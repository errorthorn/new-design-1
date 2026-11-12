"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ThumbsUp, CheckCircle2, MessageCircle, type LucideIcon } from "lucide-react";
import { timeAgo } from "@/lib/utils";

type Question = {
  id: string;
  userEmail: string;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  body: string;
  topic: string | null;
  status: "open" | "solved";
  upvotes: number;
  answerCount: number;
  createdAt: string;
  hasVoted: boolean;
};

type Answer = {
  id: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  isAccepted: boolean;
  upvotes: number;
  createdAt: string;
  hasVoted: boolean;
};

type LoadState =
  | { status: "loading" }
  | { status: "unauthorized"; message: string }
  | { status: "notfound"; message: string }
  | { status: "error"; message: string }
  | { status: "ready"; question: Question; answers: Answer[] };

export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [votingQuestion, setVotingQuestion] = useState(false);
  const [votingAnswerIds, setVotingAnswerIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setViewerEmail(d.user?.email ?? null))
      .catch(() => {});
  }, []);

  async function load() {
    const res = await fetch(`/api/community/questions/${id}`);
    const data = await res.json();
    if (res.status === 401) {
      setState({ status: "unauthorized", message: data.error ?? "Please log in first." });
    } else if (res.status === 404) {
      setState({ status: "notfound", message: "This question doesn't exist." });
    } else if (!res.ok) {
      setState({ status: "error", message: data.error ?? "Something went wrong." });
    } else {
      setState({ status: "ready", question: data.question, answers: data.answers ?? [] });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function voteQuestion() {
    if (state.status !== "ready" || votingQuestion) return;
    // Guard so a fast double-tap can't fire two requests at once — that
    // race was the cause of the vote sometimes silently not registering.
    setVotingQuestion(true);
    const prevQuestion = state.question;
    // Optimistic update so the tap feels instant even before the request resolves.
    setState({
      ...state,
      question: {
        ...state.question,
        upvotes: state.question.hasVoted ? state.question.upvotes - 1 : state.question.upvotes + 1,
        hasVoted: !state.question.hasVoted,
      },
    });

    try {
      const res = await fetch(`/api/community/questions/${id}/vote`, { method: "POST" });
      if (!res.ok) throw new Error("vote failed");
      const { upvotes, hasVoted } = await res.json();
      setState((s) => (s.status === "ready" ? { ...s, question: { ...s.question, upvotes, hasVoted } } : s));
    } catch {
      setState((s) => (s.status === "ready" ? { ...s, question: prevQuestion } : s));
    } finally {
      setVotingQuestion(false);
    }
  }

  async function voteAnswer(answerId: string) {
    if (state.status !== "ready" || votingAnswerIds.has(answerId)) return;
    setVotingAnswerIds((prev) => new Set(prev).add(answerId));
    const prevAnswer = state.answers.find((a) => a.id === answerId);
    setState({
      ...state,
      answers: state.answers.map((a) =>
        a.id === answerId
          ? { ...a, upvotes: a.hasVoted ? a.upvotes - 1 : a.upvotes + 1, hasVoted: !a.hasVoted }
          : a
      ),
    });

    try {
      const res = await fetch(`/api/community/answers/${answerId}/vote`, { method: "POST" });
      if (!res.ok) throw new Error("vote failed");
      const { upvotes, hasVoted } = await res.json();
      setState((s) =>
        s.status === "ready"
          ? { ...s, answers: s.answers.map((a) => (a.id === answerId ? { ...a, upvotes, hasVoted } : a)) }
          : s
      );
    } catch {
      setState((s) =>
        s.status === "ready" && prevAnswer
          ? { ...s, answers: s.answers.map((a) => (a.id === answerId ? prevAnswer : a)) }
          : s
      );
    } finally {
      setVotingAnswerIds((prev) => {
        const next = new Set(prev);
        next.delete(answerId);
        return next;
      });
    }
  }

  async function acceptAnswer(answerId: string) {
    const res = await fetch(`/api/community/questions/${id}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answerId }),
    });
    if (res.ok) load();
  }

  async function submitReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setSubmitting(true);
    const res = await fetch(`/api/community/questions/${id}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: reply }),
    });
    setSubmitting(false);
    if (res.ok) {
      setReply("");
      load();
    }
  }

  if (state.status === "loading") {
    return <p className="font-body text-sm text-ink-soft dark:text-cream/50">Loading…</p>;
  }

  if (state.status !== "ready") {
    return (
      <div>
        <BackLink />
        <EmptyState icon={MessageCircle} title={state.message} />
      </div>
    );
  }

  const { question, answers } = state;
  const isOwner = viewerEmail && viewerEmail === question.userEmail;

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink />

      <div className="mt-4 rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft">
        <div className="flex items-start justify-between gap-3">
          <AuthorRow name={question.authorName} avatarUrl={question.authorAvatarUrl} createdAt={question.createdAt} />
          {question.status === "solved" && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-leaf-600 bg-white px-2.5 py-1 font-body text-xs font-semibold text-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500">
              <CheckCircle2 size={12} />
              Solved
            </span>
          )}
        </div>

        <h1 className="mt-3 font-display text-xl font-semibold tracking-tight">{question.title}</h1>
        <p className="mt-2 whitespace-pre-wrap font-body text-sm text-ink-soft dark:text-cream/60">
          {question.body}
        </p>

        <div className="mt-4 flex items-center gap-3">
          {question.topic && (
            <span className="rounded-full border border-ink/10 px-2.5 py-1 font-body text-xs text-ink-soft dark:border-night-border dark:text-cream/50">
              {question.topic}
            </span>
          )}
          <VoteButton
            active={question.hasVoted}
            count={question.upvotes}
            onClick={voteQuestion}
            disabled={votingQuestion}
          />
        </div>
      </div>

      <h2 className="mt-8 font-body text-sm font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
        {answers.length} {answers.length === 1 ? "Reply" : "Replies"}
      </h2>

      <div className="mt-3 space-y-3">
        {answers.length === 0 && (
          <p className="font-body text-sm text-ink-soft/70 dark:text-cream/40">
            No replies yet — be the first to help.
          </p>
        )}

        {answers.map((a) => (
          <div
            key={a.id}
            className={
              "rounded-2xl border p-5 " +
              (a.isAccepted
                ? "border-leaf-600 bg-white dark:border-leaf-700/40 dark:bg-leaf-700/10"
                : "border-ink/10 bg-cream-soft dark:border-night-border dark:bg-night-soft")
            }
          >
            <div className="flex items-start justify-between gap-3">
              <AuthorRow name={a.authorName} avatarUrl={a.authorAvatarUrl} createdAt={a.createdAt} />
              {a.isAccepted && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-leaf-600 bg-white px-2.5 py-1 font-body text-xs font-semibold text-leaf-700">
                  <CheckCircle2 size={12} />
                  Accepted
                </span>
              )}
            </div>

            <p className="mt-2 whitespace-pre-wrap font-body text-sm text-ink-soft dark:text-cream/60">
              {a.body}
            </p>

            <div className="mt-3 flex items-center gap-3">
              <VoteButton
                active={a.hasVoted}
                count={a.upvotes}
                onClick={() => voteAnswer(a.id)}
                disabled={votingAnswerIds.has(a.id)}
              />
              {isOwner && !a.isAccepted && question.status !== "solved" && (
                <button
                  onClick={() => acceptAnswer(a.id)}
                  className="font-body text-xs font-semibold text-leaf-700 hover:underline dark:text-leaf-500"
                >
                  Mark as accepted
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={submitReply} className="mt-6">
        <label className="font-body text-xs font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
          Your reply
        </label>
        <textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Share how you'd solve this…"
          className="mt-1.5 w-full resize-none rounded-2xl border border-ink/10 bg-cream-soft px-4 py-3 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream dark:placeholder:text-cream/30"
        />
        <button
          type="submit"
          disabled={submitting || !reply.trim()}
          className="mt-2 rounded-xl bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-white transition hover:bg-leaf-700 disabled:opacity-60"
        >
          {submitting ? "Posting…" : "Post reply"}
        </button>
      </form>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/community"
      className="inline-flex items-center gap-1.5 font-body text-sm text-ink-soft transition hover:text-ink dark:text-cream/50 dark:hover:text-cream"
    >
      <ArrowLeft size={15} />
      Back to Community
    </Link>
  );
}

function AuthorRow({
  name,
  avatarUrl,
  createdAt,
}: {
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full border border-leaf-600 bg-white font-body text-xs font-semibold text-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          name.slice(0, 1).toUpperCase()
        )}
      </div>
      <div>
        <p className="font-body text-sm font-semibold">{name}</p>
        <p className="font-body text-xs text-ink-soft/70 dark:text-cream/40">{timeAgo(createdAt)}</p>
      </div>
    </div>
  );
}

function VoteButton({
  active,
  count,
  onClick,
  disabled,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-body text-xs font-medium transition disabled:opacity-60 " +
        (active
          ? "border-leaf-600 bg-white text-leaf-700 dark:border-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-500"
          : "border-ink/10 text-ink-soft/70 hover:border-ink/20 dark:border-night-border dark:text-cream/40")
      }
    >
      <ThumbsUp size={13} fill={active ? "currentColor" : "none"} />
      {count}
    </button>
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
    <div className="mt-4 flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-ink/15 bg-cream-soft px-6 py-16 text-center dark:border-night-border dark:bg-night-soft">
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
