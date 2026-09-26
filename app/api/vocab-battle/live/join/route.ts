// app/api/vocab-battle/live/join/route.ts
//
// "Join Room" side of invite-by-code Live Multiplayer. Looks up the room
// code, generates the shared question round (see lib/vocab-battle-questions),
// and flips the match to active — from this point both players' clients
// are racing through the exact same words.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/api-auth";
import { buildVocabBattleRound } from "@/lib/vocab-battle-questions";

export async function POST(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const body = await req.json().catch(() => null);
  const roomCode = String(body?.roomCode || "").trim().toUpperCase();
  if (!roomCode) {
    return NextResponse.json({ error: "Enter a room code." }, { status: 400 });
  }

  const db = await getDb();
  const matchRes = await db.execute({
    sql: `SELECT id, status, player1_id FROM vocab_battle_matches WHERE room_code = ?`,
    args: [roomCode],
  });
  const match = matchRes.rows[0];

  if (!match) {
    return NextResponse.json({ error: "Room not found. Check the code and try again." }, { status: 404 });
  }
  if (match.player1_id === user.id) {
    return NextResponse.json({ error: "You can't join your own room." }, { status: 400 });
  }
  if (match.status !== "waiting") {
    return NextResponse.json({ error: "This room has already started or ended." }, { status: 409 });
  }

  let questions;
  try {
    questions = await buildVocabBattleRound();
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Not enough vocabulary words yet to start a battle." },
      { status: 409 }
    );
  }

  const name = user.name || "Student";

  // Guard the room-still-waiting condition in the WHERE clause too, so two
  // people racing to join the same room code at the same instant can't
  // both succeed — only the first UPDATE actually changes a row.
  const updateRes = await db.execute({
    sql: `
      UPDATE vocab_battle_matches
      SET player2_id = ?, player2_name = ?, questions_json = ?, status = 'active', started_at = datetime('now')
      WHERE id = ? AND status = 'waiting'
    `,
    args: [user.id, name, JSON.stringify(questions), match.id],
  });

  if (updateRes.rowsAffected === 0) {
    return NextResponse.json({ error: "This room has already started or ended." }, { status: 409 });
  }

  return NextResponse.json({ matchId: match.id });
}
