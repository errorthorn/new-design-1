"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  Plus,
  MessageCircle,
  ThumbsUp,
  CheckCircle2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { timeAgo } from "@/lib/utils";

type Question = {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  body: string;
  topic: string | null;
  status: "open" | "solved";
  upvotes: number;
  answerCount: number;
  createdAt: string;
  hasVoted?: boolean;
};

type LoadState =
  | { status: "loading" }
  | { status: "unauthorized"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; questions: Question[] };

type SortOption = "recent" | "top" | "unanswered";
type StatusFilter = "all" | "open" | "solved";

export default function CommunityPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortOption>("recent");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [mineOnly, setMineOnly] = useState(false);
  // Tracks whether this is the very first run of the fetch effect (page
  // just mounted) vs. a re-run caused by the user changing a filter or
  // typing in search. Only the latter should pay the debounce delay —
  // on first load there's nothing to debounce, so waiting 250ms before
  // even starting the fetch was pure dead time on every visit to
  // Community.
  const isFirstLoad = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));

    const params = new URLSearchParams();
    if (query.trim()) params.set("search", query.trim());
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (mineOnly) params.set("mine", "1");
    params.set("sort", sort);

    function run() {
      fetch(`/api/community/questions?${params.toString()}`, { signal: controller.signal })
        .then(async (res) => {
          const data = await res.json();
          if (res.status === 401) {
            setState({ status: "unauthorized", message: data.error ?? "Please log in first." });
          } else if (!res.ok) {
            setState({ status: "error", message: data.error ?? "Something went wrong." });
          } else {
            setState({ status: "ready", questions: data.questions ?? [] });
          }
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            setState({ status: "error", message: "Something went wrong." });
          }
        });
    }

    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      run(); // fetch immediately on the initial page load — nothing to debounce yet
      return () => controller.abort();
    }

    const timer = setTimeout(run, 250); // debounce search typing

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, sort, statusFilter, mineOnly]);

  const questions = state.status === "ready" ? state.questions : [];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            Community
          </h1>
          <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
            Stuck on something? Ask, and get help from other students.
          </p>
        </div>
        <Link
          href="/dashboard/community/new"
          className="inline-flex items-center gap-1.5 rounded-xl bg-leaf-600 px-4 py-2.5 font-body text-sm font-semibold text-white transition hover:bg-leaf-700"
        >
          <Plus size={16} />
          Ask a question
        </Link>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft/40 dark:text-cream/30"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search doubts…"
            className="w-full rounded-2xl border border-ink/10 bg-cream-soft py-3 pl-11 pr-4 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream dark:placeholder:text-cream/30"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-2xl border border-ink/10 bg-cream-soft px-4 py-3 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream"
        >
          <option value="all">All questions</option>
          <option value="open">Open</option>
          <option value="solved">Solved</option>
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="rounded-2xl border border-ink/10 bg-cream-soft px-4 py-3 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream"
        >
          <option value="recent">Most recent</option>
          <option value="top">Most upvoted</option>
          <option value="unanswered">Unanswered</option>
        </select>

        <button
          onClick={() => setMineOnly((v) => !v)}
          className={
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-2xl border px-4 py-3 font-body text-sm font-medium transition " +
            (mineOnly
              ? "border-leaf-600 bg-white text-leaf-700 dark:border-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500"
              : "border-ink/10 bg-cream-soft text-ink-soft hover:border-ink/20 dark:border-night-border dark:bg-night-soft dark:text-cream/60")
          }
        >
          <Users size={15} />
          My posts
        </button>
      </div>

      <div className="mt-6">
        {state.status === "loading" && (
          <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>
        )}

        {(state.status === "unauthorized" || state.status === "error") && (
          <EmptyState icon={MessageCircle} title={state.message} />
        )}

        {state.status === "ready" && questions.length === 0 && (
          <EmptyState
            icon={MessageCircle}
            title={mineOnly ? "You haven't posted anything yet" : "No questions found"}
            subtitle={mineOnly ? "Ask your first question above." : "Try a different search or filter."}
          />
        )}

        {state.status === "ready" && questions.length > 0 && (
          <div className="space-y-4">
            {questions.map((q) => (
              <QuestionCard key={q.id} question={q} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionCard({ question }: { question: Question }) {
  const [upvotes, setUpvotes] = useState(question.upvotes);
  const [hasVoted, setHasVoted] = useState(!!question.hasVoted);
  const [voting, setVoting] = useState(false);

  async function handleVote(e: React.MouseEvent) {
    // Stop the click from also triggering the wrapping <Link> navigation,
    // and guard against double-clicks firing a second request before the
    // first one resolves (that race was causing "the like doesn't take").
    e.preventDefault();
    e.stopPropagation();
    if (voting) return;

    setVoting(true);
    const prevUpvotes = upvotes;
    const prevHasVoted = hasVoted;
    // Optimistic update so the tap feels instant.
    setUpvotes(hasVoted ? upvotes - 1 : upvotes + 1);
    setHasVoted(!hasVoted);

    try {
      const res = await fetch(`/api/community/questions/${question.id}/vote`, { method: "POST" });
      if (!res.ok) throw new Error("vote failed");
      const data = await res.json();
      setUpvotes(data.upvotes);
      setHasVoted(data.hasVoted);
    } catch {
      // Roll back on failure so the UI never silently drifts from the server.
      setUpvotes(prevUpvotes);
      setHasVoted(prevHasVoted);
    } finally {
      setVoting(false);
    }
  }

  return (
    <Link
      href={`/dashboard/community/${question.id}`}
      className="block rounded-2xl border border-ink/10 bg-cream-soft p-5 transition hover:border-leaf-500/40 dark:border-night-border dark:bg-night-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-leaf-600 bg-white font-body text-xs font-semibold text-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500">
            {question.authorAvatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={question.authorAvatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
            ) : (
              question.authorName.slice(0, 1).toUpperCase()
            )}
          </div>
          <div>
            <p className="font-body text-sm font-semibold">{question.authorName}</p>
            <p className="font-body text-xs text-ink-soft/70 dark:text-cream/40">
              {timeAgo(question.createdAt)}
            </p>
          </div>
        </div>

        {question.status === "solved" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-leaf-600 bg-white px-2.5 py-1 font-body text-xs font-semibold text-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500">
            <CheckCircle2 size={12} />
            Solved
          </span>
        )}
      </div>

      <p className="mt-3 font-body text-sm font-semibold">{question.title}</p>
      <p className="mt-1 line-clamp-2 font-body text-sm text-ink-soft dark:text-cream/50">
        {question.body}
      </p>

      <div className="mt-3 flex items-center gap-3">
        {question.topic && (
          <span className="rounded-full border border-ink/10 px-2.5 py-1 font-body text-xs text-ink-soft dark:border-night-border dark:text-cream/50">
            {question.topic}
          </span>
        )}
        <button
          type="button"
          onClick={handleVote}
          disabled={voting}
          className={
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-body text-xs font-medium transition disabled:opacity-60 " +
            (hasVoted
              ? "border-leaf-600 bg-white text-leaf-700 dark:border-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500"
              : "border-transparent text-ink-soft/70 hover:border-ink/10 dark:text-cream/40")
          }
        >
          <ThumbsUp size={13} fill={hasVoted ? "currentColor" : "none"} />
          {upvotes}
        </button>
        <span className="inline-flex items-center gap-1 font-body text-xs text-ink-soft/70 dark:text-cream/40">
          <MessageCircle size={13} />
          {question.answerCount}
        </span>
      </div>
    </Link>
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
