// app/api/vocab-battle/saved-words/route.ts
//
// Vocab Battle's own "Saved Words" list (separate from Speaking Club notes).
//   GET    -> the signed-in student's saved words, newest first
//   POST   -> save one word { word, meaning?, pronunciation?, example? } (saving twice is a no-op)
//   DELETE -> ?id=<row id> removes one of their own saved words
// Any signed-in student can use it; no Speaking Club plan is needed.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

const MAX_SAVED_WORDS = 2000;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT id, word, meaning, pronunciation, example, created_at
          FROM vocab_battle_saved_words WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    args: [user.id, MAX_SAVED_WORDS],
  });
  return NextResponse.json({
    words: res.rows.map((r) => ({
      id: r.id as number,
      word: r.word as string,
      meaning: (r.meaning as string | null) ?? null,
      pronunciation: (r.pronunciation as string | null) ?? null,
      example: (r.example as string | null) ?? null,
      createdAt: r.created_at as string,
    })),
  });
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;
  const body = await req.json().catch(() => null);
  const word = clean(body?.word, 120);
  if (!word) return NextResponse.json({ error: "Missing word." }, { status: 400 });

  const db = await getDb();
  const count = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM vocab_battle_saved_words WHERE user_id = ?`,
    args: [user.id],
  });
  if (Number(count.rows[0]?.n ?? 0) >= MAX_SAVED_WORDS) {
    return NextResponse.json({ error: "Your saved list is full." }, { status: 409 });
  }
  await db.execute({
    sql: `INSERT OR IGNORE INTO vocab_battle_saved_words (user_id, word_key, word, meaning, pronunciation, example)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      user.id,
      word.toLowerCase(),
      word,
      clean(body?.meaning, 300) || null,
      clean(body?.pronunciation, 80) || null,
      clean(body?.example, 400) || null,
    ],
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "Bad id." }, { status: 400 });
  const db = await getDb();
  await db.execute({ sql: `DELETE FROM vocab_battle_saved_words WHERE id = ? AND user_id = ?`, args: [id, user.id] });
  return NextResponse.json({ ok: true });
}
