"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  X,
  Shuffle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  BookOpen,
} from "lucide-react";

type VocabWordExample = { en: string; bn: string | null };
type VocabWord = {
  id: number;
  word: string;
  pronunciation: string | null;
  partOfSpeech: string | null;
  meaning: string;
  synonyms: string[];
  examples: VocabWordExample[];
  status: "known" | "learning" | null;
};

function speak(word: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function VocabPracticePage() {
  const router = useRouter();
  const [words, setWords] = useState<VocabWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knew, setKnew] = useState(0);
  const [learning, setLearning] = useState(0);

  useEffect(() => {
    fetch("/api/vocab")
      .then((res) => res.json())
      .then((data) => setWords(data.words ?? []))
      .finally(() => setLoading(false));
  }, []);

  const current = words[index];
  const isLast = words.length > 0 && index === words.length - 1;
  const progress = words.length ? Math.round((index / words.length) * 100) : 0;

  const advance = useCallback(() => {
    setFlipped(false);
    setIndex((i) => Math.min(i + 1, words.length - 1));
  }, [words.length]);

  const goBack = useCallback(() => {
    setFlipped(false);
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  async function markProgress(status: "known" | "learning") {
    if (!current) return;
    if (status === "known") setKnew((n) => n + 1);
    else setLearning((n) => n + 1);

    fetch(`/api/vocab/${current.id}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {
      /* best-effort — the session counters above already moved on */
    });

    if (isLast) {
      router.push("/dashboard/vocab");
    } else {
      advance();
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const dots = useMemo(() => words.map((_, i) => i), [words]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-body text-sm text-ink-soft dark:text-cream/50">
        Loading…
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <BookOpen size={28} className="text-ink-soft/50 dark:text-cream/30" />
        <p className="font-display text-lg font-semibold">No words to practice yet</p>
        <p className="max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">
          New words are added daily — check back soon.
        </p>
        <Link
          href="/dashboard/vocab"
          className="mt-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
        >
          Back to Vocab
        </Link>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-cream dark:bg-night">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-ink/10 px-4 py-3 dark:border-night-border sm:gap-4 md:px-6">
        <Link
          href="/dashboard/vocab"
          aria-label="Close"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-leaf-100 hover:text-ink dark:text-cream/60 dark:hover:bg-night-soft dark:hover:text-cream"
        >
          <X size={16} />
        </Link>
        <span className="shrink-0 font-body text-sm font-medium text-ink-soft dark:text-cream/60">
          {index + 1} / {words.length}
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-center">
          Vocabulary Practice
        </span>
        <button
          onClick={() => setWords((w) => shuffleArray(w))}
          className="flex shrink-0 items-center gap-1.5 font-body text-sm font-medium text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
        >
          <Shuffle size={15} />
          <span className="hidden sm:inline">Shuffle</span>
        </button>
      </div>

      {/* Knew / Learning counters */}
      <div className="flex items-center justify-center gap-3 border-b border-ink/10 px-4 py-3 dark:border-night-border">
        <span className="flex items-center gap-2 rounded-pill border border-leaf-600 bg-white px-4 py-1.5 font-body text-sm font-semibold text-leaf-700 dark:bg-night-soft dark:text-leaf-500">
          <ThumbsUp size={14} />
          KNEW <span className="font-bold">{knew}</span>
        </span>
        <span className="flex items-center gap-2 rounded-pill bg-amber-100 px-4 py-1.5 font-body text-sm font-semibold text-amber-700 dark:bg-night-soft dark:text-amber-400">
          <ThumbsDown size={14} />
          LEARNING <span className="font-bold">{learning}</span>
        </span>
      </div>

      {/* Card */}
      <div className="flex flex-1 items-center justify-center px-4">
        <div className="flex w-full max-w-xl items-center gap-1.5 sm:gap-3">
          <button
            onClick={goBack}
            disabled={index === 0}
            aria-label="Previous"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-leaf-100 disabled:opacity-30 dark:text-cream/50 dark:hover:bg-night-soft"
          >
            <ChevronLeft size={20} />
          </button>

          <button
            onClick={() => setFlipped((f) => !f)}
            className={`relative min-h-[420px] w-full overflow-hidden rounded-2xl text-left shadow-lg transition-colors sm:min-h-[460px] ${
              flipped ? "bg-cream-soft p-6 sm:p-8" : "bg-gradient-to-br from-[#16240F] to-[#0B120A] p-6 sm:p-10"
            }`}
          >
            {!flipped ? (
              <>
                <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-leaf-500/20" />
                <div className="pointer-events-none absolute -bottom-16 -left-10 h-44 w-44 rounded-full bg-leaf-500/20" />
                <div className="relative flex items-center justify-between">
                  <span className="inline-flex items-center rounded-pill bg-leaf-500/15 px-3 py-1 font-body text-[11px] font-bold uppercase tracking-widest text-leaf-500">
                    Word
                  </span>
                </div>
                <div className="relative flex h-full min-h-[280px] flex-col items-center justify-center text-center">
                  <span className="font-display text-5xl font-bold text-cream">{current.word}</span>
                  {current.pronunciation && (
                    <span className="mt-5 flex items-center gap-2 rounded-pill bg-cream/10 px-4 py-2 font-body text-sm font-medium text-cream/90">
                      {current.pronunciation}
                      <Volume2
                        size={14}
                        onClick={(e) => {
                          e.stopPropagation();
                          speak(current.word);
                        }}
                      />
                    </span>
                  )}
                  <span className="mt-10 flex items-center gap-1.5 font-body text-xs font-medium text-cream/50">
                    <RotateCcw size={12} />
                    Click to reveal definition
                  </span>
                </div>
              </>
            ) : (
              <div className="relative flex h-full flex-col items-center text-center">
                <div className="flex w-full items-start justify-between">
                  <span className="font-body text-[11px] font-semibold uppercase tracking-widest text-ink-soft">
                    Definition
                  </span>
                  <span className="rounded-pill bg-leaf-600 px-3 py-1 font-body text-xs font-bold text-cream">
                    {current.word}
                  </span>
                </div>

                {current.partOfSpeech && (
                  <span className="mt-3 rounded-pill bg-leaf-100 px-3 py-1 font-body text-xs font-semibold italic text-leaf-700">
                    {current.partOfSpeech}
                  </span>
                )}

                <p className="mt-4 font-display text-2xl font-bold leading-snug text-ink">
                  {current.meaning}
                </p>

                {current.synonyms.length > 0 && (
                  <div className="mt-5">
                    <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                      Synonyms
                    </span>
                    <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                      {current.synonyms.map((s) => (
                        <span
                          key={s}
                          className="rounded-pill border border-leaf-600/30 bg-leaf-50 px-3 py-1 font-body text-xs font-medium text-leaf-700"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {current.examples.length > 0 && (
                  <div className="mt-5 w-full max-w-md space-y-2 text-left">
                    <span className="block text-center font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                      Examples
                    </span>
                    {current.examples.map((ex, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 rounded-xl border border-ink/10 bg-white px-3 py-2.5 shadow-sm"
                      >
                        <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-leaf-600 font-body text-[10px] font-bold text-cream">
                          {i + 1}
                        </span>
                        <div>
                          <p className="font-body text-xs font-medium italic leading-snug text-ink">
                            {ex.en}
                          </p>
                          {ex.bn && (
                            <p className="mt-0.5 font-body text-xs leading-snug text-ink-soft">
                              {ex.bn}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <span className="mt-5 flex items-center gap-1.5 font-body text-xs font-medium text-ink-soft/70">
                  <RotateCcw size={12} />
                  Click to flip back
                </span>
              </div>
            )}
          </button>

          <button
            onClick={advance}
            disabled={index === words.length - 1}
            aria-label="Skip"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-leaf-100 disabled:opacity-30 dark:text-cream/50 dark:hover:bg-night-soft"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </div>

      <p className="pb-2 text-center font-body text-xs text-ink-soft/60 dark:text-cream/30">
        Press <kbd className="rounded border border-ink/15 px-1.5 py-0.5">Space</kbd> to flip
      </p>

      {/* Bottom controls */}
      <div className="border-t border-ink/10 px-4 py-4 dark:border-night-border md:px-6">
        <div className="mx-auto flex max-w-xl flex-wrap items-center justify-center gap-2 sm:gap-3">
          <button
            onClick={goBack}
            disabled={index === 0}
            className="rounded-pill border border-ink/10 px-4 py-2 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink disabled:opacity-40 dark:border-night-border dark:text-cream/70 dark:hover:bg-night-soft sm:px-5 sm:py-2.5"
          >
            ← Back
          </button>
          <button
            onClick={() => setFlipped((f) => !f)}
            className="rounded-pill border-2 border-leaf-600 px-4 py-2 font-body text-sm font-semibold text-leaf-700 transition-colors hover:bg-leaf-100 dark:text-leaf-500 dark:hover:bg-night-soft sm:px-5 sm:py-2.5"
          >
            {flipped ? "Flip back" : "Flip"}
          </button>
          <button
            onClick={() => markProgress("known")}
            className="rounded-pill bg-leaf-600 px-5 py-2 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700 sm:px-6 sm:py-2.5"
          >
            Know it →
          </button>
          <button
            onClick={() => markProgress("learning")}
            className="rounded-pill border border-ink/10 px-4 py-2 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-amber-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night-soft sm:px-5 sm:py-2.5"
          >
            {isLast ? "Done" : "Skip →"}
          </button>
        </div>
        <p className="mt-2 text-center font-body text-xs text-ink-soft/60 dark:text-cream/30">
          Don&apos;t know yet
        </p>
        <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-center justify-center gap-1">
          {dots.map((i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === index
                  ? "w-5 bg-leaf-600"
                  : i < index
                  ? "w-1.5 bg-leaf-300"
                  : "w-1.5 bg-ink/10 dark:bg-cream/15"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
