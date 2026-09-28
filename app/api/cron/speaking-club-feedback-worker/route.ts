import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/admin-auth";
import { processPendingSpeakingFeedbackBatch } from "@/lib/speaking-feedback-worker";

// Phase D (SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §5/§6 Phase D) — the
// throttled Gemini processor. A scheduler (Vercel Cron, n8n's schedule
// trigger, etc) hits this every 1 minute, same pattern as the existing
// speaking-club-alerts/speaking-club-roster cron routes. Each hit
// processes at most one BATCH_SIZE-sized batch of pending rows, now
// shared across BOTH Speaking Club and (§7.1 migration) Mock Test — see
// lib/speaking-feedback-worker.ts for the actual throttling/retry logic
// and how that shared budget is split between the two sources.
//
// Auth: same x-cron-secret / requireCron() as the other cron routes.
// Accepts GET and POST for the same reason as speaking-club-alerts (most
// schedulers default to GET; some webhook-style ones only send POST).
async function run(req: NextRequest) {
  const unauthorized = requireCron(req);
  if (unauthorized) return unauthorized;

  const summary = await processPendingSpeakingFeedbackBatch();
  return NextResponse.json({ ok: true, ...summary });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
