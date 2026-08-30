// app/api/vocab-battle/attempts/route.ts
//
// Called once when a Solo Challenge round ends (all words answered or the
// student exits early with at least one word attempted). Logs the result
// to vocab_battle_attempts and tells the client whether this run beat their
// previous best, so the results screen can show a "New Hi-Score!" badge.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await req.json().catch(() => null);
  const score = Number(body?.score);
  const correctCount = Number(body?.correctCount);
  const totalWords = Number(body?.totalWords);
  const bestStreak = Number(body?.bestStreak ?? 0);
  // Client-timed (round start to submit) — optional so older clients (or a
  // clock/tab-suspend edge case) that don't send it don't fail the whole
  // attempt. See app/dashboard/vocab-battle/solo/page.tsx.
  const durationSecondsRaw = body?.durationSeconds;
  const durationSeconds =
    Number.isFinite(Number(durationSecondsRaw)) && Number(durationSecondsRaw) >= 0
      ? Math.round(Number(durationSecondsRaw))
      : null;

  if (
    !Number.isFinite(score) ||
    !Number.isFinite(correctCount) ||
    !Number.isFinite(totalWords) ||
    totalWords <= 0
  ) {
    return NextResponse.json({ error: "Invalid attempt payload" }, { status: 400 });
  }

  const db = await getDb();

  const priorBestRes = await db.execute({
    sql: `SELECT MAX(score) AS best FROM vocab_battle_attempts WHERE user_id = ? AND mode = 'solo'`,
    args: [user.id],
  });
  const priorBest = (priorBestRes.rows[0]?.best as number | null) ?? 0;

  await db.execute({
    sql: `
      INSERT INTO vocab_battle_attempts
        (user_id, mode, score, correct_count, total_words, best_streak, duration_seconds, created_at)
      VALUES (?, 'solo', ?, ?, ?, ?, ?, datetime('now'))
    `,
    args: [user.id, score, correctCount, totalWords, bestStreak, durationSeconds],
  });

  return NextResponse.json({
    isNewHighScore: score > priorBest,
    highScore: Math.max(score, priorBest),
  });
}
