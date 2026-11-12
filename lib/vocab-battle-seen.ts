// lib/vocab-battle-seen.ts
//
// Which vocabulary words a student has already answered in Vocab Battle (Solo
// and Live share one list), so the next round can prefer words they haven't
// seen. Cleared for a student once their unseen words no longer fill a round.
import { getDb } from "@/lib/db";

type Db = Awaited<ReturnType<typeof getDb>>;

export async function loadSeen(db: Db, userId: number): Promise<Set<number>> {
  const res = await db.execute({ sql: `SELECT word_id FROM vocab_battle_seen_words WHERE user_id = ?`, args: [userId] });
  return new Set(res.rows.map((r) => Number(r.word_id)));
}

export async function clearSeen(db: Db, userId: number): Promise<void> {
  await db.execute({ sql: `DELETE FROM vocab_battle_seen_words WHERE user_id = ?`, args: [userId] });
}

export function cleanWordIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
}

export async function markSeen(db: Db, userId: number, wordIds: number[]): Promise<void> {
  if (wordIds.length === 0) return;
  await db.batch(
    wordIds.map((id) => ({
      sql: `INSERT OR IGNORE INTO vocab_battle_seen_words (user_id, word_id) VALUES (?, ?)`,
      args: [userId, id],
    })),
    "write"
  );
}
