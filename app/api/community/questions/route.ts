// app/api/community/questions/route.ts
//
// GET  ?search=&topic=&status=open|solved&mine=1&sort=recent|top|unanswered
//   Lists doubt-board questions for /dashboard/community. `mine=1` filters
//   to the signed-in user's own posts (the "My Posts" toggle in the UI).
// POST { title, body, topic? }
//   Creates a new question, authored as the signed-in user.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { createQuestion, listQuestions } from "@/lib/community-db";

export async function GET(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const params = req.nextUrl.searchParams;
  const status = params.get("status");
  const sort = params.get("sort");

  try {
    const questions = await listQuestions({
      search: params.get("search") || undefined,
      topic: params.get("topic") || undefined,
      status: status === "open" || status === "solved" ? status : undefined,
      mineOnly: params.get("mine") === "1",
      viewerEmail: user.email,
      sort: sort === "top" || sort === "unanswered" ? sort : "recent",
    });
    return NextResponse.json({ questions });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || typeof body.body !== "string") {
    return NextResponse.json({ error: "Title and question details are required." }, { status: 400 });
  }

  try {
    const question = await createQuestion({
      author: {
        userEmail: user.email,
        authorName: user.name || user.email,
        authorAvatarUrl: (user as any).avatarUrl ?? null,
      },
      title: body.title,
      body: body.body,
      topic: typeof body.topic === "string" ? body.topic : null,
    });
    return NextResponse.json({ question }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Something went wrong." },
      { status: 400 }
    );
  }
}
