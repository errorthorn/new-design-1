// app/api/vocab-battle/say-it/word/route.ts
//
// One random word for the Speaking Club's "Say It" mini-game (see
// components/speaking-club/say-it-round.tsx): a speaking round where one
// partner gets a word and 20 seconds to use it in a spoken sentence, and
// the other partner rates it live over the call — no typing, no MCQ.
// Shares the same vocab_words bank as Vocab Battle, but only needs one
// word at a time so it's its own tiny route rather than reusing
// buildVocabBattleRound (which always builds a full round + distractors).
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const db = await getDb();
    const res = await db.execute(
      `SELECT id, word, meaning_en, pronunciation, example_1_en
       FROM vocab_words
       WHERE meaning_en IS NOT NULL AND trim(meaning_en) != '' AND trim(word) != ''
       ORDER BY RANDOM() LIMIT 1`
    );
    const row = res.rows[0];
    if (!row) {
      return NextResponse.json({ error: "No vocabulary words available yet." }, { status: 409 });
    }
    return NextResponse.json({
      wordId: row.id,
      word: String(row.word).trim(),
      meaning: String(row.meaning_en).trim(),
      pronunciation: row.pronunciation ? String(row.pronunciation).trim() || null : null,
      example: row.example_1_en ? String(row.example_1_en).trim() || null : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not pick a word" }, { status: 500 });
  }
}
