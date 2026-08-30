// app/api/admin/vocab-words/[id]/route.ts
//
// PATCH edits one word (including moving its Word-of-the-Day date), DELETE
// removes it. Same admin-secret gate as the rest of /api/admin/*.
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

  if (body.dailyDate) {
    const clash = await db.execute({
      sql: `SELECT id, word FROM vocab_words WHERE daily_date = ? AND id != ?`,
      args: [body.dailyDate, wordId],
    });
    if (clash.rows[0]) {
      return NextResponse.json(
        {
          error: `"${clash.rows[0].word}" is already set as the Word of the Day for ${body.dailyDate}.`,
        },
        { status: 409 }
      );
    }
  }

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
