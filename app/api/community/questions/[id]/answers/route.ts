// app/api/community/questions/[id]/answers/route.ts
//
// POST { body } — adds a reply to a question, authored as the signed-in
// user. The question's answer_count updates itself via a DB trigger (see
// sql/schema.sql) — nothing here needs to touch it.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createAnswer } from "@/lib/community-db";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.body !== "string") {
    return NextResponse.json({ error: "Reply can't be empty." }, { status: 400 });
  }

  try {
    const answer = await createAnswer({
      author: {
        userEmail: user.email,
        authorName: user.name || user.email,
        authorAvatarUrl: (user as any).avatarUrl ?? null,
      },
      questionId: params.id,
      body: body.body,
    });
    return NextResponse.json({ answer }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { status: 400 }
    );
  }
}
