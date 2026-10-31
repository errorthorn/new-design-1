// app/api/vocab-battle/live/attempts/route.ts
//
// Called once when a player finishes their side of a Live Multiplayer
// match (mirrors /api/vocab-battle/attempts for Solo). Records their score
// on the match row and logs a vocab_battle_attempts row with mode='live'.
// Once BOTH player1_score and player2_score are set, the match is finalized
// (status -> 'finished', winner_id computed) — the results screen then
// picks that up via GET /api/vocab-battle/live/match/[matchId].
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/api-auth";

export async function POST(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const body = await req.json().catch(() => null);
  const matchId = Number(body?.matchId);
  const score = Number(body?.score);
  const correctCount = Number(body?.correctCount);
  const totalWords = Number(body?.totalWords);
  const bestStreak = Number(body?.bestStreak ?? 0);
  const durationSecondsRaw = body?.durationSeconds;
  const durationSeconds =
    Number.isFinite(Number(durationSecondsRaw)) && Number(durationSecondsRaw) >= 0
      ? Math.round(Number(durationSecondsRaw))
      : null;

  if (
    !Number.isFinite(matchId) ||
    !Number.isFinite(score) ||
    !Number.isFinite(correctCount) ||
    !Number.isFinite(totalWords) ||
    totalWords <= 0
  ) {
    return NextResponse.json({ error: "Invalid attempt payload" }, { status: 400 });
  }

  const db = await getDb();
  const matchRes = await db.execute({
    sql: `SELECT id, status, player1_id, player2_id, player1_score, player2_score FROM vocab_battle_matches WHERE id = ?`,
    args: [matchId],
  });
  const match = matchRes.rows[0];
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const isPlayer1 = match.player1_id === user.id;
  const isPlayer2 = match.player2_id === user.id;
  if (!isPlayer1 && !isPlayer2) {
    return NextResponse.json({ error: "You're not part of this match." }, { status: 403 });
  }
  if (match.status === "waiting") {
    return NextResponse.json({ error: "This match hasn't started yet." }, { status: 409 });
  }

  // Idempotent: if this player already submitted (e.g. a retried request),
  // just overwrite their own score column rather than logging a duplicate
  // attempts row.
  const scoreColumn = isPlayer1 ? "player1_score" : "player2_score";
  await db.execute({
    sql: `UPDATE vocab_battle_matches SET ${scoreColumn} = ? WHERE id = ?`,
    args: [score, matchId],
  });

  await db.execute({
    sql: `
      INSERT INTO vocab_battle_attempts
        (user_id, mode, score, correct_count, total_words, best_streak, duration_seconds, match_id, created_at)
      VALUES (?, 'live', ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
    args: [user.id, score, correctCount, totalWords, bestStreak, durationSeconds, matchId],
  });

  // Check whether both sides are in now (re-fetch fresh values).
  const freshRes = await db.execute({
    sql: `SELECT player1_id, player2_id, player1_score, player2_score FROM vocab_battle_matches WHERE id = ?`,
    args: [matchId],
  });
  const fresh = freshRes.rows[0];
  const p1Score = fresh?.player1_score as number | null;
  const p2Score = fresh?.player2_score as number | null;

  if (p1Score != null && p2Score != null) {
    let winnerId: number | null = null;
    if (p1Score > p2Score) winnerId = fresh!.player1_id as number;
    else if (p2Score > p1Score) winnerId = fresh!.player2_id as number;
    // else draw — winnerId stays null

    await db.execute({
      sql: `UPDATE vocab_battle_matches SET status = 'finished', finished_at = datetime('now'), winner_id = ? WHERE id = ?`,
      args: [winnerId, matchId],
    });
  }

  return NextResponse.json({ ok: true });
}
