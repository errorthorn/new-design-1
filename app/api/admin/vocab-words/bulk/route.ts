// app/api/admin/vocab-words/bulk/route.ts
//
// Adds many vocab words in one go — what the "paste from AI" box on /admin/vocab-words sends once the
// admin has checked the preview. The browser already parsed the pasted text (lib/vocab-import.ts), but
// nothing it sends is trusted: every word is re-validated and length-capped here, and the whole batch
// is written in one transaction, so a failure never leaves half a day's set behind.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { MAX_IMPORT_WORDS, parseBatchDate, sanitizeVocabDraft } from "@/lib/vocab-import";

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const rawWords: unknown[] = Array.isArray(body?.words) ? body.words : [];
  if (rawWords.length === 0) {
    return NextResponse.json({ error: "There are no words to add." }, { status: 400 });
  }
  if (rawWords.length > MAX_IMPORT_WORDS) {
    return NextResponse.json({ error: `Add at most ${MAX_IMPORT_WORDS} words at a time.` }, { status: 400 });
  }

  let dailyDate: string | null = null;
  if (typeof body?.dailyDate === "string" && body.dailyDate.trim()) {
    dailyDate = /^\d{4}-\d{2}-\d{2}$/.test(body.dailyDate.trim()) ? parseBatchDate(body.dailyDate.trim()) : null;
    if (!dailyDate) return NextResponse.json({ error: "The date must look like 2026-11-02." }, { status: 400 });
  }
  const topic = typeof body?.topic === "string" && body.topic.trim() ? body.topic.replace(/\s+/g, " ").trim().slice(0, 120) : null;

  const drafts = rawWords.map(sanitizeVocabDraft);
  const bad = drafts.findIndex((d) => d === null);
  if (bad >= 0) {
    return NextResponse.json({ error: `Word number ${bad + 1} is missing its word or its meaning.` }, { status: 400 });
  }

  const db = await getDb();
  try {
    await db.batch(
      drafts.map((d) => ({
        sql: `
          INSERT INTO vocab_words (
            word, pronunciation, part_of_speech, meaning_en,
            synonym_1, synonym_2, example_1_en, example_1_bn,
            example_2_en, example_2_bn, daily_date, topic
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          d!.word,
          d!.pronunciation || null,
          d!.partOfSpeech || null,
          d!.meaningEn,
          d!.synonym1 || null,
          d!.synonym2 || null,
          d!.example1En || null,
          d!.example1Bn || null,
          d!.example2En || null,
          d!.example2Bn || null,
          dailyDate,
          topic,
        ],
      })),
      "write"
    );
  } catch (err) {
    console.error("[admin/vocab-words/bulk] insert failed", err);
    return NextResponse.json({ error: "Could not save the words. Nothing was added; try again." }, { status: 500 });
  }

  return NextResponse.json({ inserted: drafts.length }, { status: 201 });
}
