// app/api/vocab-battle/leaderboard/route.ts
//
// Powers the ranking panel on the Vocab Battle Arena page
// (/dashboard/vocab-battle), which replaced the old per-student "Battle
// History" list so students compete against each other, not just their
// own past rounds.
//
// Ranked by TOTAL POINTS earned in the selected period, across Solo and
// Live rounds (score_version = 3 only — an older, differently-scaled
// score isn't comparable, same rule the Hi-Score uses). Ties are broken
// by accuracy (correct answers / questions), then by user id so the order
// is always stable between requests.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

type Period = "weekly" | "monthly" | "all";

const TOP_LIMIT = 10;

// Same idea as lib/mock-test-ranking.ts: the ranking is a full GROUP BY
// over every attempt, and it doesn't change second to second, so one
// request per window pays for it and the rest reuse the result.
const CACHE_TTL_MS = 30_000;

type RankedRow = {
  userId: number;
  name: string;
  avatarUrl: string | null;
  isMember: boolean;
  points: number;
  games: number;
  accuracy: number; // 0-100
  rank: number;
};

const cache = new Map<Period, { data: RankedRow[]; expiresAt: number }>();

const CUTOFF_SQL: Record<Period, string> = {
  weekly: "AND a.created_at >= datetime('now', '-7 days')",
  monthly: "AND a.created_at >= datetime('now', '-30 days')",
  all: "",
};

async function getRanking(period: Period): Promise<RankedRow[]> {
  const cached = cache.get(period);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const db = await getDb();
  const res = await db.execute({
    sql: `
      SELECT
        u.id AS user_id,
        u.name AS name,
        u.email AS email,
        u.avatar_url AS avatar_url,
        u.subscription_active AS subscription_active,
        SUM(a.score) AS points,
        COUNT(*) AS games,
        SUM(a.correct_count) AS correct,
        SUM(a.total_words) AS total
      FROM vocab_battle_attempts a
      JOIN users u ON u.id = a.user_id
      WHERE a.score_version = 3 ${CUTOFF_SQL[period]}
      GROUP BY u.id
      HAVING SUM(a.score) > 0
      ORDER BY
        points DESC,
        (CAST(SUM(a.correct_count) AS REAL) / MAX(SUM(a.total_words), 1)) DESC,
        u.id ASC
    `,
    args: [],
  });

  const data: RankedRow[] = res.rows.map((r, i) => {
    const total = Number(r.total) || 0;
    const correct = Number(r.correct) || 0;
    return {
      userId: Number(r.user_id),
      name: (r.name as string) || String(r.email).split("@")[0],
      avatarUrl: (r.avatar_url as string) || null,
      isMember: Boolean(r.subscription_active),
      points: Number(r.points) || 0,
      games: Number(r.games) || 0,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      rank: i + 1,
    };
  });

  cache.set(period, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

export async function GET(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const p = req.nextUrl.searchParams.get("period");
  const period: Period = p === "monthly" || p === "all" ? p : "weekly";

  const ranking = await getRanking(period);

  return NextResponse.json({
    period,
    rankings: ranking.slice(0, TOP_LIMIT),
    // The signed-in student's own row (null if they have no points in this
    // period) — returned even when they're outside the top list so they
    // can always see where they stand.
    me: ranking.find((r) => r.userId === Number(user.id)) ?? null,
    totalPlayers: ranking.length,
    currentUserId: Number(user.id),
  });
}
