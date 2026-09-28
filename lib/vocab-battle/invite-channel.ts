"use client";

// lib/vocab-battle/invite-channel.ts
//
// Lets one person in a shared "context" (e.g. a Speaking Club call)
// invite whoever else is there to a Vocab Battle, without either side
// typing a room code by hand — the inviter creates an invite-by-code
// match (POST /api/vocab-battle/live/create) as normal, then broadcasts
// its roomCode here instead of reading it aloud. Same Supabase Realtime
// broadcast approach as lib/vocab-battle/live-channel.ts and
// lib/webrtc/signaling-channel.ts — a channel of its own, deliberately
// NOT reusing the Speaking Club WebRTC signaling channel object, so a
// bug here can never affect call signaling.
//
// Purely a convenience layer for exchanging a room code: the actual
// join is still the real POST /api/vocab-battle/live/join call, with
// its own server-side race guard (first to join a still-"waiting" room
// wins) — so if more than 2 people share a context, whoever clicks
// Join first gets paired; everyone else's join attempt gets the normal
// "already started" error.

import { supabaseBrowser } from "@/lib/supabase-browser";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type BattleInviteMessage = {
  type: "invite";
  matchId: number;
  roomCode: string;
  fromName: string;
  fromUserId: string;
};

export type BattleInviteChannel = {
  sendInvite: (msg: Omit<BattleInviteMessage, "type">) => Promise<void>;
  onInvite: (handler: (msg: BattleInviteMessage) => void) => () => void;
  leave: () => Promise<void>;
};

export function joinBattleInviteChannel(contextKey: string): BattleInviteChannel {
  const channel: RealtimeChannel = supabaseBrowser.channel(`vocab-battle-invite-${contextKey}`, {
    config: { broadcast: { self: false } },
  });

  const handlers = new Set<(msg: BattleInviteMessage) => void>();

  channel.on("broadcast", { event: "invite" }, (payload) => {
    handlers.forEach((h) => h(payload.payload as BattleInviteMessage));
  });

  let subscribed = false;
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") subscribed = true;
  });

  return {
    async sendInvite(msg) {
      if (!subscribed) return;
      await channel.send({ type: "broadcast", event: "invite", payload: { type: "invite", ...msg } });
    },
    onInvite(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    async leave() {
      handlers.clear();
      await supabaseBrowser.removeChannel(channel);
    },
  };
}
