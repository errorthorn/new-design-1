// app/api/admin/speaking-club/feedback/route.ts
//
// Admin feedback viewer (gap-fix, follow-up to the AI Feedback plan's
// Phase G Monitoring tab — see lib/speaking-feedback-monitoring.ts).
// Monitoring only ever showed aggregate pipeline health (status counts,
// daily volume, a handful of recent failures); there was no page for an
// admin to actually read what a specific student's feedback said, or
// browse everyone's. This route is the thin wrapper over the real query
// (lib/speaking-feedback-db.ts) — same requireAdmin gate as every other
// /api/admin/speaking-club/* route in this codebase.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listSpeakingFeedbackForAdmin } from "@/lib/speaking-feedback-db";

const VALID_STATUSES = ["pending", "processing", "done", "failed"] as const;

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = (VALID_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as (typeof VALID_STATUSES)[number])
    : null;
  const studentQuery = req.nextUrl.searchParams.get("q");
  const cursor = req.nextUrl.searchParams.get("cursor");

  try {
    const page = await listSpeakingFeedbackForAdmin({ status, studentQuery, cursor });
    return NextResponse.json(page);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem loading feedback" }, { status: 500 });
  }
}
