"use client";

import { useState } from "react";
import { BookmarkPlus, Check, Loader2 } from "lucide-react";
import type { AnswerRecord, Question } from "@/lib/vocab-battle/rules";

// "Words to review" — the post-round list of every word the player missed
// (wrong answer or ran out of time), with its meaning, pronunciation and an
// example so a mistake turns into something learned instead of just a lower
// score. Shown on both the Solo and Live results screens.
//
// Each missed word has a one-tap "Save" into the Speaking Club "New words"
// notes (POST /api/speaking-club/words — see lib/speaking-club-words.ts),
// so a mistake here can become one of those saved words too. That endpoint
// needs an active Speaking Club plan; if a Solo player (any signed-in
// student, per requireUser on /api/vocab-battle/attempts) doesn't have one,
// the first save attempt fails and the buttons quietly turn into a single
// note instead of erroring on every word.

type Props = {
  questions: Question[];
  answers: AnswerRecord[];
  /** Only set inside a Speaking Club call — files the saved word under that live session. */
  shiftId?: string;
  roomCode?: string;
};

export function ReviewList({ questions, answers, shiftId, roomCode }: Props) {
  const [saved, setSaved] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [unavailable, setUnavailable] = useState(false);

  async function handleSave(question: Question) {
    if (unavailable || saved.has(question.wordId) || saving.has(question.wordId)) return;
    setSaving((s) => new Set(s).add(question.wordId));
    try {
      const res = await fetch("/api/speaking-club/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: question.word, meaning: question.meaning, shiftId, roomCode }),
      });
      if (res.status === 403 || res.status === 401) {
        setUnavailable(true);
        return;
      }
      if (!res.ok) throw new Error();
      setSaved((s) => new Set(s).add(question.wordId));
    } catch {
      // A one-off failure (network hiccup) — the button just stays tappable to retry.
    } finally {
      setSaving((s) => {
        const next = new Set(s);
        next.delete(question.wordId);
        return next;
      });
    }
  }

  const missed = answers.filter((a) => !a.correct).map((a) => ({ answer: a, question: questions[a.index] }));

  if (missed.length === 0) {
    return (
      <p className="mt-6 rounded-xl bg-leaf-50 px-4 py-3 text-center font-body text-sm font-medium text-leaf-700 dark:bg-leaf-500/10 dark:text-leaf-400">
        Perfect round — nothing to review! 🎉
      </p>
    );
  }

  return (
    <div className="mt-6 text-left">
      <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
        Words to review ({missed.length})
      </p>
      <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
        {missed.map(({ answer, question }) => (
          <li
            key={question.wordId + "-" + answer.index}
            className="rounded-xl border border-ink/10 bg-white px-4 py-3 dark:border-night-border dark:bg-night"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-display text-base font-semibold text-ink dark:text-cream">
                {question.word}
                {question.pronunciation && (
                  <span className="ml-2 font-body text-xs font-normal text-ink-soft dark:text-cream/50">
                    {question.pronunciation}
                  </span>
                )}
              </p>
              {!unavailable && (
                <button
                  type="button"
                  onClick={() => handleSave(question)}
                  disabled={saved.has(question.wordId) || saving.has(question.wordId)}
                  aria-label={saved.has(question.wordId) ? `${question.word} saved` : `Save ${question.word} to New words`}
                  className="flex shrink-0 items-center gap-1 rounded-pill border border-leaf-300 bg-leaf-50 px-2 py-1 font-body text-[11px] font-semibold text-leaf-700 transition-colors enabled:hover:bg-leaf-100 disabled:opacity-70 dark:border-night-border dark:bg-night-soft dark:text-leaf-400"
                >
                  {saving.has(question.wordId) ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : saved.has(question.wordId) ? (
                    <Check size={11} />
                  ) : (
                    <BookmarkPlus size={11} />
                  )}
                  {saved.has(question.wordId) ? "Saved" : "Save"}
                </button>
              )}
            </div>
            <p className="mt-0.5 font-body text-sm text-ink-soft dark:text-cream/70">{question.meaning}</p>
            {question.example && (
              <p className="mt-1 font-body text-xs italic text-ink-soft/80 dark:text-cream/50">“{question.example}”</p>
            )}
            {answer.chosen !== null && (
              <p className="mt-1 font-body text-[11px] text-red-500">You picked: {question.options[answer.chosen]}</p>
            )}
          </li>
        ))}
      </ul>
      {unavailable && (
        <p className="mt-2 font-body text-[11px] text-ink-soft dark:text-cream/40">
          Saving words needs an active Speaking Club plan.
        </p>
      )}
    </div>
  );
}
