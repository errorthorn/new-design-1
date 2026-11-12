// app/api/admin/mistake-quiz/route.ts
//
// Admin-facing counterpart to app/api/cron/mistake-quiz-generator/route.ts
// (see lib/mistake-quiz-generator.ts for the actual generation logic).
// GET lets the admin panel show when the mistake-review quiz last
// regenerated without waiting for the scheduler; POST lets an admin
// force a run on demand - it regenerates TODAY's quiz (or creates it if the
// daily run hasn't happened yet).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseServer } from "@/lib/supabase";
import { generateMistakeReviewQuiz } from "@/lib/mistake-quiz-generator";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin(req, "quiz");
  if (unauthorized) return unauthorized;

  // One quiz per day now, so "status" = the most recently generated one.
  const { data, error } = await supabaseServer
    .from("quizzes")
    .select("id, title, published, auto_generated_at, auto_mistakes_analyzed")
    .eq("auto_source", "speaking_club_mistakes")
    .order("auto_generated_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ quiz: data?.[0] ?? null });
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin(req, "quiz");
  if (unauthorized) return unauthorized;

  try {
    const result = await generateMistakeReviewQuiz();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem regenerating the quiz" }, { status: 500 });
  }
}
