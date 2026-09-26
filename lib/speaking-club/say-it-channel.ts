"use client";

// lib/speaking-club/say-it-channel.ts
//
// Realtime channel for the Speaking Club's "Say It" mini-game — one
// partner gets a word and speaks a sentence with it live on the call, the
// other rates it. Entirely ephemeral (not stored anywhere): this channel
// IS the game. Same Supabase Realtime broadcast approach as
// cue-card-channel.ts and words-channel.ts, on a channel of its own so it
// can't interfere with the call or those other features.

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type SayItWord = {
  wordId: number;
  word: string;
  meaning: string;
  pronunciation: string | null;
  example: string | null;
};

export type SayItStartMessage = {
  type: "start";
  roundId: string;
  word: SayItWord;
  speakerName: string;
};

export type SayItVerdictMessage = {
  type: "verdict";
  roundId: string;
  /** true = nailed it, false = needs another go. */
  correct: boolean;
};

export type SayItChannel = {
  sendStart: (msg: Omit<SayItStartMessage, "type">) => Promise<void>;
  sendVerdict: (msg: Omit<SayItVerdictMessage, "type">) => Promise<void>;
  onStart: (handler: (msg: SayItStartMessage) => void) => () => void;
  onVerdict: (handler: (msg: SayItVerdictMessage) => void) => () => void;
  leave: () => Promise<void>;
};

export function joinSayItChannel(roomCode: string): SayItChannel {
  const channel: RealtimeChannel = supabaseBrowser.channel(`speaking-club-say-it-${roomCode}`, {
    config: { broadcast: { self: false } },
  });

  const startHandlers = new Set<(msg: SayItStartMessage) => void>();
  const verdictHandlers = new Set<(msg: SayItVerdictMessage) => void>();

  channel.on("broadcast", { event: "start" }, (payload) => {
    startHandlers.forEach((h) => h(payload.payload as SayItStartMessage));
  });
  channel.on("broadcast", { event: "verdict" }, (payload) => {
    verdictHandlers.forEach((h) => h(payload.payload as SayItVerdictMessage));
  });

  let subscribed = false;
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") subscribed = true;
  });

  return {
    async sendStart(msg) {
      if (!subscribed) return;
      await channel.send({ type: "broadcast", event: "start", payload: { type: "start", ...msg } });
    },
    async sendVerdict(msg) {
      if (!subscribed) return;
      await channel.send({ type: "broadcast", event: "verdict", payload: { type: "verdict", ...msg } });
    },
    onStart(handler) {
      startHandlers.add(handler);
      return () => startHandlers.delete(handler);
    },
    onVerdict(handler) {
      verdictHandlers.add(handler);
      return () => verdictHandlers.delete(handler);
    },
    async leave() {
      startHandlers.clear();
      verdictHandlers.clear();
      await supabaseBrowser.removeChannel(channel);
    },
  };
}
