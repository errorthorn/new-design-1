"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  X,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Volume2,
  VolumeX,
  SkipForward,
  Lightbulb,
  Check,
  Sparkles,
} from "lucide-react";
import { joinSayItChannel, type SayItChannel, type SayItWord } from "@/lib/speaking-club/say-it-channel";
import { useSfx } from "@/lib/vocab-battle/sfx";

// "Say It" — a speaking-only mini-game for inside a Speaking Club call:
// one partner gets a word and 20 seconds to use it in a spoken sentence out
// loud on the call, and the other partner rates it live with a thumbs
// up/down. No typing, no multiple choice — the whole point is to make the
// two of them actually talk.
//
// v2 (what changed from the first version):
//   - Turns alternate: after you rate your partner, it's automatically your
//     turn to speak next ("Your turn" card), so nobody is stuck judging.
//   - "I'm done" lets the speaker finish early; the judge can rate at once.
//   - Skip word (2 per turn) and an optional example-sentence hint.
//   - A word is never repeated within the same call.
//   - Either person can End game at any time and the other screen resets, and
//     a stuck "waiting for rating" state can be skipped after 45s.
//   - If both tap start at the same instant, one round wins deterministically
//     instead of both screens fighting.
//   - A warning if the speaker's mic is muted.
//   - The panel no longer dims the whole screen, so mute / speaker / leave
//     stay reachable while you play.
//   - One game per call: a game is one turn each (two rounds). Once it has
//     finished or been ended, Say It is used up for the rest of the call.
//   - No Say It button. After SAY_IT_PROMPT_AFTER_MINUTES of conversation an
//     invite popup appears; if it's ignored it comes back every 10 minutes
//     (and 10 minutes after a game ends). Never during a battle or when the
//     session is about to end.
//
// Still entirely ephemeral: nothing is written to the database.

const SPEAK_SECONDS = 20;
const SKIPS_PER_TURN = 2;
const VERDICT_WAIT_STUCK_MS = 45_000;
const INVITE_AUTO_HIDE_MS = 90_000;
/** If the invite is ignored (or a game just ended), ask again after this long. */
const INVITE_REPEAT_MS = 10 * 60_000;
/** Minutes of conversation (both people connected) before the invite popup. */
export const SAY_IT_PROMPT_AFTER_MINUTES = 30;

type Phase =
  | "idle" // nobody's playing; either side can start
  | "loading" // fetching a word to start a round
  | "speaking-you" // you're the speaker
  | "speaking-partner" // partner is the speaker, you'll judge
  | "judging" // partner finished — rate them
  | "waiting-verdict" // you finished — waiting for partner's rating
  | "result" // your round's result just came back
  | "your-turn" // you just judged — now it's your turn to speak
  | "game-over"; // both turns done (you judged last)

type Props = {
  roomCode: string;
  partnerName: string;
  /** Epoch ms when both people were first connected; drives the invite popup. */
  conversationStartMs?: number | null;
  /** True while the invite popup must not appear (battle running, session ending…). */
  suppressInvite?: boolean;
  /** Local mic state, so we can warn a muted speaker. */
  micMuted?: boolean;
};

const CARD =
  "pointer-events-auto max-h-[calc(100dvh-14rem)] w-full max-w-sm overflow-y-auto rounded-2xl border-2 border-leaf-500 bg-white p-4 text-center shadow-xl sm:p-5 lg:max-h-[calc(100dvh-8rem)] dark:bg-night-card";

export function SayItRound({
  roomCode,
  partnerName,
  conversationStartMs = null,
  suppressInvite = false,
  micMuted = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [word, setWord] = useState<SayItWord | null>(null);
  const [timeLeft, setTimeLeft] = useState(SPEAK_SECONDS);
  const [lastResult, setLastResult] = useState<boolean | null>(null);
  const [tally, setTally] = useState({ you: 0, partner: 0 });
  const [roundNumber, setRoundNumber] = useState(0);
  const [skipsLeft, setSkipsLeft] = useState(SKIPS_PER_TURN);
  const [showHint, setShowHint] = useState(false);
  const [verdictStuck, setVerdictStuck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Invite schedule. There is no Say It button any more — the popup is the
  // way in: first at SAY_IT_PROMPT_AFTER_MINUTES, then every INVITE_REPEAT_MS
  // for as long as it keeps being ignored (and again after a game ends).
  // The next-due time is remembered per room for this tab, so a reconnect
  // (which remounts this component) can't reset or replay the schedule.
  const inviteKey = `say-it-next-invite-${roomCode}`;
  const [nextInviteAt, setNextInviteAt] = useState<number | null>(() => {
    try {
      const v = typeof window !== "undefined" ? window.sessionStorage.getItem(inviteKey) : null;
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  const [inviteDue, setInviteDue] = useState(false);

  // One game per call. Remembered per room for this tab so a reconnect
  // (which remounts this component) can't unlock a second game.
  const usedKey = `say-it-used-${roomCode}`;
  const [used, setUsed] = useState(() => {
    try {
      return typeof window !== "undefined" && window.sessionStorage.getItem(usedKey) === "1";
    } catch {
      return false;
    }
  });
  const usedRef = useRef(used);
  const [finished, setFinished] = useState(false); // both turns judged
  const verdictsRef = useRef(0);
  const markUsed = useCallback(() => {
    usedRef.current = true;
    setUsed(true);
    try {
      window.sessionStorage.setItem(usedKey, "1");
    } catch {
      /* private mode etc. */
    }
  }, [usedKey]);

  const sfx = useSfx(false); // muted by default in a call, same as Vocab Battle
  const channelRef = useRef<SayItChannel | null>(null);
  const roundIdRef = useRef<string | null>(null);
  const roundNumberRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const attemptRef = useRef(0); // bumped whenever an in-flight start must be abandoned
  const playedRef = useRef<number[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerNameRef = useRef(partnerName);
  partnerNameRef.current = partnerName;

  const openRef = useRef(false);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  function clearTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }
  useEffect(() => clearTimer, []);

  function rememberWord(id: number) {
    if (!playedRef.current.includes(id)) playedRef.current.push(id);
  }

  // ---- realtime wiring ---------------------------------------------------
  useEffect(() => {
    const channel = joinSayItChannel(roomCode);
    channelRef.current = channel;

    const offStart = channel.onStart((msg) => {
      // Both sides tapped start at the same moment: the lower round id wins,
      // the other side yields. Both clients apply the same rule, so they agree.
      const mine = roundIdRef.current;
      const busy = phaseRef.current === "speaking-you" || phaseRef.current === "loading";
      if (busy && mine && mine < msg.roundId) return;

      attemptRef.current += 1; // abandon any start we still have in flight
      roundIdRef.current = msg.roundId;
      roundNumberRef.current = msg.roundNumber;
      rememberWord(msg.word.wordId);
      setRoundNumber(msg.roundNumber);
      setWord(msg.word);
      setShowHint(false);
      setError(null);
      setPhase("speaking-partner");
      setTimeLeft(SPEAK_SECONDS);
      setOpen(true);
    });

    const offDone = channel.onDone((msg) => {
      if (msg.roundId !== roundIdRef.current) return;
      if (phaseRef.current === "speaking-partner") {
        clearTimer();
        setPhase("judging");
      }
    });

    const offVerdict = channel.onVerdict((msg) => {
      if (msg.roundId !== roundIdRef.current) return; // stale/late message for a round we've moved past
      setLastResult(msg.correct);
      setTally((t) => (msg.correct ? { ...t, you: t.you + 1 } : t));
      verdictsRef.current += 1;
      if (verdictsRef.current >= 2) {
        setFinished(true);
        markUsed();
      }
      setPhase("result");
      sfx.play(msg.correct ? "correct" : "wrong");
    });

    const offCancel = channel.onCancel(() => {
      if (phaseRef.current === "idle" && !openRef.current) return;
      attemptRef.current += 1;
      clearTimer();
      if (roundNumberRef.current > 0) markUsed(); // a started game counts as the call's one game
      setPhase("idle");
      setOpen(false);
      showToast(`${partnerNameRef.current} ended Say It.`);
    });

    return () => {
      offStart();
      offDone();
      offVerdict();
      offCancel();
      channel.leave().catch(() => {});
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ---- countdown ---------------------------------------------------------
  useEffect(() => {
    if (phase !== "speaking-you" && phase !== "speaking-partner") {
      clearTimer();
      return;
    }
    setTimeLeft(SPEAK_SECONDS);
    const deadline = Date.now() + SPEAK_SECONDS * 1000;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(left);
      if (left <= 0) {
        clearTimer();
        setPhase((p) => (p === "speaking-you" ? "waiting-verdict" : p === "speaking-partner" ? "judging" : p));
      }
    }, 250);
    return clearTimer;
  }, [phase]);

  // Never leave the speaker stuck forever waiting for a rating.
  useEffect(() => {
    setVerdictStuck(false);
    if (phase !== "waiting-verdict") return;
    const t = setTimeout(() => setVerdictStuck(true), VERDICT_WAIT_STUCK_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // ---- invite popup (30 min, then every 10 min while ignored) -------------
  const scheduleNextInvite = useCallback(() => {
    const at = Date.now() + INVITE_REPEAT_MS;
    setInviteDue(false);
    setNextInviteAt(at);
  }, []);

  // First invite: SAY_IT_PROMPT_AFTER_MINUTES after the conversation began.
  useEffect(() => {
    if (nextInviteAt === null && conversationStartMs && !used) {
      setNextInviteAt(conversationStartMs + SAY_IT_PROMPT_AFTER_MINUTES * 60_000);
    }
  }, [nextInviteAt, conversationStartMs]);

  useEffect(() => {
    if (nextInviteAt === null) return;
    try {
      window.sessionStorage.setItem(inviteKey, String(nextInviteAt));
    } catch {
      /* private mode etc. — worst case the schedule restarts after a reconnect */
    }
    const t = setTimeout(() => setInviteDue(true), Math.max(0, nextInviteAt - Date.now()));
    return () => clearTimeout(t);
  }, [nextInviteAt, inviteKey]);

  const showInvite = inviteDue && !used && !open && phase === "idle" && !suppressInvite;

  // Ignored for a while → hide it and ask again in 10 minutes.
  useEffect(() => {
    if (!showInvite) return;
    const t = setTimeout(scheduleNextInvite, INVITE_AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [showInvite, scheduleNextInvite]);

  // Game opened (by either side): the invite is answered. When the panel
  // closes again, the next invite is 10 minutes later.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      setInviteDue(false);
    } else if (wasOpenRef.current) {
      scheduleNextInvite();
    }
    wasOpenRef.current = open;
  }, [open, scheduleNextInvite]);

  // ---- actions -----------------------------------------------------------
  async function startRound(isSkip = false) {
    if (usedRef.current) return;
    const attempt = ++attemptRef.current;
    setError(null);
    setPhase("loading");
    setOpen(true);
    setShowHint(false);
    const roundId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    roundIdRef.current = roundId; // so a simultaneous partner start can be tie-broken
    try {
      const qs = playedRef.current.length ? `?exclude=${playedRef.current.slice(-100).join(",")}` : "";
      const res = await fetch(`/api/vocab-battle/say-it/word${qs}`);
      const data = await res.json();
      if (attempt !== attemptRef.current) return;
      if (!res.ok) throw new Error(data.error || "Could not get a word.");
      const w: SayItWord = {
        wordId: Number(data.wordId),
        word: data.word,
        meaning: data.meaning,
        pronunciation: data.pronunciation ?? null,
        example: data.example ?? null,
      };
      const nextNumber = isSkip ? Math.max(1, roundNumberRef.current) : roundNumberRef.current + 1;
      await channelRef.current?.sendStart({ roundId, word: w, speakerName: "", roundNumber: nextNumber });
      if (attempt !== attemptRef.current) return; // partner's round won while we were sending
      roundNumberRef.current = nextNumber;
      rememberWord(w.wordId);
      setRoundNumber(nextNumber);
      setWord(w);
      if (!isSkip) setSkipsLeft(SKIPS_PER_TURN);
      setPhase("speaking-you");
    } catch (err: any) {
      if (attempt !== attemptRef.current) return;
      roundIdRef.current = null;
      setError(err?.message ?? "Could not start Say It.");
      setPhase("idle");
    }
  }

  function skipWord() {
    if (skipsLeft <= 0) return;
    setSkipsLeft((n) => n - 1);
    void startRound(true);
  }

  function finishEarly() {
    if (!roundIdRef.current) return;
    clearTimer();
    setPhase("waiting-verdict");
    channelRef.current?.sendDone({ roundId: roundIdRef.current }).catch(() => {});
  }

  function submitVerdict(correct: boolean) {
    if (!roundIdRef.current) return;
    setTally((t) => (correct ? { ...t, partner: t.partner + 1 } : t));
    channelRef.current?.sendVerdict({ roundId: roundIdRef.current, correct }).catch(() => {});
    sfx.play(correct ? "correct" : "wrong");
    setSkipsLeft(SKIPS_PER_TURN);
    verdictsRef.current += 1;
    if (verdictsRef.current >= 2) {
      setFinished(true);
      markUsed();
      setPhase("game-over"); // both turns are done
    } else {
      setPhase("your-turn"); // turns alternate: the judge speaks next
    }
  }

  function endGame() {
    attemptRef.current += 1;
    clearTimer();
    channelRef.current?.sendCancel({ roundId: roundIdRef.current }).catch(() => {});
    if (roundNumberRef.current > 0) markUsed();
    setPhase("idle");
    setOpen(false);
  }

  function closePanel() {
    setOpen(false);
    if (phase === "result" || phase === "game-over") setPhase("idle");
  }

  const playing =
    phase === "loading" ||
    phase === "speaking-you" ||
    phase === "speaking-partner" ||
    phase === "judging" ||
    phase === "waiting-verdict";
  const hasPlayed = tally.you > 0 || tally.partner > 0 || roundNumber > 0;

  return (
    <>
      {/* Invite popup: the only way into the game */}
      <AnimatePresence>
        {showInvite && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none fixed inset-x-0 top-[6.25rem] z-50 flex justify-center px-4 lg:top-28"
          >
            <div className="pointer-events-auto relative w-full max-w-sm rounded-2xl border-2 border-leaf-500 bg-white p-4 shadow-xl sm:p-5 dark:bg-night-card">
              <button
                type="button"
                onClick={scheduleNextInvite}
                aria-label="Dismiss"
                className="absolute right-3 top-3 text-ink-soft/60 hover:text-ink-soft"
              >
                <X size={16} />
              </button>
              <div className="flex items-start gap-3 pr-5 text-left">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-leaf-500 bg-white">
                  <Sparkles size={18} className="text-leaf-600" />
                </span>
                <div>
                  <p className="font-display text-base font-bold text-ink dark:text-cream">
                    {SAY_IT_PROMPT_AFTER_MINUTES} minutes of great conversation!
                  </p>
                  <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/70">
                    Want a quick round of <span className="font-semibold">Say It</span> with {partnerName}? One of you
                    gets a word and 20 seconds to use it in a sentence.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={scheduleNextInvite}
                  className="flex-1 rounded-pill border border-ink/10 px-4 py-2 font-body text-sm font-medium text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/70"
                >
                  Maybe later
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void startRound();
                  }}
                  className="flex-1 rounded-pill bg-leaf-600 px-4 py-2 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
                >
                  Let&apos;s play
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tiny notice when the partner ends the game */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none fixed inset-x-0 top-[6.25rem] z-50 flex justify-center px-4 lg:top-28"
          >
            <p className="rounded-pill border border-leaf-500 bg-white px-4 py-2 font-body text-sm font-medium text-ink shadow-lg dark:bg-night-card dark:text-cream">
              {toast}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The game panel. No dimmed backdrop on purpose: mute / speaker /
          leave must stay tappable while you play. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="pointer-events-none fixed inset-x-0 top-[6.25rem] z-50 flex justify-center px-4 lg:top-28"
          >
            <div className={CARD}>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold uppercase tracking-wide text-ink-soft dark:text-cream/50">
                  <Mic size={13} />
                  Say It{roundNumber > 0 && ` · Round ${roundNumber}`}
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
                  {playing || phase === "your-turn" ? (
                    <button
                      type="button"
                      onClick={endGame}
                      className="font-body text-xs font-semibold text-red-600 hover:underline"
                    >
                      End game
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={closePanel}
                      aria-label="Close"
                      className="text-ink-soft/60 hover:text-ink-soft"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>

              {hasPlayed && (
                <p className="mt-2 font-body text-[11px] text-ink-soft dark:text-cream/50">
                  You {tally.you} – {tally.partner} {partnerName}
                </p>
              )}

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
                      : phase === "waiting-verdict"
                        ? "Time's up!"
                        : "Use this word in a sentence, out loud:"}
                  </p>
                  <h3 className="mt-2 font-display text-3xl font-bold text-ink sm:text-4xl dark:text-cream">{word.word}</h3>
                  {word.pronunciation && (
                    <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/50">{word.pronunciation}</p>
                  )}
                  <p className="mt-1 font-body text-xs text-ink-soft sm:text-sm dark:text-cream/70">{word.meaning}</p>

                  {phase === "speaking-you" && micMuted && (
                    <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 font-body text-xs font-medium text-amber-800">
                      <MicOff size={13} className="shrink-0" />
                      Your mic is off — unmute so {partnerName} can hear you.
                    </p>
                  )}

                  {phase === "speaking-you" && showHint && word.example && (
                    <p className="mt-2 rounded-xl border border-leaf-500 bg-white px-3 py-1.5 font-body text-xs italic text-ink-soft dark:bg-night-soft dark:text-cream/70">
                      &ldquo;{word.example}&rdquo;
                    </p>
                  )}

                  {phase !== "waiting-verdict" && (
                    <div className="mx-auto mt-3 flex w-full max-w-[240px] items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-pill bg-ink/10 dark:bg-night-border">
                        <div
                          className={`h-full rounded-pill transition-[width] duration-200 ${
                            timeLeft <= 5 ? "bg-red-500" : "bg-leaf-500"
                          }`}
                          style={{ width: `${(timeLeft / SPEAK_SECONDS) * 100}%` }}
                        />
                      </div>
                      <p className="w-7 text-right font-display text-xl font-semibold tabular-nums text-ink dark:text-cream">
                        {timeLeft}
                      </p>
                    </div>
                  )}

                  {phase === "speaking-you" && (
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                      {word.example && !showHint && (
                        <button
                          type="button"
                          onClick={() => setShowHint(true)}
                          className="flex items-center gap-1.5 rounded-pill border border-leaf-500 bg-white px-3 py-1.5 font-body text-xs font-semibold text-ink hover:bg-leaf-50 dark:bg-night-card dark:text-cream"
                        >
                          <Lightbulb size={13} />
                          Hint
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={skipWord}
                        disabled={skipsLeft <= 0}
                        className="flex items-center gap-1.5 rounded-pill border border-ink/15 bg-white px-3 py-1.5 font-body text-xs font-semibold text-ink-soft hover:bg-leaf-50 disabled:opacity-40 dark:border-night-border dark:bg-night-card dark:text-cream/70"
                      >
                        <SkipForward size={13} />
                        Skip word ({skipsLeft})
                      </button>
                      <button
                        type="button"
                        onClick={finishEarly}
                        className="flex items-center gap-1.5 rounded-pill bg-leaf-600 px-4 py-1.5 font-body text-xs font-semibold text-cream hover:bg-leaf-700"
                      >
                        <Check size={13} />
                        I&apos;m done
                      </button>
                    </div>
                  )}

                  {phase === "waiting-verdict" && (
                    <div className="mt-4">
                      <p className="font-display text-2xl">⏳</p>
                      <p className="mt-1 font-body text-xs text-ink-soft dark:text-cream/50">
                        Waiting for {partnerName} to rate you…
                      </p>
                      {verdictStuck && (
                        <button
                          type="button"
                          onClick={() => setPhase("idle")}
                          className="mt-3 rounded-pill border border-ink/15 px-4 py-1.5 font-body text-xs font-medium text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/70"
                        >
                          Skip rating
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {phase === "judging" && word && (
                <>
                  <p className="mt-4 font-body text-xs font-medium text-ink-soft dark:text-cream/60">
                    Did {partnerName} use it correctly?
                  </p>
                  <h3 className="mt-2 font-display text-3xl font-bold text-ink dark:text-cream">{word.word}</h3>
                  <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/70">{word.meaning}</p>
                  <div className="mt-5 flex justify-center gap-3">
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
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border-2 border-leaf-500 bg-white px-4 py-3 font-body text-sm font-semibold text-leaf-700 transition-colors hover:bg-leaf-100 dark:bg-leaf-500/10 dark:text-leaf-400"
                    >
                      <ThumbsUp size={16} />
                      Nailed it
                    </button>
                  </div>
                </>
              )}

              {phase === "your-turn" && (
                <div className="py-3">
                  <span className="text-4xl">🎤</span>
                  <p className="mt-2 font-display text-lg font-semibold text-ink dark:text-cream">Your turn!</p>
                  <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                    Thanks for rating. Now {partnerName} will judge you.
                  </p>
                  <div className="mt-5 flex justify-center gap-3">
                    <button
                      type="button"
                      onClick={endGame}
                      className="rounded-pill border border-ink/10 px-4 py-2 font-body text-sm font-medium text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/70"
                    >
                      End game
                    </button>
                    <button
                      type="button"
                      onClick={() => startRound()}
                      className="rounded-pill bg-leaf-600 px-5 py-2 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
                    >
                      Get my word
                    </button>
                  </div>
                </div>
              )}

              {phase === "result" && (
                <div className="py-3">
                  <span className="text-4xl">{lastResult ? "🎉" : "💪"}</span>
                  <p className="mt-2 font-display text-lg font-semibold text-ink dark:text-cream">
                    {lastResult ? "Nailed it!" : "Keep practicing!"}
                  </p>
                  <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                    {partnerName} says you {lastResult ? "used it perfectly." : "can give it another shot."}
                  </p>
                  {finished ? (
                    <p className="mt-3 font-body text-sm font-semibold text-ink dark:text-cream">
                      That&apos;s the game! Final score: You {tally.you} – {tally.partner} {partnerName}
                    </p>
                  ) : (
                    <p className="mt-3 font-body text-xs text-ink-soft dark:text-cream/50">
                      {partnerName} will take their turn next.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={closePanel}
                    className="mt-4 rounded-pill bg-leaf-600 px-5 py-2 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
                  >
                    {finished ? "Done" : "Close"}
                  </button>
                </div>
              )}

              {phase === "game-over" && (
                <div className="py-3">
                  <span className="text-4xl">🏁</span>
                  <p className="mt-2 font-display text-lg font-semibold text-ink dark:text-cream">That&apos;s the game!</p>
                  <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                    Final score: You {tally.you} – {tally.partner} {partnerName}
                  </p>
                  <button
                    type="button"
                    onClick={closePanel}
                    className="mt-4 rounded-pill bg-leaf-600 px-5 py-2 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
                  >
                    Done
                  </button>
                </div>
              )}

              {phase === "idle" && !error && (
                <div className="py-3">
                  <p className="font-display text-lg font-semibold text-ink dark:text-cream">
                    {hasPlayed ? "Ready for another round?" : "Say It"}
                  </p>
                  {!hasPlayed && (
                    <ol className="mx-auto mt-3 max-w-[260px] list-decimal space-y-1 pl-5 text-left font-body text-xs text-ink-soft dark:text-cream/60">
                      <li>One of you gets a word.</li>
                      <li>Use it in a sentence, out loud, within 20 seconds.</li>
                      <li>The other person rates it, then you swap.</li>
                    </ol>
                  )}
                  <button
                    type="button"
                    onClick={() => startRound()}
                    className="mt-4 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
                  >
                    {hasPlayed ? "Get a word" : "Start — I'll go first"}
                  </button>
                </div>
              )}

              {phase === "idle" && error && (
                <div className="py-2">
                  <button
                    type="button"
                    onClick={() => startRound()}
                    className="mt-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
