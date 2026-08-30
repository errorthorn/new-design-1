import { supabaseServer } from "@/lib/supabase";
import { getDb } from "@/lib/db";

// A test session realistically runs ~25-30 minutes. If an attempt is still
// unfinished (no completed_at) well past that — tab closed, browser
// crashed, connection died — treat it as abandoned rather than a
// still-live test. This grace window is generous on purpose: better to
// wait a bit before writing an attempt off than to cut short a real slow
// connection.
export const ORPHAN_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours

// No admin override on this account yet (see /admin/members) -> fall back
// to a 4-week program (a 1-month plan's worth) rather than showing/allowing
// nothing.
const DEFAULT_TOTAL_WEEKS = 4;

export type WeekScheduleEntry = { weekNumber: number; unlockDate: string | null };

export type WeekProgram = {
  totalWeeks: number;
  weekSchedule: WeekScheduleEntry[];
};

// Reads how many mock-test weeks this account's subscription includes
// (an admin sets this per-student — see /admin/members) and any real
// calendar dates an admin has attached to specific week numbers (see
// /admin/mock-test). Shared by every route that needs to know "which
// weeks are unlocked right now", so the dashboard, the check-in form, and
// the route that actually spends Gemini quota all agree.
export async function getWeekProgram(user: { subscriptionWeeks?: number | null }): Promise<WeekProgram> {
  const totalWeeks =
    user.subscriptionWeeks && user.subscriptionWeeks > 0 ? user.subscriptionWeeks : DEFAULT_TOTAL_WEEKS;

  const db = await getDb();
  const res = await db.execute(
    "SELECT week_number, unlock_date FROM mock_test_week_schedule ORDER BY week_number ASC"
  );
  const weekSchedule: WeekScheduleEntry[] = res.rows.map((r) => ({
    weekNumber: Number(r.week_number),
    unlockDate: (r.unlock_date as string | null) ?? null,
  }));

  return { totalWeeks, weekSchedule };
}

export type Eligibility = {
  eligible: boolean;
  nextEligibleAt: string | null;
  inProgressAttempt: { id: string; startedAt: string } | null;
};

// The single source of truth for "can this student start a test right
// now?" — used by the dashboard, the check-in form, AND the route that
// actually spends Gemini API quota, so eligibility can't be bypassed by
// calling that route directly. An abandoned (orphaned) attempt never
// costs the student a slot; only a genuinely-live or an actually-completed
// attempt affects eligibility.
//
// Eligibility is date-driven, not a rolling "7 days since your last
// attempt" rule: an admin schedules a real calendar date for each week
// number (/admin/mock-test), and a student may take ANY week whose date
// has already arrived and that they haven't completed yet — in whatever
// order. So if they skip Week 2 and Week 3's date later arrives, both
// Week 2 and Week 3 are open at once; nothing here forces date order,
// only counts how many scheduled dates (within this account's paid-for
// totalWeeks) have arrived versus how many attempts are already done.
export async function computeEligibility(studentId: string, program: WeekProgram): Promise<Eligibility> {
  const { data: liveRows } = await supabaseServer
    .from("mock_test_attempts")
    .select("id, started_at")
    .eq("student_id", studentId)
    .is("completed_at", null)
    .eq("abandoned", false)
    .order("started_at", { ascending: false })
    .limit(1);

  const live = liveRows?.[0];
  if (live) {
    const isOrphaned = Date.now() - new Date(live.started_at).getTime() >= ORPHAN_GRACE_MS;
    if (!isOrphaned) {
      return {
        eligible: false,
        nextEligibleAt: null,
        inProgressAttempt: { id: live.id, startedAt: live.started_at },
      };
    }

    // Past the grace window — this attempt is genuinely abandoned, not
    // still live. Mark it here (rather than just skipping it in memory)
    // so it stops colliding with idx_one_live_attempt_per_student and a
    // fresh attempt can actually be inserted next.
    await supabaseServer
      .from("mock_test_attempts")
      .update({ abandoned: true })
      .eq("id", live.id);
  }

  const { data: completedRows } = await supabaseServer
    .from("mock_test_attempts")
    .select("id")
    .eq("student_id", studentId)
    .not("completed_at", "is", null);

  const completedCount = completedRows?.length ?? 0;

  // Already finished every week this subscription includes.
  if (completedCount >= program.totalWeeks) {
    return { eligible: false, nextEligibleAt: null, inProgressAttempt: null };
  }

  const now = Date.now();
  const unlockedWeeks = program.weekSchedule.filter(
    (w) => w.weekNumber <= program.totalWeeks && w.unlockDate && new Date(w.unlockDate).getTime() <= now
  ).length;

  // At least one scheduled-and-arrived week hasn't been taken yet.
  if (completedCount < unlockedWeeks) {
    return { eligible: true, nextEligibleAt: null, inProgressAttempt: null };
  }

  // Caught up on everything unlocked so far — surface the soonest
  // still-upcoming scheduled date, if an admin has set one, so the
  // dashboard can show "unlocks <date>". If no future date has been set
  // yet, nextEligibleAt is null (admin hasn't scheduled that far ahead).
  const upcoming = program.weekSchedule
    .filter((w) => w.weekNumber <= program.totalWeeks && w.unlockDate && new Date(w.unlockDate).getTime() > now)
    .sort((a, b) => new Date(a.unlockDate as string).getTime() - new Date(b.unlockDate as string).getTime())[0];

  return {
    eligible: false,
    nextEligibleAt: upcoming?.unlockDate ?? null,
    inProgressAttempt: null,
  };
}

// Confirms `attemptId` belongs to a student row linked to `userEmail`'s
// account — the same ownership check used by upload-audio.ts, shared here
// so /api/mock-test/complete can use it too instead of trusting the
// attemptId in the request body on its own.
export async function checkAttemptOwnership(attemptId: string, userEmail: string) {
  const { data: attempt } = await supabaseServer
    .from("mock_test_attempts")
    .select("id, student_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt) return null;

  const { data: student } = await supabaseServer
    .from("students")
    .select("id")
    .eq("id", attempt.student_id)
    .eq("user_email", userEmail)
    .maybeSingle();

  return student ? attempt : null;
}
