"use client";

// lib/speaking-club/cue-card-channel.ts
//
// Keeps both participants in a Speaking Club call looking at the same cue
// card, without any server-side "current card" state — each client computes
// the current card index itself from a shared start-time baseline (see
// the room page), and this channel exists only to (a) agree on that
// baseline when the call connects and (b) broadcast a manual "Shuffle" tap
// so both sides jump to the same new card at the same moment. Same Supabase
// Realtime broadcast approach as lib/vocab-battle/invite-channel.ts — a
// channel of its own, deliberately NOT reusing the WebRTC signaling
// channel, so a bug here can never affect call signaling.

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type CueCardMessage =
  | { type: "epoch"; epochMs: number }
  | { type: "shuffle"; cardIndex: number; epochMs: number };

export type CueCardChannel = {
  sendEpoch: (epochMs: number) => Promise<void>;
  sendShuffle: (cardIndex: number, epochMs: number) => Promise<void>;
  onMessage: (handler: (msg: CueCardMessage) => void) => () => void;
  leave: () => Promise<void>;
};

export function joinCueCardChannel(roomCode: string): CueCardChannel {
  const channel: RealtimeChannel = supabaseBrowser.channel(`speaking-club-cue-card-${roomCode}`, {
    config: { broadcast: { self: false } },
  });

  const handlers = new Set<(msg: CueCardMessage) => void>();

  channel.on("broadcast", { event: "cue-card" }, (payload) => {
    handlers.forEach((h) => h(payload.payload as CueCardMessage));
  });

  let subscribed = false;
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") subscribed = true;
  });

  async function send(msg: CueCardMessage) {
    if (!subscribed) return;
    await channel.send({ type: "broadcast", event: "cue-card", payload: msg });
  }

  return {
    sendEpoch: (epochMs) => send({ type: "epoch", epochMs }),
    sendShuffle: (cardIndex, epochMs) => send({ type: "shuffle", cardIndex, epochMs }),
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async leave() {
      handlers.clear();
      await supabaseBrowser.removeChannel(channel);
    },
  };
}
