// app/api/admin/vocab-words/route.ts
//
// Admin content management for the Vocab feature — GET lists every word
// (used by /admin/vocab-words), POST adds a new one. Setting dailyDate
// to a date is what puts a word into that day's vocab SET on
// /dashboard/vocab's "Previous Vocabulary" browser (or today's hero card
// if it's today's date) — multiple words share the same dailyDate on
// purpose now, as one day's topic-based batch (see lib/db.ts's migration
// comment for why the old one-word-per-date restriction was removed).
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const res = await db.execute(
    `SELECT * FROM vocab_words ORDER BY created_at DESC`
  );

  return NextResponse.json({ words: res.rows });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const {
    word,
    pronunciation,
    partOfSpeech,
    meaningEn,
    synonym1,
    synonym2,
    example1En,
    example1Bn,
    example2En,
    example2Bn,
    dailyDate, // "YYYY-MM-DD" or null — which day's vocab set this word belongs to, if any
    topic, // free-text topic label for that day's set, or null
  } = body;

  if (!word || !meaningEn) {
    return NextResponse.json(
      { error: "word and meaningEn are required" },
      { status: 400 }
    );
  }

  const db = await getDb();

  const res = await db.execute({
    sql: `
      INSERT INTO vocab_words (
        word, pronunciation, part_of_speech, meaning_en,
        synonym_1, synonym_2, example_1_en, example_1_bn,
        example_2_en, example_2_bn, daily_date, topic
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      word,
      pronunciation || null,
      partOfSpeech || null,
      meaningEn,
      synonym1 || null,
      synonym2 || null,
      example1En || null,
      example1Bn || null,
      example2En || null,
      example2Bn || null,
      dailyDate || null,
      topic || null,
    ],
  });

  return NextResponse.json({ id: Number(res.lastInsertRowid) }, { status: 201 });
}
