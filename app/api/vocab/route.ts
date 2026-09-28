// app/api/vocab/route.ts
//
// Powers /dashboard/vocab. Returns every vocab word an admin has added
// (the general pool, used for the All/Mastered/Learning list + search),
// each annotated with the signed-in student's own progress (known /
// learning / untouched) — plus, new for the "Previous Vocabulary"
// feature, every daily vocab SET: words sharing the same daily_date +
// topic, one set per day a batch was published, newest first. Today's
// set (if one exists) is what the page's hero card highlights; every
// earlier one is what "Previous Vocabulary" lets a student revise.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// libsql's driver types every column value as string | number | bigint |
// ArrayBuffer | null (it doesn't know these are actually TEXT columns), so
// row.daily_date / row.topic come back wider than plain `string` even
// though they're always text in practice. That's fine for values that just
// get echoed back in the JSON response, but daily_date is used as a Map key
// and topic as a Set member below — both require exactly `string`, which is
// what caused the Vercel build to fail. Normalize once here instead of
// casting at every use site.
function toStringOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
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
        w.daily_date, w.topic,
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
    dailyDate: toStringOrNull(row.daily_date),
    topic: toStringOrNull(row.topic),
    status: row.progress_status ?? null, // "known" | "learning" | null
  }));

  // Group every word that belongs to a specific day's batch (dailyDate
  // set) into one set per date. A date can in principle carry more than
  // one topic label across its words if an admin mixed topics under the
  // same date by mistake — rather than silently picking just one label
  // (which would hide that inconsistency) or splintering into multiple
  // same-date groups (confusing on the page), each set's topic is every
  // distinct label seen for that date, joined for display.
  const byDate = new Map<string, { date: string; topics: Set<string>; words: typeof words }>();
  for (const w of words) {
    if (!w.dailyDate) continue;
    let entry = byDate.get(w.dailyDate);
    if (!entry) {
      entry = { date: w.dailyDate, topics: new Set(), words: [] };
      byDate.set(w.dailyDate, entry);
    }
    if (w.topic) entry.topics.add(w.topic);
    entry.words.push(w);
  }
  const dailySets = Array.from(byDate.values())
    .map((entry) => ({ date: entry.date, topic: entry.topics.size ? Array.from(entry.topics).join(" / ") : null, words: entry.words }))
    .sort((a, b) => b.date.localeCompare(a.date));

  const today = todayIsoDate();
  const todaysSet = dailySets.find((s) => s.date === today) ?? null;
  const previousSets = dailySets.filter((s) => s.date !== today);

  return NextResponse.json({ words, dailySets, todaysSet, previousSets });
}
