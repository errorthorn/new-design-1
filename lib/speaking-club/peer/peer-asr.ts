// lib/speaking-club/peer/peer-asr.ts
//
// Partner offload: a WEAK device sends chunks of its own speech, compressed, to the
// partner it is already in a call with; if the partner's device is STRONG (it
// transcribes live), it transcribes the chunk and sends the text back. The audio
// only ever reaches the one person who is already hearing it live; no server.
//
// Wire format on one negotiated RTCDataChannel ("lc-asr"):
//   text  {t:"hello", v:1, helper:boolean}       "I can (not) transcribe for you"
//   text  {t:"req", id, n, f, p, s}              n samples, f frames follow, ADPCM state p/s
//   bin   [1][id u32][seq u16][payload…]         one of the f frames of request `id`
//   text  {t:"res", id, ok, text?, busy?}        the answer (or "not now" with busy)
//   text  {t:"cancel", id}                       the requester gave up
// Everything is best-effort: any failure just means "no text from the partner", and
// the requester then transcribes that chunk itself (locally or via the cloud).
import { PEER } from "@/lib/speaking-club/config";
import { adpcmDecode, adpcmEncode } from "@/lib/speaking-club/peer/adpcm";
import { subscribeAsrChannels, type ChannelLike } from "@/lib/speaking-club/peer/channel-registry";

export type HelperHandler = {
  /** False when the helper is busy with its own speech, or its model is not loaded yet. */
  canAccept(): boolean;
  transcribe(audio: Int16Array): Promise<string | null>;
};

type Control =
  | { t: "hello"; v: 1; helper: boolean }
  | { t: "req"; id: number; n: number; f: number; p: number; s: number }
  | { t: "res"; id: number; ok: boolean; text?: string; busy?: boolean }
  | { t: "cancel"; id: number };

const MAX_SAMPLES = 30 * 16000;
const FRAME_HEADER = 7;

export function packFrame(id: number, seq: number, payload: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(FRAME_HEADER + payload.length);
  const v = new DataView(out.buffer);
  v.setUint8(0, 1);
  v.setUint32(1, id >>> 0, true);
  v.setUint16(5, seq & 0xffff, true);
  out.set(payload, FRAME_HEADER);
  return out.buffer;
}

export function unpackFrame(buf: ArrayBuffer): { id: number; seq: number; payload: Uint8Array } | null {
  if (buf.byteLength < FRAME_HEADER) return null;
  const v = new DataView(buf);
  if (v.getUint8(0) !== 1) return null;
  return { id: v.getUint32(1, true), seq: v.getUint16(5, true), payload: new Uint8Array(buf, FRAME_HEADER) };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Outgoing = { resolve: (text: string | null) => void; timer: ReturnType<typeof setTimeout> };
type Incoming = { n: number; f: number; p: number; s: number; frames: Map<number, Uint8Array>; startedAt: number };

export class PeerAsrLink {
  /** What the partner last told us: it can transcribe for us. */
  peerIsHelper = false;
  onChange: (() => void) | null = null;

  private readonly ch: ChannelLike;
  private readonly getHelper: () => HelperHandler | null;
  private out = new Map<number, Outgoing>();
  private incoming = new Map<number, Incoming>();
  private helperChain: Promise<void> = Promise.resolve();
  private nextId = 1;
  private disposed = false;

  constructor(ch: ChannelLike, getHelper: () => HelperHandler | null) {
    this.ch = ch;
    this.getHelper = getHelper;
    ch.addEventListener("open", this.onOpen);
    ch.addEventListener("close", this.onClose);
    ch.addEventListener("message", this.onMessage);
    if (ch.readyState === "open") this.sendHello();
  }

  get busy(): boolean {
    return this.out.size > 0;
  }
  /** Can a new chunk be sent to this partner right now? */
  canRequest(): boolean {
    return !this.disposed && this.ch.readyState === "open" && this.peerIsHelper && !this.busy;
  }

  // ---- requester side ------------------------------------------------------

  /** Sends `audio` to the partner. Resolves with the text, or null (busy / failed / timed out). */
  request(audio: Int16Array): Promise<string | null> {
    if (!this.canRequest() || audio.length === 0 || audio.length > MAX_SAMPLES) return Promise.resolve(null);
    const id = this.nextId++;
    const block = adpcmEncode(audio);
    const frames = Math.ceil(block.data.length / PEER.frameBytes);
    return new Promise<string | null>((resolve) => {
      const finish = (text: string | null) => {
        const o = this.out.get(id);
        if (!o) return;
        clearTimeout(o.timer);
        this.out.delete(id);
        o.resolve(text);
        this.onChange?.();
      };
      const timer = setTimeout(() => {
        this.sendControl({ t: "cancel", id });
        finish(null);
      }, PEER.requestTimeoutMs);
      this.out.set(id, { resolve, timer });
      // The entry is registered synchronously, so busy is true from this very call on.
      this.sendControl({ t: "req", id, n: audio.length, f: frames, p: block.predictor, s: block.stepIndex });
      void this.sendFrames(id, block.data, frames).then((ok) => {
        if (!ok) finish(null);
      });
    });
  }

  private async sendFrames(id: number, data: Uint8Array, frames: number): Promise<boolean> {
    for (let seq = 0; seq < frames; seq++) {
      const waitStart = Date.now();
      while (this.ch.bufferedAmount > PEER.highWaterBytes) {
        if (this.disposed || Date.now() - waitStart > 20_000) return false;
        await sleep(20);
      }
      if (this.disposed || this.ch.readyState !== "open" || !this.out.has(id)) return false;
      try {
        this.ch.send(packFrame(id, seq, data.subarray(seq * PEER.frameBytes, (seq + 1) * PEER.frameBytes)));
      } catch {
        return false;
      }
    }
    return true;
  }

  // ---- helper side ---------------------------------------------------------

  private startServing(id: number, inc: Incoming) {
    this.incoming.delete(id);
    const helper = this.getHelper();
    if (!helper) {
      this.sendControl({ t: "res", id, ok: false, busy: true });
      return;
    }
    const parts: Uint8Array[] = [];
    for (let i = 0; i < inc.f; i++) {
      const p = inc.frames.get(i);
      if (!p) {
        this.sendControl({ t: "res", id, ok: false });
        return;
      }
      parts.push(p);
    }
    const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      bytes.set(p, at);
      at += p.length;
    }
    const audio = adpcmDecode(bytes, inc.n, inc.p, inc.s);
    // One chunk at a time, in arrival order.
    this.helperChain = this.helperChain.then(async () => {
      if (this.disposed) return;
      try {
        const text = await helper.transcribe(audio);
        this.sendControl(text === null ? { t: "res", id, ok: false } : { t: "res", id, ok: true, text });
      } catch {
        this.sendControl({ t: "res", id, ok: false });
      }
    });
  }

  // ---- messages ------------------------------------------------------------

  private onOpen = () => this.sendHello();

  private onClose = () => {
    this.failAll();
    this.peerIsHelper = false;
    this.onChange?.();
  };

  private onMessage = (ev: { data: unknown }) => {
    if (this.disposed) return;
    const d = ev.data;
    if (typeof d === "string") {
      let m: Control;
      try {
        m = JSON.parse(d) as Control;
      } catch {
        return;
      }
      this.onControl(m);
    } else if (d instanceof ArrayBuffer) {
      const f = unpackFrame(d);
      if (!f) return;
      const inc = this.incoming.get(f.id);
      if (!inc) return;
      inc.frames.set(f.seq, f.payload.slice());
      if (inc.frames.size >= inc.f) this.startServing(f.id, inc);
    }
  };

  private onControl(m: Control) {
    if (m.t === "hello") {
      if (this.peerIsHelper !== Boolean(m.helper)) {
        this.peerIsHelper = Boolean(m.helper);
        this.onChange?.();
      }
    } else if (m.t === "req") {
      const helper = this.getHelper();
      const sane =
        Number.isInteger(m.id) &&
        Number.isInteger(m.n) &&
        m.n > 0 &&
        m.n <= MAX_SAMPLES &&
        Number.isInteger(m.f) &&
        m.f > 0 &&
        m.f <= Math.ceil(MAX_SAMPLES / 2 / PEER.frameBytes) + 1;
      if (!sane) {
        if (Number.isInteger(m.id)) this.sendControl({ t: "res", id: m.id, ok: false });
        return;
      }
      if (!helper || !helper.canAccept()) {
        this.sendControl({ t: "res", id: m.id, ok: false, busy: true });
        return;
      }
      // Forget half-received requests that never finished.
      const now = Date.now();
      this.incoming.forEach((v, k) => {
        if (now - v.startedAt > 30_000) this.incoming.delete(k);
      });
      this.incoming.set(m.id, { n: m.n, f: m.f, p: m.p, s: m.s, frames: new Map(), startedAt: now });
    } else if (m.t === "res") {
      const o = this.out.get(m.id);
      if (!o) return;
      clearTimeout(o.timer);
      this.out.delete(m.id);
      o.resolve(m.ok && typeof m.text === "string" ? m.text : null);
      this.onChange?.();
    } else if (m.t === "cancel") {
      this.incoming.delete(m.id);
    }
  }

  // ---- housekeeping ----------------------------------------------------------

  /** Tells the partner whether this device can transcribe for it (call again when that changes). */
  sendHello() {
    this.sendControl({ t: "hello", v: 1, helper: Boolean(this.getHelper()) });
  }

  private sendControl(m: Control) {
    if (this.ch.readyState !== "open") return;
    try {
      this.ch.send(JSON.stringify(m));
    } catch {
      // the channel is going away; the timeouts clean up
    }
  }

  private failAll() {
    this.out.forEach((o) => {
      clearTimeout(o.timer);
      o.resolve(null);
    });
    this.out.clear();
    this.incoming.clear();
  }

  dispose() {
    if (this.disposed) return;
    // Tell the partner to stop sending us work, before we stop listening.
    this.disposed = true;
    if (this.ch.readyState === "open") {
      try {
        this.ch.send(JSON.stringify({ t: "hello", v: 1, helper: false } satisfies Control));
      } catch {
        // ignore
      }
    }
    this.ch.removeEventListener("open", this.onOpen);
    this.ch.removeEventListener("close", this.onClose);
    this.ch.removeEventListener("message", this.onMessage);
    this.failAll();
  }
}

// ---------------------------------------------------------------------------
// One hub per capture: follows the call's data channels and offers "send this chunk to a helper".
// ---------------------------------------------------------------------------

export class PeerAsrHub {
  private links = new Map<string, PeerAsrLink>();
  private helper: HelperHandler | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<() => void>();

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = subscribeAsrChannels((peerId, channel) => {
      this.links.get(peerId)?.dispose();
      this.links.delete(peerId);
      if (channel) {
        const link = new PeerAsrLink(channel, () => this.helper);
        link.onChange = () => this.listeners.forEach((l) => l());
        this.links.set(peerId, link);
      }
      this.listeners.forEach((l) => l());
    });
  }

  /** This device can (or, with null, can no longer) transcribe for its partner. */
  setHelper(h: HelperHandler | null): void {
    this.helper = h;
    this.links.forEach((l) => l.sendHello());
  }

  /** Called whenever a partner's availability changes or a request finishes. */
  onAvailability(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  hasFreeHelper(): boolean {
    for (const l of this.links.values()) if (l.canRequest()) return true;
    return false;
  }

  /** Sends one chunk to a free helper. Resolves null at once when there is none. */
  request(audio: Int16Array): Promise<string | null> {
    for (const l of this.links.values()) if (l.canRequest()) return l.request(audio);
    return Promise.resolve(null);
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.helper = null;
    this.links.forEach((l) => l.dispose());
    this.links.clear();
    this.listeners.clear();
  }
}
