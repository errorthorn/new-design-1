"use client";

// components/vocab-battle/battle-round.tsx
//
// The in-round experience for BOTH Vocab Battle modes — Solo Challenge
// (app/dashboard/vocab-battle/solo/page.tsx) and Live Multiplayer
// (components/vocab-battle/live-match-panel.tsx). Both used to carry their
// own near-identical copy of the timer/scoring/answer logic; every new
// feature would have had to be built twice and kept in sync, so it now lives
// here once. The parents keep everything that's genuinely different: how
// questions arrive, the opponent header, and what happens with the result.
//
// What's in a round:
//   - a 3-2-1-GO intro
//   - mixed question kinds (see lib/vocab-battle-questions.ts)
//   - a per-question countdown (deadline-based, so a throttled background tab
//     can't stretch a question's time)
//   - streak + combo, with a "+points" pop on every correct answer
//   - power-ups earned by streaks: 50/50 and +5 seconds
//   - sound effects (optional; see lib/vocab-battle/sfx.ts)
//
// Nothing here talks to the server: the round hands back a RoundResult and
// the parent decides what to do with it. The match's authoritative result
// still comes from the server, exactly as before.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, Flame, CheckCircle2, XCircle, Volume2, VolumeX, Zap, Clock } from "lucide-react";
import { useSfx } from "@/lib/vocab-battle/sfx";
import {
  KIND_LABEL,
  REVEAL_PAUSE_MS,
  TIME_BOOST_SECONDS,
  addPowerUp,
  pickOptionsToHide,
  pointsForCorrect,
  powerUpEarned,
  timeLimitFor,
  type AnswerRecord,
  type PowerUps,
  type Question,
  type RoundResult,
} from "@/lib/vocab-battle/rules";

type Props = {
  questions: Question[];
  /** The exit control (a Link in Solo, a button in Live) — rendered top-left. */
  exit: ReactNode;
  /** Live only: the opponent's progress, rendered top-right. */
  headerRight?: ReactNode;
  /** Rendered under the question card (Live: the reaction bar). */
  footer?: ReactNode;
  /** Inside a Speaking Club call: sound defaults to off so it can't leak into the mic. */
  inCall?: boolean;
  /** Called after every answered/timed-out question (Live broadcasts this to the opponent). */
  onProgress?: (p: { index: number; score: number }) => void;
  /**
   * Live duel pressure: bump `token` (any change fires it) when the
   * opponent answers `index`. If the local player is still on that same
   * question and hasn't answered yet, their clock drops to
   * PRESSURE_SECONDS — so falling behind in a live match has a real,
   * immediate cost instead of the two sides just racing on separate clocks.
   * Ignored once the local player has moved to a different question.
   */
  pressure?: { index: number; token: number } | null;
  /** Called once, after the last question's reveal. */
  onComplete: (result: RoundResult) => void;
};

const PRESSURE_SECONDS = 3;

export function BattleRound({
  questions,
  exit,
  headerRight,
  footer,
  inCall = false,
  onProgress,
  pressure,
  onComplete,
}: Props) {
  const sfx = useSfx(!inCall);

  const [phase, setPhase] = useState<"intro" | "playing">("intro");
  const [index, setIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(() => timeLimitFor(questions[0].kind));
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [hidden, setHidden] = useState<number[]>([]);

  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [powerUps, setPowerUps] = useState<PowerUps>({ fifty: 0, time: 0 });
  const [gain, setGain] = useState<{ points: number; key: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Mirrors of state that timers/handlers must read fresh (a closure created
  // for one question would otherwise see stale values).
  const indexRef = useRef(0);
  const revealedRef = useRef(false);
  const streakRef = useRef(0);
  const powerUpsRef = useRef<PowerUps>({ fifty: 0, time: 0 });
  const deadlineRef = useRef(0);
  const roundStartRef = useRef(0);
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);
  const stats = useRef({ score: 0, correctCount: 0, bestStreak: 0, answers: [] as AnswerRecord[] });

  // Latest-callback refs so the interval/timeouts always call current code.
  const timeoutHandlerRef = useRef<() => void>(() => {});
  const playRef = useRef(sfx.play);
  playRef.current = sfx.play;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  indexRef.current = index;

  const question = questions[index];
  const limit = timeLimitFor(question.kind);

  // ---- 3-2-1-GO intro ---------------------------------------------------
  const [countdown, setCountdown] = useState<number>(3); // 3,2,1 then 0 = "GO!"
  useEffect(() => {
    if (phase !== "intro") return;
    playRef.current(countdown === 0 ? "go" : "tick");
    const t = setTimeout(
      () => {
        if (countdown === 0) {
          roundStartRef.current = Date.now();
          setPhase("playing");
        } else {
          setCountdown((c) => c - 1);
        }
      },
      countdown === 0 ? 600 : 850
    );
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // ---- Per-question countdown -------------------------------------------
  useEffect(() => {
    if (phase !== "playing") return;
    const q = questions[index];
    const seconds = timeLimitFor(q.kind);
    deadlineRef.current = Date.now() + seconds * 1000;
    setTimeLeft(seconds);

    let lastTickSecond = -1;
    const id = setInterval(() => {
      if (revealedRef.current) return;
      const left = Math.max(0, (deadlineRef.current - Date.now()) / 1000);
      setTimeLeft(left);
      const wholeSecond = Math.ceil(left);
      if (left > 0 && left <= 3 && wholeSecond !== lastTickSecond) {
        lastTickSecond = wholeSecond;
        playRef.current("tick");
      }
      if (left <= 0) timeoutHandlerRef.current();
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index]);

  useEffect(
    () => () => {
      if (advanceRef.current) clearTimeout(advanceRef.current);
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  // Live duel pressure (see the `pressure` prop above). Watches the token so
  // it fires on every new opponent-answered event, even a second one for
  // the same question index.
  const lastPressureTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!pressure || phase !== "playing") return;
    if (lastPressureTokenRef.current === pressure.token) return;
    lastPressureTokenRef.current = pressure.token;
    if (pressure.index !== indexRef.current || revealedRef.current) return;

    const pressureDeadline = Date.now() + PRESSURE_SECONDS * 1000;
    if (pressureDeadline < deadlineRef.current) {
      deadlineRef.current = pressureDeadline;
      setTimeLeft(PRESSURE_SECONDS);
      setToast("Partner answered — clock's ticking! ⏱");
      playRef.current("tick");
    }
  }, [pressure, phase]);

  // ---- Flow ---------------------------------------------------------------
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCompleteRef.current({
      score: stats.current.score,
      correctCount: stats.current.correctCount,
      bestStreak: stats.current.bestStreak,
      answers: stats.current.answers,
      durationSeconds: Math.round((Date.now() - roundStartRef.current) / 1000),
    });
  }, []);

  function scheduleAdvance() {
    advanceRef.current = setTimeout(() => {
      const next = indexRef.current + 1;
      if (next >= questions.length) {
        finish();
        return;
      }
      revealedRef.current = false;
      setSelected(null);
      setRevealed(false);
      setTimedOut(false);
      setHidden([]);
      setIndex(next);
    }, REVEAL_PAUSE_MS);
  }

  function selectOption(optionIndex: number) {
    if (revealedRef.current || phase !== "playing" || hidden.includes(optionIndex)) return;
    revealedRef.current = true;

    const correct = optionIndex === question.correctIndex;
    setSelected(optionIndex);
    setRevealed(true);
    setTimedOut(false);

    stats.current.answers.push({ index, chosen: optionIndex, correct });

    if (correct) {
      const timeRemaining = Math.max(0, (deadlineRef.current - Date.now()) / 1000);
      const points = pointsForCorrect({ timeLeft: timeRemaining, timeLimit: limit, streakBefore: streakRef.current });
      const newStreak = streakRef.current + 1;
      streakRef.current = newStreak;

      stats.current.score += points;
      stats.current.correctCount += 1;
      stats.current.bestStreak = Math.max(stats.current.bestStreak, newStreak);

      setScore(stats.current.score);
      setStreak(newStreak);
      setGain({ points, key: Date.now() });
      sfx.play("correct");

      const earned = powerUpEarned(newStreak);
      if (earned) {
        powerUpsRef.current = addPowerUp(powerUpsRef.current, earned);
        setPowerUps(powerUpsRef.current);
        setToast(earned === "fifty" ? "Power-up earned: 50/50!" : `Power-up earned: +${TIME_BOOST_SECONDS}s!`);
        setTimeout(() => playRef.current("powerup"), 260);
      }
    } else {
      streakRef.current = 0;
      setStreak(0);
      sfx.play("wrong");
    }

    onProgressRef.current?.({ index, score: stats.current.score });
    scheduleAdvance();
  }

  function handleTimeout() {
    if (revealedRef.current) return;
    revealedRef.current = true;
    setRevealed(true);
    setTimedOut(true);
    streakRef.current = 0;
    setStreak(0);
    stats.current.answers.push({ index: indexRef.current, chosen: null, correct: false });
    playRef.current("wrong");
    onProgressRef.current?.({ index: indexRef.current, score: stats.current.score });
    scheduleAdvance();
  }
  timeoutHandlerRef.current = handleTimeout;

  function activateFifty() {
    if (revealedRef.current || powerUpsRef.current.fifty <= 0 || hidden.length > 0) return;
    powerUpsRef.current = { ...powerUpsRef.current, fifty: powerUpsRef.current.fifty - 1 };
    setPowerUps(powerUpsRef.current);
    setHidden(pickOptionsToHide(question));
    sfx.play("powerup");
  }

  function activateTimeBoost() {
    if (revealedRef.current || powerUpsRef.current.time <= 0) return;
    powerUpsRef.current = { ...powerUpsRef.current, time: powerUpsRef.current.time - 1 };
    setPowerUps(powerUpsRef.current);
    deadlineRef.current += TIME_BOOST_SECONDS * 1000;
    setTimeLeft((t) => t + TIME_BOOST_SECONDS);
    sfx.play("powerup");
  }

  // ---- Render -------------------------------------------------------------
  const soundToggle = (
    <button
      type="button"
      onClick={sfx.toggle}
      aria-label={sfx.enabled ? "Turn sound off" : "Turn sound on"}
      className="text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
    >
      {sfx.enabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
    </button>
  );

  if (phase === "intro") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-cream dark:bg-night">
        <div className="flex items-center justify-between gap-4 border-b border-ink/10 px-4 py-3 dark:border-night-border md:px-6">
          {exit}
          {soundToggle}
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="font-body text-xs font-semibold uppercase tracking-widest text-ink-soft dark:text-cream/50">
            {questions.length} questions · get ready
          </p>
          <AnimatePresence mode="wait">
            <motion.span
              key={countdown}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.4, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="font-display text-8xl font-bold text-leaf-600 dark:text-leaf-500"
            >
              {countdown === 0 ? "GO!" : countdown}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  const timePct = Math.max(0, Math.min(100, (timeLeft / limit) * 100));
  const urgent = timeLeft <= 3 && !revealed;
  const bigPrompt = question.kind === "meaning" || question.kind === "synonym";

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-cream dark:bg-night">
      <div className="flex items-center justify-between gap-4 border-b border-ink/10 px-4 py-3 dark:border-night-border md:px-6">
        {exit}
        <div className="flex items-center gap-4">
          {headerRight}
          {soundToggle}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 md:px-0">
        {/* Score + streak */}
        <div className="flex items-center justify-between">
          <span className="relative flex items-center gap-2 font-body text-sm font-semibold text-ink dark:text-cream">
            <Trophy size={18} className="text-amber-500" />
            {score}
            <AnimatePresence>
              {gain && (
                <motion.span
                  key={gain.key}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: -14 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                  onAnimationComplete={() => setGain((g) => (g && g.key === gain.key ? null : g))}
                  className="absolute -right-12 top-0 font-body text-xs font-bold text-leaf-600 dark:text-leaf-400"
                >
                  +{gain.points}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <span className="flex items-center gap-1.5 font-body text-sm font-medium text-ink-soft dark:text-cream/60">
            {streak >= 3 ? (
              <motion.span
                key={streak}
                initial={{ scale: 1.4 }}
                animate={{ scale: 1 }}
                className="rounded-pill bg-orange-500/10 px-2 py-0.5 font-semibold text-orange-600 dark:text-orange-400"
              >
                Combo x{streak}
              </motion.span>
            ) : (
              <>
                Streak
                <span className="font-semibold text-ink dark:text-cream">{streak}</span>
              </>
            )}
            <Flame size={16} className={streak > 0 ? "text-orange-500" : "text-ink-soft/30 dark:text-cream/20"} />
          </span>
        </div>

        {/* Timer bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
            <span>Time Left</span>
            <span>{Math.ceil(timeLeft)}s</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-pill bg-ink/10 dark:bg-night-border">
            <div className={`h-full rounded-pill ${urgent ? "bg-red-500" : "bg-leaf-500"}`} style={{ width: `${timePct}%` }} />
          </div>
        </div>

        {/* Power-ups */}
        <div className="mt-3 flex items-center gap-2">
          <PowerUpButton
            icon={<Zap size={13} />}
            label="50/50"
            count={powerUps.fifty}
            disabled={revealed || hidden.length > 0 || powerUps.fifty <= 0}
            onClick={activateFifty}
          />
          <PowerUpButton
            icon={<Clock size={13} />}
            label={`+${TIME_BOOST_SECONDS}s`}
            count={powerUps.time}
            disabled={revealed || powerUps.time <= 0}
            onClick={activateTimeBoost}
          />
          <AnimatePresence>
            {toast && (
              <motion.span
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="font-body text-xs font-semibold text-leaf-700 dark:text-leaf-400"
              >
                {toast}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Question card */}
        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25 }}
            className="mt-4 rounded-2xl border-2 border-leaf-500/40 bg-cream-soft p-6 dark:bg-night-soft md:p-8"
          >
            <div className="flex justify-center">
              <span className="rounded-pill border border-leaf-600 bg-white px-3 py-1 font-body text-xs font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
                Question {index + 1} of {questions.length}
              </span>
            </div>
            <p className="mt-3 text-center font-body text-xs font-medium text-ink-soft dark:text-cream/50">
              {KIND_LABEL[question.kind]}
            </p>
            <h2
              className={`mt-2 text-center font-display font-bold ${
                bigPrompt ? "text-4xl md:text-5xl" : "text-xl leading-snug md:text-2xl"
              }`}
            >
              {question.prompt}
            </h2>
            {bigPrompt && question.pronunciation && (
              <p className="mt-1 text-center font-body text-sm text-ink-soft dark:text-cream/50">{question.pronunciation}</p>
            )}

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {question.options.map((option, i) => {
                const isCorrectOption = i === question.correctIndex;
                const isSelected = i === selected;
                const isHidden = hidden.includes(i);

                let style =
                  "border-ink/10 bg-cream text-ink hover:border-leaf-400 hover:bg-leaf-50 dark:border-night-border dark:bg-night dark:text-cream dark:hover:border-leaf-600";
                if (isHidden) {
                  style = "border-ink/5 bg-cream text-ink-soft/30 line-through opacity-40 dark:border-night-border dark:bg-night dark:text-cream/20";
                } else if (revealed) {
                  if (isCorrectOption) {
                    style = "border-leaf-500 bg-leaf-50 text-leaf-800 dark:border-leaf-500 dark:bg-leaf-500/10 dark:text-leaf-400";
                  } else if (isSelected) {
                    style = "border-red-400 bg-red-50 text-red-700 dark:border-red-500/60 dark:bg-red-500/10 dark:text-red-400";
                  } else {
                    style = "border-ink/10 bg-cream text-ink-soft/50 dark:border-night-border dark:bg-night dark:text-cream/30";
                  }
                }

                return (
                  <button
                    key={i}
                    onClick={() => selectOption(i)}
                    disabled={revealed || isHidden}
                    className={`flex items-center justify-between gap-3 rounded-xl border-2 px-5 py-4 text-left font-body text-sm font-medium transition-colors ${style}`}
                  >
                    <span>{option}</span>
                    {revealed && isCorrectOption && <CheckCircle2 size={18} className="shrink-0 text-leaf-600 dark:text-leaf-400" />}
                    {revealed && isSelected && !isCorrectOption && <XCircle size={18} className="shrink-0 text-red-500" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {timedOut && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 text-center font-display text-lg font-semibold text-red-500">
            Time&apos;s Up!
          </motion.p>
        )}

        {footer}
      </div>
    </div>
  );
}

function PowerUpButton({
  icon,
  label,
  count,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-pill border border-leaf-500/50 bg-white px-3 py-1 font-body text-xs font-semibold text-leaf-700 transition-colors enabled:hover:bg-leaf-50 disabled:cursor-not-allowed disabled:border-ink/10 disabled:text-ink-soft/40 dark:bg-night dark:text-leaf-400 dark:disabled:border-night-border dark:disabled:text-cream/25"
    >
      {icon}
      {label}
      <span className="rounded-full bg-leaf-600/10 px-1.5 text-[10px]">×{count}</span>
    </button>
  );
}
