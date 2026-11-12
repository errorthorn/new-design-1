import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";

// A "mistake" isn't its own table — it's derived on the fly from the
// student's own quiz_attempts.answers vs the real quiz_questions.
// correct_index, the same source of truth the scoring route in
// /api/quiz/[id]/attempt uses. Keeping it derived (rather than writing a
// separate "wrong answers" row at attempt time) means there's only ever
// one place that decides what's correct.
//
// Only the mistakes from the student's latest attempt that had at least one
// wrong answer are returned (see the comment further down).
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

  const questionsByQuiz = new Map<string, typeof questions>();
  for (const q of questions ?? []) {
    const list = questionsByQuiz.get(q.quiz_id) ?? [];
    list.push(q);
    questionsByQuiz.set(q.quiz_id, list as any);
  }

  // Only the student's MOST RECENT attempt that had at least one wrong
  // answer counts. So after a new (daily) quiz, yesterday's mistakes stay on
  // screen until the student takes the new quiz AND gets something wrong -
  // then those replace the old ones. A perfect score never empties the log,
  // and old quizzes (even unpublished ones) keep their questions, so the
  // derived mistakes stay valid.
  const newestFirst = [...attempts].sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  let latestAttempt: (typeof attempts)[number] | null = null;
  let wrongQuestions: any[] = [];
  for (const attempt of newestFirst) {
    // The daily cleanup (lib/data-retention.ts) clears `answers` on attempts
    // that are no longer needed. No answers = nothing to compare, so skip it
    // (otherwise every question would look "wrong").
    if (attempt.answers == null) continue;
    const answers: Record<string, number> = (attempt.answers as any) ?? {};
    const wrong = ((questionsByQuiz.get(attempt.quiz_id) ?? []) as any[]).filter(
      (q) => answers[q.id] !== q.correct_index
    );
    if (wrong.length > 0) {
      latestAttempt = attempt;
      wrongQuestions = wrong;
      break;
    }
  }

  if (countOnly) {
    return NextResponse.json({ count: wrongQuestions.length });
  }
  if (!latestAttempt) {
    return NextResponse.json({ mistakes: [] });
  }

  const quizTitleById = new Map((quizzes ?? []).map((q) => [q.id, q.title]));
  const answers: Record<string, number> = (latestAttempt.answers as any) ?? {};
  const mistakes = wrongQuestions.map((q) => ({
    quizId: latestAttempt!.quiz_id,
    quizTitle: quizTitleById.get(latestAttempt!.quiz_id) ?? "Quiz",
    questionId: q.id,
    question: q.question,
    options: q.options as string[],
    correctIndex: q.correct_index as number,
    yourIndex: (answers[q.id] ?? null) as number | null,
    explanation: (q.explanation ?? null) as string | null,
    completedAt: latestAttempt!.completed_at as string | null,
  }));

  return NextResponse.json({ mistakes });
}
