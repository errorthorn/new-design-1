// app/api/vocab-battle/live/create/route.ts
//
// "Create Room" side of invite-by-code Live Multiplayer. Makes a match row
// with a room code and no player2 yet, then the creator's client polls
// GET /api/vocab-battle/live/match/[matchId] waiting for someone to join
// (see app/dashboard/vocab-battle/live/[matchId]/page.tsx).
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/api-auth";
import { generateUniqueRoomCode } from "@/lib/vocab-battle-room-code";

export async function POST() {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const db = await getDb();
  const name = user.name || "Student";

  let roomCode: string;
  try {
    roomCode = await generateUniqueRoomCode();
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Could not create a room." }, { status: 500 });
  }

  const insertRes = await db.execute({
    sql: `
      INSERT INTO vocab_battle_matches (room_code, source, status, player1_id, player1_name)
      VALUES (?, 'invite', 'waiting', ?, ?)
    `,
    args: [roomCode, user.id, name],
  });

  return NextResponse.json({ matchId: Number(insertRes.lastInsertRowid), roomCode });
}
