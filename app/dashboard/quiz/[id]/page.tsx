"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  LogOut,
  XCircle,
} from "lucide-react";

type Question = {
  id: string;
  question: string;
  options: string[];
  correct_index?: number;
  explanation?: string | null;
  passage?: string | null;
  position: number;
};

type Quiz = {
  id: string;
  title: string;
  description: string | null;
  time_limit_minutes: number | null;
};

type Attempt = {
  score: number;
  totalQuestions: number;
  answers: Record<string, number>;
} | null;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; quiz: Quiz; questions: Question[]; attempt: Attempt };

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export default function TakeQuizPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const quizId = params.id;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  async function load() {
    try {
      const res = await fetch(`/api/quiz/${quizId}`);
      const data = await res.json();
      if (!res.ok) {
        setState({ status: "error", message: data.error ?? "Something went wrong." });
        return;
      }
      setState({ status: "ready", quiz: data.quiz, questions: data.questions ?? [], attempt: data.attempt });
      if (!data.attempt && data.quiz?.time_limit_minutes) {
        setSecondsLeft(data.quiz.time_limit_minutes * 60);
      }
    } catch {
      setState({ status: "error", message: "Something went wrong." });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  const allAnswered = useMemo(() => {
    if (state.status !== "ready") return false;
    return state.questions.every((q) => selected[q.id] !== undefined);
  }, [state, selected]);

  const answeredCount = useMemo(() => {
    if (state.status !== "ready") return 0;
    return state.questions.filter((q) => selected[q.id] !== undefined).length;
  }, [state, selected]);

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/quiz/${quizId}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: selected }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  // Countdown, only while an untimed-out attempt is actually in progress.
  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      submit();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => (s !== null ? s - 1 : s)), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  if (state.status === "loading") {
    return <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>;
  }

  if (state.status === "error") {
    return (
      <div>
        <BackLink />
        <div className="mt-4 flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
          <p className="font-display text-lg font-semibold">{state.message}</p>
        </div>
      </div>
    );
  }

  const { quiz, questions, attempt } = state;

  // ---------------------------------------------------------------------
  // Review screen (already attempted) — stays inside the normal dashboard
  // shell, since this is just reading back results, not a timed test.
  // ---------------------------------------------------------------------
  if (attempt) {
    return (
      <div>
        <BackLink />
        <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight md:text-3xl">{quiz.title}</h1>
        <div className="mt-3 inline-flex items-center gap-2 rounded-pill border border-leaf-600 bg-white px-4 py-1.5 font-body text-sm font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
          Score: {attempt.score}/{attempt.totalQuestions}
        </div>

        <div className="mt-6 space-y-4">
          {questions.map((q, i) => {
            const picked = attempt.answers[q.id];
            const isCorrect = picked === q.correct_index;
            return (
              <div
                key={q.id}
                className="rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft"
              >
                {q.passage && (
                  <div className="mb-3 rounded-xl bg-ink/5 p-3 font-body text-xs leading-relaxed text-ink-soft dark:bg-night dark:text-cream/50">
                    {q.passage}
                  </div>
                )}
                <div className="flex items-start gap-2">
                  {isCorrect ? (
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-leaf-600 dark:text-leaf-500" />
                  ) : (
                    <XCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
                  )}
                  <p className="font-body text-sm font-semibold">
                    {i + 1}. {q.question}
                  </p>
                </div>
                <ul className="mt-3 space-y-1.5 pl-6">
                  {q.options.map((opt, idx) => {
                    const isPicked = idx === picked;
                    const isRight = idx === q.correct_index;
                    return (
                      <li
                        key={idx}
                        className={
                          "font-body text-sm rounded-lg px-3 py-1.5 " +
                          (isRight
                            ? "bg-leaf-100 text-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500"
                            : isPicked
                            ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                            : "text-ink-soft dark:text-cream/60")
                        }
                      >
                        <span className="mr-1.5 font-semibold">{LETTERS[idx]}.</span>
                        {opt}
                        {isPicked && !isRight && " (your answer)"}
                      </li>
                    );
                  })}
                </ul>
                {q.explanation && (
                  <p className="mt-2 pl-6 font-body text-xs text-ink-soft/70 dark:text-cream/40">
                    {q.explanation}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Taking the quiz — a full-screen, SAT-style split view: reading
  // passage on the left, one question with lettered choices on the
  // right, one question at a time.
  // ---------------------------------------------------------------------
  const q = questions[currentIndex];
  const total = questions.length;
  const isLast = currentIndex === total - 1;
  const isFirst = currentIndex === 0;
  const currentAnswered = q ? selected[q.id] !== undefined : false;

  function goTo(i: number) {
    if (i < 0 || i >= total) return;
    setCurrentIndex(i);
  }

  function exit() {
    if (confirm("Leave the quiz? Your progress on this attempt won't be saved.")) {
      router.push("/dashboard/quiz");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-night font-body text-cream">
      {/* Top bar */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-night-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={exit}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-cream/60 hover:bg-night-soft hover:text-cream"
          >
            <LogOut size={15} />
            <span className="hidden sm:inline">Exit</span>
          </button>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-cream sm:text-base">{quiz.title}</p>
          </div>
        </div>
        {secondsLeft !== null && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-pill bg-night-soft px-3 py-1.5 text-sm font-semibold text-leaf-500">
            <Clock size={14} />
            {formatTime(secondsLeft)}
          </div>
        )}
      </div>

      {/* Meta strip */}
      <div className="flex shrink-0 items-center gap-6 bg-leaf-600 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/95 sm:gap-10 sm:px-6">
        <div>
          <p className="text-white/60">Question</p>
          <p>
            {currentIndex + 1} of {total}
          </p>
        </div>
        <div>
          <p className="text-white/60">Status</p>
          <p>{currentAnswered ? "Answered" : "Not tried"}</p>
        </div>
        <div className="hidden sm:block">
          <p className="text-white/60">Progress</p>
          <p>
            {answeredCount}/{total} answered
          </p>
        </div>
      </div>

      {/* Main content */}
      {q && (
        <div
          className={
            "grid min-h-0 flex-1 overflow-hidden " +
            (q.passage ? "grid-cols-1 md:grid-cols-2 md:divide-x md:divide-night-border" : "grid-cols-1")
          }
        >
          {q.passage && (
            <div className="min-h-0 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
              <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cream/40">
                <BookOpenText size={14} />
                Reading passage
              </div>
              <p className="whitespace-pre-wrap font-body text-[15px] leading-relaxed text-cream/85">
                {q.passage}
              </p>
            </div>
          )}

          <div className="min-h-0 overflow-y-auto px-5 py-6 sm:px-8 sm:py-8">
            <p className="font-body text-base font-semibold leading-relaxed text-cream sm:text-lg">
              {q.question}
            </p>

            <div className="mt-5 space-y-3">
              {q.options.map((opt, idx) => {
                const isSelected = selected[q.id] === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelected((prev) => ({ ...prev, [q.id]: idx }))}
                    className={
                      "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors " +
                      (isSelected
                        ? "border-leaf-500 bg-leaf-500/10 text-cream"
                        : "border-night-border bg-night-soft text-cream/80 hover:border-cream/20 hover:bg-night-soft/80")
                    }
                  >
                    <span
                      className={
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold " +
                        (isSelected
                          ? "border-leaf-500 bg-leaf-500 text-night"
                          : "border-cream/25 text-cream/60")
                      }
                    >
                      {LETTERS[idx]}
                    </span>
                    <span className="min-w-0">{opt}</span>
                  </button>
                );
              })}
            </div>

            {submitError && <p className="mt-4 font-body text-sm text-red-400">{submitError}</p>}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-t border-night-border px-4 sm:px-6">
        <button
          onClick={() => goTo(currentIndex - 1)}
          disabled={isFirst}
          className="flex items-center gap-1 rounded-pill border border-night-border px-3 py-2 text-sm font-semibold text-cream/80 hover:bg-night-soft disabled:opacity-30 sm:px-4"
        >
          <ChevronLeft size={16} />
          Back
        </button>

        <select
          value={currentIndex}
          onChange={(e) => goTo(Number(e.target.value))}
          className="rounded-pill border border-night-border bg-night-soft px-3 py-2 text-xs font-semibold text-cream/80 sm:text-sm"
        >
          {questions.map((qq, i) => (
            <option key={qq.id} value={i}>
              Question {i + 1} of {total} {selected[qq.id] !== undefined ? "• answered" : ""}
            </option>
          ))}
        </select>

        {isLast ? (
          <button
            onClick={submit}
            disabled={!allAnswered || submitting}
            className="rounded-pill bg-leaf-500 px-4 py-2 text-sm font-semibold text-night hover:bg-leaf-600 disabled:opacity-40 sm:px-6"
          >
            {submitting ? "Submitting…" : "Submit quiz"}
          </button>
        ) : (
          <button
            onClick={() => goTo(currentIndex + 1)}
            className="flex items-center gap-1 rounded-pill bg-leaf-500 px-3 py-2 text-sm font-semibold text-night hover:bg-leaf-600 sm:px-4"
          >
            Next
            <ChevronRight size={16} />
          </button>
        )}
      </div>
      {isLast && !allAnswered && (
        <p className="shrink-0 bg-night px-4 pb-3 text-center font-body text-xs text-cream/40">
          Answer every question to submit — {total - answeredCount} left.
        </p>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/quiz"
      className="inline-flex items-center gap-1.5 font-body text-sm text-ink-soft hover:text-ink dark:text-cream/50 dark:hover:text-cream"
    >
      <ArrowLeft size={14} /> Back to Quiz
    </Link>
  );
}

function formatTime(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
