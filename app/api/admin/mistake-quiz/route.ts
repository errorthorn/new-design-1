// app/api/admin/mistake-quiz/route.ts
//
// Admin-facing counterpart to app/api/cron/mistake-quiz-generator/route.ts
// (see lib/mistake-quiz-generator.ts for the actual generation logic).
// GET lets the admin panel show when the mistake-review quiz last
// regenerated without waiting for the scheduler; POST lets an admin
// force a regeneration on demand (e.g. right after a batch of Speaking
// Club feedback finishes processing, instead of waiting for the next
// scheduled run).
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseServer } from "@/lib/supabase";
import { generateMistakeReviewQuiz } from "@/lib/mistake-quiz-generator";

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data, error } = await supabaseServer
    .from("quizzes")
    .select("id, title, published, auto_generated_at, auto_mistakes_analyzed")
    .eq("auto_source", "speaking_club_mistakes")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ quiz: data ?? null });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  try {
    const result = await generateMistakeReviewQuiz();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem regenerating the quiz" }, { status: 500 });
  }
}
