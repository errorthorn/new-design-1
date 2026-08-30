// app/api/vocab-battle/live/match/[matchId]/route.ts
//
// Used two ways by app/dashboard/vocab-battle/live/[matchId]/page.tsx:
//   1. Right after create/join/queue-match, to fetch the shared question
//      set (and, for the room-creator, to poll waiting -> active once
//      someone joins their room code).
//   2. After submitting this player's own attempt, to poll waiting ->
//      finished once the opponent submits theirs too, so the results
//      screen can reveal both scores at the same time.
//
// Always resolves "you" vs "opponent" server-side from the signed-in user
// id — never trusts the client to say which side it is.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/api-auth";

export async function GET(_req: NextRequest, { params }: { params: { matchId: string } }) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const matchId = Number(params.matchId);
  if (!Number.isFinite(matchId)) {
    return NextResponse.json({ error: "Invalid match id." }, { status: 400 });
  }

  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT * FROM vocab_battle_matches WHERE id = ?`,
    args: [matchId],
  });
  const match = res.rows[0];
  if (!match) {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }

  const isPlayer1 = match.player1_id === user.id;
  const isPlayer2 = match.player2_id === user.id;
  if (!isPlayer1 && !isPlayer2) {
    return NextResponse.json({ error: "You're not part of this match." }, { status: 403 });
  }

  const yourScore = (isPlayer1 ? match.player1_score : match.player2_score) as number | null;
  const opponentScore = (isPlayer1 ? match.player2_score : match.player1_score) as number | null;
  const opponentName = (isPlayer1 ? match.player2_name : match.player1_name) as string | null;

  let winner: "you" | "opponent" | "draw" | null = null;
  if (match.status === "finished") {
    if (match.winner_id == null) winner = "draw";
    else winner = match.winner_id === user.id ? "you" : "opponent";
  }

  return NextResponse.json({
    status: match.status, // 'waiting' | 'active' | 'finished'
    roomCode: match.room_code,
    opponentName,
    questions: match.questions_json ? JSON.parse(match.questions_json as string) : null,
    yourScore,
    opponentScore,
    winner,
  });
}
