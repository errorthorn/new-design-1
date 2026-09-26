"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Mic, MicOff, PhoneOff, Wifi, Loader2, AlertTriangle, UserRound, Volume2, VolumeX, Swords, X, Shuffle, Clock3 } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { cn } from "@/lib/utils";
import { useSpeakingRoomCall } from "@/hooks/use-speaking-room-call";
import { useSpeakingClubTranscript } from "@/hooks/use-speaking-club-transcript";
import { RemoteAudioSinks } from "@/components/speaking-club/remote-audio-sinks";
import { SessionProgress, formatClockLabel } from "@/components/speaking-club/session-progress";
import { LearnedWordsNotes } from "@/components/speaking-club/learned-words-notes";
import { SayItRound } from "@/components/speaking-club/say-it-round";
import { SessionRatingCard } from "@/components/speaking-club/session-rating-card";
import { SessionCountedNote } from "@/components/speaking-club/session-counted-note";
import { VocabBattleLiveMatchPanel } from "@/components/vocab-battle/live-match-panel";
import { joinBattleInviteChannel, type BattleInviteChannel } from "@/lib/vocab-battle/invite-channel";
import { joinCueCardChannel, type CueCardChannel } from "@/lib/speaking-club/cue-card-channel";

// Page background matches the mock-test dashboard and speaking-club
// dashboard so the three feel like one product, not three different apps.
const PAGE_BG = { background: "#F8FAFC" };

// ---------------------------------------------------------------------------
// PHASE 2 — this screen is now wired to a real audio call via
// useSpeakingRoomCall (mesh WebRTC over Supabase Realtime signaling +
// Cloudflare TURN). Phase 0's visual design is unchanged; the "3rd person"
// layout below simply renders whatever peers are actually present, so it
// naturally covers the §4.2 emergency-3rd-participant case once Phase 5
// starts adding a temp_username to a shift — no UI change needed then.
//
// Identity: normally the signed-in user's email is used as the WebRTC peer
// id (Phase 3 will gate entry to this page with real passkey/time-window
// validation — see SPEAKING-CLUB-WEBRTC-PLAN.md §9 Phase 3). For the Phase
// 2 acceptance test itself ("two test users enter the same room_code"),
// non-production builds accept ?as=<name> so two browser tabs can join as
// two different identities without needing two real accounts — see
// PHASE2-TESTING.md. This override never runs in production.
// ---------------------------------------------------------------------------

type Participant = {
  id: string;
  name: string;
  initial: string;
  muted: boolean;
  you?: boolean;
  temporary?: boolean;
  connectionState?: "connecting" | "connected" | "disconnected" | "failed";
  stream?: MediaStream | null;
};

function initialOf(name: string) {
  return (name.trim()[0] || "?").toUpperCase();
}

// How many ms from right now until "HH:MM:SS" today, in Asia/Dhaka —
// shifts are daily-recurring and never cross midnight (see the
// `end_time > start_time` check on speaking_shifts in sql/schema.sql), so
// "today" is unambiguous. Builds both "now" and the target time the same
// way (as if Asia/Dhaka's wall-clock reading were UTC) so their difference
// is a valid real duration regardless of the actual UTC offset — the same
// trick used for Asia/Dhaka day-math in lib/mock-test-slots.ts.
function msUntilDhakaTimeToday(hhmmss: string): number {
  const [h, m, s] = hhmmss.split(":").map(Number);
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const nowAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const endAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), h, m, s || 0);
  return endAsUtc - nowAsUtc;
}

export default function SpeakingRoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [self, setSelf] = useState<{ id: string; name: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Local-only "deafen" toggle for the speaker button — mutes remote
  // playback in your own browser without touching your mic or the call.
  const [deafened, setDeafened] = useState(false);
  // Auto-end at the shift's scheduled end_time (see the effect below that
  // fetches it from /api/speaking-club/my-status) — endingSoon shows a
  // heads-up a few minutes out, sessionEnded shows a brief message right
  // before this page hangs up and redirects on its own, so the call never
  // just silently cuts out with no warning.
  const [sessionEnded, setSessionEnded] = useState(false);
  // How many "new words" this student noted this session (reported by
  // <LearnedWordsNotes />) — only used for the line on the session-ended card.
  const [savedWordCount, setSavedWordCount] = useState(0);
  // End-of-session rating (Feature #5). We only ask when there was
  // actually someone to rate: a real shift AND a partner who was in the
  // call at some point. leftManually = the student tapped "Leave call" and
  // is now looking at the rating card (the call itself is already left —
  // the rating never delays hanging up). The ref mirrors it so the
  // shift-end effect below can tell "already left" without re-running.
  const [hadPartner, setHadPartner] = useState(false);
  const [partnerName, setPartnerName] = useState<string | null>(null);
  const [leftManually, setLeftManually] = useState(false);
  const leftManuallyRef = useRef(false);
  // The shift's window as absolute epoch ms (start/end) — drives both the
  // Session progress bar and the "ending soon" banner below. clockNow ticks
  // once a second, but only while a window exists (so the dev ?as= path,
  // which has no shift, never runs this interval).
  const [shiftWindow, setShiftWindow] = useState<{
    startMs: number;
    endMs: number;
    startLabel?: string;
    endLabel?: string;
  } | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());

  // Dev/test-only identity override — see file header. Never active in production.
  const testAs = process.env.NODE_ENV !== "production" ? searchParams.get("as") : null;
  const forceTurn = process.env.NODE_ENV !== "production" && searchParams.get("forceTurn") === "1";

  useEffect(() => {
    if (testAs) {
      setSelf({ id: `test:${testAs}`, name: testAs });
      setAuthChecked(true);
      return;
    }
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.user) setSelf({ id: data.user.email, name: data.user.name || data.user.email });
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [testAs]);

  const roomCode = (params?.code as string) ?? "room-07";
  // Phase 5: passed by the dashboard's "Join the Call" link (app/speaking-club/page.tsx)
  // after a successful passkey join — used for the presence heartbeat below,
  // and (Phase B, AI feedback plan §6) to tag the transcript submission with
  // the right speaking_shifts row.
  const shiftId = searchParams.get("shiftId") ?? undefined;
  const askRating = Boolean(shiftId) && hadPartner;

  const call = useSpeakingRoomCall({
    roomCode,
    selfId: self?.id ?? "",
    selfName: self?.name ?? "You",
    forceTurn,
    enabled: !!self,
    shiftId,
  });

  // PHASE B (SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §6) — captures this
  // student's own transcript via the Web Speech API while the call is
  // actually connected. Independent of the WebRTC audio above; degrades
  // silently on unsupported browsers (see hook file header) so this never
  // affects the call itself.
  const transcript = useSpeakingClubTranscript({
    enabled: call.overallState === "connected",
    shiftId,
    studentUsername: self?.id ?? "",
  });

  // Auto-end at the shift's scheduled end_time — without this, a session
  // just runs forever until someone manually hangs up. Reuses
  // /api/speaking-club/my-status (already returns each of today's shifts'
  // endTime, "HH:MM:SS" in Asia/Dhaka) rather than adding a new endpoint;
  // finds the row matching this room's shiftId and works out how many ms
  // are left in Asia/Dhaka's clock right now, then times the actual end off
  // that (and feeds the Session progress bar + 5-minute warning below). If shiftId doesn't resolve to a real row
  // (e.g. the ?as= dev-test override, which has no matching DB shift), this
  // silently does nothing — same "never let the test path affect the real
  // one" rule the rest of this file already follows.
  useEffect(() => {
    if (!self || !shiftId) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    fetch("/api/speaking-club/my-status")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const shift = (data.shifts ?? []).find((s: { shiftId: string }) => s.shiftId === shiftId);
        if (!shift?.endTime) return;

        const msUntilEnd = msUntilDhakaTimeToday(shift.endTime);
        if (msUntilEnd <= 0) {
          setSessionEnded(true);
          return;
        }

        const nowMs = Date.now();
        const endMs = nowMs + msUntilEnd;
        const startMs = shift.startTime ? nowMs + msUntilDhakaTimeToday(shift.startTime) : NaN;
        setClockNow(nowMs);
        if (Number.isFinite(startMs) && startMs < endMs) {
          setShiftWindow({
            startMs,
            endMs,
            startLabel: formatClockLabel(shift.startTime),
            endLabel: formatClockLabel(shift.endTime),
          });
        }
        timers.push(setTimeout(() => !cancelled && setSessionEnded(true), msUntilEnd));
      })
      .catch(() => {
        // If this lookup fails, the call simply doesn't auto-end — no
        // different from how the site behaved before this feature existed,
        // so failing open here is the safe choice.
      });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [self, shiftId]);

  // 1s tick for the countdown. Displayed time is always computed from
  // Date.now() vs the shift window (never by counting ticks), so a
  // throttled background tab catches up instantly when it wakes — and the
  // check below also ends the session then, in case the browser delayed
  // the setTimeout above.
  useEffect(() => {
    if (!shiftWindow || sessionEnded) return;
    const id = setInterval(() => {
      const t = Date.now();
      setClockNow(t);
      if (t >= shiftWindow.endMs) setSessionEnded(true);
    }, 1000);
    return () => clearInterval(id);
  }, [shiftWindow, sessionEnded]);

  // Live "ending soon" banner value — derived, so it counts down with the
  // clock (5 → 4 → … → 1) instead of staying frozen at "about 5 minutes".
  const remainingMs = shiftWindow ? shiftWindow.endMs - clockNow : null;
  const endingSoonMinutes =
    remainingMs !== null && remainingMs > 0 && remainingMs <= 5 * 60_000 ? Math.ceil(remainingMs / 60_000) : null;

  useEffect(() => {
    if (!sessionEnded) return;
    // Fire-and-forget, same as the manual "Leave call" button — the
    // student is being moved on regardless of whether this finishes.
    if (leftManuallyRef.current) return; // already hung up; the rating card owns the exit now
    transcript.submitTranscript();
    call.leave();
    // With a rating to collect, the card navigates when the student is
    // done (or skips); otherwise it's the original brief message + redirect.
    if (askRating) return;
    const id = setTimeout(() => router.push("/speaking-club"), 4000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEnded]);

  // Vocab Battle in-call: lets whoever's in this room start a battle
  // with each other WITHOUT leaving the call — audio keeps running
  // regardless of what's on screen, since the call itself has no video
  // to hide, so a full-screen battle overlay over the (audio-only) call
  // UI is a genuine "do both at once," not a compromise. Deliberately
  // its own Realtime channel (lib/vocab-battle/invite-channel.ts), keyed
  // by this room's code — completely separate from the WebRTC signaling
  // channel above, so nothing here can affect call signaling.
  const [battleMatchId, setBattleMatchId] = useState<number | null>(null);
  const [pendingInvite, setPendingInvite] = useState<{ matchId: number; roomCode: string; fromName: string } | null>(null);
  const [startingBattle, setStartingBattle] = useState(false);
  const [battleError, setBattleError] = useState<string | null>(null);
  const inviteChannelRef = useRef<BattleInviteChannel | null>(null);

  useEffect(() => {
    if (!self) return;
    const channel = joinBattleInviteChannel(roomCode);
    inviteChannelRef.current = channel;
    const unsubscribe = channel.onInvite((msg) => {
      // Ignore invites that arrive while already mid-battle (or from
      // ourselves, though broadcast self:false already filters that) —
      // never yank someone out of a game they're already playing.
      setBattleMatchId((current: number | null) => {
        if (current != null) return current;
        setPendingInvite({ matchId: msg.matchId, roomCode: msg.roomCode, fromName: msg.fromName });
        return current;
      });
    });
    return () => {
      unsubscribe();
      channel.leave().catch(() => {});
    };
  }, [roomCode, self]);

  async function startVocabBattle() {
    setStartingBattle(true);
    setBattleError(null);
    try {
      const res = await fetch("/api/vocab-battle/live/create", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start a battle.");
      await inviteChannelRef.current?.sendInvite({
        matchId: data.matchId,
        roomCode: data.roomCode,
        fromName: self?.name ?? "Your partner",
        fromUserId: self?.id ?? "",
      });
      setBattleMatchId(data.matchId);
    } catch (err: any) {
      setBattleError(err?.message ?? "Could not start a battle.");
    } finally {
      setStartingBattle(false);
    }
  }

  async function acceptBattleInvite() {
    if (!pendingInvite) return;
    const invite = pendingInvite;
    setPendingInvite(null);
    try {
      const res = await fetch("/api/vocab-battle/live/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: invite.roomCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not join that battle.");
      setBattleMatchId(data.matchId);
    } catch (err: any) {
      // Most likely someone else in the room already joined first — not
      // worth a scary error, since the invite itself is still valid for
      // whoever got there first.
      setBattleError(err?.message ?? "Could not join that battle.");
    }
  }

  // Speaking-topic cue cards: admin sets one topic + a pool of questions
  // each day (see /admin/speaking-club, "Topic & Cue Cards" tab); this
  // room rotates through them automatically and either participant can
  // shuffle to a different one early. No server-side "current card" state
  // — both sides compute it independently from a shared (baseEpochMs,
  // baseCardIndex) pair, kept in sync over lib/speaking-club/cue-card-channel.ts.
  const [topicTitle, setTopicTitle] = useState("");
  const [rotationMinutes, setRotationMinutes] = useState(8);
  const [cueCards, setCueCards] = useState<{ id: string; questionText: string }[]>([]);
  const [baseEpochMs, setBaseEpochMs] = useState<number | null>(null);
  const [baseCardIndex, setBaseCardIndex] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const cueChannelRef = useRef<CueCardChannel | null>(null);
  const hasBroadcastEpochRef = useRef(false);

  useEffect(() => {
    if (!self) return;
    let cancelled = false;
    fetch("/api/speaking-club/cue-cards")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setTopicTitle(data.topicTitle ?? "Free talk");
        setRotationMinutes(data.rotationMinutes ?? 8);
        setCueCards(data.cards ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [self]);

  // Gap-fix (see topic_title/cue_card_questions in sql/schema.sql): feed
  // whatever the cue-card fetch above just loaded into the transcript
  // hook, so a submission at end-of-call has the day's topic + full card
  // pool to send along, giving the AI feedback worker something to check
  // the conversation against. Runs whenever either changes — cheap, and
  // submitTranscript itself only reads the ref at actual submit time.
  useEffect(() => {
    transcript.setTopicContext({
      topicTitle,
      cueCardQuestions: cueCards.map((c) => c.questionText),
    });
  }, [transcript, topicTitle, cueCards]);

  useEffect(() => {
    if (!self) return;
    const channel = joinCueCardChannel(roomCode);
    cueChannelRef.current = channel;
    const unsubscribe = channel.onMessage((msg) => {
      if (msg.type === "epoch") {
        // Both sides may announce an epoch near call-start — always keep
        // whichever is EARLIER (a simple, order-independent way for two
        // async broadcasts to converge on the same value no matter which
        // arrives first). This must stay distinct from "shuffle" below,
        // which always takes effect immediately regardless of timing —
        // an intentional shuffle should never lose to an earlier epoch.
        setBaseEpochMs((cur) => (cur === null || msg.epochMs < cur ? msg.epochMs : cur));
      } else if (msg.type === "shuffle") {
        setBaseEpochMs(msg.epochMs);
        setBaseCardIndex(msg.cardIndex);
      }
    });
    return () => {
      unsubscribe();
      channel.leave().catch(() => {});
    };
  }, [roomCode, self]);

  useEffect(() => {
    if (call.overallState !== "connected" || hasBroadcastEpochRef.current) return;
    hasBroadcastEpochRef.current = true;
    const epochMs = Date.now();
    setBaseEpochMs((cur) => (cur === null || epochMs < cur ? epochMs : cur));
    cueChannelRef.current?.sendEpoch(epochMs);
  }, [call.overallState]);

  // Recomputing every 15s is plenty of resolution for a multi-minute
  // rotation — no need for per-second ticking here.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  const currentCardIndex = useMemo(() => {
    if (cueCards.length === 0 || baseEpochMs === null) return 0;
    const elapsedMs = Math.max(0, nowTick - baseEpochMs);
    const steps = Math.floor(elapsedMs / (rotationMinutes * 60000));
    return (baseCardIndex + steps) % cueCards.length;
  }, [cueCards.length, baseEpochMs, baseCardIndex, rotationMinutes, nowTick]);

  function shuffleCueCard() {
    if (cueCards.length === 0) return;
    let next = Math.floor(Math.random() * cueCards.length);
    if (cueCards.length > 1 && next === currentCardIndex) {
      next = (next + 1) % cueCards.length;
    }
    const epochMs = Date.now();
    setBaseEpochMs(epochMs);
    setBaseCardIndex(next);
    cueChannelRef.current?.sendShuffle(next, epochMs);
  }

  const participants: Participant[] = useMemo(() => {
    const me: Participant = {
      id: "me",
      name: "You",
      initial: initialOf(self?.name ?? "?"),
      muted: call.localMuted,
      you: true,
    };
    const others: Participant[] = call.peers.map((p, idx) => ({
      id: p.peerId,
      name: p.name,
      initial: initialOf(p.name),
      muted: p.remoteMuted,
      temporary: idx >= 1, // 3rd+ peer in the room renders as the temporary-partner tile (§4.2)
      connectionState: p.connectionState,
      stream: p.stream,
    }));
    return [me, ...others];
  }, [call.peers, call.localMuted, self]);

  const overallConnection: "connecting" | "connected" =
    call.overallState === "connected" ? "connected" : "connecting";

  // Remember that a partner was really here (and their first name) so the
  // end-of-session rating is only asked when there was someone to rate.
  useEffect(() => {
    if (participants.length >= 2) {
      setHadPartner(true);
      const other = participants.find((p) => !p.you);
      if (other && participants.length === 2) setPartnerName(other.name.split(" ")[0] || other.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participants.length]);

  if (!authChecked) {
    return (
      <div className="min-h-screen" style={PAGE_BG}>
        <Navbar />
        <div className="flex h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink/15 border-t-leaf-600" />
        </div>
      </div>
    );
  }

  if (!self) {
    return (
      <div className="min-h-screen" style={PAGE_BG}>
        <Navbar />
        <div className="mx-auto max-w-md px-6 py-16 text-center">
          <p className="font-body text-sm text-ink-soft">Please sign in before entering the room.</p>
        </div>
      </div>
    );
  }

  // Below 2 real participants, we still render a second "waiting" slot so
  // the screen reads as an actual two-person call from the moment you join
  // — not a lone tile floating in a mostly-empty page.
  const showWaitingSlot = participants.length === 1;
  const tileCount = participants.length + (showWaitingSlot ? 1 : 0);

  return (
    <div className="min-h-screen" style={PAGE_BG}>
      <Navbar />

      <main className="mx-auto flex min-h-[calc(100vh-104px)] max-w-4xl flex-col px-6 py-8">
        {/* Renders every remote peer's audio (hidden, no visual — the tiles below are the UI) */}
        <RemoteAudioSinks peers={call.peers} deafened={deafened} />

        {/* Header: room code + live connection state */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded-pill bg-ink px-3 py-1 font-display text-xs font-semibold uppercase tracking-wide text-cream">
              {roomCode}
            </span>
            <ConnectionBadge state={overallConnection} micState={call.overallState} />
          </div>
          {forceTurn && (
            <span className="rounded-pill border border-amber-300 bg-amber-50 px-3 py-1 font-body text-xs font-medium text-amber-700">
              Test mode: TURN relay forced
            </span>
          )}
        </div>

        {shiftWindow && !sessionEnded && (
          <SessionProgress
            startMs={shiftWindow.startMs}
            endMs={shiftWindow.endMs}
            now={clockNow}
            startLabel={shiftWindow.startLabel}
            endLabel={shiftWindow.endLabel}
          />
        )}

        {cueCards.length > 0 && call.overallState === "connected" && (
          <div className="mt-5 rounded-2xl border border-leaf-300 bg-leaf-50/60 px-5 py-4 dark:border-night-border dark:bg-night-soft">
            <div className="flex items-center justify-between gap-3">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-leaf-700">
                Today&apos;s topic: {topicTitle}
              </span>
              <button
                onClick={shuffleCueCard}
                className="flex shrink-0 items-center gap-1.5 rounded-pill border border-leaf-300 bg-white px-3 py-1.5 font-body text-xs font-semibold text-ink transition-colors hover:bg-leaf-50 dark:bg-night-card dark:text-cream"
              >
                <Shuffle size={13} />
                Shuffle
              </button>
            </div>
            <p className="mt-2 font-display text-lg text-ink dark:text-cream">
              {cueCards[currentCardIndex]?.questionText}
            </p>
          </div>
        )}

        {call.error && (
          <div className="mt-5 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {call.error}
          </div>
        )}

        {endingSoonMinutes !== null && !sessionEnded && (
          <div className="mt-5 flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 font-body text-sm text-amber-800">
            <Clock3 size={16} className="shrink-0" />
            This session ends in about {endingSoonMinutes} minute{endingSoonMinutes === 1 ? "" : "s"} — the call
            will close on its own when your shift time is up.
          </div>
        )}

        {participants.length === 3 && (
          <div className="mt-5 rounded-2xl border border-leaf-300 bg-leaf-50 px-4 py-3 font-body text-sm text-ink-soft">
            <span className="font-semibold text-ink">{participants[2].name}</span> didn&apos;t have a partner
            for this shift, so the admin has temporarily added them to your room. The three of you will practice together today.
          </div>
        )}

        {/* Call stage: tiles are centered in the space above the controls,
            and the mic/leave buttons sit lower — anchored a fixed distance
            from the bottom of the screen instead of glued to the tile grid
            or floating with a lot of dead space beneath them. */}
        <div className="flex flex-1 flex-col items-center">
          <div className="flex w-full flex-1 items-center justify-center">
            <div
              className={cn(
                "grid w-full gap-6",
                tileCount >= 3 ? "max-w-3xl grid-cols-1 sm:grid-cols-3" : "max-w-2xl grid-cols-1 sm:grid-cols-2"
              )}
            >
              {participants.map((p, idx) => (
                <ParticipantTile key={p.id} participant={p} index={idx} />
              ))}
              {showWaitingSlot && <WaitingPartnerTile index={participants.length} />}
            </div>
          </div>

          {/* Controls */}
          <div className="mb-10 flex flex-col items-center gap-3">
            {/* LearnedWordsNotes renders a fixed corner icon button (top-right) —
                deliberately NOT in this button row; it positions itself. */}
            <LearnedWordsNotes shiftId={shiftId} roomCode={roomCode} onCountChange={setSavedWordCount} />
            <div className="mb-1 flex flex-wrap items-center justify-center gap-2">
              {call.overallState === "connected" && participants.length >= 2 && !battleMatchId && (
                <button
                  onClick={startVocabBattle}
                  disabled={startingBattle}
                  className="hover-lift flex items-center gap-2 rounded-pill border-2 border-leaf-300 bg-white px-5 py-2 font-body text-sm font-semibold text-ink transition-colors hover:border-leaf-600 hover:bg-leaf-50 disabled:opacity-60"
                >
                  {startingBattle ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
                  {startingBattle ? "Starting…" : "Vocab Battle"}
                </button>
              )}
              {call.overallState === "connected" && participants.length >= 2 && (
                <SayItRound roomCode={roomCode} partnerName={partnerName ?? "your partner"} />
              )}
            </div>
            <div className="flex items-center gap-5">
              <button
                onClick={call.toggleMute}
                aria-label={call.localMuted ? "Unmute" : "Mute"}
                className={cn(
                  "hover-lift flex h-16 w-16 items-center justify-center rounded-full border-2 transition-colors",
                  call.localMuted
                    ? "border-ink bg-ink text-cream"
                    : "border-leaf-300 bg-white text-ink hover:border-leaf-600 hover:bg-leaf-50"
                )}
              >
                {call.localMuted ? <MicOff size={22} /> : <Mic size={22} />}
              </button>
              <button
                onClick={() => setDeafened((d) => !d)}
                aria-label={deafened ? "Turn speaker on" : "Turn speaker off"}
                className={cn(
                  "hover-lift flex h-16 w-16 items-center justify-center rounded-full border-2 transition-colors",
                  deafened
                    ? "border-ink bg-ink text-cream"
                    : "border-leaf-300 bg-white text-ink hover:border-leaf-600 hover:bg-leaf-50"
                )}
              >
                {deafened ? <VolumeX size={22} /> : <Volume2 size={22} />}
              </button>
              <button
                onClick={() => {
                  // Fire-and-forget, no await — the student must navigate
                  // away immediately (plan §6 Phase B). A slow/failed
                  // submission must never delay or freeze call exit.
                  transcript.submitTranscript();
                  call.leave();
                  if (askRating) {
                    // Hang up now, then ask the two-question rating on the
                    // wrap-up card below; the card navigates when finished.
                    leftManuallyRef.current = true;
                    setLeftManually(true);
                    return;
                  }
                  router.push("/speaking-club");
                }}
                aria-label="Leave call"
                className="hover-lift flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700"
              >
                <PhoneOff size={22} />
              </button>
            </div>
            <p className="text-center font-body text-xs text-ink-soft">
              {call.localMuted ? "Your mic is off" : "Your mic is on"}
              {deafened && " · Speaker is off"}
            </p>
            {battleError && (
              <button
                onClick={() => setBattleError(null)}
                className="flex items-center gap-1.5 rounded-pill bg-red-50 px-3 py-1 font-body text-xs text-red-700"
              >
                {battleError}
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Vocab Battle invite — someone else in this call started a
          battle; this is the "no code to type" convenience the
          invite channel exists for (see startVocabBattle above). */}
      {pendingInvite && (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="flex items-center gap-4 rounded-2xl border border-leaf-300 bg-white px-5 py-3 shadow-lg dark:border-night-border dark:bg-night-soft">
            <Swords size={18} className="shrink-0 text-leaf-600" />
            <p className="font-body text-sm text-ink dark:text-cream">
              <span className="font-semibold">{pendingInvite.fromName}</span> started a Vocab Battle
            </p>
            <button
              onClick={acceptBattleInvite}
              className="rounded-pill bg-leaf-600 px-4 py-1.5 font-body text-sm font-semibold text-cream hover:bg-leaf-700"
            >
              Join
            </button>
            <button
              onClick={() => setPendingInvite(null)}
              aria-label="Dismiss"
              className="text-ink-soft/50 hover:text-ink-soft"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Full-screen overlay — the call has no video to hide, so this
          genuinely runs ALONGSIDE the conversation rather than pausing
          it: audio keeps flowing through the WebRTC hook above
          regardless of what's rendered on screen. */}
      {battleMatchId != null && (
        <VocabBattleLiveMatchPanel
          matchId={battleMatchId}
          onExit={() => setBattleMatchId(null)}
          // Rematch: close this battle and immediately invite the partner to
          // a fresh one (same call, new invite). If it can't start, the
          // error shows on the call screen like any other battle error.
          onPlayAgain={() => {
            setBattleMatchId(null);
            void startVocabBattle();
          }}
          // Sound effects start muted in a call so they can't leak into the mic.
          inCall
          shiftId={shiftId}
          roomCode={roomCode}
        />
      )}

      {/* Shown for the few seconds between the shift's end_time arriving
          (see the auto-end effect above, which already hung up the call by
          this point) and the redirect back to the dashboard — so the
          student sees a clear reason the call just went quiet instead of
          being silently booted. */}
      {(sessionEnded || leftManually) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 px-6 dark:bg-black/80">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center dark:bg-night-card">
            <p className="font-display text-lg font-semibold text-ink dark:text-cream">
              {sessionEnded ? "Time's up for this session!" : "You've left the call"}
            </p>
            <p className="mt-1.5 font-body text-sm text-ink-soft dark:text-cream/60">
              {sessionEnded
                ? "Great practice today — see you at your next Speaking Club shift."
                : "Nice work today — one quick question before you go."}
            </p>
            {savedWordCount > 0 && (
              <p className="mt-3 rounded-xl bg-leaf-50 px-3 py-2 font-body text-sm font-medium text-leaf-700 dark:bg-night-soft">
                You noted {savedWordCount} new word{savedWordCount === 1 ? "" : "s"} today — find {savedWordCount === 1 ? "it" : "them"} on your Speaking Club page.
              </p>
            )}
            {/* Only when there was a real shift + a partner — the same
                condition as the rating — so the check isn't wasted on a
                call that could never have qualified. */}
            {askRating && <SessionCountedNote />}
            {askRating && shiftId && (
              <SessionRatingCard
                shiftId={shiftId}
                partnerName={partnerName}
                onDone={() => router.push("/speaking-club")}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectionBadge({
  state,
  micState,
}: {
  state: "connecting" | "connected";
  micState: string;
}) {
  if (state === "connecting") {
    return (
      <span className="flex items-center gap-1.5 rounded-pill border border-leaf-300 bg-white px-3 py-1 font-body text-xs font-medium text-ink-soft shadow-sm">
        <Loader2 size={12} className="animate-spin" />
        {micState === "requesting-mic" ? "Requesting microphone permission…" : "Connecting…"}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 rounded-pill border border-leaf-300 bg-leaf-100 px-3 py-1 font-body text-xs font-medium text-leaf-700 shadow-sm">
      <Wifi size={12} />
      Connected
    </span>
  );
}

// Matches the white-card + green-border icon system used across the
// speaking-club dashboard and mock-test pages, so a call tile, a dashboard
// stat card, and a page icon all read as the same product.
function ParticipantTile({ participant, index }: { participant: Participant; index: number }) {
  const showAsLive = participant.you || participant.connectionState === "connected";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "hover-lift flex flex-col items-center rounded-2xl border p-10 shadow-[0_1px_0_0_rgba(21,23,15,0.04)]",
        participant.temporary
          ? "border-leaf-300 bg-leaf-50 hover:border-leaf-600"
          : "border-leaf-300 bg-white hover:border-leaf-600"
      )}
    >
      <span
        className={cn(
          "flex h-24 w-24 items-center justify-center rounded-full border-2 font-display text-3xl font-bold",
          showAsLive ? "border-leaf-300 bg-white text-leaf-700" : "border-ink/10 bg-ink/5 text-ink-soft"
        )}
      >
        {participant.initial}
      </span>
      <p className="mt-5 font-display text-base font-semibold">{participant.name}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {participant.temporary && (
          <span className="rounded-pill bg-leaf-200 px-2 py-0.5 font-body text-[10px] font-semibold text-leaf-700">
            Temporary partner
          </span>
        )}
        {!showAsLive ? (
          <span className="font-body text-xs text-ink-soft">Waiting…</span>
        ) : participant.muted ? (
          <span className="flex items-center gap-1 font-body text-xs text-ink-soft">
            <MicOff size={12} /> Muted
          </span>
        ) : (
          <span className="flex items-center gap-1 font-body text-xs text-leaf-700">
            <Mic size={12} /> Speaking
          </span>
        )}
      </div>
    </motion.div>
  );
}

// Placeholder second slot shown while a partner hasn't joined yet, so the
// call always reads as a two-person room instead of one lonely tile.
function WaitingPartnerTile({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center rounded-2xl border-2 border-dashed border-ink/15 bg-cream-soft/60 p-10"
    >
      <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-ink/15 bg-white text-ink-soft/50">
        <UserRound size={30} />
      </span>
      <p className="mt-5 font-display text-base font-semibold text-ink-soft">Partner</p>
      <span className="mt-1.5 flex items-center gap-1.5 font-body text-xs text-ink-soft">
        <Loader2 size={12} className="animate-spin" />
        Waiting to join…
      </span>
    </motion.div>
  );
}
