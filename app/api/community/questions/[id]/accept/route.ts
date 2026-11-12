// app/api/community/questions/[id]/accept/route.ts
//
// POST { answerId } — the question's original poster marks one reply as
// the accepted answer. Flips the question to 'solved'. Rejected with a
// 400 (via lib/community-db.ts) if the caller isn't the original poster.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { acceptAnswer } from "@/lib/community-db";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.answerId !== "string") {
    return NextResponse.json({ error: "answerId is required." }, { status: 400 });
  }

  try {
    const question = await acceptAnswer(user.email, params.id, body.answerId);
    return NextResponse.json({ question });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { status: 400 }
    );
  }
}
