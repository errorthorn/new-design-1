import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";

// A "mistake" isn't its own table — it's derived on the fly from the
// student's own quiz_attempts.answers vs the real quiz_questions.
// correct_index, the same source of truth the scoring route in
// /api/quiz/[id]/attempt uses. Keeping it derived (rather than writing a
// separate "wrong answers" row at attempt time) means there's only ever
// one place that decides what's correct.
export async function GET() {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const { data: attempts, error: attemptsError } = await supabaseServer
    .from("quiz_attempts")
    .select("quiz_id, answers, completed_at")
    .eq("user_email", user.email);

  if (attemptsError) {
    return NextResponse.json({ error: attemptsError.message }, { status: 500 });
  }
  if (!attempts || attempts.length === 0) {
    return NextResponse.json({ mistakes: [] });
  }

  const quizIds = attempts.map((a) => a.quiz_id);

  const { data: quizzes, error: quizzesError } = await supabaseServer
    .from("quizzes")
    .select("id, title")
    .in("id", quizIds);

  if (quizzesError) {
    return NextResponse.json({ error: quizzesError.message }, { status: 500 });
  }

  const { data: questions, error: questionsError } = await supabaseServer
    .from("quiz_questions")
    .select("id, quiz_id, question, options, correct_index, explanation")
    .in("quiz_id", quizIds);

  if (questionsError) {
    return NextResponse.json({ error: questionsError.message }, { status: 500 });
  }

  const quizTitleById = new Map((quizzes ?? []).map((q) => [q.id, q.title]));
  const questionsByQuiz = new Map<string, typeof questions>();
  for (const q of questions ?? []) {
    const list = questionsByQuiz.get(q.quiz_id) ?? [];
    list.push(q);
    questionsByQuiz.set(q.quiz_id, list as any);
  }

  const mistakes: Array<{
    quizId: string;
    quizTitle: string;
    questionId: string;
    question: string;
    options: string[];
    correctIndex: number;
    yourIndex: number | null;
    explanation: string | null;
    completedAt: string | null;
  }> = [];

  for (const attempt of attempts) {
    const answers: Record<string, number> = (attempt.answers as any) ?? {};
    const quizQuestions = questionsByQuiz.get(attempt.quiz_id) ?? [];
    for (const q of quizQuestions as any[]) {
      const picked = answers[q.id];
      if (picked === q.correct_index) continue; // answered correctly
      mistakes.push({
        quizId: attempt.quiz_id,
        quizTitle: quizTitleById.get(attempt.quiz_id) ?? "Quiz",
        questionId: q.id,
        question: q.question,
        options: q.options,
        correctIndex: q.correct_index,
        yourIndex: picked ?? null,
        explanation: q.explanation,
        completedAt: attempt.completed_at,
      });
    }
  }

  // Most recently missed first.
  mistakes.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  return NextResponse.json({ mistakes });
}
