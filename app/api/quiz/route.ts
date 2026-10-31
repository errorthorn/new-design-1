import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";

// Every published quiz, plus (for the signed-in student) whether they've
// already attempted it and, if so, their score — enough for the /dashboard
// quiz list to show Not attempted / Completed (score) cards without a
// second round trip per quiz.
export async function GET() {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const { data: quizzes, error: quizzesError } = await supabaseServer
    .from("quizzes")
    .select("id, title, description, time_limit_minutes, position")
    .eq("published", true)
    .order("position", { ascending: true });

  if (quizzesError) {
    return NextResponse.json({ error: quizzesError.message }, { status: 500 });
  }

  const { data: counts } = await supabaseServer
    .from("quiz_questions")
    .select("quiz_id");

  const { data: attempts, error: attemptsError } = await supabaseServer
    .from("quiz_attempts")
    .select("quiz_id, score, total_questions, completed_at")
    .eq("user_email", user.email);

  if (attemptsError) {
    return NextResponse.json({ error: attemptsError.message }, { status: 500 });
  }

  const result = (quizzes ?? []).map((quiz) => {
    const attempt = (attempts ?? []).find((a) => a.quiz_id === quiz.id) ?? null;
    return {
      ...quiz,
      questionCount: (counts ?? []).filter((c) => c.quiz_id === quiz.id).length,
      attempted: Boolean(attempt),
      score: attempt?.score ?? null,
      totalQuestions: attempt?.total_questions ?? null,
    };
  });

  return NextResponse.json({ quizzes: result });
}
