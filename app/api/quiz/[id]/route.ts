import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const { data: quiz, error: quizError } = await supabaseServer
    .from("quizzes")
    .select("id, title, description, time_limit_minutes, published")
    .eq("id", params.id)
    .single();

  if (quizError || !quiz || !quiz.published) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  const { data: questions, error: questionsError } = await supabaseServer
    .from("quiz_questions")
    .select("id, question, options, correct_index, explanation, position, passage")
    .eq("quiz_id", params.id)
    .order("position", { ascending: true });

  if (questionsError) {
    return NextResponse.json({ error: questionsError.message }, { status: 500 });
  }

  const { data: attempt } = await supabaseServer
    .from("quiz_attempts")
    .select("score, total_questions, answers, completed_at")
    .eq("quiz_id", params.id)
    .eq("user_email", user.email)
    .maybeSingle();

  // Not attempted yet: hide the answer key so it never sits in the network
  // tab while the student is taking the quiz. Already attempted: this is
  // now a review screen, so include everything needed to show what they
  // got right/wrong.
  const questionsOut = (questions ?? []).map((q) =>
    attempt
      ? q
      : { id: q.id, question: q.question, options: q.options, position: q.position, passage: q.passage }
  );

  return NextResponse.json({
    quiz,
    questions: questionsOut,
    attempt: attempt
      ? {
          score: attempt.score,
          totalQuestions: attempt.total_questions,
          answers: attempt.answers,
        }
      : null,
  });
}
