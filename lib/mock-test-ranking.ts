// lib/mock-test-ranking.ts
//
// Shared by app/api/leaderboard/route.ts (top 10) and
// app/api/performance/route.ts (one student's own rank, which may well be
// outside the top 10) — both need the *same full* sorted list so a
// student's rank number always matches what the leaderboard would show if
// they scrolled far enough, rather than two routes quietly drifting apart.
//
// Ranked by average IELTS speaking band across a student's *scored*
// (teacher-graded) Mock Test attempts in the given period — see the
// leaderboard route's file comment for why Mock Test alone, not a blend
// with Quiz/Vocab Battle points.
import { supabaseServer } from "@/lib/supabase";

export type Period = "weekly" | "monthly" | "all";

export function isoCutoffFor(period: Period): string | null {
  if (period === "all") return null;
  const days = period === "weekly" ? 7 : 30;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export type RankedStudent = {
  email: string;
  avgBand: number;
  attempts: number;
};

// getMockTestRanking does a full scan (every student + every mock_test
// attempt in the period) to sort everyone by band — necessary once, but
// every dashboard load and every leaderboard view was triggering its own
// fresh scan, so N students loading /dashboard around the same time meant
// N identical full scans for an answer that doesn't change second to
// second. A short cache means the *first* request in this window pays for
// the scan and everyone else within it reuses the result — rankings being
// up to this many seconds stale is an acceptable trade for a leaderboard.
const RANKING_CACHE_TTL_MS = 30_000;
const rankingCache = new Map<Period, { data: RankedStudent[]; expiresAt: number }>();

/**
 * Full list of students with at least one scored Mock Test attempt in the
 * period, sorted best-band-first. Not sliced — callers decide how much of
 * it they need (top N for the leaderboard, or a `findIndex` for one
 * student's rank).
 */
export async function getMockTestRanking(period: Period): Promise<RankedStudent[]> {
  const cached = rankingCache.get(period);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const result = await computeMockTestRanking(period);
  rankingCache.set(period, { data: result, expiresAt: Date.now() + RANKING_CACHE_TTL_MS });
  return result;
}

async function computeMockTestRanking(period: Period): Promise<RankedStudent[]> {
  const isoCutoff = isoCutoffFor(period);
  const byEmail = new Map<string, { totalBand: number; scoredAttempts: number }>();

  try {
    let attemptsQuery = supabaseServer
      .from("mock_test_attempts")
      .select("student_id, score, completed_at")
      .not("completed_at", "is", null)
      .not("score", "is", null);
    if (isoCutoff) attemptsQuery = attemptsQuery.gte("completed_at", isoCutoff);

    // Independent of each other (attempts are keyed by student_id, not by
    // anything the students query returns), so fetch both at once instead
    // of waiting on one before starting the other.
    const [studentsRes, attemptsRes] = await Promise.all([
      supabaseServer.from("students").select("id, user_email").not("user_email", "is", null),
      attemptsQuery,
    ]);
    if (studentsRes.error) throw studentsRes.error;
    if (attemptsRes.error) throw attemptsRes.error;

    const emailByStudentId = new Map<string, string>();
    for (const s of studentsRes.data ?? []) {
      if (s.user_email) emailByStudentId.set(s.id as string, String(s.user_email).toLowerCase());
    }

    for (const a of attemptsRes.data ?? []) {
      const email = emailByStudentId.get(a.student_id as string);
      if (!email) continue;
      const prev = byEmail.get(email) ?? { totalBand: 0, scoredAttempts: 0 };
      byEmail.set(email, {
        totalBand: prev.totalBand + Number(a.score ?? 0),
        scoredAttempts: prev.scoredAttempts + 1,
      });
    }
  } catch {
    // Supabase not configured / unreachable — callers get an empty
    // ranking rather than a 500.
  }

  return Array.from(byEmail.entries())
    .map(([email, v]) => ({
      email,
      avgBand: Math.round((v.totalBand / v.scoredAttempts) * 10) / 10,
      attempts: v.scoredAttempts,
    }))
    .sort((a, b) => b.avgBand - a.avgBand);
}
