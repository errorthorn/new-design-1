import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getTopicOfDay } from "@/lib/speaking-club-cue-cards";

// Any signed-in user can read today's topic/cards — it's practice content,
// not sensitive, but still gated behind login (requireUser) rather than
// left fully public, consistent with the rest of the site's API routes.
export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const topic = await getTopicOfDay();
  return NextResponse.json(topic);
}
