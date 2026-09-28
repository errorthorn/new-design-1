"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { X, Trophy, Flame, Swords, RotateCcw } from "lucide-react";
import { BattleRound } from "@/components/vocab-battle/battle-round";
import { Confetti } from "@/components/vocab-battle/confetti";
import { ReviewList } from "@/components/vocab-battle/review-list";
import { useSfx } from "@/lib/vocab-battle/sfx";
import { normalizeQuestion, type Question, type RoundResult } from "@/lib/vocab-battle/rules";

// The round itself (timer, scoring, power-ups, question kinds, sound) lives
// in components/vocab-battle/battle-round.tsx, shared with Live Multiplayer.
// This page owns what's specific to Solo: fetching a round, submitting the
// finished attempt, and the results screen.

type Phase = "loading" | "error" | "playing" | "finishing" | "results";

export default function VocabBattleSoloPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  // Bumped on every new round so <BattleRound> remounts with fresh state
  // (intro countdown, streak, power-ups) instead of carrying the last one over.
  const [roundKey, setRoundKey] = useState(0);
  const [result, setResult] = useState<RoundResult | null>(null);

  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [highScore, setHighScore] = useState(0);
  const sfx = useSfx(true);

  const loadRound = useCallback(() => {
    setPhase("loading");
    fetch("/api/vocab-battle/round")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start a round.");
        return data;
      })
      .then((data) => {
        setQuestions((data.questions as unknown[]).map(normalizeQuestion));
        setResult(null);
        setIsNewHighScore(false);
        setRoundKey((k) => k + 1);
        setPhase("playing");
      })
      .catch((err) => {
        setErrorMessage(err.message || "Something went wrong.");
        setPhase("error");
      });
  }, []);

  useEffect(() => {
    loadRound();
  }, [loadRound]);

  // Submit the finished round once, then show results.
  function handleComplete(r: RoundResult) {
    setResult(r);
    setPhase("finishing");
    fetch("/api/vocab-battle/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score: r.score,
        correctCount: r.correctCount,
        totalWords: questions.length,
        bestStreak: r.bestStreak,
        durationSeconds: r.durationSeconds,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        setIsNewHighScore(Boolean(data.isNewHighScore));
        setHighScore(data.highScore ?? r.score);
        if (data.isNewHighScore) sfx.play("win");
      })
      .catch(() => {
        setHighScore(r.score);
      })
      .finally(() => setPhase("results"));
  }

  if (phase === "loading" || phase === "finishing") {
    return (
      <div className="fixed inset-0 z-40 grid place-items-center bg-cream dark:bg-night">
        <p className="font-body text-sm text-ink-soft dark:text-cream/50">
          {phase === "finishing" ? "Tallying your score…" : "Preparing your battle…"}
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-cream px-6 text-center dark:bg-night">
        <Swords size={28} className="text-ink-soft/40 dark:text-cream/30" />
        <p className="font-display text-lg font-semibold">Can&apos;t start a battle yet</p>
        <p className="max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">{errorMessage}</p>
        <Link
          href="/dashboard/vocab-battle"
          className="mt-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
        >
          Back to Arena
        </Link>
      </div>
    );
  }

  if (phase === "results" && result) {
    const accuracy = Math.round((result.correctCount / questions.length) * 100);
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-cream dark:bg-night">
        {isNewHighScore && <Confetti />}
        <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-5 px-4 py-8">
          {isNewHighScore && (
            <motion.span
              initial={{ opacity: 0, y: -8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="flex items-center gap-1.5 rounded-pill bg-gradient-to-r from-leaf-500 to-leaf-700 px-4 py-1.5 font-body text-xs font-semibold uppercase tracking-wide text-cream"
            >
              <Trophy size={13} />
              New Hi-Score!
            </motion.span>
          )}

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="w-full rounded-2xl border border-ink/10 bg-cream-soft p-8 text-center dark:border-night-border dark:bg-night-soft"
          >
            <p className="font-body text-xs font-semibold uppercase tracking-widest text-ink-soft dark:text-cream/50">
              Battle Complete
            </p>
            <p className="mt-2 font-display text-5xl font-bold text-leaf-700 dark:text-leaf-500">{result.score}</p>
            <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/50">points</p>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-leaf-600 bg-white px-3 py-3 dark:bg-night">
                <p className="font-display text-lg font-semibold">
                  {result.correctCount}/{questions.length}
                </p>
                <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/50">Correct</p>
              </div>
              <div className="rounded-xl border border-leaf-600 bg-white px-3 py-3 dark:bg-night">
                <p className="font-display text-lg font-semibold">{accuracy}%</p>
                <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/50">Accuracy</p>
              </div>
              <div className="rounded-xl border border-leaf-600 bg-white px-3 py-3 dark:bg-night">
                <p className="flex items-center justify-center gap-1 font-display text-lg font-semibold">
                  {result.bestStreak}
                  <Flame size={14} className="text-orange-500" />
                </p>
                <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/50">Best Streak</p>
              </div>
            </div>

            {!isNewHighScore && (
              <p className="mt-5 font-body text-xs text-ink-soft dark:text-cream/40">Hi-Score: {highScore}</p>
            )}

            <ReviewList questions={questions} answers={result.answers} />

            <div className="mt-7 flex items-center justify-center gap-3">
              <Link
                href="/dashboard/vocab-battle"
                className="rounded-pill border border-ink/10 px-5 py-2.5 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night dark:hover:text-cream"
              >
                Back to Arena
              </Link>
              <button
                onClick={loadRound}
                className="flex items-center gap-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700"
              >
                <RotateCcw size={15} />
                Play Again
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <BattleRound
      key={roundKey}
      questions={questions}
      exit={
        <Link
          href="/dashboard/vocab-battle"
          className="flex items-center gap-1.5 font-body text-sm font-medium text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
        >
          <X size={16} />
          Exit Game
        </Link>
      }
      onComplete={handleComplete}
    />
  );
}
