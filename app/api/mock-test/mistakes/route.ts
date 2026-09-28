// app/api/mock-test/mistakes/route.ts
//
// §7.1 step 8 deliverable: "the data needs somewhere to actually
// surface, or this migration is incomplete" — the Mistake Log page's
// third tab reads from here. Same shape as
// /api/speaking-club/mistakes, just a different `source` — both are
// thin wrappers over lib/mistake-logs-db.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/api-auth";
import { getMistakeLogsPage } from "@/lib/mistake-logs-db";

export async function GET(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const cursor = req.nextUrl.searchParams.get("cursor");

  try {
    const page = await getMistakeLogsPage("mock_test", user.email, cursor);
    return NextResponse.json(page);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem loading mistakes" }, { status: 500 });
  }
}
