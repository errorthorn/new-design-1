// app/api/vocab/route.ts
//
// Powers /dashboard/vocab. Returns every vocab word an admin has added,
// each annotated with the signed-in student's own progress (known /
// learning / untouched), plus today's Word of the Day if one has been
// scheduled for today's date.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const db = await getDb();

  const wordsRes = await db.execute({
    sql: `
      SELECT
        w.id, w.word, w.pronunciation, w.part_of_speech, w.meaning_en,
        w.synonym_1, w.synonym_2,
        w.example_1_en, w.example_1_bn, w.example_2_en, w.example_2_bn,
        w.daily_date,
        p.status AS progress_status
      FROM vocab_words w
      LEFT JOIN vocab_progress p ON p.word_id = w.id AND p.user_id = ?
      ORDER BY w.created_at DESC
    `,
    args: [user.id],
  });

  const words = wordsRes.rows.map((row) => ({
    id: row.id,
    word: row.word,
    pronunciation: row.pronunciation,
    partOfSpeech: row.part_of_speech,
    meaning: row.meaning_en,
    synonyms: [row.synonym_1, row.synonym_2].filter(Boolean),
    examples: [
      row.example_1_en && { en: row.example_1_en, bn: row.example_1_bn },
      row.example_2_en && { en: row.example_2_en, bn: row.example_2_bn },
    ].filter(Boolean),
    dailyDate: row.daily_date,
    status: row.progress_status ?? null, // "known" | "learning" | null
  }));

  const today = todayIsoDate();
  const dailyWord = words.find((w) => w.dailyDate === today) ?? null;

  return NextResponse.json({ words, dailyWord });
}
