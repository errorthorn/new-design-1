"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Trophy,
  Flame,
  CheckCircle2,
  XCircle,
  Swords,
  RotateCcw,
} from "lucide-react";

type Question = {
  wordId: number;
  word: string;
  options: string[];
  correctIndex: number;
};

const TIME_PER_WORD = 10; // seconds
const REVEAL_PAUSE_MS = 1300;

type Phase = "loading" | "error" | "playing" | "finishing" | "results";

export default function VocabBattleSoloPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIME_PER_WORD);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [highScore, setHighScore] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundStartRef = useRef<number | null>(null);

  const loadRound = useCallback(() => {
    setPhase("loading");
    fetch("/api/vocab-battle/round")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start a round.");
        return data;
      })
      .then((data) => {
        setQuestions(data.questions);
        setIndex(0);
        setTimeLeft(TIME_PER_WORD);
        setSelected(null);
        setRevealed(false);
        setTimedOut(false);
        setScore(0);
        setStreak(0);
        setBestStreak(0);
        setCorrectCount(0);
        setIsNewHighScore(false);
        roundStartRef.current = Date.now();
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

  const clearTimers = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (advanceRef.current) clearTimeout(advanceRef.current);
    intervalRef.current = null;
    advanceRef.current = null;
  }, []);

  // Per-word countdown. Runs only while playing this question and not yet revealed.
  useEffect(() => {
    if (phase !== "playing" || revealed) return;

    intervalRef.current = setInterval(() => {
      setTimeLeft((t) => {
        const next = Math.round((t - 0.1) * 10) / 10;
        if (next <= 0) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          handleTimeout();
          return 0;
        }
        return next;
      });
    }, 100);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, revealed]);

  useEffect(() => clearTimers, [clearTimers]);

  function handleTimeout() {
    setRevealed(true);
    setTimedOut(true);
    setStreak(0);
    scheduleAdvance();
  }

  function selectOption(optionIndex: number) {
    if (revealed) return;
    clearTimers();

    const current = questions[index];
    const isCorrect = optionIndex === current.correctIndex;

    setSelected(optionIndex);
    setRevealed(true);
    setTimedOut(false);

    if (isCorrect) {
      const speedBonus = Math.round((timeLeft / TIME_PER_WORD) * 50);
      const streakBonus = streak * 10;
      setScore((s) => s + 100 + speedBonus + streakBonus);
      setCorrectCount((c) => c + 1);
      setStreak((s) => {
        const next = s + 1;
        setBestStreak((b) => Math.max(b, next));
        return next;
      });
    } else {
      setStreak(0);
    }

    scheduleAdvance();
  }

  function scheduleAdvance() {
    advanceRef.current = setTimeout(() => {
      setIndex((i) => {
        const next = i + 1;
        if (next >= questions.length) {
          setPhase("finishing");
          return i;
        }
        setSelected(null);
        setRevealed(false);
        setTimedOut(false);
        setTimeLeft(TIME_PER_WORD);
        return next;
      });
    }, REVEAL_PAUSE_MS);
  }

  // Submit the finished round once, then show results.
  useEffect(() => {
    if (phase !== "finishing") return;
    clearTimers();

    fetch("/api/vocab-battle/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        score,
        correctCount,
        totalWords: questions.length,
        bestStreak,
        durationSeconds: roundStartRef.current
          ? Math.round((Date.now() - roundStartRef.current) / 1000)
          : undefined,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        setIsNewHighScore(Boolean(data.isNewHighScore));
        setHighScore(data.highScore ?? score);
      })
      .catch(() => {
        setHighScore(score);
      })
      .finally(() => setPhase("results"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === "loading") {
    return (
      <div className="fixed inset-0 z-40 grid place-items-center bg-cream dark:bg-night">
        <p className="font-body text-sm text-ink-soft dark:text-cream/50">
          Preparing your battle…
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-cream px-6 text-center dark:bg-night">
        <Swords size={28} className="text-ink-soft/40 dark:text-cream/30" />
        <p className="font-display text-lg font-semibold">Can&apos;t start a battle yet</p>
        <p className="max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">
          {errorMessage}
        </p>
        <Link
          href="/dashboard/vocab-battle"
          className="mt-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
        >
          Back to Arena
        </Link>
      </div>
    );
  }

  if (phase === "results") {
    const accuracy = Math.round((correctCount / questions.length) * 100);
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-cream px-4 dark:bg-night">
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
          className="w-full max-w-md rounded-2xl border border-ink/10 bg-cream-soft p-8 text-center dark:border-night-border dark:bg-night-soft"
        >
          <p className="font-body text-xs font-semibold uppercase tracking-widest text-ink-soft dark:text-cream/50">
            Battle Complete
          </p>
          <p className="mt-2 font-display text-5xl font-bold text-leaf-700 dark:text-leaf-500">
            {score}
          </p>
          <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/50">points</p>

          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-leaf-600 bg-white px-3 py-3 dark:bg-night">
              <p className="font-display text-lg font-semibold">
                {correctCount}/{questions.length}
              </p>
              <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/50">
                Correct
              </p>
            </div>
            <div className="rounded-xl border border-leaf-600 bg-white px-3 py-3 dark:bg-night">
              <p className="font-display text-lg font-semibold">{accuracy}%</p>
              <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/50">
                Accuracy
              </p>
            </div>
            <div className="rounded-xl border border-leaf-600 bg-white px-3 py-3 dark:bg-night">
              <p className="flex items-center justify-center gap-1 font-display text-lg font-semibold">
                {bestStreak}
                <Flame size={14} className="text-orange-500" />
              </p>
              <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/50">
                Best Streak
              </p>
            </div>
          </div>

          {!isNewHighScore && (
            <p className="mt-5 font-body text-xs text-ink-soft dark:text-cream/40">
              Hi-Score: {highScore}
            </p>
          )}

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
    );
  }

  const current = questions[index];
  const timePct = Math.max(0, Math.min(100, (timeLeft / TIME_PER_WORD) * 100));
  const urgent = timeLeft <= 3 && !revealed;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-cream dark:bg-night">
      <div className="flex items-center gap-4 border-b border-ink/10 px-4 py-3 dark:border-night-border md:px-6">
        <Link
          href="/dashboard/vocab-battle"
          className="flex items-center gap-1.5 font-body text-sm font-medium text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
        >
          <X size={16} />
          Exit Game
        </Link>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 md:px-0">
        {/* Score + streak */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 font-body text-sm font-semibold text-ink dark:text-cream">
            <Trophy size={18} className="text-amber-500" />
            {score}
          </span>
          <span className="flex items-center gap-1.5 font-body text-sm font-medium text-ink-soft dark:text-cream/60">
            Streak
            <span className="font-semibold text-ink dark:text-cream">{streak}</span>
            <Flame
              size={16}
              className={streak > 0 ? "text-orange-500" : "text-ink-soft/30 dark:text-cream/20"}
            />
          </span>
        </div>

        {/* Timer bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
            <span>Time Left</span>
            <span>{Math.ceil(timeLeft)}s</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-pill bg-ink/10 dark:bg-night-border">
            <div
              className={`h-full rounded-pill ${urgent ? "bg-red-500" : "bg-leaf-500"}`}
              style={{ width: `${timePct}%` }}
            />
          </div>
        </div>

        {/* Question card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="mt-5 rounded-2xl border-2 border-leaf-500/40 bg-cream-soft p-8 dark:bg-night-soft"
          >
            <div className="flex justify-center">
              <span className="rounded-pill border border-leaf-600 bg-white px-3 py-1 font-body text-xs font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
                Word {index + 1} of {questions.length}
              </span>
            </div>
            <h2 className="mt-4 text-center font-display text-4xl font-bold md:text-5xl">
              {current.word}
            </h2>

            <div className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {current.options.map((option, i) => {
                const isCorrectOption = i === current.correctIndex;
                const isSelected = i === selected;

                let style =
                  "border-ink/10 bg-cream text-ink hover:border-leaf-400 hover:bg-leaf-50 dark:border-night-border dark:bg-night dark:text-cream dark:hover:border-leaf-600";
                if (revealed) {
                  if (isCorrectOption) {
                    style =
                      "border-leaf-500 bg-leaf-50 text-leaf-800 dark:border-leaf-500 dark:bg-leaf-500/10 dark:text-leaf-400";
                  } else if (isSelected) {
                    style =
                      "border-red-400 bg-red-50 text-red-700 dark:border-red-500/60 dark:bg-red-500/10 dark:text-red-400";
                  } else {
                    style =
                      "border-ink/10 bg-cream text-ink-soft/50 dark:border-night-border dark:bg-night dark:text-cream/30";
                  }
                }

                return (
                  <button
                    key={i}
                    onClick={() => selectOption(i)}
                    disabled={revealed}
                    className={`flex items-center justify-between gap-3 rounded-xl border-2 px-5 py-4 text-left font-body text-sm font-medium transition-colors ${style}`}
                  >
                    <span>{option}</span>
                    {revealed && isCorrectOption && (
                      <CheckCircle2 size={18} className="shrink-0 text-leaf-600 dark:text-leaf-400" />
                    )}
                    {revealed && isSelected && !isCorrectOption && (
                      <XCircle size={18} className="shrink-0 text-red-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {timedOut && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-5 text-center font-display text-lg font-semibold text-red-500"
          >
            Time&apos;s Up!
          </motion.p>
        )}
      </div>
    </div>
  );
}
