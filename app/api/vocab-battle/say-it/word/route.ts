// app/api/vocab-battle/say-it/word/route.ts
//
// One random word for the Speaking Club's "Say It" mini-game (see
// components/speaking-club/say-it-round.tsx): a speaking round where one
// partner gets a word and 20 seconds to use it in a spoken sentence, and
// the other partner rates it live over the call — no typing, no MCQ.
// Shares the same vocab_words bank as Vocab Battle, but only needs one
// word at a time so it's its own tiny route rather than reusing
// buildVocabBattleRound (which always builds a full round + distractors).
//
// Optional ?exclude=1,2,3 — word ids already played this session, so the
// two students don't see the same word twice in one call. If the bank is
// so small that everything has been excluded, it falls back to any word.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

const BASE_WHERE = `meaning_en IS NOT NULL AND trim(meaning_en) != '' AND trim(word) != ''`;

export async function GET(req: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const exclude = (new URL(req.url).searchParams.get("exclude") ?? "")
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 100);

    const db = await getDb();
    const pick = (ids: number[]) =>
      db.execute({
        sql: `SELECT id, word, meaning_en, pronunciation, example_1_en
              FROM vocab_words
              WHERE ${BASE_WHERE}${ids.length ? ` AND id NOT IN (${ids.map(() => "?").join(",")})` : ""}
              ORDER BY RANDOM() LIMIT 1`,
        args: ids,
      });

    let res = await pick(exclude);
    if (!res.rows[0] && exclude.length) res = await pick([]);
    const row = res.rows[0];
    if (!row) {
      return NextResponse.json({ error: "No vocabulary words available yet." }, { status: 409 });
    }
    return NextResponse.json({
      wordId: Number(row.id),
      word: String(row.word).trim(),
      meaning: String(row.meaning_en).trim(),
      pronunciation: row.pronunciation ? String(row.pronunciation).trim() || null : null,
      example: row.example_1_en ? String(row.example_1_en).trim() || null : null,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not pick a word" }, { status: 500 });
  }
}
