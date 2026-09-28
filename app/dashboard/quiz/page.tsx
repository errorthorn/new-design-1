"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Zap, Clock, ListChecks, CheckCircle2, ArrowRight } from "lucide-react";
import { AccessGate } from "@/components/dashboard/access-gate";

type QuizSummary = {
  id: string;
  title: string;
  description: string | null;
  time_limit_minutes: number | null;
  questionCount: number;
  attempted: boolean;
  score: number | null;
  totalQuestions: number | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "unauthorized"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; quizzes: QuizSummary[] };

export default function QuizPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quiz")
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 401) {
          setState({ status: "unauthorized", message: data.error ?? "Please log in first." });
        } else if (res.status === 403) {
          setState({ status: "forbidden", message: data.error ?? "Subscription is not active." });
        } else if (!res.ok) {
          setState({ status: "error", message: data.error ?? "Something went wrong." });
        } else {
          setState({ status: "ready", quizzes: data.quizzes ?? [] });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Something went wrong." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Quiz</h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Every quiz here is tied to a class — take it once your class is done to check what stuck.
      </p>

      <div className="mt-6">
        {state.status === "loading" && (
          <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>
        )}

        {(state.status === "unauthorized" || state.status === "forbidden" || state.status === "error") && (
          <AccessGate status={state.status} message={state.message} icon={Zap} />
        )}

        {state.status === "ready" && state.quizzes.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
            <div className="grid h-14 w-14 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
              <Zap size={26} />
            </div>
            <p className="mt-5 font-display text-lg font-semibold">No quizzes yet</p>
            <p className="mt-1.5 max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">
              Your teacher will publish a quiz here after your next class.
            </p>
          </div>
        )}

        {state.status === "ready" && state.quizzes.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {state.quizzes.map((quiz) => (
              <Link
                key={quiz.id}
                href={`/dashboard/quiz/${quiz.id}`}
                className="group flex flex-col rounded-2xl border border-ink/10 bg-cream-soft p-5 transition-colors hover:border-leaf-500/50 dark:border-night-border dark:bg-night-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-base font-semibold leading-snug">{quiz.title}</p>
                  {quiz.attempted ? (
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-leaf-600 dark:text-leaf-500" />
                  ) : (
                    <ArrowRight
                      size={18}
                      className="mt-0.5 shrink-0 text-ink-soft/30 transition-transform group-hover:translate-x-0.5 dark:text-cream/30"
                    />
                  )}
                </div>

                {quiz.description && (
                  <p className="mt-1.5 font-body text-sm text-ink-soft dark:text-cream/60">{quiz.description}</p>
                )}

                <div className="mt-4 flex items-center gap-3 font-body text-xs text-ink-soft/70 dark:text-cream/40">
                  <span className="flex items-center gap-1">
                    <ListChecks size={13} /> {quiz.questionCount} question{quiz.questionCount === 1 ? "" : "s"}
                  </span>
                  {quiz.time_limit_minutes && (
                    <span className="flex items-center gap-1">
                      <Clock size={13} /> {quiz.time_limit_minutes} min
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  {quiz.attempted ? (
                    <span className="inline-flex items-center rounded-pill border border-leaf-600 bg-white px-3 py-1 font-body text-xs font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
                      Completed · {quiz.score}/{quiz.totalQuestions}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-pill bg-leaf-500 px-3 py-1 font-body text-xs font-semibold text-white group-hover:bg-leaf-600">
                      Start quiz
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
