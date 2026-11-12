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
import { isReactionEmoji, type ReactionEmoji } from "@/lib/vocab-battle/rules";

export type ProgressMessage = {
  type: "progress";
  index: number; // current question index, 0-based
  score: number;
};

export type LiveMatchChannel = {
  sendProgress: (msg: Omit<ProgressMessage, "type">) => Promise<void>;
  onOpponentProgress: (handler: (msg: ProgressMessage) => void) => () => void;
  /** Quick emoji reaction to the opponent (👏 🔥 😅 😎). Cosmetic, like progress. */
  sendReaction: (emoji: ReactionEmoji) => Promise<void>;
  onReaction: (handler: (emoji: ReactionEmoji) => void) => () => void;
  /**
   * "Something changed on the server, go fetch it" nudge — sent when the
   * opponent joins ("joined") or when the second score lands ("finished").
   * Replaces fast HTTP polling: one tiny broadcast instead of a request
   * every 2 seconds per player. The server stays the source of truth; if
   * a nudge is missed, a slow fallback poll in the panel still catches up.
   */
  sendState: (state: "joined" | "finished") => Promise<void>;
  onState: (handler: (state: "joined" | "finished") => void) => () => void;
  leave: () => Promise<void>;
};

export function joinLiveMatchChannel(matchId: number): LiveMatchChannel {
  const channel: RealtimeChannel = supabaseBrowser.channel(`vocab-battle-match-${matchId}`, {
    config: { broadcast: { self: false } },
  });

  const handlers = new Set<(msg: ProgressMessage) => void>();
  const reactionHandlers = new Set<(emoji: ReactionEmoji) => void>();
  const stateHandlers = new Set<(state: "joined" | "finished") => void>();
  let pendingState: "joined" | "finished" | null = null;

  channel.on("broadcast", { event: "state" }, (payload) => {
    const state = (payload.payload as { state?: unknown } | null)?.state;
    if (state === "joined" || state === "finished") stateHandlers.forEach((h) => h(state));
  });

  channel.on("broadcast", { event: "progress" }, (payload) => {
    const msg = payload.payload as ProgressMessage;
    handlers.forEach((h) => h(msg));
  });

  channel.on("broadcast", { event: "reaction" }, (payload) => {
    // Only whitelisted emoji get through, so a spoofed message can't put
    // arbitrary text on the other player's screen.
    const emoji = (payload.payload as { emoji?: unknown } | null)?.emoji;
    if (isReactionEmoji(emoji)) reactionHandlers.forEach((h) => h(emoji));
  });

  let subscribed = false;
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      subscribed = true;
      // A state ping requested before the socket was ready goes out now.
      if (pendingState) {
        void channel.send({ type: "broadcast", event: "state", payload: { state: pendingState } });
        pendingState = null;
      }
    }
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
    async sendState(state) {
      if (!subscribed) {
        pendingState = state;
        return;
      }
      await channel.send({ type: "broadcast", event: "state", payload: { state } });
    },
    onState(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    },
    async sendReaction(emoji) {
      if (!subscribed) return;
      await channel.send({ type: "broadcast", event: "reaction", payload: { emoji } });
    },
    onReaction(handler) {
      reactionHandlers.add(handler);
      return () => reactionHandlers.delete(handler);
    },
    async leave() {
      handlers.clear();
      reactionHandlers.clear();
      stateHandlers.clear();
      await supabaseBrowser.removeChannel(channel);
    },
  };
}
