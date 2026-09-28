"use client";

// lib/speaking-club/words-channel.ts
//
// A tiny "the shared word list changed" ping between the two people in a
// Speaking Club room, so a word one person notes (or deletes) shows up on
// the other's panel within a moment instead of waiting for a poll. The ping
// carries no data — the receiver just re-fetches the list from the server,
// which stays the single source of truth (and applies the visibility
// rules). Same Supabase Realtime broadcast approach as cue-card-channel.ts,
// on a channel of its own so it can never interfere with call signaling.

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type WordsChannel = {
  sendChanged: () => Promise<void>;
  onChanged: (handler: () => void) => () => void;
  leave: () => Promise<void>;
};

export function joinWordsChannel(roomCode: string): WordsChannel {
  const channel: RealtimeChannel = supabaseBrowser.channel(`speaking-club-words-${roomCode}`, {
    config: { broadcast: { self: false } },
  });

  const handlers = new Set<() => void>();
  channel.on("broadcast", { event: "words-changed" }, () => {
    handlers.forEach((h) => h());
  });

  let subscribed = false;
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") subscribed = true;
  });

  return {
    async sendChanged() {
      if (!subscribed) return;
      await channel.send({ type: "broadcast", event: "words-changed", payload: {} });
    },
    onChanged(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async leave() {
      handlers.clear();
      await supabaseBrowser.removeChannel(channel);
    },
  };
}
