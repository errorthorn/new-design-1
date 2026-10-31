"use client";

// lib/webrtc/signaling-channel.ts
//
// Phase 2 (plan §3.1): peer discovery + SDP/ICE exchange over a single
// Supabase Realtime channel per room_code. No new signaling server —
// Supabase Realtime is already in the stack (used elsewhere for auth-free
// browser access via the anon key, see lib/supabase-browser.ts).
//
// One channel per room_code (e.g. "speaking-room-room-07") — only the
// active users in that room's current shift ever join it, so SDP/ICE
// traffic never crosses between rooms (plan §3.1, §3.6).
//
// This file only knows about "peers in this room" and "messages between
// them" — it has no opinion on RTCPeerConnection at all. That logic lives
// in use-speaking-room-call.ts, which is what makes this piece testable/
// reusable on its own.

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type SignalMessage =
  | { type: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: "ice-candidate"; from: string; to: string; candidate: RTCIceCandidateInit };

export type PresenceInfo = { peerId: string; name: string };

export type RoomSignaling = {
  /** Send a signaling message to one specific peer in the room. */
  send: (msg: SignalMessage) => Promise<void>;
  /** Subscribe to signaling messages addressed to `selfId`. Returns an unsubscribe fn. */
  onMessage: (handler: (msg: SignalMessage) => void) => () => void;
  /** Subscribe to presence changes (who's currently in the room). */
  onPresence: (handler: (peers: PresenceInfo[]) => void) => () => void;
  /** Leave the channel and stop all realtime traffic for this room. */
  leave: () => Promise<void>;
};

/**
 * Joins the Supabase Realtime channel for `roomCode` as `selfId` (a stable
 * per-session id — the room page uses the signed-in user's email) and
 * returns a small pub/sub interface over it.
 */
export function joinRoomSignaling(roomCode: string, selfId: string, selfName: string): RoomSignaling {
  const channel: RealtimeChannel = supabaseBrowser.channel(`speaking-room-${roomCode}`, {
    config: {
      broadcast: { self: false },
      presence: { key: selfId },
    },
  });

  const messageHandlers = new Set<(msg: SignalMessage) => void>();
  const presenceHandlers = new Set<(peers: PresenceInfo[]) => void>();

  function currentPresence(): PresenceInfo[] {
    const state = channel.presenceState<{ name: string }>();
    return Object.entries(state).map(([peerId, entries]) => ({
      peerId,
      name: entries[0]?.name ?? peerId,
    }));
  }

  channel
    .on("broadcast", { event: "signal" }, (payload) => {
      const msg = payload.payload as SignalMessage;
      // Broadcast reaches everyone in the room; only react to messages
      // addressed to us (mesh signaling between up to 3 peers, plan §3.2).
      if (msg.to !== selfId) return;
      messageHandlers.forEach((h) => h(msg));
    })
    .on("presence", { event: "sync" }, () => {
      const peers = currentPresence();
      presenceHandlers.forEach((h) => h(peers));
    });

  let subscribed = false;
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED" && !subscribed) {
      subscribed = true;
      await channel.track({ name: selfName });
    }
  });

  return {
    async send(msg) {
      await channel.send({ type: "broadcast", event: "signal", payload: msg });
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onPresence(handler) {
      presenceHandlers.add(handler);
      return () => presenceHandlers.delete(handler);
    },
    async leave() {
      messageHandlers.clear();
      presenceHandlers.clear();
      await channel.untrack();
      await supabaseBrowser.removeChannel(channel);
    },
  };
}
