// app/api/speaking-club/words/[id]/route.ts
//
// Removes one of the signed-in student's own saved words.
import { NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/api-auth";
import { deleteLearnedWord } from "@/lib/speaking-club-words";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  // Not a uuid -> can't be one of ours; avoids a Postgres cast error (500).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    return NextResponse.json({ error: "Word not found" }, { status: 404 });
  }

  try {
    const removed = await deleteLearnedWord(user.email, params.id);
    if (!removed) return NextResponse.json({ error: "Word not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem deleting that word" }, { status: 500 });
  }
}
