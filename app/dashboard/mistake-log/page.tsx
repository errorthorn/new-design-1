"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import {
  Search,
  FileX2,
  XCircle,
  CheckCircle2,
  MessagesSquare,
  Mic,
  Headphones,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { AccessGate } from "@/components/dashboard/access-gate";

type QuizMistake = {
  source: "quiz";
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

// Speaking Club (Phase F) and Mock Test (§7.1 migration) mistakes are
// structurally identical — both come straight out of mistake_logs via
// lib/mistake-logs-db.ts, differing only in the `source` tag — so one
// type + one card component (AiMistakeCard below) serves both, rather
// than duplicating a near-identical type/component pair.
type AiMistake = {
  source: "speaking_club" | "mock_test";
  id: string;
  category: string;
  description: string;
  sourceRefId: string | null;
  createdAt: string;
};

type Mistake = QuizMistake | AiMistake;

// §7.1 step 8: the "Mock Test" tab, previously left disabled with a
// placeholder note in Phase F ("leave room for Mock Test later"), is now
// enabled — its mistakes are written to mistake_logs by the worker
// (lib/speaking-feedback-worker.ts) as of this migration.
const TABS: { key: TabKey; label: string; disabled?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "quiz", label: "Quiz" },
  { key: "speaking_club", label: "Speaking Club" },
  { key: "mock_test", label: "Mock Test" },
];
type TabKey = "all" | "quiz" | "speaking_club" | "mock_test";

type FetchState<T> =
  | { status: "loading" }
  | { status: "unauthorized"; message: string }
  | { status: "forbidden"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; items: T[]; nextCursor: string | null };

function dateOf(m: Mistake): string {
  return m.source === "quiz" ? m.completedAt ?? "" : m.createdAt;
}

const CATEGORY_LABEL: Record<string, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  pronunciation: "Pronunciation",
  fluency: "Fluency",
  coherence: "Coherence",
};

const AI_SOURCE_META: Record<AiMistake["source"], { label: string; icon: LucideIcon }> = {
  speaking_club: { label: "Speaking Club", icon: MessagesSquare },
  mock_test: { label: "Mock Test", icon: Headphones },
};

function fetchAiMistakes(source: "speaking_club" | "mock_test", cursor?: string) {
  const url = source === "speaking_club" ? "/api/speaking-club/mistakes" : "/api/mock-test/mistakes";
  return fetch(cursor ? `${url}?cursor=${encodeURIComponent(cursor)}` : url);
}

export default function MistakeLogPage() {
  const [quizState, setQuizState] = useState<FetchState<QuizMistake>>({ status: "loading" });
  const [speakingState, setSpeakingState] = useState<FetchState<AiMistake>>({ status: "loading" });
  const [mockState, setMockState] = useState<FetchState<AiMistake>>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabKey>("all");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/quiz/mistakes")
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 401) setQuizState({ status: "unauthorized", message: data.error ?? "Please log in first." });
        else if (res.status === 403) setQuizState({ status: "forbidden", message: data.error ?? "Subscription is not active." });
        else if (!res.ok) setQuizState({ status: "error", message: data.error ?? "Something went wrong." });
        else {
          const items: QuizMistake[] = (data.mistakes ?? []).map((m: any) => ({ source: "quiz", ...m }));
          setQuizState({ status: "ready", items, nextCursor: null });
        }
      })
      .catch(() => {
        if (!cancelled) setQuizState({ status: "error", message: "Something went wrong." });
      });

    fetchAiMistakes("speaking_club")
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 401) setSpeakingState({ status: "unauthorized", message: data.error ?? "Please log in first." });
        else if (res.status === 403) setSpeakingState({ status: "forbidden", message: data.error ?? "Subscription is not active." });
        else if (!res.ok) setSpeakingState({ status: "error", message: data.error ?? "Something went wrong." });
        else {
          const items: AiMistake[] = (data.mistakes ?? []).map((m: any) => ({ source: "speaking_club", ...m }));
          setSpeakingState({ status: "ready", items, nextCursor: data.nextCursor ?? null });
        }
      })
      .catch(() => {
        if (!cancelled) setSpeakingState({ status: "error", message: "Something went wrong." });
      });

    fetchAiMistakes("mock_test")
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (res.status === 401) setMockState({ status: "unauthorized", message: data.error ?? "Please log in first." });
        else if (res.status === 403) setMockState({ status: "forbidden", message: data.error ?? "Subscription is not active." });
        else if (!res.ok) setMockState({ status: "error", message: data.error ?? "Something went wrong." });
        else {
          const items: AiMistake[] = (data.mistakes ?? []).map((m: any) => ({ source: "mock_test", ...m }));
          setMockState({ status: "ready", items, nextCursor: data.nextCursor ?? null });
        }
      })
      .catch(() => {
        if (!cancelled) setMockState({ status: "error", message: "Something went wrong." });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Shared by both "Load more" buttons below — which state setter to
  // update is the only thing that differs between the two AI sources.
  async function loadMoreAi(source: "speaking_club" | "mock_test") {
    const state = source === "speaking_club" ? speakingState : mockState;
    const setState = source === "speaking_club" ? setSpeakingState : setMockState;
    if (state.status !== "ready" || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetchAiMistakes(source, state.nextCursor);
      const data = await res.json();
      if (!res.ok) return;
      const newItems: AiMistake[] = (data.mistakes ?? []).map((m: any) => ({ source, ...m }));
      setState((prev: FetchState<AiMistake>) =>
        prev.status === "ready" ? { status: "ready", items: [...prev.items, ...newItems], nextCursor: data.nextCursor ?? null } : prev
      );
    } finally {
      setLoadingMore(false);
    }
  }

  // All three sources share the same auth gate (requireActiveMember), so
  // they should agree — but if they ever disagree (one down, one up),
  // still fail closed on unauthorized/forbidden rather than silently
  // hiding part of the page's data.
  const authIssue =
    (quizState.status === "unauthorized" && quizState) ||
    (speakingState.status === "unauthorized" && speakingState) ||
    (mockState.status === "unauthorized" && mockState) ||
    (quizState.status === "forbidden" && quizState) ||
    (speakingState.status === "forbidden" && speakingState) ||
    (mockState.status === "forbidden" && mockState) ||
    null;

  const allLoading = quizState.status === "loading" && speakingState.status === "loading" && mockState.status === "loading";
  const allErrored = quizState.status === "error" && speakingState.status === "error" && mockState.status === "error";

  const quizItems = quizState.status === "ready" ? quizState.items : [];
  const speakingItems = speakingState.status === "ready" ? speakingState.items : [];
  const mockItems = mockState.status === "ready" ? mockState.items : [];

  const combined: Mistake[] = useMemo(() => {
    const pool =
      tab === "all"
        ? [...quizItems, ...speakingItems, ...mockItems]
        : tab === "quiz"
        ? quizItems
        : tab === "speaking_club"
        ? speakingItems
        : mockItems;
    return [...pool].sort((a, b) => dateOf(b).localeCompare(dateOf(a)));
  }, [tab, quizItems, speakingItems, mockItems]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return combined;
    return combined.filter((m) =>
      m.source === "quiz"
        ? m.question.toLowerCase().includes(q) || m.quizTitle.toLowerCase().includes(q)
        : m.description.toLowerCase().includes(q) || (CATEGORY_LABEL[m.category] ?? m.category).toLowerCase().includes(q)
    );
  }, [combined, query]);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">Mistake Log</h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Every mistake found across your quizzes, Speaking Club sessions, and Mock Tests, in one place.
      </p>

      {!authIssue && !allLoading && (
        <>
          <div className="mt-6 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => !t.disabled && setTab(t.key)}
                disabled={t.disabled}
                title={t.disabled ? "Coming soon" : undefined}
                className={
                  "rounded-pill px-4 py-1.5 font-body text-sm font-medium transition-colors " +
                  (t.disabled
                    ? "cursor-not-allowed text-ink-soft/30 dark:text-cream/20"
                    : tab === t.key
                    ? "bg-leaf-600 text-white"
                    : "border border-ink/10 text-ink-soft hover:border-leaf-500/40 dark:border-night-border dark:text-cream/60")
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative mt-4">
            <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft/40 dark:text-cream/30" />
            <input
              value={query}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-2xl border border-ink/10 bg-cream-soft py-3 pl-11 pr-4 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream dark:placeholder:text-cream/30"
            />
          </div>
        </>
      )}

      <div className="mt-6">
        {allLoading && <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>}

        {authIssue && <AccessGate status={authIssue.status as "unauthorized" | "forbidden"} message={authIssue.message} icon={FileX2} />}

        {!authIssue && allErrored && <AccessGate status="error" message="Something went wrong." icon={FileX2} />}

        {!authIssue && !allLoading && !allErrored && filtered.length === 0 && (
          <EmptyState
            icon={FileX2}
            title={combined.length === 0 ? "No mistakes found" : "No matching results"}
            subtitle={combined.length === 0 ? "Keep practicing to find areas for improvement!" : "Try a different search."}
          />
        )}

        {!authIssue && filtered.length > 0 && (
          <div className="space-y-4">
            {filtered.map((m: Mistake) => (m.source === "quiz" ? <QuizMistakeCard key={`quiz-${m.quizId}-${m.questionId}`} m={m} /> : <AiMistakeCard key={`${m.source}-${m.id}`} m={m} />))}
          </div>
        )}

        {/* Load more is single-source only — "all" mixes three sources
            with no single combined cursor, so this stays a per-tab
            control rather than trying to paginate the merged view. */}
        {!authIssue && tab === "speaking_club" && speakingState.status === "ready" && speakingState.nextCursor && (
          <LoadMoreButton loading={loadingMore} onClick={() => loadMoreAi("speaking_club")} />
        )}
        {!authIssue && tab === "mock_test" && mockState.status === "ready" && mockState.nextCursor && (
          <LoadMoreButton loading={loadingMore} onClick={() => loadMoreAi("mock_test")} />
        )}
      </div>
    </div>
  );
}

function LoadMoreButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <div className="mt-5 flex justify-center">
      <button
        onClick={onClick}
        disabled={loading}
        className="flex items-center gap-2 rounded-pill border border-ink/10 px-5 py-2 font-body text-sm font-medium text-ink-soft hover:border-leaf-500/40 disabled:opacity-60 dark:border-night-border dark:text-cream/60"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        Load more
      </button>
    </div>
  );
}

function QuizMistakeCard({ m }: { m: QuizMistake }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft">
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

      {m.explanation && <p className="mt-2 pl-6 font-body text-xs text-ink-soft/70 dark:text-cream/40">{m.explanation}</p>}
    </div>
  );
}

// Shared by both Speaking Club (Phase F) and Mock Test (§7.1) mistakes —
// same shape, same card treatment: category tag (from the mistake_logs
// `check` constraint's five values) + the AI's description + date, no
// options list to render (unlike quiz, there's no single "correct
// answer" for a speaking mistake). Not linked anywhere, since neither
// source has a single-session detail page to link into yet.
function AiMistakeCard({ m }: { m: AiMistake }) {
  const meta = AI_SOURCE_META[m.source];
  const Icon = meta.icon;
  return (
    <div className="rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-body text-xs font-semibold uppercase tracking-wider text-leaf-600 dark:text-leaf-500">
          <Icon size={13} />
          {meta.label}
        </span>
        <span className="font-body text-xs text-ink-soft/60 dark:text-cream/30">
          {new Date(m.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>

      <div className="mt-2 flex items-start gap-2">
        <Mic size={16} className="mt-0.5 shrink-0 text-red-500" />
        <div>
          <span className="rounded-pill bg-leaf-100 px-2 py-0.5 font-body text-[11px] font-medium text-leaf-700 dark:bg-night-border dark:text-leaf-500">
            {CATEGORY_LABEL[m.category] ?? m.category}
          </span>
          <p className="mt-1.5 font-body text-sm">{m.description}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, subtitle }: { icon: LucideIcon; title: string; subtitle?: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
      <div className="grid h-14 w-14 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
        <Icon size={26} />
      </div>
      <p className="mt-5 font-display text-lg font-semibold">{title}</p>
      {subtitle && <p className="mt-1.5 max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">{subtitle}</p>}
    </div>
  );
}
