// app/api/community/questions/[id]/route.ts
//
// GET — question detail + its replies, for /dashboard/community/[id].
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getQuestion, listAnswers } from "@/lib/community-db";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    // Independent of each other — listAnswers only needs params.id, not
    // the question object — so there's no reason to wait for one before
    // starting the other.
    const [question, answers] = await Promise.all([
      getQuestion(params.id, user.email),
      listAnswers(params.id, user.email),
    ]);
    if (!question) return NextResponse.json({ error: "Question not found." }, { status: 404 });

    return NextResponse.json({ question, answers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { status: 500 }
    );
  }
}
