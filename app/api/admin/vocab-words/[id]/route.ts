// app/api/admin/vocab-words/[id]/route.ts
//
// PATCH edits one word (including moving which day's vocab set it
// belongs to, or its topic label), DELETE removes it. Same admin-secret
// gate as the rest of /api/admin/*.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

const FIELD_MAP: Record<string, string> = {
  word: "word",
  pronunciation: "pronunciation",
  partOfSpeech: "part_of_speech",
  meaningEn: "meaning_en",
  synonym1: "synonym_1",
  synonym2: "synonym_2",
  example1En: "example_1_en",
  example1Bn: "example_1_bn",
  example2En: "example_2_en",
  example2Bn: "example_2_bn",
  dailyDate: "daily_date",
  topic: "topic",
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const wordId = Number(id);
  if (!Number.isInteger(wordId)) {
    return NextResponse.json({ error: "Invalid word id" }, { status: 400 });
  }

  const body = await req.json();
  const db = await getDb();

  // No more same-date clash check here — a day's vocab set is
  // deliberately many words sharing one dailyDate now (see lib/db.ts's
  // migration comment). The old check existed only for the previous
  // "one Word of the Day per date" model.

  const sets: string[] = [];
  const args: (string | null)[] = [];
  for (const [key, column] of Object.entries(FIELD_MAP)) {
    if (key in body) {
      sets.push(`${column} = ?`);
      args.push(body[key] || null);
    }
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  args.push(String(wordId));
  await db.execute({
    sql: `UPDATE vocab_words SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const wordId = Number(id);
  if (!Number.isInteger(wordId)) {
    return NextResponse.json({ error: "Invalid word id" }, { status: 400 });
  }

  const db = await getDb();
  await db.execute({ sql: `DELETE FROM vocab_words WHERE id = ?`, args: [wordId] });
  await db.execute({ sql: `DELETE FROM vocab_progress WHERE word_id = ?`, args: [wordId] });

  return NextResponse.json({ ok: true });
}
