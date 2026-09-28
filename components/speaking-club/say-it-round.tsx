"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X, ThumbsUp, ThumbsDown, Loader2, Volume2, VolumeX } from "lucide-react";
import { joinSayItChannel, type SayItChannel, type SayItWord } from "@/lib/speaking-club/say-it-channel";
import { useSfx } from "@/lib/vocab-battle/sfx";

// "Say It" — a speaking-only mini-game for inside a Speaking Club call
// (Vocab Battle's suggestion #3): one partner gets a word and 20 seconds to
// use it in a spoken sentence out loud on the call, and the other partner
// rates it live with a thumbs up/down. No typing, no multiple choice — the
// whole point is to make the two of them actually talk.
//
// Entirely ephemeral: nothing here is written to the database. The round
// (and the session tally) lives only in this component and the realtime
// channel that keeps the two screens in sync; it resets if either side
// refreshes or leaves the room. If this turns out to be popular, an
// obvious next step is logging rounds the way Vocab Battle attempts are,
// but that's more than this pass needed.

const SPEAK_SECONDS = 20;

type Phase =
  | "idle" // nobody's playing; either side can start
  | "loading" // fetching a word to start a round
  | "speaking-you" // you're the speaker
  | "speaking-partner" // partner is the speaker, you'll judge
  | "judging" // partner's timer ran out — rate them
  | "waiting-verdict" // your timer ran out — waiting for partner's rating
  | "result"; // your round's result just came back

type Props = {
  roomCode: string;
  partnerName: string;
};

export function SayItRound({ roomCode, partnerName }: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [word, setWord] = useState<SayItWord | null>(null);
  const [timeLeft, setTimeLeft] = useState(SPEAK_SECONDS);
  const [lastResult, setLastResult] = useState<boolean | null>(null);
  const [tally, setTally] = useState({ you: 0, partner: 0 });
  const [error, setError] = useState<string | null>(null);

  const sfx = useSfx(false); // muted by default in a call, same as Vocab Battle
  const channelRef = useRef<SayItChannel | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const channel = joinSayItChannel(roomCode);
    channelRef.current = channel;

    const offStart = channel.onStart((msg) => {
      roundIdRef.current = msg.roundId;
      setWord(msg.word);
      setPhase("speaking-partner");
      setTimeLeft(SPEAK_SECONDS);
      setOpen(true);
    });

    const offVerdict = channel.onVerdict((msg) => {
      if (msg.roundId !== roundIdRef.current) return; // stale/late message for a round we've moved past
      setLastResult(msg.correct);
      setTally((t) => (msg.correct ? { ...t, you: t.you + 1 } : t));
      setPhase("result");
      sfx.play(msg.correct ? "correct" : "wrong");
    });

    return () => {
      offStart();
      offVerdict();
      channel.leave().catch(() => {});
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  function clearTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }
  useEffect(() => clearTimer, []);

  // Countdown for whichever side is currently speaking.
  useEffect(() => {
    if (phase !== "speaking-you" && phase !== "speaking-partner") {
      clearTimer();
      return;
    }
    setTimeLeft(SPEAK_SECONDS);
    const deadline = Date.now() + SPEAK_SECONDS * 1000;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        clearTimer();
        setPhase((p) => (p === "speaking-you" ? "waiting-verdict" : p === "speaking-partner" ? "judging" : p));
      }
    }, 250);
    return clearTimer;
  }, [phase]);

  async function startRound() {
    setError(null);
    setPhase("loading");
    setOpen(true);
    try {
      const res = await fetch("/api/vocab-battle/say-it/word");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not get a word.");
      const w: SayItWord = {
        wordId: data.wordId,
        word: data.word,
        meaning: data.meaning,
        pronunciation: data.pronunciation ?? null,
        example: data.example ?? null,
      };
      const roundId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      roundIdRef.current = roundId;
      setWord(w);
      setPhase("speaking-you");
      await channelRef.current?.sendStart({ roundId, word: w, speakerName: "" });
    } catch (err: any) {
      setError(err?.message ?? "Could not start Say It.");
      setPhase("idle");
    }
  }

  function submitVerdict(correct: boolean) {
    if (!roundIdRef.current) return;
    setTally((t) => (correct ? { ...t, partner: t.partner + 1 } : t));
    channelRef.current?.sendVerdict({ roundId: roundIdRef.current, correct }).catch(() => {});
    sfx.play(correct ? "correct" : "wrong");
    setPhase("idle");
    setTimeout(() => setOpen(false), 400);
  }

  function closeResult() {
    setPhase("idle");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (phase === "idle" && !open ? startRound() : setOpen(true))}
        className="hover-lift flex items-center gap-2 rounded-pill border-2 border-leaf-300 bg-white px-5 py-2 font-body text-sm font-semibold text-ink transition-colors hover:border-leaf-600 hover:bg-leaf-50 dark:border-night-border dark:bg-night-card dark:text-cream"
      >
        <Mic size={16} />
        Say It
        {(tally.you > 0 || tally.partner > 0) && (
          <span className="font-body text-[11px] font-normal text-ink-soft dark:text-cream/50">
            {tally.you}–{tally.partner}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-6 dark:bg-black/80"
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl bg-white p-6 text-center dark:bg-night-card"
            >
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold uppercase tracking-wide text-ink-soft dark:text-cream/50">
                  <Mic size={13} />
                  Say It
                </span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={sfx.toggle}
                    aria-label={sfx.enabled ? "Turn sound off" : "Turn sound on"}
                    className="text-ink-soft hover:text-ink dark:text-cream/60"
                  >
                    {sfx.enabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
                  </button>
                  {(phase === "idle" || phase === "result") && (
                    <button
                      type="button"
                      onClick={closeResult}
                      aria-label="Close"
                      className="text-ink-soft/60 hover:text-ink-soft"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>

              {phase === "loading" && (
                <div className="flex flex-col items-center gap-2 py-8">
                  <Loader2 size={22} className="animate-spin text-leaf-600" />
                  <p className="font-body text-sm text-ink-soft dark:text-cream/60">Picking a word…</p>
                </div>
              )}

              {error && (
                <p className="mt-3 font-body text-xs text-red-600" role="alert">
                  {error}
                </p>
              )}

              {(phase === "speaking-you" || phase === "speaking-partner" || phase === "waiting-verdict") && word && (
                <>
                  <p className="mt-4 font-body text-xs font-medium text-ink-soft dark:text-cream/60">
                    {phase === "speaking-partner"
                      ? `${partnerName} is speaking — listen up!`
                      : "Use this word in a sentence, out loud:"}
                  </p>
                  <h3 className="mt-2 font-display text-4xl font-bold text-ink dark:text-cream">{word.word}</h3>
                  {word.pronunciation && (
                    <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/50">{word.pronunciation}</p>
                  )}
                  <p className="mt-2 font-body text-sm text-ink-soft dark:text-cream/70">{word.meaning}</p>

                  <div className="mx-auto mt-5 h-2 w-full max-w-[200px] overflow-hidden rounded-pill bg-ink/10 dark:bg-night-border">
                    <div
                      className={`h-full rounded-pill transition-[width] duration-200 ${
                        timeLeft <= 5 ? "bg-red-500" : "bg-leaf-500"
                      }`}
                      style={{ width: `${(timeLeft / SPEAK_SECONDS) * 100}%` }}
                    />
                  </div>
                  <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink dark:text-cream">
                    {phase === "waiting-verdict" ? "⏳" : timeLeft}
                  </p>
                  {phase === "waiting-verdict" && (
                    <p className="mt-1 font-body text-xs text-ink-soft dark:text-cream/50">
                      Waiting for {partnerName} to rate you…
                    </p>
                  )}
                </>
              )}

              {phase === "judging" && word && (
                <>
                  <p className="mt-4 font-body text-xs font-medium text-ink-soft dark:text-cream/60">Did they nail it?</p>
                  <h3 className="mt-2 font-display text-3xl font-bold text-ink dark:text-cream">{word.word}</h3>
                  <div className="mt-6 flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => submitVerdict(false)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 font-body text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 dark:border-red-500/40 dark:bg-red-500/10"
                    >
                      <ThumbsDown size={16} />
                      Not quite
                    </button>
                    <button
                      type="button"
                      onClick={() => submitVerdict(true)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-leaf-500 bg-leaf-50 px-4 py-3 font-body text-sm font-semibold text-leaf-700 transition-colors hover:bg-leaf-100 dark:bg-leaf-500/10 dark:text-leaf-400"
                    >
                      <ThumbsUp size={16} />
                      Nailed it
                    </button>
                  </div>
                </>
              )}

              {phase === "result" && (
                <div className="py-4">
                  <span className="text-4xl">{lastResult ? "🎉" : "💪"}</span>
                  <p className="mt-2 font-display text-lg font-semibold text-ink dark:text-cream">
                    {lastResult ? "Nailed it!" : "Keep practicing!"}
                  </p>
                  <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                    {partnerName} says you {lastResult ? "used it perfectly." : "can give it another shot."}
                  </p>
                  <div className="mt-5 flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={closeResult}
                      className="rounded-pill border border-ink/10 px-4 py-2 font-body text-sm font-medium text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/70"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={startRound}
                      className="rounded-pill bg-leaf-600 px-4 py-2 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
                    >
                      Another word
                    </button>
                  </div>
                </div>
              )}

              {phase === "idle" && !error && (
                <div className="py-4">
                  <p className="font-body text-sm text-ink-soft dark:text-cream/60">Ready for another round?</p>
                  <button
                    type="button"
                    onClick={startRound}
                    className="mt-4 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
                  >
                    Get a word
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
