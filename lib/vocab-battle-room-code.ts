// lib/vocab-battle-room-code.ts
//
// Short invite codes for Live Multiplayer "Create Room" matches. Same
// character set as lib/referral.ts's randomCode (no 0/O/1/I — easy to read
// aloud or type on a phone), kept separate because this one collides
// against vocab_battle_matches.room_code, not users.referral_code.

import { getDb } from "@/lib/db";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
const MAX_ATTEMPTS = 8;

function randomCode(length: number) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

/** Generates a room code guaranteed not to collide with an existing open/active match. */
export async function generateUniqueRoomCode(): Promise<string> {
  const db = await getDb();
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const code = randomCode(CODE_LENGTH);
    const existing = await db.execute({
      sql: `SELECT 1 FROM vocab_battle_matches WHERE room_code = ?`,
      args: [code],
    });
    if (!existing.rows[0]) return code;
  }
  throw new Error("Could not generate a unique room code, please try again.");
}
