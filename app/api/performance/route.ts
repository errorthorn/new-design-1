// app/api/performance/route.ts
//
// Powers /dashboard/performance — the signed-in student's own overview,
// distinct from /dashboard/leaderboard (everyone's ranking). Pulls from
// all three point-in-time-tracked activities:
//   - Mock Test   (Supabase: mock_test_attempts, via students.user_email)
//   - Quiz        (Supabase: quiz_attempts, by user_email)
//   - Vocab Battle(Turso:    vocab_battle_attempts, by user_id)
// plus Speaking Club call time (Supabase: speaking_turn_usage, by
// username = email) for the time-spent total.
//
// Two numbers here are worth flagging if this ever needs revisiting:
//
// 1. Time spent. Quiz and Mock Test already store started_at/completed_at,
//    so their time is a real elapsed duration. Vocab Battle didn't track
//    duration until this route was added — see the duration_seconds
//    column on vocab_battle_attempts (lib/db.ts) and the client-side
//    timing in app/dashboard/vocab-battle/solo/page.tsx. Attempts logged
//    before that column existed contribute 0 seconds, not a guess.
//    Speaking Club minutes come from speaking_turn_usage, which is an
//    append-only relay-monitoring log, not a purpose-built time tracker —
//    it's a reasonable proxy (one row roughly per call this student was
//    in) but wasn't designed for this, so treat it as approximate.
//
// 2. Streak. Counts *calendar days* (not weeks) with at least one
//    qualifying activity of any kind, across all-time data — deliberately
//    not scoped to the period filter, since a "7-day weekly streak" reset
//    by a period dropdown would be a confusing streak. This is a
//    different definition from the "weeks between mock tests" streak
//    already shown on /profile (which only looks at Mock Test, spaced by
//    the weekly test cadence) — that one measures mock-test discipline
//    specifically; this one measures "did I do *something* today."
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { supabaseServer } from "@/lib/supabase";
import { getMockTestRanking, isoCutoffFor, type Period } from "@/lib/mock-test-ranking";

function toSqliteCutoff(isoCutoff: string | null): string | null {
  if (!isoCutoff) return null;
  return isoCutoff.slice(0, 19).replace("T", " ");
}

function dateKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD, UTC calendar day
}

export async function GET(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const periodParam = req.nextUrl.searchParams.get("period");
  const period: Period =
    periodParam === "monthly" || periodParam === "all" ? periodParam : "weekly";
  // /dashboard's Home cards only ever read rank/avgBand/totalRanked and
  // currentStreakDays from this endpoint (see components/dashboard/home/
  // home-view.tsx) — every other field here (attempt breakdowns, time
  // spent, trend) was being computed and thrown away on every single
  // dashboard load. ?light=1 skips exactly that unused work; the full
  // /dashboard/performance page calls this without the flag and is
  // unaffected.
  const light = req.nextUrl.searchParams.get("light") === "1";

  const isoCutoff = isoCutoffFor(period);
  const sqliteCutoff = toSqliteCutoff(isoCutoff);
  const email = user.email.toLowerCase();
  const db = await getDb();

  // --- Rank + student row are independent of each other — fetch together ---
  const [ranking, studentRes] = await Promise.all([
    getMockTestRanking(period),
    supabaseServer.from("students").select("id").eq("user_email", user.email).maybeSingle(),
  ]);
  const student = studentRes.data;

  const rankIndex = ranking.findIndex((r) => r.email === email);
  const myRank = rankIndex === -1 ? null : rankIndex + 1;
  const myAvgBand = rankIndex === -1 ? null : ranking[rankIndex].avgBand;
  const totalRanked = ranking.length;

  // --- Everything below only depends on `student` (already known) and
  // `user`, so all of it can run concurrently instead of one-request-at-
  // a-time. Each piece keeps its own try/catch so one slow/unreachable
  // source still degrades to "contributes 0", exactly as before —
  // parallelizing doesn't change any behavior, only the timing. ------------

  async function fetchQuiz() {
    try {
      let q = supabaseServer
        .from("quiz_attempts")
        .select("started_at, completed_at")
        .eq("user_email", user.email)
        .not("completed_at", "is", null);
      if (isoCutoff) q = q.gte("completed_at", isoCutoff);
      const { data, error } = await q;
      if (error) throw error;
      let attempts = 0;
      let seconds = 0;
      for (const a of data ?? []) {
        attempts++;
        if (a.started_at && a.completed_at) {
          const secs = (new Date(a.completed_at).getTime() - new Date(a.started_at).getTime()) / 1000;
          if (secs > 0) seconds += secs;
        }
      }
      return { attempts, seconds };
    } catch {
      return { attempts: 0, seconds: 0 };
    }
  }

  async function fetchMock() {
    if (!student) return { attempts: 0, seconds: 0 };
    try {
      let m = supabaseServer
        .from("mock_test_attempts")
        .select("started_at, completed_at")
        .eq("student_id", student.id)
        .not("completed_at", "is", null);
      if (isoCutoff) m = m.gte("completed_at", isoCutoff);
      const { data, error } = await m;
      if (error) throw error;
      let attempts = 0;
      let seconds = 0;
      for (const a of data ?? []) {
        attempts++;
        if (a.started_at && a.completed_at) {
          const secs = (new Date(a.completed_at).getTime() - new Date(a.started_at).getTime()) / 1000;
          if (secs > 0) seconds += secs;
        }
      }
      return { attempts, seconds };
    } catch {
      return { attempts: 0, seconds: 0 };
    }
  }

  async function fetchVocabBattle() {
    const vbRes = await db.execute({
      sql: `
        SELECT COUNT(*) AS attempts, COALESCE(SUM(duration_seconds), 0) AS total_seconds
        FROM vocab_battle_attempts
        WHERE user_id = ? AND mode = 'solo' ${sqliteCutoff ? "AND created_at >= ?" : ""}
      `,
      args: sqliteCutoff ? [user.id, sqliteCutoff] : [user.id],
    });
    return {
      attempts: (vbRes.rows[0]?.attempts as number) ?? 0,
      seconds: (vbRes.rows[0]?.total_seconds as number) ?? 0,
    };
  }

  async function fetchSpeakingSeconds() {
    try {
      let s = supabaseServer
        .from("speaking_turn_usage")
        .select("call_duration_seconds, created_at")
        .eq("username", user.email);
      if (isoCutoff) s = s.gte("created_at", isoCutoff);
      const { data, error } = await s;
      if (error) throw error;
      let seconds = 0;
      for (const row of data ?? []) seconds += Number(row.call_duration_seconds ?? 0);
      return seconds;
    } catch {
      return 0;
    }
  }

  // --- Streak sources (all-time, no period cutoff — see file note) ---------
  async function fetchStreakDates() {
    const dates = new Set<string>();
    try {
      const [{ data: quizDates }, { data: speakingDates }] = await Promise.all([
        supabaseServer.from("quiz_attempts").select("completed_at").eq("user_email", user.email).not("completed_at", "is", null),
        supabaseServer.from("speaking_turn_usage").select("created_at").eq("username", user.email),
      ]);
      for (const r of quizDates ?? []) if (r.completed_at) dates.add(dateKey(r.completed_at));
      for (const r of speakingDates ?? []) if (r.created_at) dates.add(dateKey(r.created_at));

      if (student) {
        const { data: mockDates } = await supabaseServer
          .from("mock_test_attempts")
          .select("completed_at")
          .eq("student_id", student.id)
          .not("completed_at", "is", null);
        for (const r of mockDates ?? []) if (r.completed_at) dates.add(dateKey(r.completed_at));
      }
    } catch {
      // Partial data is fine for a streak — worst case it undercounts.
    }

    const vbDatesRes = await db.execute({
      sql: `SELECT DISTINCT date(created_at) AS d FROM vocab_battle_attempts WHERE user_id = ? AND mode = 'solo'`,
      args: [user.id],
    });
    for (const row of vbDatesRes.rows) {
      if (row.d) dates.add(row.d as string);
    }
    return dates;
  }

  async function fetchTrend() {
    if (!student) return [] as { date: string; band: number }[];
    try {
      const { data, error } = await supabaseServer
        .from("mock_test_attempts")
        .select("completed_at, score")
        .eq("student_id", student.id)
        .not("completed_at", "is", null)
        .not("score", "is", null)
        .order("completed_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((a) => ({
        date: dateKey(a.completed_at as string),
        band: Number(a.score),
      }));
    } catch {
      return [];
    }
  }

  const [quiz, mock, vocabBattle, speakingSeconds, activeDates, trend] = light
    ? await Promise.all([
        Promise.resolve({ attempts: 0, seconds: 0 }),
        Promise.resolve({ attempts: 0, seconds: 0 }),
        Promise.resolve({ attempts: 0, seconds: 0 }),
        Promise.resolve(0),
        fetchStreakDates(),
        Promise.resolve([] as { date: string; band: number }[]),
      ])
    : await Promise.all([
        fetchQuiz(),
        fetchMock(),
        fetchVocabBattle(),
        fetchSpeakingSeconds(),
        fetchStreakDates(),
        fetchTrend(),
      ]);

  let currentStreakDays = 0;
  {
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    // A streak "survives" through today even if today has no activity yet
    // — it only breaks once a full day has passed with nothing logged.
    if (!activeDates.has(cursor.toISOString().slice(0, 10))) {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    while (activeDates.has(cursor.toISOString().slice(0, 10))) {
      currentStreakDays++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  return NextResponse.json({
    period,
    rank: myRank,
    totalRanked,
    avgBand: myAvgBand,
    totalAttempts: quiz.attempts + mock.attempts + vocabBattle.attempts,
    breakdown: { quiz: quiz.attempts, mockTest: mock.attempts, vocabBattle: vocabBattle.attempts },
    timeSpentSeconds: Math.round(quiz.seconds + mock.seconds + vocabBattle.seconds + speakingSeconds),
    currentStreakDays,
    trend,
  });
}
