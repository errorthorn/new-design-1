// lib/speaking-feedback-monitoring.ts
//
// Phase G deliverable (SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §5 step 6 /
// §6 Phase G). Two things the plan asks an admin to be able to watch:
//   1. "Watch failed status counts — a persistently high failure rate
//      signals a prompt or parsing problem worth fixing, not just
//      retrying forever." (§6 Phase G)
//   2. "surfacing an admin-visible failure count (not to the student)"
//      (§5 step 6) — same requirement, restated at the architecture
//      level.
// Also covers the other Phase G bullet ("watch real Gemini request
// volume vs the free-tier RPD/RPM numbers ... for the first couple
// weeks") with a daily submitted-row count as a proxy for request
// volume — this codebase has no separate Gemini request log, and every
// non-skipped row here corresponds to exactly one Gemini call (Phase D
// processes one row per call), so counting rows is equivalent to
// counting requests without needing new instrumentation.
import { supabaseServer } from "@/lib/supabase";

export type SpeakingFeedbackMonitoringSummary = {
  statusCounts: { pending: number; processing: number; done: number; failed: number };
  // Rows created per day over the lookback window — a proxy for Gemini
  // request volume (see file header). Oldest first, so it plots left-to-right.
  dailyVolume: { date: string; count: number }[];
  // The specific rows an admin would actually want to click into first
  // when the failed count looks high — newest failures, capped small.
  recentFailures: { id: string; studentUsername: string; attemptCount: number; createdAt: string }[];
};

function dateKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD, consistent with dateKey() used elsewhere in this codebase (e.g. app/api/performance/route.ts)
}

export async function getSpeakingFeedbackMonitoringSummary(lookbackDays = 14): Promise<SpeakingFeedbackMonitoringSummary> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  const [pendingCount, processingCount, doneCount, failedCount, recentRows] = await Promise.all([
    supabaseServer.from("speaking_feedback").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabaseServer.from("speaking_feedback").select("id", { count: "exact", head: true }).eq("status", "processing"),
    supabaseServer.from("speaking_feedback").select("id", { count: "exact", head: true }).eq("status", "done"),
    supabaseServer.from("speaking_feedback").select("id", { count: "exact", head: true }).eq("status", "failed"),
    // One query serves both dailyVolume (all rows in the window) and
    // recentFailures (filtered client-side below) — cheaper than two
    // separate round-trips for what's the same underlying window.
    supabaseServer
      .from("speaking_feedback")
      .select("id, student_username, status, attempt_count, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: true }),
  ]);

  for (const r of [pendingCount, processingCount, doneCount, failedCount, recentRows]) {
    if (r.error) throw r.error;
  }

  const dailyMap = new Map<string, number>();
  for (const row of recentRows.data ?? []) {
    const key = dateKey(row.created_at as string);
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
  }
  const dailyVolume = Array.from(dailyMap.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  type RawRow = { id: string; student_username: string; status: string; attempt_count: number; created_at: string };

  const recentFailures = ((recentRows.data ?? []) as RawRow[])
    .filter((row: RawRow) => row.status === "failed")
    .sort((a: RawRow, b: RawRow) => b.created_at.localeCompare(a.created_at))
    .slice(0, 10)
    .map((row: RawRow) => ({
      id: row.id,
      studentUsername: row.student_username,
      attemptCount: row.attempt_count,
      createdAt: row.created_at,
    }));

  return {
    statusCounts: {
      pending: pendingCount.count ?? 0,
      processing: processingCount.count ?? 0,
      done: doneCount.count ?? 0,
      failed: failedCount.count ?? 0,
    },
    dailyVolume,
    recentFailures,
  };
}
