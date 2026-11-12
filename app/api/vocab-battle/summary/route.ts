// app/api/vocab-battle/summary/route.ts
//
// Powers the Hi-Score badge on the Vocab Battle Arena landing page
// (/dashboard/vocab-battle). Read-only — nothing here is written to; see
// /api/vocab-battle/attempts for that. The ranking panel has its own route:
// /api/vocab-battle/leaderboard.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const db = await getDb();

  // Hi-Score for the round length the student currently plays (that of
  // their latest solo attempt) — rounds are now 20 questions, and an old
  // 10-question score isn't comparable. See /api/vocab-battle/attempts,
  // which uses the same rule to decide "New Hi-Score!".
  const highScoreRes = await db.execute({
    sql: `
      SELECT MAX(score) AS best FROM vocab_battle_attempts
      WHERE user_id = ? AND mode = 'solo' AND score_version = 3
        AND total_words = (
          SELECT total_words FROM vocab_battle_attempts
          WHERE user_id = ? AND mode = 'solo'
          ORDER BY created_at DESC, id DESC LIMIT 1
        )
    `,
    args: [user.id, user.id],
  });
  const highScore = (highScoreRes.rows[0]?.best as number | null) ?? 0;

  return NextResponse.json({ highScore });
}
