import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";
import { computeEligibility, getWeekProgram } from "@/lib/mock-test";

// Powers the /mock-test dashboard. Which weeks are unlocked comes from
// getWeekProgram() (subscription-based week count + admin-scheduled
// dates, see lib/mock-test.ts) — not an invented fixed "week 7 of 12".
export async function GET(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  // /dashboard's Home cards only need completed_at/score to show progress
  // and the latest score (see MockTestCard/NextTestCard in
  // components/dashboard/home/home-view.tsx) — they never display a
  // transcript or feedback. Those two columns can be substantial text per
  // attempt (a full speech transcript + AI/teacher feedback), so pulling
  // them on every dashboard load for every past week was pure waste; only
  // /mock-test's own history view (which actually shows that text) asks
  // for the full columns.
  const light = req.nextUrl.searchParams.get("light") === "1";
  const attemptColumns = light
    ? "id, started_at, completed_at, score"
    : "id, started_at, completed_at, score, transcript, feedback, audio_path";

  const { data: student } = await supabaseServer
    .from("students")
    .select("id")
    .eq("user_email", user.email)
    .maybeSingle();

  // How many weeks this account's subscription includes, and any real
  // dates an admin has scheduled for specific week numbers. Read
  // regardless of whether a `student` row exists yet, since even a
  // first-time visitor should see the right week count.
  const { totalWeeks, weekSchedule } = await getWeekProgram(user);

  // Never taken a test yet — no student row exists. Not an error: they're
  // simply eligible to take their first one, provided at least one
  // scheduled week has actually arrived (same "any unlocked week counts"
  // rule as computeEligibility, just with 0 completed attempts).
  if (!student) {
    const now = Date.now();
    const arrived = weekSchedule.filter(
      (w) => w.weekNumber <= totalWeeks && w.unlockDate && new Date(w.unlockDate).getTime() <= now
    );
    const upcoming = weekSchedule
      .filter((w) => w.weekNumber <= totalWeeks && w.unlockDate && new Date(w.unlockDate).getTime() > now)
      .sort((a, b) => new Date(a.unlockDate as string).getTime() - new Date(b.unlockDate as string).getTime())[0];

    return NextResponse.json({
      attempts: [],
      eligible: arrived.length > 0,
      nextEligibleAt: arrived.length > 0 ? null : upcoming?.unlockDate ?? null,
      inProgressAttemptId: null,
      totalWeeks,
      weekSchedule,
    });
  }

  const { data: attempts, error } = await supabaseServer
    .from("mock_test_attempts")
    .select(attemptColumns)
    .eq("student_id", student.id)
    .order("started_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Same eligibility rule used everywhere else (check-in form, the route
  // that actually spends Gemini quota) — this is also what keeps an
  // abandoned/orphaned attempt from showing as "in progress" forever, since
  // computeEligibility only treats a recently-started incomplete attempt as
  // genuinely live.
  const { eligible, nextEligibleAt, inProgressAttempt } = await computeEligibility(student.id, {
    totalWeeks,
    weekSchedule,
  });

  return NextResponse.json({
    attempts: attempts ?? [],
    eligible,
    nextEligibleAt,
    inProgressAttemptId: inProgressAttempt?.id ?? null,
    totalWeeks,
    weekSchedule,
  });
}
