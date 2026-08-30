// app/api/vocab-battle/summary/route.ts
//
// Powers the Hi-Score badge and Battle History panel on the Vocab Battle
// Arena landing page (/dashboard/vocab-battle). Read-only — nothing here
// is written to; see /api/vocab-battle/attempts for that.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

const HISTORY_LIMIT = 10;

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const db = await getDb();

  const highScoreRes = await db.execute({
    sql: `SELECT MAX(score) AS best FROM vocab_battle_attempts WHERE user_id = ? AND mode = 'solo'`,
    args: [user.id],
  });
  const highScore = (highScoreRes.rows[0]?.best as number | null) ?? 0;

  const historyRes = await db.execute({
    sql: `
      SELECT id, mode, score, correct_count, total_words, best_streak, created_at
      FROM vocab_battle_attempts
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    args: [user.id, HISTORY_LIMIT],
  });

  const history = historyRes.rows.map((row) => ({
    id: row.id,
    mode: row.mode,
    score: row.score,
    correctCount: row.correct_count,
    totalWords: row.total_words,
    bestStreak: row.best_streak,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ highScore, history });
}
