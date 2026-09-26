// app/api/vocab/[id]/progress/route.ts
//
// Called from the practice flashcard's "Know it" / "Still learning"
// buttons. Upserts one row per (user, word) — a student flipping through
// the same word twice just overwrites their earlier answer.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const { id } = await params;
  const wordId = Number(id);
  if (!Number.isInteger(wordId)) {
    return NextResponse.json({ error: "Invalid word id" }, { status: 400 });
  }

  const { status } = await req.json();
  if (status !== "known" && status !== "learning") {
    return NextResponse.json(
      { error: "status must be 'known' or 'learning'" },
      { status: 400 }
    );
  }

  const db = await getDb();
  await db.execute({
    sql: `
      INSERT INTO vocab_progress (user_id, word_id, status, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(user_id, word_id) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at
    `,
    args: [user.id, wordId, status],
  });

  return NextResponse.json({ ok: true });
}
