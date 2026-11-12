// lib/speaking-club/peer/channel-registry.ts
//
// A tiny bridge between the call hook (which owns the RTCPeerConnections and creates
// one data channel per peer) and the speech-capture code (which wants to use it).
// Neither imports the other: the call hook registers channels here, the capture
// subscribes. A module-level registry, so there is exactly one per browser tab.

/** The part of RTCDataChannel the peer-offload code uses (also what the tests fake). */
export interface ChannelLike {
  readonly readyState: string;
  readonly bufferedAmount: number;
  send(data: string | ArrayBuffer): void;
  addEventListener(type: "open" | "close" | "error" | "message", listener: (ev: any) => void): void;
  removeEventListener(type: "open" | "close" | "error" | "message", listener: (ev: any) => void): void;
}

type Listener = (peerId: string, channel: ChannelLike | null) => void;

const channels = new Map<string, ChannelLike>();
const listeners = new Set<Listener>();

export function registerAsrChannel(peerId: string, channel: ChannelLike): void {
  channels.set(peerId, channel);
  listeners.forEach((l) => l(peerId, channel));
}

export function unregisterAsrChannel(peerId: string): void {
  if (!channels.delete(peerId)) return;
  listeners.forEach((l) => l(peerId, null));
}

export function clearAsrChannels(): void {
  for (const id of Array.from(channels.keys())) unregisterAsrChannel(id);
}

/** Calls `cb` for every channel that already exists, then for every later change (channel = null: removed). */
export function subscribeAsrChannels(cb: Listener): () => void {
  listeners.add(cb);
  channels.forEach((ch, id) => cb(id, ch));
  return () => {
    listeners.delete(cb);
  };
}
