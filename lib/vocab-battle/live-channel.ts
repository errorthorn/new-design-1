"use client";

// lib/vocab-battle/live-channel.ts
//
// Live opponent-progress feed for one Vocab Battle match. Same
// Supabase Realtime broadcast approach as lib/webrtc/signaling-channel.ts
// (used for Speaking Club) — one channel per match id, no server relay
// needed since both clients are already talking to Supabase directly.
//
// This is purely cosmetic (showing the opponent's live question index and
// running score while you play) — the *authoritative* result of the match
// always comes from the server (see /api/vocab-battle/live/attempts and
// /api/vocab-battle/live/match/[matchId]), never from a broadcast message.
// A dropped or spoofed broadcast can make the opponent's progress bar look
// wrong for a moment; it can never change who actually won.

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type ProgressMessage = {
  type: "progress";
  index: number; // current question index, 0-based
  score: number;
};

export type LiveMatchChannel = {
  sendProgress: (msg: Omit<ProgressMessage, "type">) => Promise<void>;
  onOpponentProgress: (handler: (msg: ProgressMessage) => void) => () => void;
  leave: () => Promise<void>;
};

export function joinLiveMatchChannel(matchId: number): LiveMatchChannel {
  const channel: RealtimeChannel = supabaseBrowser.channel(`vocab-battle-match-${matchId}`, {
    config: { broadcast: { self: false } },
  });

  const handlers = new Set<(msg: ProgressMessage) => void>();

  channel.on("broadcast", { event: "progress" }, (payload) => {
    const msg = payload.payload as ProgressMessage;
    handlers.forEach((h) => h(msg));
  });

  let subscribed = false;
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") subscribed = true;
  });

  return {
    async sendProgress(msg) {
      if (!subscribed) return;
      await channel.send({
        type: "broadcast",
        event: "progress",
        payload: { type: "progress", ...msg },
      });
    },
    onOpponentProgress(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async leave() {
      handlers.clear();
      await supabaseBrowser.removeChannel(channel);
    },
  };
}
