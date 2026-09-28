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
//
// AI Feedback plan §6 Phase G — a third, unrelated-but-bundled-here
// stat: getSpeakingFeedbackMonitoringSummary() over speaking_feedback,
// for the same "watch it for the first couple weeks" reason as #1 above.
//
// Session ratings — a fourth: the end-of-call quick rating
// (getSessionRatingSummary() over speaking_session_ratings).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getReassignmentFrequencySummary, getTurnUsageSummary } from "@/lib/speaking-club-db";
import { getSpeakingFeedbackMonitoringSummary } from "@/lib/speaking-feedback-monitoring";
import { getSessionRatingSummary } from "@/lib/speaking-club-ratings";

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const [turnUsage, reassignmentFrequency, speakingFeedback, sessionRatings] = await Promise.all([
      getTurnUsageSummary(14),
      getReassignmentFrequencySummary(),
      getSpeakingFeedbackMonitoringSummary(14),
      getSessionRatingSummary(14),
    ]);
    return NextResponse.json({ turnUsage, reassignmentFrequency, speakingFeedback, sessionRatings });
  } catch (err) {
    console.error("[admin/speaking-club/monitoring] failed", err);
    return NextResponse.json({ error: "There was a problem loading monitoring data" }, { status: 500 });
  }
}
