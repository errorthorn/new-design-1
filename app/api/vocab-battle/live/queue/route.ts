// app/api/vocab-battle/live/queue/route.ts
//
// Random-matchmaking waiting room for Live Multiplayer. No realtime/socket
// needed — the client (app/dashboard/vocab-battle/live/page.tsx) just calls
// POST every couple of seconds while waiting, which is cheap and works fine
// on Vercel's serverless functions (no long-lived connection required).
//
// POST is deliberately both "join" and "poll" in one idempotent call:
//   1. If someone already matched against us (their POST beat ours), grab
//      that match and stop.
//   2. Otherwise, look for another unmatched waiting member. If found, we
//      become the match-maker: create the match, mark THEIR row matched
//      (their next POST picks it up per step 1), and return the new
//      matchId immediately.
//   3. Otherwise, make sure we have a queue row and report "waiting".
//
// Re-running the same POST every poll (instead of a separate GET) is what
// makes this self-healing: if two students call POST at the exact same
// instant and both end up waiting as separate rows (step 2 found nobody
// for either, because neither had committed yet), the very next poll a
// couple of seconds later will match them against each other.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireActiveMember } from "@/lib/api-auth";
import { buildVocabBattleRound } from "@/lib/vocab-battle-questions";

export async function POST() {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const db = await getDb();
  const name = user.name || "Student";

  // Step 1: were we already matched by someone else's POST?
  const mine = await db.execute({
    sql: `SELECT matched_match_id FROM vocab_battle_queue WHERE user_id = ?`,
    args: [user.id],
  });
  const myMatchedId = mine.rows[0]?.matched_match_id as number | null | undefined;
  if (myMatchedId) {
    await db.execute({ sql: `DELETE FROM vocab_battle_queue WHERE user_id = ?`, args: [user.id] });
    return NextResponse.json({ status: "matched", matchId: myMatchedId });
  }

  // Step 2: is anyone else waiting for an opponent RIGHT NOW? "Right now"
  // means their row was touched (inserted or heartbeat-refreshed, see the
  // end of this function) within the last 8 seconds — the client polls
  // every 2.5s while genuinely waiting, so a live opponent's row is always
  // fresh. An older row means that tab was closed / lost connection
  // without hitting Cancel; skipping it stops us from ever matching a
  // real student against a ghost who will never actually show up.
  const opponentRes = await db.execute({
    sql: `
      SELECT user_id, user_name FROM vocab_battle_queue
      WHERE matched_match_id IS NULL
        AND user_id != ?
        AND created_at >= datetime('now', '-8 seconds')
      ORDER BY created_at ASC LIMIT 1
    `,
    args: [user.id],
  });
  const opponent = opponentRes.rows[0];

  if (opponent) {
    let questions;
    try {
      questions = await buildVocabBattleRound();
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Not enough vocabulary words yet to start a battle." },
        { status: 409 }
      );
    }

    const opponentId = opponent.user_id as number;
    const opponentName = opponent.user_name as string;

    const insertRes = await db.execute({
      sql: `
        INSERT INTO vocab_battle_matches
          (room_code, source, status, player1_id, player1_name, player2_id, player2_name, questions_json, started_at)
        VALUES (NULL, 'random', 'active', ?, ?, ?, ?, ?, datetime('now'))
      `,
      args: [opponentId, opponentName, user.id, name, JSON.stringify(questions)],
    });
    const matchId = Number(insertRes.lastInsertRowid);

    // Mark the opponent's row matched (their next poll picks it up), and
    // remove our own row (if any) since we already have the matchId now.
    await db.execute({
      sql: `UPDATE vocab_battle_queue SET matched_match_id = ? WHERE user_id = ?`,
      args: [matchId, opponentId],
    });
    await db.execute({ sql: `DELETE FROM vocab_battle_queue WHERE user_id = ?`, args: [user.id] });

    return NextResponse.json({ status: "matched", matchId });
  }

  // Step 3: nobody available right now — make sure we're queued (or, if we
  // already were, refresh our heartbeat) and wait.
  await db.execute({
    sql: `
      INSERT INTO vocab_battle_queue (user_id, user_name) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET created_at = datetime('now')
    `,
    args: [user.id, name],
  });
  return NextResponse.json({ status: "waiting" });
}

export async function DELETE() {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const db = await getDb();
  await db.execute({ sql: `DELETE FROM vocab_battle_queue WHERE user_id = ?`, args: [user.id] });
  return NextResponse.json({ ok: true });
}
