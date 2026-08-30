// app/api/admin/vocab-words/route.ts
//
// Admin content management for the Vocab feature — GET lists every word
// (used by /admin/vocab-words), POST adds a new one. This is the same
// content an admin adds daily; setting dailyDate to today's date is what
// makes a word show as the Word of the Day on /dashboard/vocab.
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
    dailyDate, // "YYYY-MM-DD" or null
  } = body;

  if (!word || !meaningEn) {
    return NextResponse.json(
      { error: "word and meaningEn are required" },
      { status: 400 }
    );
  }

  const db = await getDb();

  if (dailyDate) {
    const clash = await db.execute({
      sql: `SELECT id, word FROM vocab_words WHERE daily_date = ?`,
      args: [dailyDate],
    });
    if (clash.rows[0]) {
      return NextResponse.json(
        {
          error: `"${clash.rows[0].word}" is already set as the Word of the Day for ${dailyDate}.`,
        },
        { status: 409 }
      );
    }
  }

  const res = await db.execute({
    sql: `
      INSERT INTO vocab_words (
        word, pronunciation, part_of_speech, meaning_en,
        synonym_1, synonym_2, example_1_en, example_1_bn,
        example_2_en, example_2_bn, daily_date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    ],
  });

  return NextResponse.json({ id: Number(res.lastInsertRowid) }, { status: 201 });
}
