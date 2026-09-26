import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/admin-auth";
import { generateMistakeReviewQuiz } from "@/lib/mistake-quiz-generator";

// A scheduler (Vercel Cron, n8n, etc) should hit this ONCE A DAY — the
// point is that every day's fresh batch of Speaking Club mistakes (~300
// students practicing daily) feeds into tomorrow's quiz, per
// lib/mistake-quiz-generator.ts's rolling 30-day window. No need to run
// it more often than that; it's reanalyzing a window, not draining a
// queue, so an extra run the same day would just regenerate the same
// quiz from nearly-identical data. Same x-cron-secret / requireCron()
// auth as every other cron route in this codebase.
async function run(req: NextRequest) {
  const unauthorized = requireCron(req);
  if (unauthorized) return unauthorized;

  const result = await generateMistakeReviewQuiz();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
