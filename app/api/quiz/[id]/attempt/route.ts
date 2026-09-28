import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";

// Body: { answers: { [questionId: string]: number } }
// Scoring happens here, server-side, from the real quiz_questions rows —
// never trust a score computed in the browser, since the browser never
// even received correct_index for an unattempted quiz (see GET
// /api/quiz/[id]).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const { data: quiz } = await supabaseServer
    .from("quizzes")
    .select("id, published")
    .eq("id", params.id)
    .single();

  if (!quiz || !quiz.published) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  const { data: existing } = await supabaseServer
    .from("quiz_attempts")
    .select("id")
    .eq("quiz_id", params.id)
    .eq("user_email", user.email)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "You've already taken this quiz." }, { status: 409 });
  }

  const { answers } = await req.json();
  const submitted: Record<string, number> =
    answers && typeof answers === "object" ? answers : {};

  const { data: questions, error: questionsError } = await supabaseServer
    .from("quiz_questions")
    .select("id, correct_index")
    .eq("quiz_id", params.id);

  if (questionsError) {
    return NextResponse.json({ error: questionsError.message }, { status: 500 });
  }
  if (!questions || questions.length === 0) {
    return NextResponse.json({ error: "This quiz has no questions yet." }, { status: 400 });
  }

  let score = 0;
  for (const q of questions) {
    if (submitted[q.id] === q.correct_index) score += 1;
  }

  const { data: attempt, error: insertError } = await supabaseServer
    .from("quiz_attempts")
    .insert({
      quiz_id: params.id,
      user_email: user.email,
      completed_at: new Date().toISOString(),
      score,
      total_questions: questions.length,
      answers: submitted,
    })
    .select("score, total_questions, answers")
    .single();

  if (insertError) {
    // The unique index on (quiz_id, user_email) is the real guard against a
    // double-submit race (two tabs submitting at once) — surface that as
    // the same friendly "already taken" message rather than a raw 500.
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "You've already taken this quiz." }, { status: 409 });
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ attempt });
}
