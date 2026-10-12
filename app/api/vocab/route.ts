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
//
// UPDATE: students now only see the LATEST published day's set. When an
// admin publishes a new day's vocabulary (adds words with a newer
// daily_date), every earlier day's words drop out of this response, so they
// disappear from the Vocabulary page and Practice Words. Nothing is deleted
// - the rows stay in the database and in the admin panel. Words with no
// daily_date (the general pool) are not tied to a day and stay visible, and
// a set dated in the future stays hidden until its day arrives. Vocab
// Battle / Say It use their own queries and are not affected.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

function todayIsoDate() {
  // Asia/Dhaka (UTC+6, no DST) calendar day, YYYY-MM-DD - the same day
  // admins type into the daily-date field.
  return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

  const allWords = wordsRes.rows.map((row) => ({
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

  // Only the newest published day's set (date <= today) stays visible;
  // older days' sets and not-yet-due future sets are left out.
  const today = todayIsoDate();
  let latestDate: string | null = null;
  for (const w of allWords) {
    if (w.dailyDate && w.dailyDate <= today && (!latestDate || w.dailyDate > latestDate)) {
      latestDate = w.dailyDate;
    }
  }
  const words = allWords.filter((w) => !w.dailyDate || w.dailyDate === latestDate);

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

  const todaysSet = dailySets.find((s) => s.date === today) ?? null;
  // Earlier days' sets are no longer shown to students (see the header
  // comment), so this is always empty; kept so the response shape and the
  // switched-off "Previous Vocabulary" UI stay compatible.
  const previousSets: typeof dailySets = [];

  return NextResponse.json({ words, dailySets, todaysSet, previousSets });
}
