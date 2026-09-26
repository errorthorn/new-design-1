"use client";

// hooks/use-speaking-room-call.ts
//
// Phase 2 deliverable (plan §9): RTCPeerConnection setup, offer/answer/ICE
// exchange, wired to the Supabase Realtime signaling channel
// (lib/webrtc/signaling-channel.ts) and Cloudflare TURN credentials
// (app/api/speaking-club/turn-credentials). Audio only (plan §3.2).
//
// Supports 2-person (normal) and 3-person (plan §4.2 emergency 3rd
// participant) rooms with the SAME code path — every peer just opens one
// RTCPeerConnection per *other* peer present (mesh), so a 3-person room is
// simply two peer connections per participant instead of one. This is the
// piece Phase 2's acceptance test explicitly requires working before the
// phase is marked done (plan §9: "Don't mark Phase 2 done based on the
// 2-person case alone").
//
// Glare avoidance: when two peers both see each other appear via presence
// at ~the same time, only one may send the initial offer or their SDP
// exchange collides. We use a simple deterministic rule instead of full
// "perfect negotiation" (unnecessary complexity for a room capped at 3
// people that never renegotiates mid-call): the peer with the
// lexicographically smaller id always initiates the offer to the peer with
// the larger id. Both sides agree on this without talking to each other
// first, so there's no race.

import { useCallback, useEffect, useRef, useState } from "react";
import { joinRoomSignaling, type RoomSignaling, type SignalMessage } from "@/lib/webrtc/signaling-channel";

export type PeerCallState = {
  peerId: string;
  name: string;
  connectionState: "connecting" | "connected" | "disconnected" | "failed";
  stream: MediaStream | null;
  remoteMuted: boolean; // best-effort, driven by remote track.enabled via out-of-band signal below
};

export type UseSpeakingRoomCallOptions = {
  roomCode: string;
  selfId: string; // stable per-session id — the room page passes the signed-in user's email
  selfName: string;
  /** Forces every RTCPeerConnection to relay-only ICE candidates — used for the
   *  Phase 2 "forced TURN relay" test case (plan §9), never in normal use. */
  forceTurn?: boolean;
  enabled?: boolean; // set false until the room/passkey is actually validated (Phase 3 wires this)
  /** Phase 5 (plan §4.1): this shift's id, so we can report "I'm actually
   *  here" to the backend every ~45s. Optional/omitted in the Phase 2 dev
   *  test-identity path (?as=...), which has no real shiftId — presence
   *  just isn't reported in that case, which is fine since that path
   *  never runs in production. */
  shiftId?: string;
};

export type UseSpeakingRoomCallResult = {
  overallState: "idle" | "requesting-mic" | "connecting" | "connected" | "error";
  peers: PeerCallState[];
  localMuted: boolean;
  toggleMute: () => void;
  leave: () => void;
  error: string | null;
};

type PeerRig = {
  pc: RTCPeerConnection;
  makingOffer: boolean;
  // Reconnection watchdog state (see attemptIceRestart below) — tracks
  // whether a restart is already in flight for this peer (to avoid
  // stacking two at once) and any pending grace-period timer waiting to
  // see if a "disconnected" state self-heals before we act on it.
  restarting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

// How long a peer connection is allowed to sit in "disconnected" before
// we treat it as needing a real ICE restart rather than waiting for the
// browser's own (much slower — often 20-30s+) internal retry to give up
// or recover on its own. Momentary WiFi/mobile-data blips that self-heal
// within a couple seconds shouldn't trigger a full restart (that's a
// fresh candidate-gathering + offer/answer round trip, not free) — but
// once this much time has passed with the browser still retrying using
// candidates gathered under the OLD network conditions, those candidates
// are likely stale (new local IP/port after a WiFi reconnect, etc.), and
// only a restart (fresh candidates) will actually recover it.
const DISCONNECT_RECONNECT_GRACE_MS = 4000;

// ---------------------------------------------------------------------------
// Phase 7 (plan §7, §9 Phase 7): "log TURN usage via getStats() for the
// first 1-2 weeks [after launch]" — so the real relay-vs-direct ratio and
// real relayed bytes can be checked against Cloudflare's free 1000 GB/
// month quota (plan §7's own estimate: ~40-60 GB/month realistic, ~202
// GB/month worst case) instead of trusting that estimate forever.
// Reporting itself lives in app/api/speaking-club/turn-stats/route.ts.
// ---------------------------------------------------------------------------

type RelayStatsSnapshot = { usedRelay: boolean; bytesSent: number; bytesReceived: number };

/**
 * Reads WebRTC's own getStats() for one peer connection and sums bytes
 * over whichever candidate-pair got nominated (selected) for the actual
 * media, but only if that pair's LOCAL candidate is type "relay" — i.e.
 * this peer specifically needed TURN, not just direct P2P. A room can
 * have one peer on TURN and the other on direct P2P at the same time
 * (asymmetric NATs), so this is tracked per-peer-connection, not per-room.
 */
async function collectRelayStats(pc: RTCPeerConnection): Promise<RelayStatsSnapshot> {
  try {
    const stats = await pc.getStats();
    const localCandidates = new Map<string, any>();
    stats.forEach((report: any) => {
      if (report.type === "local-candidate") localCandidates.set(report.id, report);
    });

    let usedRelay = false;
    let bytesSent = 0;
    let bytesReceived = 0;
    stats.forEach((report: any) => {
      if (report.type !== "candidate-pair" || !report.nominated) return;
      const local = localCandidates.get(report.localCandidateId);
      if (local?.candidateType === "relay") {
        usedRelay = true;
        bytesSent += report.bytesSent ?? 0;
        bytesReceived += report.bytesReceived ?? 0;
      }
    });
    return { usedRelay, bytesSent, bytesReceived };
  } catch {
    // getStats() can reject on an already-closed connection in some
    // browsers — treat as "nothing to report" rather than throwing,
    // consistent with every other best-effort path in this file.
    return { usedRelay: false, bytesSent: 0, bytesReceived: 0 };
  }
}

/**
 * Fire-and-forget POST to the Phase 7 usage-logging route. Deliberately
 * mirrors the presence heartbeat's "only report for a real shiftId" rule
 * (undefined shiftId means the Phase 2 dev test-identity path, which
 * never runs in production — nothing to log there).
 */
function reportTurnUsage(params: {
  shiftId?: string;
  usedRelay: boolean;
  relayBytesSent: number;
  relayBytesReceived: number;
  callDurationSeconds: number;
  peerCount: number;
}) {
  if (!params.shiftId) return;
  const body = JSON.stringify({
    shiftId: params.shiftId,
    usedRelay: params.usedRelay,
    relayBytesSent: params.relayBytesSent,
    relayBytesReceived: params.relayBytesReceived,
    callDurationSeconds: params.callDurationSeconds,
    peerCount: params.peerCount,
  });
  try {
    // sendBeacon survives the tab actually closing — by far the most
    // common way a call ends — far better than fetch, which browsers may
    // cancel mid-flight during unload. Only fall back to fetch (with
    // keepalive, for the same reason) if sendBeacon isn't available.
    const sent =
      typeof navigator !== "undefined" && "sendBeacon" in navigator
        ? navigator.sendBeacon("/api/speaking-club/turn-stats", new Blob([body], { type: "application/json" }))
        : false;
    if (!sent) {
      fetch("/api/speaking-club/turn-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Usage logging must never be able to break a call's actual cleanup.
  }
}

export function useSpeakingRoomCall(options: UseSpeakingRoomCallOptions): UseSpeakingRoomCallResult {
  const { roomCode, selfId, selfName, forceTurn = false, enabled = true, shiftId } = options;

  const [overallState, setOverallState] = useState<UseSpeakingRoomCallResult["overallState"]>("idle");
  const [peers, setPeers] = useState<Record<string, PeerCallState>>({});
  const [localMuted, setLocalMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signalingRef = useRef<RoomSignaling | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRigsRef = useRef<Map<string, PeerRig>>(new Map());
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: "stun:stun.l.google.com:19302" }]);
  // Phase 7 (plan §7): "log TURN usage via getStats() for the first 1-2
  // weeks" — callStartedAtRef marks when this call's peer connections
  // first started forming, so the eventual report has a real duration.
  const callStartedAtRef = useRef<number | null>(null);
  // Fix: previously `finalizeAndReportUsage` used the CURRENT peerRigsRef
  // size at leave/unmount time as `peerCount`, sent to the attendance
  // check (recordAttendance requires peerCount >= 2 to even look up
  // whether the partner was really there). That undercounts whenever the
  // partner leaves first: by the time the remaining student leaves a few
  // seconds later, their own rig for that partner has already been torn
  // down (see the presence-leave branch below), so peerCount reads 1 even
  // though they genuinely spoke with a partner minutes earlier — the
  // whole session then fails to qualify for attendance/streak credit.
  // This set tracks every peerId that ever reached "connected" at least
  // once during this call, so a partner who leaves early still counts.
  const everConnectedPeersRef = useRef<Set<string>>(new Set());
  // Holds attemptIceRestart (defined further below, after isInitiator) so
  // createPeerConnection's onconnectionstatechange handler — defined
  // earlier in this file — can call it without a circular/forward
  // reference between the two useCallbacks. Assigned via a plain render-
  // body statement right after attemptIceRestart is defined; refs are
  // safe to mutate outside of effects.
  const attemptIceRestartRef = useRef<(peerId: string) => void>(() => {});

  const updatePeer = useCallback((peerId: string, patch: Partial<PeerCallState>) => {
    setPeers((prev) => ({
      ...prev,
      [peerId]: { ...(prev[peerId] ?? { peerId, name: peerId, connectionState: "connecting", stream: null, remoteMuted: false }), ...patch },
    }));
  }, []);

  const removePeer = useCallback((peerId: string) => {
    const rig = peerRigsRef.current.get(peerId);
    if (rig) {
      if (rig.reconnectTimer) clearTimeout(rig.reconnectTimer);
      rig.pc.close();
      peerRigsRef.current.delete(peerId);
    }
    setPeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string, peerName: string) => {
      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        iceTransportPolicy: forceTurn ? "relay" : "all",
      });
      const rig: PeerRig = { pc, makingOffer: false, restarting: false, reconnectTimer: null };
      peerRigsRef.current.set(peerId, rig);
      updatePeer(peerId, { peerId, name: peerName, connectionState: "connecting", stream: null, remoteMuted: false });

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));
      }

      pc.ontrack = (event) => {
        updatePeer(peerId, { stream: event.streams[0] ?? null });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && signalingRef.current) {
          signalingRef.current.send({
            type: "ice-candidate",
            from: selfId,
            to: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        const currentRig = peerRigsRef.current.get(peerId);

        if (state === "connected") {
          updatePeer(peerId, { connectionState: "connected" });
          everConnectedPeersRef.current.add(peerId);
          // Recovered (either on its own, or because a restart we kicked
          // off succeeded) — cancel any pending restart attempt for this
          // peer so we don't fire one unnecessarily right after.
          if (currentRig?.reconnectTimer) {
            clearTimeout(currentRig.reconnectTimer);
            currentRig.reconnectTimer = null;
          }
        } else if (state === "failed") {
          updatePeer(peerId, { connectionState: "failed" });
          // "failed" means the browser's own ICE checks are already
          // exhausted — no grace period needed, restart right away
          // (still guarded against stacking — see the !reconnectTimer
          // check — and against firing twice if we're already
          // mid-restart, inside attemptIceRestart itself).
          if (currentRig && !currentRig.reconnectTimer) {
            currentRig.reconnectTimer = setTimeout(() => attemptIceRestartRef.current(peerId), 0);
          }
        } else if (state === "disconnected") {
          updatePeer(peerId, { connectionState: "disconnected" });
          // THE actual fix for "weak network -> stuck on connecting
          // forever, even after the network recovers": without this,
          // nothing ever re-gathers ICE candidates, so the browser keeps
          // retrying with candidates gathered under the old (now
          // possibly stale, e.g. after a WiFi IP change) network
          // conditions — sometimes for 20-30s+ before even giving up,
          // and with no recovery path at all if it does give up. Give it
          // DISCONNECT_RECONNECT_GRACE_MS to self-heal (common for a
          // momentary blip) before forcing a real restart.
          if (currentRig && !currentRig.reconnectTimer) {
            currentRig.reconnectTimer = setTimeout(() => attemptIceRestartRef.current(peerId), DISCONNECT_RECONNECT_GRACE_MS);
          }
        } else if (state === "closed") {
          updatePeer(peerId, { connectionState: "disconnected" });
          if (currentRig?.reconnectTimer) {
            clearTimeout(currentRig.reconnectTimer);
            currentRig.reconnectTimer = null;
          }
        } else {
          updatePeer(peerId, { connectionState: "connecting" });
        }

        setOverallState((prevOverall) => {
          const rigs = Array.from(peerRigsRef.current.values());
          if (rigs.length === 0) return prevOverall;
          const allConnected = rigs.every((r) => r.pc.connectionState === "connected");
          return allConnected ? "connected" : prevOverall === "connected" ? "connecting" : prevOverall;
        });
      };

      return rig;
    },
    [forceTurn, selfId, updatePeer]
  );

  // Deterministic initiator rule — see file header. Only the "smaller" id
  // creates+sends the offer; the other side just waits for it.
  const isInitiator = useCallback((otherId: string) => selfId < otherId, [selfId]);

  // The actual reconnection logic (see onconnectionstatechange above for
  // when this gets scheduled). Re-uses this file's existing deterministic
  // offerer rule — same lexicographic-id comparison as the initial offer
  // — so restarts don't glare either: exactly one side ever sends the
  // restart offer for a given peer pair, the other side's existing
  // handleSignal("offer") branch below already handles receiving it
  // correctly with zero changes needed (setRemoteDescription/
  // createAnswer doesn't care whether an incoming offer is a fresh one
  // or an ICE-restart one).
  const attemptIceRestart = useCallback(
    async (peerId: string) => {
      const rig = peerRigsRef.current.get(peerId);
      if (!rig) return; // peer already torn down (e.g. left the room) before this fired
      rig.reconnectTimer = null;

      if (rig.pc.connectionState === "connected" || rig.pc.connectionState === "closed") return; // recovered on its own, or gone
      if (!isInitiator(peerId)) return; // only the deterministic initiator re-offers
      if (rig.restarting) return; // already mid-restart for this peer
      if (rig.pc.signalingState !== "stable") return; // already mid-negotiation; let that resolve first rather than colliding with it

      rig.restarting = true;
      try {
        // TURN credentials are short-lived (see the turn-credentials
        // route) — if this reconnect is happening well into a long call,
        // the ones this pc was constructed with may have expired.
        // setConfiguration() lets us refresh them on the EXISTING
        // connection rather than needing to tear it down and rebuild it.
        try {
          const res = await fetch("/api/speaking-club/turn-credentials");
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.iceServers) && data.iceServers.length) {
              iceServersRef.current = data.iceServers;
              rig.pc.setConfiguration({ iceServers: iceServersRef.current, iceTransportPolicy: forceTurn ? "relay" : "all" });
            }
          }
        } catch {
          // Keep using whatever ICE servers this connection is already
          // configured with — a failed credential refresh shouldn't
          // block attempting the restart with what we've got.
        }

        // restartIce() marks the NEXT createOffer to generate fresh ICE
        // credentials (new ufrag/pwd), which is what actually forces
        // fresh candidate gathering instead of continuing to retry with
        // whatever was gathered under the old network conditions.
        rig.pc.restartIce();
        const offer = await rig.pc.createOffer();
        await rig.pc.setLocalDescription(offer);
        await signalingRef.current?.send({ type: "offer", from: selfId, to: peerId, sdp: offer });
      } catch (err) {
        // Non-fatal — the next connectionstatechange transition (if
        // still broken) will schedule another attempt.
        console.warn("[speaking-club] ICE restart attempt failed", err);
      } finally {
        rig.restarting = false;
      }
    },
    [isInitiator, selfId, forceTurn]
  );
  attemptIceRestartRef.current = attemptIceRestart;

  const startOffer = useCallback(
    async (peerId: string, peerName: string) => {
      if (peerRigsRef.current.has(peerId)) return;
      const rig = createPeerConnection(peerId, peerName);
      try {
        rig.makingOffer = true;
        const offer = await rig.pc.createOffer();
        await rig.pc.setLocalDescription(offer);
        await signalingRef.current?.send({ type: "offer", from: selfId, to: peerId, sdp: offer });
      } finally {
        rig.makingOffer = false;
      }
    },
    [createPeerConnection, selfId]
  );

  const handleSignal = useCallback(
    async (msg: SignalMessage) => {
      if (msg.type === "offer") {
        let rig = peerRigsRef.current.get(msg.from);
        if (!rig) rig = createPeerConnection(msg.from, msg.from);
        await rig.pc.setRemoteDescription(msg.sdp);
        const answer = await rig.pc.createAnswer();
        await rig.pc.setLocalDescription(answer);
        await signalingRef.current?.send({ type: "answer", from: selfId, to: msg.from, sdp: answer });
      } else if (msg.type === "answer") {
        const rig = peerRigsRef.current.get(msg.from);
        if (rig) await rig.pc.setRemoteDescription(msg.sdp);
      } else if (msg.type === "ice-candidate") {
        const rig = peerRigsRef.current.get(msg.from);
        if (rig) {
          try {
            await rig.pc.addIceCandidate(msg.candidate);
          } catch (err) {
            // Benign if it arrives before setRemoteDescription in rare
            // orderings — WebRTC's own retry via ICE restart covers this
            // at the scale/traffic this room ever sees (max 3 peers).
            console.warn("[speaking-club] addIceCandidate failed", err);
          }
        }
      }
    },
    [createPeerConnection, selfId]
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function setup() {
      setOverallState("requesting-mic");
      setError(null);
      everConnectedPeersRef.current = new Set();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;

        try {
          const res = await fetch("/api/speaking-club/turn-credentials");
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.iceServers) && data.iceServers.length) {
              iceServersRef.current = data.iceServers;
            }
          }
        } catch {
          // Falls back to the default STUN-only server set in iceServersRef.
        }

        if (cancelled) return;
        setOverallState("connecting");
        callStartedAtRef.current = Date.now();

        const signaling = joinRoomSignaling(roomCode, selfId, selfName);
        signalingRef.current = signaling;

        const unsubMessage = signaling.onMessage(handleSignal);
        const unsubPresence = signaling.onPresence((presentPeers) => {
          const otherIds = new Set(presentPeers.map((p) => p.peerId).filter((id) => id !== selfId));

          // New peers: only the deterministic initiator opens the offer —
          // the other side just waits for it via handleSignal("offer").
          for (const p of presentPeers) {
            if (p.peerId === selfId) continue;
            if (peerRigsRef.current.has(p.peerId)) continue;
            if (isInitiator(p.peerId)) startOffer(p.peerId, p.name);
          }

          // Peers that left: tear down their connection.
          for (const existingId of Array.from(peerRigsRef.current.keys())) {
            if (!otherIds.has(existingId)) removePeer(existingId);
          }
        });

        return () => {
          unsubMessage();
          unsubPresence();
        };
      } catch (err: any) {
        if (!cancelled) {
          setOverallState("error");
          setError(
            err?.name === "NotAllowedError"
              ? "Grant microphone permission — you can't join the call without the browser's mic permission."
              : err?.message ?? "There was a problem joining the call."
          );
        }
      }
    }

    const cleanupPromise = setup();

    return () => {
      cancelled = true;
      cleanupPromise.then((cleanup) => cleanup?.());
      finalizeAndReportUsage();
      peerRigsRef.current.forEach((rig) => {
        if (rig.reconnectTimer) clearTimeout(rig.reconnectTimer);
        rig.pc.close();
      });
      peerRigsRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      signalingRef.current?.leave();
      signalingRef.current = null;
      callStartedAtRef.current = null;
      setPeers({});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, selfId, selfName, enabled, forceTurn]);

  // Phase 5 (plan §4.1) — presence heartbeat. Deliberately a separate
  // effect from the call-setup one above: it should keep running for as
  // long as `enabled` is true regardless of the call's connection state
  // (a student sitting in "connecting…" waiting for their partner is
  // exactly the case the backend needs to see a heartbeat from), and it
  // shouldn't restart/duplicate on every peer join/leave the way the call
  // effect's own cleanup does.
  useEffect(() => {
    if (!enabled || !shiftId) return;

    let cancelled = false;
    const sendHeartbeat = () => {
      fetch("/api/speaking-club/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId }),
        // Presence is best-effort — a failed heartbeat just means this
        // one tick doesn't count as "present"; nothing in the UI depends
        // on the response, so a network hiccup here shouldn't surface an
        // error to the student.
      }).catch(() => {});
    };

    sendHeartbeat();
    const interval = setInterval(() => {
      if (!cancelled) sendHeartbeat();
    }, 45_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, shiftId]);

  // Phase 7 — kicks off getStats() collection across every still-open peer
  // connection and posts the aggregated report, WITHOUT awaiting (so it can
  // be called from a synchronous cleanup path right before pc.close()).
  // getStats() calls already in flight resolve fine even if close() runs
  // immediately after they were invoked.
  const finalizeAndReportUsage = useCallback(() => {
    const rigs = Array.from(peerRigsRef.current.values());
    const everConnectedCount = everConnectedPeersRef.current.size;
    if (rigs.length === 0 && everConnectedCount === 0) return;
    // Use whichever is larger: peers still connected right now, or peers
    // that connected earlier and have since left (see the ref's comment
    // above) — a partner who dropped off after a real conversation must
    // still count, not just whoever happens to still be in the room at
    // the exact moment THIS student leaves.
    const peerCount = Math.max(rigs.length, everConnectedCount) + 1; // + self
    // Clear right away: leave() calls this directly and then tears down
    // peerRigsRef, but the setup effect's own cleanup calls this again
    // right after (see below) — without clearing, that second call would
    // still see the same everConnectedPeersRef contents and send a
    // duplicate report, double-counting this call's seconds server-side.
    everConnectedPeersRef.current = new Set();
    const startedAt = callStartedAtRef.current;
    const callDurationSeconds = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    const currentShiftId = shiftId;

    Promise.all(rigs.map((rig) => collectRelayStats(rig.pc)))
      .then((snapshots) => {
        const usedRelay = snapshots.some((s) => s.usedRelay);
        const relayBytesSent = snapshots.reduce((sum, s) => sum + s.bytesSent, 0);
        const relayBytesReceived = snapshots.reduce((sum, s) => sum + s.bytesReceived, 0);
        // Skip a report that would just be noise — left before anything
        // ever connected, e.g. closed the tab during "connecting…".
        if (!usedRelay && relayBytesSent === 0 && relayBytesReceived === 0 && callDurationSeconds < 3) return;
        reportTurnUsage({
          shiftId: currentShiftId,
          usedRelay,
          relayBytesSent,
          relayBytesReceived,
          callDurationSeconds,
          peerCount,
        });
      })
      .catch(() => {});
  }, [shiftId]);

  const toggleMute = useCallback(() => {
    setLocalMuted((prev) => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach((track) => (track.enabled = !next));
      return next;
    });
  }, []);

  const leave = useCallback(() => {
    finalizeAndReportUsage();
    peerRigsRef.current.forEach((rig) => {
      if (rig.reconnectTimer) clearTimeout(rig.reconnectTimer);
      rig.pc.close();
    });
    peerRigsRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    signalingRef.current?.leave();
    signalingRef.current = null;
    callStartedAtRef.current = null;
    setPeers({});
    setOverallState("idle");
  }, [finalizeAndReportUsage]);

  return {
    overallState,
    peers: Object.values(peers),
    localMuted,
    toggleMute,
    leave,
    error,
  };
}
