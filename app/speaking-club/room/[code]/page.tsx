"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Mic, MicOff, PhoneOff, Wifi, Loader2, AlertTriangle, UserRound, Volume2, VolumeX } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { cn } from "@/lib/utils";
import { useSpeakingRoomCall } from "@/hooks/use-speaking-room-call";
import { RemoteAudioSinks } from "@/components/speaking-club/remote-audio-sinks";

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

export default function SpeakingRoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [self, setSelf] = useState<{ id: string; name: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Local-only "deafen" toggle for the speaker button — mutes remote
  // playback in your own browser without touching your mic or the call.
  const [deafened, setDeafened] = useState(false);

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
  // after a successful passkey join — used only for the presence heartbeat below.
  const shiftId = searchParams.get("shiftId") ?? undefined;

  const call = useSpeakingRoomCall({
    roomCode,
    selfId: self?.id ?? "",
    selfName: self?.name ?? "You",
    forceTurn,
    enabled: !!self,
    shiftId,
  });

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

        {call.error && (
          <div className="mt-5 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 font-body text-sm text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {call.error}
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
                  call.leave();
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
          </div>
        </div>
      </main>
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
