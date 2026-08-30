// app/api/admin/speaking-club/monitoring/route.ts
//
// Phase 7 deliverable (plan §7, §9 Phase 7). GET, requireAdmin — the
// Monitoring tab's data source. Two independent things plan §9 Phase 7
// asks for, bundled into one route since the admin panel shows them
// together:
//   1. "log TURN usage via getStats() for the first 1-2 weeks" (§7) —
//      getTurnUsageSummary() over speaking_turn_usage (new this phase).
//   2. "Watch real partner-absent frequency" — getReassignmentFrequencySummary()
//      over speaking_reassignments (already existed, written by Phase 5).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getReassignmentFrequencySummary, getTurnUsageSummary } from "@/lib/speaking-club-db";

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const [turnUsage, reassignmentFrequency] = await Promise.all([
      getTurnUsageSummary(14),
      getReassignmentFrequencySummary(),
    ]);
    return NextResponse.json({ turnUsage, reassignmentFrequency });
  } catch (err) {
    console.error("[admin/speaking-club/monitoring] failed", err);
    return NextResponse.json({ error: "There was a problem loading monitoring data" }, { status: 500 });
  }
}
