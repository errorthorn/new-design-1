// app/api/leaderboard/route.ts
//
// Powers /dashboard/leaderboard. Ranked purely on Mock Test — the IELTS
// speaking band (0-9), average of a student's *scored* attempts in the
// selected period.
//
// Quiz and Vocab Battle were tried as a blended points score in an
// earlier version of this route, but that meant averaging two
// incompatible scales (raw points vs. a 0-9 band) into one number that
// didn't honestly mean anything. Mock Test alone keeps the ranking
// legible: it's the one graded, examiner-reviewed activity, so "#1 on
// the leaderboard" means "highest average speaking band," not a fudge.
//
// The ranking itself comes from lib/mock-test-ranking.ts, shared with
// app/api/performance/route.ts so a student's own rank always matches
// this list, not a separately-computed one.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { getMockTestRanking, type Period } from "@/lib/mock-test-ranking";

const RANKED_LIMIT = 10;

export async function GET(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const periodParam = req.nextUrl.searchParams.get("period");
  const period: Period =
    periodParam === "monthly" || periodParam === "all" ? periodParam : "weekly";

  const ranking = await getMockTestRanking(period);

  // getMockTestRanking already returns everyone sorted best-band-first, so
  // the leaderboard only ever needs the first RANKED_LIMIT emails — fetch
  // just those users' rows instead of the previous `SELECT * FROM users`,
  // which pulled every single account on every leaderboard view regardless
  // of how many actually made the top 10.
  const top = ranking.slice(0, RANKED_LIMIT);
  if (top.length === 0) {
    return NextResponse.json({ period, rankings: [], currentUserId: user.id });
  }

  const db = await getDb();
  const placeholders = top.map(() => "?").join(", ");
  const usersRes = await db.execute({
    sql: `SELECT id, name, email, avatar_url, subscription_active FROM users WHERE LOWER(email) IN (${placeholders})`,
    args: top.map((r) => r.email),
  });

  const usersByEmail = new Map(usersRes.rows.map((u) => [String(u.email).toLowerCase(), u]));

  const combined = top
    .map((entry, i) => {
      const u = usersByEmail.get(entry.email);
      if (!u) return null; // ranked in mock_test_attempts but the account row is gone somehow

      return {
        id: u.id as number,
        name: (u.name as string) || (u.email as string).split("@")[0],
        email: u.email as string,
        avatarUrl: (u.avatar_url as string) || null,
        isMember: Boolean(u.subscription_active),
        attempts: entry.attempts,
        avgBand: entry.avgBand,
        score: entry.avgBand,
        rank: i + 1,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return NextResponse.json({
    period,
    rankings: combined,
    currentUserId: user.id,
  });
}
