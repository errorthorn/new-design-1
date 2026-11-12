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
import { getMistakeCategoryCounts, getMistakeLogsPage, MISTAKE_CATEGORIES, type MistakeCategory } from "@/lib/mistake-logs-db";

export async function GET(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const cursor = req.nextUrl.searchParams.get("cursor");
  // Optional category filter, backing the per-category tabs on the
  // Mistake Log page. Filtering here (not client-side) keeps "Load more"
  // correct inside a category: each page is 20 rows of that category.
  const rawCategory = req.nextUrl.searchParams.get("category");
  const category = (MISTAKE_CATEGORIES as readonly string[]).includes(rawCategory ?? "") ? (rawCategory as MistakeCategory) : null;
  if (rawCategory && !category) return NextResponse.json({ error: "Unknown category" }, { status: 400 });

  try {
    const page = await getMistakeLogsPage("speaking_club", user.email, cursor, category);
    // Per-category totals only ride along on the first, unfiltered page.
    const counts = !cursor && !category ? await getMistakeCategoryCounts("speaking_club", user.email) : undefined;
    return NextResponse.json(counts ? { ...page, counts } : page);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem loading mistakes" }, { status: 500 });
  }
}
