"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, FileX2, XCircle, CheckCircle2, type LucideIcon } from "lucide-react";
import { AccessGate } from "@/components/dashboard/access-gate";

type Mistake = {
  quizId: string;
  quizTitle: string;
  questionId: string;
  question: string;
  options: string[];
  correctIndex: number;
  yourIndex: number | null;
  explanation: string | null;
  completedAt: string | null;
};

type LoadState =
  | { status: "loading" }
  | { status: "unauthorized"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; mistakes: Mistake[] };

export default function MistakeLogPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quiz/mistakes")
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
          setState({ status: "ready", mistakes: data.mistakes ?? [] });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Something went wrong." });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (state.status !== "ready") return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.mistakes;
    return state.mistakes.filter(
      (m) => m.question.toLowerCase().includes(q) || m.quizTitle.toLowerCase().includes(q)
    );
  }, [state, query]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Mistake Log</h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Every question you&apos;ve gotten wrong across your quizzes, in one place.
      </p>

      {state.status === "ready" && (
        <div className="relative mt-6">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft/40 dark:text-cream/30" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions…"
            className="w-full rounded-2xl border border-ink/10 bg-cream-soft py-3 pl-11 pr-4 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream dark:placeholder:text-cream/30"
          />
        </div>
      )}

      <div className="mt-6">
        {state.status === "loading" && (
          <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>
        )}

        {(state.status === "unauthorized" || state.status === "forbidden" || state.status === "error") && (
          <AccessGate status={state.status} message={state.message} icon={FileX2} />
        )}

        {state.status === "ready" && filtered.length === 0 && (
          <EmptyState
            icon={FileX2}
            title={state.mistakes.length === 0 ? "No mistakes found" : "No matching questions"}
            subtitle={
              state.mistakes.length === 0
                ? "Keep practicing to find areas for improvement!"
                : "Try a different search."
            }
          />
        )}

        {state.status === "ready" && filtered.length > 0 && (
          <div className="space-y-4">
            {filtered.map((m) => (
              <div
                key={`${m.quizId}-${m.questionId}`}
                className="rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft"
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/dashboard/quiz/${m.quizId}`}
                    className="font-body text-xs font-semibold uppercase tracking-wider text-leaf-600 hover:underline dark:text-leaf-500"
                  >
                    {m.quizTitle}
                  </Link>
                </div>

                <div className="mt-2 flex items-start gap-2">
                  <XCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
                  <p className="font-body text-sm font-semibold">{m.question}</p>
                </div>

                <ul className="mt-3 space-y-1.5 pl-6">
                  {m.options.map((opt, idx) => {
                    const isRight = idx === m.correctIndex;
                    const isPicked = idx === m.yourIndex;
                    return (
                      <li
                        key={idx}
                        className={
                          "flex items-center gap-1.5 font-body text-sm rounded-lg px-3 py-1.5 " +
                          (isRight
                            ? "bg-leaf-100 text-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500"
                            : isPicked
                            ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
                            : "text-ink-soft dark:text-cream/60")
                        }
                      >
                        {isRight && <CheckCircle2 size={13} className="shrink-0" />}
                        {opt}
                        {isPicked && !isRight && " (your answer)"}
                      </li>
                    );
                  })}
                </ul>

                {m.explanation && (
                  <p className="mt-2 pl-6 font-body text-xs text-ink-soft/70 dark:text-cream/40">{m.explanation}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
        <Icon size={26} />
      </div>
      <p className="mt-5 font-display text-lg font-semibold">{title}</p>
      {subtitle && (
        <p className="mt-1.5 max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">{subtitle}</p>
      )}
    </div>
  );
}
