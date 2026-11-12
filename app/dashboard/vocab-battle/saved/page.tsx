"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookmarkCheck, Loader2, Trash2 } from "lucide-react";

type SavedWord = {
  id: number;
  word: string;
  meaning: string | null;
  pronunciation: string | null;
  example: string | null;
};

export default function VocabBattleSavedWordsPage() {
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/vocab-battle/saved-words")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load your saved words.");
        setWords(data.words ?? []);
      })
      .catch((e) => setError(e.message || "Could not load your saved words."));
  }, []);

  async function remove(id: number) {
    const previous = words;
    setWords((cur) => (cur ? cur.filter((w) => w.id !== id) : cur));
    try {
      const res = await fetch(`/api/vocab-battle/saved-words?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setWords(previous);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-0">
      <Link
        href="/dashboard/vocab-battle"
        className="inline-flex items-center gap-1.5 font-body text-sm font-medium text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
      >
        <ArrowLeft size={15} />
        Back to Arena
      </Link>

      <h1 className="mt-4 flex items-center gap-2 font-display text-2xl font-bold">
        <BookmarkCheck size={22} className="text-leaf-600 dark:text-leaf-500" />
        Saved Words
      </h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Words you saved from the &ldquo;Words to review&rdquo; list after a battle.
      </p>

      {error && <p className="mt-8 text-center font-body text-sm text-ink-soft dark:text-cream/60">{error}</p>}

      {!error && words === null && (
        <div className="mt-10 flex justify-center">
          <Loader2 size={22} className="animate-spin text-leaf-600" />
        </div>
      )}

      {words && words.length === 0 && (
        <p className="mt-10 rounded-2xl border border-ink/10 bg-cream-soft p-6 text-center font-body text-sm text-ink-soft dark:border-night-border dark:bg-night-soft dark:text-cream/60">
          No saved words yet. After a battle, tap Save next to a missed word to keep it here.
        </p>
      )}

      {words && words.length > 0 && (
        <ul className="mt-6 flex flex-col gap-3">
          {words.map((w) => (
            <li
              key={w.id}
              className="rounded-2xl border border-ink/10 bg-cream-soft p-4 dark:border-night-border dark:bg-night-soft"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold">
                    {w.word}
                    {w.pronunciation && (
                      <span className="ml-2 font-body text-xs font-normal text-ink-soft dark:text-cream/50">{w.pronunciation}</span>
                    )}
                  </p>
                  {w.meaning && <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/70">{w.meaning}</p>}
                  {w.example && (
                    <p className="mt-1.5 font-body text-xs italic text-ink-soft/80 dark:text-cream/50">&ldquo;{w.example}&rdquo;</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove(w.id)}
                  aria-label={`Remove ${w.word}`}
                  className="shrink-0 text-ink-soft/60 transition-colors hover:text-red-500 dark:text-cream/40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
