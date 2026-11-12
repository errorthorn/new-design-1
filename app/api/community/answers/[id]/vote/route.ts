// app/api/community/answers/[id]/vote/route.ts
//
// POST — toggles the signed-in user's upvote on this reply.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { toggleVote } from "@/lib/community-db";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const result = await toggleVote(user.email, "answer", params.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { status: 400 }
    );
  }
}
