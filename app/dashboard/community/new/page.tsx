"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NewQuestionPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) {
      setError("Please fill in a title and the question details.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/community/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, topic: topic.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }
      router.push(`/dashboard/community/${data.question.id}`);
    } catch {
      setError("Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/community"
        className="inline-flex items-center gap-1.5 font-body text-sm text-ink-soft transition hover:text-ink dark:text-cream/50 dark:hover:text-cream"
      >
        <ArrowLeft size={15} />
        Back to Community
      </Link>

      <h1 className="mt-4 font-display text-2xl font-semibold tracking-tight md:text-3xl">
        Ask a question
      </h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Be specific — the more detail you give, the easier it is for someone to help.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label className="font-body text-xs font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="e.g. Which choice completes the text with the most logical word?"
            className="mt-1.5 w-full rounded-2xl border border-ink/10 bg-cream-soft px-4 py-3 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream dark:placeholder:text-cream/30"
          />
        </div>

        <div>
          <label className="font-body text-xs font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
            Topic <span className="normal-case text-ink-soft/50 dark:text-cream/30">(optional)</span>
          </label>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={40}
            placeholder="e.g. Reading, Math, Vocabulary"
            className="mt-1.5 w-full rounded-2xl border border-ink/10 bg-cream-soft px-4 py-3 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream dark:placeholder:text-cream/30"
          />
        </div>

        <div>
          <label className="font-body text-xs font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
            Details
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={5000}
            rows={7}
            placeholder="Paste the question, your options, and what you're stuck on…"
            className="mt-1.5 w-full resize-none rounded-2xl border border-ink/10 bg-cream-soft px-4 py-3 font-body text-sm outline-none focus:border-leaf-500/50 dark:border-night-border dark:bg-night-soft dark:text-cream dark:placeholder:text-cream/30"
          />
        </div>

        {error && <p className="font-body text-sm text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-white transition hover:bg-leaf-700 disabled:opacity-60"
        >
          {submitting ? "Posting…" : "Post question"}
        </button>
      </form>
    </div>
  );
}
