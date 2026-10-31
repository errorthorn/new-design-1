"use client";

// lib/speaking-club/say-it-channel.ts
//
// Realtime channel for the Speaking Club's "Say It" mini-game — one
// partner gets a word and speaks a sentence with it live on the call, the
// other rates it. Entirely ephemeral (not stored anywhere): this channel
// IS the game. Same Supabase Realtime broadcast approach as
// cue-card-channel.ts and words-channel.ts, on a channel of its own so it
// can't interfere with the call or those other features.
//
// v2 adds two messages on top of start/verdict:
//   - "done"   the speaker finished early, so the judge can rate right away
//              instead of waiting out the whole countdown.
//   - "cancel" either side stopped the game; the other screen resets.

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
  /** 1-based round counter, so both screens show the same number. */
  roundNumber: number;
};

export type SayItVerdictMessage = {
  type: "verdict";
  roundId: string;
  /** true = nailed it, false = needs another go. */
  correct: boolean;
};

export type SayItDoneMessage = { type: "done"; roundId: string };
export type SayItCancelMessage = { type: "cancel"; roundId: string | null };

export type SayItChannel = {
  sendStart: (msg: Omit<SayItStartMessage, "type">) => Promise<void>;
  sendVerdict: (msg: Omit<SayItVerdictMessage, "type">) => Promise<void>;
  sendDone: (msg: Omit<SayItDoneMessage, "type">) => Promise<void>;
  sendCancel: (msg: Omit<SayItCancelMessage, "type">) => Promise<void>;
  onStart: (handler: (msg: SayItStartMessage) => void) => () => void;
  onVerdict: (handler: (msg: SayItVerdictMessage) => void) => () => void;
  onDone: (handler: (msg: SayItDoneMessage) => void) => () => void;
  onCancel: (handler: (msg: SayItCancelMessage) => void) => () => void;
  leave: () => Promise<void>;
};

export function joinSayItChannel(roomCode: string): SayItChannel {
  const channel: RealtimeChannel = supabaseBrowser.channel(`speaking-club-say-it-${roomCode}`, {
    config: { broadcast: { self: false } },
  });

  const startHandlers = new Set<(msg: SayItStartMessage) => void>();
  const verdictHandlers = new Set<(msg: SayItVerdictMessage) => void>();
  const doneHandlers = new Set<(msg: SayItDoneMessage) => void>();
  const cancelHandlers = new Set<(msg: SayItCancelMessage) => void>();

  channel.on("broadcast", { event: "start" }, (p) => {
    startHandlers.forEach((h) => h(p.payload as SayItStartMessage));
  });
  channel.on("broadcast", { event: "verdict" }, (p) => {
    verdictHandlers.forEach((h) => h(p.payload as SayItVerdictMessage));
  });
  channel.on("broadcast", { event: "done" }, (p) => {
    doneHandlers.forEach((h) => h(p.payload as SayItDoneMessage));
  });
  channel.on("broadcast", { event: "cancel" }, (p) => {
    cancelHandlers.forEach((h) => h(p.payload as SayItCancelMessage));
  });

  let subscribed = false;
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      subscribed = true;
      resolveReady();
    }
  });

  // Waits (briefly) for the channel to finish subscribing, then sends.
  // Throws if it never connects — the old behaviour was to silently drop
  // the message, which left the speaker playing a round their partner
  // never saw.
  async function send(event: string, payload: Record<string, unknown>) {
    if (!subscribed) {
      await Promise.race([ready, new Promise<void>((r) => setTimeout(r, 3000))]);
    }
    if (!subscribed) throw new Error("Not connected to your partner yet. Try again in a moment.");
    await channel.send({ type: "broadcast", event, payload: { type: event, ...payload } });
  }

  function on<T>(set: Set<(m: T) => void>) {
    return (handler: (m: T) => void) => {
      set.add(handler);
      return () => set.delete(handler);
    };
  }

  return {
    sendStart: (msg) => send("start", msg),
    sendVerdict: (msg) => send("verdict", msg),
    sendDone: (msg) => send("done", msg),
    sendCancel: (msg) => send("cancel", msg),
    onStart: on(startHandlers),
    onVerdict: on(verdictHandlers),
    onDone: on(doneHandlers),
    onCancel: on(cancelHandlers),
    async leave() {
      startHandlers.clear();
      verdictHandlers.clear();
      doneHandlers.clear();
      cancelHandlers.clear();
      await supabaseBrowser.removeChannel(channel);
    },
  };
}
