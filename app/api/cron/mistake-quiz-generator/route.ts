import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { requireCron } from "@/lib/admin-auth";
import { generateMistakeReviewQuiz } from "@/lib/mistake-quiz-generator";

// The quiz is one Gemini call over up to a day of mistakes. Give it room so Vercel does not cut it off.
export const maxDuration = 60;

// A free scheduler such as cron-job.org gives up after 30 seconds, but this job can take longer. So by
// default the route answers straight away (202) and the quiz is built in the background, which
// Vercel keeps alive for up to maxDuration. The result is written to the function logs.
// Add ?wait=1 to run it in the foreground and get the result in the response (handy for testing).
async function run(req: NextRequest) {
  const unauthorized = requireCron(req);
  if (unauthorized) return unauthorized;

  const job = generateMistakeReviewQuiz();

  if (req.nextUrl.searchParams.get("wait") === "1") {
    const result = await job;
    return NextResponse.json({ ok: true, ...result });
  }

  waitUntil(
    job
      .then((result) => console.log("[mistake-quiz-generator] finished", JSON.stringify(result)))
      .catch((error) => console.error("[mistake-quiz-generator] failed", error)),
  );
  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
