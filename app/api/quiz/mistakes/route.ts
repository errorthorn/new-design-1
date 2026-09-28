import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";

// A "mistake" isn't its own table — it's derived on the fly from the
// student's own quiz_attempts.answers vs the real quiz_questions.
// correct_index, the same source of truth the scoring route in
// /api/quiz/[id]/attempt uses. Keeping it derived (rather than writing a
// separate "wrong answers" row at attempt time) means there's only ever
// one place that decides what's correct.
export async function GET(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  // Home's Mistake Log card (components/dashboard/home/home-view.tsx) only
  // ever reads the COUNT, never question/options/explanation text — those
  // columns can be sizeable per question, and every one of them was being
  // pulled and discarded on every dashboard load. ?countOnly=1 skips the
  // quiz-title lookup entirely (not needed for a count) and narrows the
  // questions select to just the id + correct_index it needs to compare
  // against. The full /dashboard/mistake-log view (which actually renders
  // the question text) calls this without the flag and is unaffected.
  const countOnly = req.nextUrl.searchParams.get("countOnly") === "1";

  const { data: attempts, error: attemptsError } = await supabaseServer
    .from("quiz_attempts")
    .select("quiz_id, answers, completed_at")
    .eq("user_email", user.email);

  if (attemptsError) {
    return NextResponse.json({ error: attemptsError.message }, { status: 500 });
  }
  if (!attempts || attempts.length === 0) {
    return countOnly ? NextResponse.json({ count: 0 }) : NextResponse.json({ mistakes: [] });
  }

  const quizIds = attempts.map((a) => a.quiz_id);

  // Quiz titles and question rows both depend only on quizIds (not on each
  // other), so fetch them together instead of one-after-another. In
  // countOnly mode there's no title to show, so that query is skipped
  // altogether rather than run and thrown away.
  const [quizzesRes, questionsRes] = await Promise.all([
    countOnly
      ? Promise.resolve({ data: [] as { id: string; title: string }[], error: null })
      : supabaseServer.from("quizzes").select("id, title").in("id", quizIds),
    countOnly
      ? supabaseServer.from("quiz_questions").select("id, quiz_id, correct_index").in("quiz_id", quizIds)
      : supabaseServer
          .from("quiz_questions")
          .select("id, quiz_id, question, options, correct_index, explanation")
          .in("quiz_id", quizIds),
  ]);

  if (quizzesRes.error) {
    return NextResponse.json({ error: quizzesRes.error.message }, { status: 500 });
  }
  if (questionsRes.error) {
    return NextResponse.json({ error: questionsRes.error.message }, { status: 500 });
  }
  const quizzes = quizzesRes.data;
  const questions = questionsRes.data;

  if (countOnly) {
    let count = 0;
    const questionsByQuiz = new Map<string, typeof questions>();
    for (const q of questions ?? []) {
      const list = questionsByQuiz.get(q.quiz_id) ?? [];
      list.push(q);
      questionsByQuiz.set(q.quiz_id, list as any);
    }
    for (const attempt of attempts) {
      const answers: Record<string, number> = (attempt.answers as any) ?? {};
      const quizQuestions = questionsByQuiz.get(attempt.quiz_id) ?? [];
      for (const q of quizQuestions as any[]) {
        if (answers[q.id] !== q.correct_index) count++;
      }
    }
    return NextResponse.json({ count });
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
