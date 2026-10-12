import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/admin-auth";
import { generateMistakeReviewQuiz } from "@/lib/mistake-quiz-generator";

// A scheduler (Vercel Cron, n8n, etc) should hit this ONCE A DAY, ideally
// late evening Asia/Dhaka time after the day's Speaking Club sessions (note
// Vercel Cron schedules are in UTC). Each run creates and publishes that
// day's new quiz from the last 24 hours of mistakes (see
// lib/mistake-quiz-generator.ts). A second run the same day just rebuilds
// today's quiz, unless a student has already taken it. Same x-cron-secret /
// requireCron() auth as every other cron route in this codebase.
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
