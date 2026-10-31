import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireCron } from "@/lib/admin-auth";
import { processPendingSpeakingFeedbackBatch } from "@/lib/speaking-feedback-worker";

// Phase D (SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §5/§6 Phase D) — the
// throttled Gemini processor. A scheduler (n8n's schedule trigger,
// cron-job.org, etc) hits this every 1 minute, same pattern as the existing
// speaking-club-alerts/speaking-club-roster cron routes. Each hit pulls pending rows
// at a rate-limit-aware pace (per-minute + in-flight budget shared across runs, 429 pause) —
// see lib/speaking-feedback-worker.ts for the pacing/retry logic and the FEEDBACK_WORKER_* env vars.
//
// 300s = the Vercel Hobby maximum WITH Fluid Compute (Vercel -> Settings -> Functions -> Fluid
// Compute must be ON; it is the default for projects created after Apr 2025). A run needs about
// FEEDBACK_WORKER_BUDGET_MS (55s) + FEEDBACK_WORKER_CALL_TIMEOUT_MS (150s) at the very most.
// If your project cannot use Fluid Compute, set this back to 60 and set
// FEEDBACK_WORKER_BUDGET_MS=20000 and FEEDBACK_WORKER_CALL_TIMEOUT_MS=35000.
export const maxDuration = 300;

// A free scheduler such as cron-job.org gives up after 30 seconds and shows the run as "failed", but
// a run lasts about a minute. So by default the route answers straight away (202) and the work
// continues in the background, which Vercel keeps alive for up to maxDuration. The summary is written
// to the function logs. Add ?wait=1 to run it in the foreground and get the summary in the response
// (handy for testing).
//
// Auth: same x-cron-secret / requireCron() as the other cron routes.
// Accepts GET and POST for the same reason as speaking-club-alerts (most
// schedulers default to GET; some webhook-style ones only send POST).
async function run(req: NextRequest) {
  const unauthorized = requireCron(req);
  if (unauthorized) return unauthorized;

  const job = processPendingSpeakingFeedbackBatch();

  if (req.nextUrl.searchParams.get("wait") === "1") {
    const summary = await job;
    return NextResponse.json({ ok: true, ...summary });
  }

  waitUntil(
    job
      .then((summary) => console.log("[speaking-club-feedback-worker] finished", JSON.stringify(summary)))
      .catch((error) => console.error("[speaking-club-feedback-worker] failed", error)),
  );
  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
