// app/api/speaking-club/mistakes/route.ts
//
// Phase F deliverable (SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §6 Phase F,
// option (a) of step 3: "the page calls both /api/quiz/mistakes and a
// new /api/speaking-club/mistakes and merges client-side" — chosen over
// a server-side merged endpoint specifically so quiz's existing
// derived-live logic (app/api/quiz/mistakes/route.ts) stays completely
// untouched).
//
// Unlike quiz's mistakes (derived live, no persisted row), Speaking
// Club's are already sitting in mistake_logs (Phase D wrote them) — this
// route is a thin wrapper over the shared keyset-paginated read in
// lib/mistake-logs-db.ts (factored out when §7.1 added the near-identical
// /api/mock-test/mistakes route).
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/api-auth";
import { getMistakeLogsPage } from "@/lib/mistake-logs-db";

export async function GET(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const cursor = req.nextUrl.searchParams.get("cursor");

  try {
    const page = await getMistakeLogsPage("speaking_club", user.email, cursor);
    return NextResponse.json(page);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem loading mistakes" }, { status: 500 });
  }
}
