"use client";

// components/vocab-battle/live-match-panel.tsx
//
// The actual Vocab Battle live-match gameplay UI, extracted out of
// app/dashboard/vocab-battle/live/[matchId]/page.tsx (which is now a
// thin wrapper around this) so the exact same tested gameplay/scoring/
// polling logic can also be rendered INSIDE the Speaking Club room page
// — letting two people already on a call start a battle without
// leaving it. Nothing about the game logic changed in this extraction;
// only matchId (now a prop instead of a route param) and every exit
// point (now callbacks instead of real navigation Links) changed —
// real navigation Links inside an embedded panel would unmount the
// Speaking Club room page and drop the call.
import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Swords, Loader2, Crown, Handshake, Users } from "lucide-react";
import { joinLiveMatchChannel, type LiveMatchChannel } from "@/lib/vocab-battle/live-channel";
import { BattleRound } from "@/components/vocab-battle/battle-round";
import { Confetti } from "@/components/vocab-battle/confetti";
import { ReviewList } from "@/components/vocab-battle/review-list";
import { FloatingReactions, ReactionBar, type FloatingReaction } from "@/components/vocab-battle/reactions";
import { useSfx } from "@/lib/vocab-battle/sfx";
import { normalizeQuestion, type Question, type ReactionEmoji, type RoundResult } from "@/lib/vocab-battle/rules";

// The round itself (timer, scoring, power-ups, question kinds, sound) lives
// in components/vocab-battle/battle-round.tsx, shared with the Solo page.
// This panel owns what's specific to a live match: loading/joining the
// match, the opponent's progress + reactions, submitting the score, and the
// head-to-head results.

type Phase =
  | "loading"
  | "waiting-for-opponent"
  | "error"
  | "playing"
  | "finishing"
  | "waiting-result"
  | "opponent-left"
  | "results";

export type VocabBattleLiveMatchPanelProps = {
  matchId: number;
  onExit: () => void;
  onPlayAgain?: () => void;
  /** Rendered inside a Speaking Club call: sound effects start muted so they can't leak into the mic. */
  inCall?: boolean;
  /** Inside a Speaking Club call: lets a missed word be saved to that session's shared "New words" notes. */
  shiftId?: string;
  roomCode?: string;
};

type HeadToHead = { you: number; opponent: number; draws: number };

export function VocabBattleLiveMatchPanel({
  matchId,
  onExit,
  onPlayAgain,
  inCall = false,
  shiftId,
  roomCode,
}: VocabBattleLiveMatchPanelProps) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [opponentName, setOpponentName] = useState("Opponent");

  const [result, setResult] = useState<RoundResult | null>(null);
  const score = result?.score ?? 0;

  const [opponentIndex, setOpponentIndex] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  // Duel pressure (see the `pressure` prop on <BattleRound>): bumped every
  // time the opponent answers, so answering the SAME question twice in a
  // row still re-triggers the squeeze rather than being a no-op change.
  const [pressure, setPressure] = useState<{ index: number; token: number } | null>(null);
  const pressureTokenRef = useRef(0);

  const [finalYourScore, setFinalYourScore] = useState<number | null>(null);
  const [finalOpponentScore, setFinalOpponentScore] = useState<number | null>(null);
  const [winner, setWinner] = useState<"you" | "opponent" | "draw" | null>(null);
  const [headToHead, setHeadToHead] = useState<HeadToHead | null>(null);

  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  const reactionIdRef = useRef(0);
  const lastReactionSentRef = useRef(0);

  const sfx = useSfx(!inCall);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<LiveMatchChannel | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const addFloatingReaction = useCallback((emoji: ReactionEmoji, mine: boolean) => {
    setFloating((cur) => [
      ...cur.slice(-7),
      { id: ++reactionIdRef.current, emoji, mine, left: 10 + Math.random() * 75 },
    ]);
  }, []);

  const expireFloatingReaction = useCallback((id: number) => {
    setFloating((cur) => cur.filter((r) => r.id !== id));
  }, []);

  function sendReaction(emoji: ReactionEmoji) {
    const now = Date.now();
    if (now - lastReactionSentRef.current < 700) return; // no spamming the opponent's screen
    lastReactionSentRef.current = now;
    addFloatingReaction(emoji, true);
    channelRef.current?.sendReaction(emoji).catch(() => {});
  }

  const loadMatch = useCallback(() => {
    fetch(`/api/vocab-battle/live/match/${matchId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not load this match.");
        return data;
      })
      .then((data) => {
        setOpponentName(data.opponentName || "Opponent");
        if (data.status === "waiting") {
          setPhase("waiting-for-opponent");
          if (!pollRef.current) pollRef.current = setInterval(loadMatch, 2000);
          return;
        }
        stopPolling();
        setQuestions((data.questions as unknown[]).map(normalizeQuestion));
        setPhase("playing");

        channelRef.current = joinLiveMatchChannel(Number(matchId));
        channelRef.current.onOpponentProgress((msg) => {
          setOpponentIndex(msg.index);
          setOpponentScore(msg.score);
          pressureTokenRef.current += 1;
          setPressure({ index: msg.index, token: pressureTokenRef.current });
        });
        channelRef.current.onReaction((emoji) => addFloatingReaction(emoji, false));
      })
      .catch((err) => {
        stopPolling();
        setErrorMessage(err.message || "Something went wrong.");
        setPhase("error");
      });
  }, [matchId, stopPolling, addFloatingReaction]);

  useEffect(() => {
    loadMatch();
    return () => {
      stopPolling();
      channelRef.current?.leave().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // The round hands back its result; submit it once, then wait for the
  // opponent's so both scores can be revealed together.
  function handleRoundComplete(r: RoundResult) {
    setResult(r);
    setPhase("finishing");
  }

  useEffect(() => {
    if (phase !== "finishing" || !result) return;
    channelRef.current?.leave().catch(() => {});

    fetch("/api/vocab-battle/live/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: Number(matchId),
        score: result.score,
        correctCount: result.correctCount,
        totalWords: questions.length,
        bestStreak: result.bestStreak,
        durationSeconds: result.durationSeconds,
      }),
    })
      .then(() => {
        setPhase("waiting-result");
        const deadline = Date.now() + 60_000;
        const poll = () => {
          fetch(`/api/vocab-battle/live/match/${matchId}`)
            .then((res) => res.json())
            .then((data) => {
              if (data.status === "finished") {
                stopPolling();
                setFinalYourScore(data.yourScore);
                setFinalOpponentScore(data.opponentScore);
                setWinner(data.winner);
                setHeadToHead(data.headToHead ?? null);
                setPhase("results");
              } else if (Date.now() > deadline) {
                stopPolling();
                setPhase("opponent-left");
              }
            })
            .catch(() => {});
        };
        poll();
        pollRef.current = setInterval(poll, 2000);
      })
      .catch(() => {
        setFinalYourScore(result.score);
        setPhase("results");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === "results" && winner === "you") sfx.play("win");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, winner]);

  if (phase === "loading" || phase === "waiting-for-opponent") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-cream px-6 text-center dark:bg-night">
        <Loader2 size={28} className="animate-spin text-leaf-600 dark:text-leaf-500" />
        <p className="font-display text-lg font-semibold">
          {phase === "waiting-for-opponent" ? "Waiting for your opponent…" : "Preparing your battle…"}
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-cream px-6 text-center dark:bg-night">
        <Swords size={28} className="text-ink-soft/40 dark:text-cream/30" />
        <p className="font-display text-lg font-semibold">Can&apos;t continue this battle</p>
        <p className="max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">{errorMessage}</p>
        <button onClick={onExit} className="mt-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream hover:bg-leaf-700">
          Close
        </button>
      </div>
    );
  }

  if (phase === "finishing" || phase === "waiting-result") {
    return (
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-cream px-6 text-center dark:bg-night">
        <Loader2 size={28} className="animate-spin text-leaf-600 dark:text-leaf-500" />
        <p className="font-display text-lg font-semibold">You scored {score}!</p>
        <p className="font-body text-sm text-ink-soft dark:text-cream/60">Waiting for {opponentName} to finish…</p>
      </div>
    );
  }

  const newBattleButton = onPlayAgain ? (
    <button
      onClick={onPlayAgain}
      className="flex items-center gap-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700"
    >
      <Swords size={15} />
      Rematch
    </button>
  ) : (
    <a
      href="/dashboard/vocab-battle/live"
      className="flex items-center gap-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700"
    >
      <Swords size={15} />
      New Battle
    </a>
  );

  if (phase === "opponent-left") {
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-cream dark:bg-night">
        <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-6 py-8 text-center">
          <Swords size={28} className="text-ink-soft/40 dark:text-cream/30" />
          <p className="font-display text-lg font-semibold">You scored {score}!</p>
          <p className="max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">
            {opponentName} didn&apos;t finish their round, so there&apos;s no final result to compare — but your score is saved.
          </p>
          {result && <ReviewList questions={questions} answers={result.answers} shiftId={shiftId} roomCode={roomCode} />}
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={onExit}
              className="rounded-pill border border-ink/10 px-5 py-2.5 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night dark:hover:text-cream"
            >
              Close
            </button>
            {newBattleButton}
          </div>
        </div>
      </div>
    );
  }

  if (phase === "results") {
    const h2hTotal = headToHead ? headToHead.you + headToHead.opponent + headToHead.draws : 0;
    return (
      <div className="fixed inset-0 z-40 overflow-y-auto bg-cream dark:bg-night">
        {winner === "you" && <Confetti />}
        <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-5 px-4 py-8">
          {winner === "you" && (
            <motion.span
              initial={{ opacity: 0, y: -8, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="flex items-center gap-1.5 rounded-pill bg-gradient-to-r from-leaf-500 to-leaf-700 px-4 py-1.5 font-body text-xs font-semibold uppercase tracking-wide text-cream"
            >
              <Crown size={13} />
              Victory!
            </motion.span>
          )}
          {winner === "draw" && (
            <span className="flex items-center gap-1.5 rounded-pill bg-ink/10 px-4 py-1.5 font-body text-xs font-semibold uppercase tracking-wide text-ink-soft dark:bg-night-soft dark:text-cream/70">
              <Handshake size={13} />
              Draw
            </span>
          )}

          <div className="w-full rounded-2xl border border-ink/10 bg-cream-soft p-8 text-center dark:border-night-border dark:bg-night-soft">
            <p className="font-body text-xs font-semibold uppercase tracking-widest text-ink-soft dark:text-cream/50">Battle Complete</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div
                className={`rounded-xl border px-4 py-4 ${
                  winner === "you" ? "border-leaf-500 bg-leaf-50 dark:bg-leaf-500/10" : "border-ink/10 bg-white dark:border-night-border dark:bg-night"
                }`}
              >
                <p className="font-body text-[11px] font-medium text-ink-soft dark:text-cream/50">You</p>
                <p className="mt-1 font-display text-3xl font-bold text-leaf-700 dark:text-leaf-500">{finalYourScore ?? score}</p>
              </div>
              <div
                className={`rounded-xl border px-4 py-4 ${
                  winner === "opponent" ? "border-leaf-500 bg-leaf-50 dark:bg-leaf-500/10" : "border-ink/10 bg-white dark:border-night-border dark:bg-night"
                }`}
              >
                <p className="font-body text-[11px] font-medium text-ink-soft dark:text-cream/50">{opponentName}</p>
                <p className="mt-1 font-display text-3xl font-bold text-ink dark:text-cream">{finalOpponentScore ?? "—"}</p>
              </div>
            </div>

            {headToHead && h2hTotal > 1 && (
              <p className="mt-4 font-body text-xs text-ink-soft dark:text-cream/50">
                Head-to-head vs {opponentName}:{" "}
                <span className="font-semibold text-ink dark:text-cream">
                  {headToHead.you} – {headToHead.opponent}
                </span>
                {headToHead.draws > 0 ? ` (${headToHead.draws} draw${headToHead.draws === 1 ? "" : "s"})` : ""}
              </p>
            )}

            {result && <ReviewList questions={questions} answers={result.answers} shiftId={shiftId} roomCode={roomCode} />}

            <div className="mt-7 flex items-center justify-center gap-3">
              <button
                onClick={onExit}
                className="rounded-pill border border-ink/10 px-5 py-2.5 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night dark:hover:text-cream"
              >
                Close
              </button>
              {newBattleButton}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // phase === "playing"
  return (
    <>
      <BattleRound
        questions={questions}
        inCall={inCall}
        exit={
          <button
            onClick={onExit}
            className="flex items-center gap-1.5 font-body text-sm font-medium text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
          >
            <X size={16} />
            Exit Game
          </button>
        }
        headerRight={
          <div className="flex items-center gap-2 font-body text-xs text-ink-soft dark:text-cream/50">
            <Users size={14} />
            {opponentName}: question {Math.min(opponentIndex + 1, questions.length)}/{questions.length} ·{" "}
            <span className="font-semibold text-ink dark:text-cream">{opponentScore}</span>
          </div>
        }
        footer={<ReactionBar onPick={sendReaction} />}
        pressure={pressure}
        onProgress={(p) => channelRef.current?.sendProgress(p).catch(() => {})}
        onComplete={handleRoundComplete}
      />
      <FloatingReactions items={floating} onExpire={expireFloatingReaction} />
    </>
  );
}
