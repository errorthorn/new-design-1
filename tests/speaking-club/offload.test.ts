import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkIds, installBrowserStubs, installFakeWorker, sessionMeta, sleep, waitFor } from "./helpers";
import { adpcmDecode, adpcmEncode } from "@/lib/speaking-club/peer/adpcm";
import { encodeWav16k, parseWavInfo } from "@/lib/speaking-club/audio/wav";
import { PeerAsrHub, PeerAsrLink, packFrame, unpackFrame, type HelperHandler } from "@/lib/speaking-club/peer/peer-asr";
import { PeerOffloader } from "@/lib/speaking-club/peer/offloader";
import { clearAsrChannels, registerAsrChannel, type ChannelLike } from "@/lib/speaking-club/peer/channel-registry";
import { cloudTranscribe, resetCloudState } from "@/lib/speaking-club/transcription/cloud";
import { getPostCallState, processSession, subscribePostCall } from "@/lib/speaking-club/post-call/engine";
import { saveSegment, saveSession } from "@/lib/speaking-club/storage/segment-store";

beforeEach(() => {
  installBrowserStubs();
  resetCloudState();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearAsrChannels();
});

/** Speech-like test signal: a few harmonics under a syllable-rate envelope. */
function speech(seconds: number): Int16Array {
  const n = Math.round(seconds * 16000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / 16000;
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t);
    const v = Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 420 * t) + 0.25 * Math.sin(2 * Math.PI * 1300 * t);
    out[i] = Math.round(env * v * 9000);
  }
  return out;
}

describe("ADPCM", () => {
  it("compresses 4:1 and decodes back with high fidelity", () => {
    const pcm = speech(3);
    const block = adpcmEncode(pcm);
    expect(block.data.length).toBe(Math.ceil(pcm.length / 2));
    const back = adpcmDecode(block.data, pcm.length, block.predictor, block.stepIndex);
    let sig = 0;
    let err = 0;
    for (let i = 0; i < pcm.length; i++) {
      sig += pcm[i] * pcm[i];
      err += (pcm[i] - back[i]) ** 2;
    }
    const snrDb = 10 * Math.log10(sig / err);
    expect(snrDb).toBeGreaterThan(20);
  });

  it("handles odd lengths and empty input", () => {
    const pcm = speech(0.2).slice(0, 1601);
    const b = adpcmEncode(pcm);
    expect(adpcmDecode(b.data, pcm.length, b.predictor, b.stepIndex)).toHaveLength(1601);
    expect(adpcmEncode(new Int16Array(0)).data).toHaveLength(0);
  });
});

describe("WAV", () => {
  it("round-trips the header", () => {
    const wav = encodeWav16k(speech(2));
    const info = parseWavInfo(wav)!;
    expect(info.sampleRate).toBe(16000);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.durationSec).toBeCloseTo(2, 3);
  });
  it("rejects anything that is not a 16-bit PCM WAV", () => {
    expect(parseWavInfo(new Uint8Array(10))).toBeNull();
    expect(parseWavInfo(new Uint8Array(100).fill(7))).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/** Two RTCDataChannel stand-ins wired to each other. */
function channelPair() {
  class Fake implements ChannelLike {
    readyState = "open";
    bufferedAmount = 0;
    peer!: Fake;
    sent: (string | ArrayBuffer)[] = [];
    private ls = new Map<string, Set<(e: any) => void>>();
    send(data: string | ArrayBuffer) {
      this.sent.push(data);
      const to = this.peer;
      setTimeout(() => to.emit("message", { data }), 0);
    }
    addEventListener(t: string, l: (e: any) => void) {
      if (!this.ls.has(t)) this.ls.set(t, new Set());
      this.ls.get(t)!.add(l);
    }
    removeEventListener(t: string, l: (e: any) => void) {
      this.ls.get(t)?.delete(l);
    }
    emit(t: string, ev: any = {}) {
      this.ls.get(t)?.forEach((l) => l(ev));
    }
    close() {
      this.readyState = "closed";
      this.emit("close");
      this.peer.readyState = "closed";
      this.peer.emit("close");
    }
  }
  const a = new Fake();
  const b = new Fake();
  a.peer = b;
  b.peer = a;
  return { a, b };
}

const helperOf = (transcribe: (a: Int16Array) => Promise<string | null>, accept = () => true): HelperHandler => ({
  canAccept: accept,
  transcribe,
});

describe("PeerAsrLink", () => {
  it("frames round-trip", () => {
    const f = unpackFrame(packFrame(70000, 3, new Uint8Array([1, 2, 3])))!;
    expect(f.id).toBe(70000);
    expect(f.seq).toBe(3);
    expect([...f.payload]).toEqual([1, 2, 3]);
  });

  it("a weak device gets its chunk transcribed by a strong partner (multi-frame, ADPCM)", async () => {
    const { a, b } = channelPair();
    const received: Int16Array[] = [];
    const requester = new PeerAsrLink(a, () => null);
    const helper = new PeerAsrLink(b, () => helperOf(async (audio) => (received.push(audio), "hello from helper")));
    await waitFor(() => requester.peerIsHelper, "hello");
    expect(helper.peerIsHelper).toBe(false); // the weak side never offered help

    const pcm = speech(25); // ~200 KB compressed = several frames
    const text = await requester.request(pcm);
    expect(text).toBe("hello from helper");
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(pcm.length);
    const frames = a.sent.filter((m) => typeof m !== "string");
    expect(frames.length).toBeGreaterThan(5);
    requester.dispose();
    helper.dispose();
  });

  it("falls back (null) when the helper is busy or fails", async () => {
    const { a, b } = channelPair();
    const requester = new PeerAsrLink(a, () => null);
    let busy = true;
    const helper = new PeerAsrLink(b, () => helperOf(async () => "x", () => !busy));
    await waitFor(() => requester.peerIsHelper, "hello");
    expect(await requester.request(speech(2))).toBeNull(); // busy
    busy = false;
    expect(await requester.request(speech(2))).toBe("x");
    requester.dispose();
    helper.dispose();
    expect(await requester.request(speech(2))).toBeNull(); // disposed
  });

  it("only one chunk at a time, and a null from the model is a failure", async () => {
    const { a, b } = channelPair();
    const requester = new PeerAsrLink(a, () => null);
    const helper = new PeerAsrLink(b, () => helperOf(async () => null));
    await waitFor(() => requester.peerIsHelper, "hello");
    const first = requester.request(speech(1));
    expect(requester.canRequest()).toBe(false); // busy right away
    expect(await requester.request(speech(1))).toBeNull(); // refused locally while busy
    expect(await first).toBeNull(); // helper said "failed"
    expect(requester.canRequest()).toBe(true);
    requester.dispose();
    helper.dispose();
  });

  it("gives up after the timeout and when the channel closes", async () => {
    vi.useFakeTimers();
    const { a, b } = channelPair();
    const requester = new PeerAsrLink(a, () => null);
    const helper = new PeerAsrLink(b, () => helperOf(() => new Promise<string | null>(() => {}))); // never answers
    await vi.advanceTimersByTimeAsync(10);
    expect(requester.peerIsHelper).toBe(true);
    const p = requester.request(speech(1));
    await vi.advanceTimersByTimeAsync(80_000);
    expect(await p).toBeNull();

    const p2 = requester.request(speech(1));
    await vi.advanceTimersByTimeAsync(10);
    a.close();
    expect(await p2).toBeNull();
    expect(requester.peerIsHelper).toBe(false);
    requester.dispose();
    helper.dispose();
  });

  it("ignores a nonsense request (bad sizes)", async () => {
    const { a, b } = channelPair();
    const helper = new PeerAsrLink(b, () => helperOf(async () => "x"));
    a.send(JSON.stringify({ t: "req", id: 1, n: 99_999_999, f: 5, p: 0, s: 0 }));
    await sleep(10);
    const reply = a.peer.sent.map((m) => (typeof m === "string" ? JSON.parse(m) : null)).find((m) => m?.t === "res");
    expect(reply?.ok).toBe(false);
    helper.dispose();
  });
});

describe("PeerAsrHub + PeerOffloader", () => {
  it("offloads chunks to a helper partner and remembers which utterances are covered", async () => {
    const { a, b } = channelPair();
    const helperLink = new PeerAsrLink(b, () => helperOf(async () => "partner text here"));
    const hub = new PeerAsrHub();
    hub.start();
    registerAsrChannel("p1", a);
    await waitFor(() => hub.hasFreeHelper(), "helper available");

    const off = new PeerOffloader(hub);
    off.submit({ pos: 0, audio: speech(3), members: [0, 1] });
    off.submit({ pos: 2, audio: speech(3), members: [2] });
    await waitFor(() => off.covered.size === 3, "both chunks answered");
    const { texts, covered } = off.stop();
    expect([...covered].sort()).toEqual([0, 1, 2]);
    expect(texts.get(0)).toBe("partner text here");
    expect(texts.get(2)).toBe("partner text here");
    hub.dispose();
    helperLink.dispose();
  });

  it("leaves chunks uncovered when there is no helper, and stops asking after repeated failures", async () => {
    // Like the real hub: a helper is "free" only while no request is in flight.
    let inFlight = 0;
    const hub = {
      hasFreeHelper: () => inFlight === 0,
      request: vi.fn(async () => {
        inFlight++;
        await sleep(1);
        inFlight--;
        return null;
      }),
      onAvailability: () => () => {},
    };
    const off = new PeerOffloader(hub);
    for (let i = 0; i < 6; i++) off.submit({ pos: i, audio: speech(1), members: [i] });
    await sleep(20);
    expect(off.active).toBe(false);
    expect(hub.request.mock.calls.length).toBeLessThanOrEqual(3);
    expect(off.stop().covered.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cloud fallback through the post-call engine
// ---------------------------------------------------------------------------

/** fetch mock for both endpoints; the cloud answer encodes the chunk marker (first sample) like the fake worker does. */
function mockEndpoints(cloud: { status: number } = { status: 200 }) {
  const submitted: { transcript: string; shiftId: string }[] = [];
  const cloudCalls: { shift: string | null; marker: number }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: any; headers?: Record<string, string> }) => {
    if (String(url).includes("transcribe-chunk")) {
      const bytes = new Uint8Array(init.body as ArrayBuffer);
      const marker = new DataView(bytes.buffer, bytes.byteOffset).getInt16(44, true);
      cloudCalls.push({ shift: init.headers?.["x-shift-id"] ?? null, marker });
      return {
        status: cloud.status,
        ok: cloud.status < 300,
        json: async () => ({ ok: cloud.status < 300, text: `c${marker} some words here` }),
      };
    }
    submitted.push(JSON.parse(init.body));
    return { status: 200, ok: true, json: async () => ({ ok: true }) };
  });
  return { submitted, cloudCalls, setCloud: (s: number) => (cloud.status = s) };
}

const raw = (n: number, secs = 1) =>
  Array.from({ length: n }, (_, i) => {
    const a = new Int16Array(secs * 16000).fill(300);
    a[0] = i;
    return a;
  });

describe("cloud fallback", () => {
  it("cloudTranscribe is off unless enabled", async () => {
    const api = mockEndpoints();
    expect(await cloudTranscribe("s", speech(2))).toBeNull();
    expect(api.cloudCalls).toHaveLength(0);
  });

  it("a device without live transcription gets the whole call from the cloud — the model is never loaded", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_TRANSCRIBE", "true");
    const w = installFakeWorker();
    const api = mockEndpoints();
    const meta = sessionMeta("cloud-all");
    await saveSession(meta);

    const blocking: boolean[] = [];
    const un = subscribePostCall(() => blocking.push(getPostCallState().blocking));
    processSession(meta, raw(10, 20), { blocking: true });
    await waitFor(() => api.submitted.length === 1, "submit");
    un();

    expect(chunkIds(api.submitted[0].transcript)).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(api.cloudCalls.every((c) => c.shift === "shift-1")).toBe(true);
    expect(w.created).toBe(0); // no model download / load at all
    expect(blocking).toContain(true); // cloud is quick, so the result is waited for
  });

  it("chunks the cloud cannot do are transcribed on the device, in order", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_TRANSCRIBE", "true");
    const w = installFakeWorker({ perChunkMs: 5 });
    const api = mockEndpoints({ status: 502 }); // cloud down
    const meta = sessionMeta("cloud-down");
    await saveSession(meta);
    processSession(meta, raw(6, 20), { blocking: true });
    await waitFor(() => api.submitted.length === 1, "submit");
    expect(chunkIds(api.submitted[0].transcript)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(w.created).toBe(1);
  });

  it("stops asking the server after it says 'not configured' (503), and uses the device", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_TRANSCRIBE", "true");
    installFakeWorker({ perChunkMs: 5 });
    const api = mockEndpoints({ status: 503 });
    const meta = sessionMeta("cloud-503");
    await saveSession(meta);
    processSession(meta, raw(8, 20), { blocking: true });
    await waitFor(() => api.submitted.length === 1, "submit");
    expect(chunkIds(api.submitted[0].transcript)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(api.cloudCalls.length).toBeLessThanOrEqual(3); // the first few were already in flight; then it stopped
  });

  it("a device that cannot run the model at all still gets its feedback from the cloud", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUD_TRANSCRIBE", "true");
    vi.unstubAllGlobals();
    installBrowserStubs({ deviceMemory: 0.5 }); // below the model's minimum RAM
    const w = installFakeWorker();
    const api = mockEndpoints();
    const meta = sessionMeta("tiny-device");
    await saveSession(meta);
    for (const [i, s] of raw(3, 20).entries()) await saveSegment("tiny-device", i, s);
    processSession(meta, raw(3, 20), { blocking: true });
    await waitFor(() => api.submitted.length === 1, "submit");
    expect(chunkIds(api.submitted[0].transcript)).toEqual([0, 1, 2]);
    expect(w.created).toBe(0);
  });
});

describe("partner results in the post-call engine", () => {
  it("text the partner produced is merged in order and its utterances are not transcribed again", async () => {
    installFakeWorker({ perChunkMs: 5 });
    const api = mockEndpoints();
    const meta = sessionMeta("partner-mix");
    await saveSession(meta);
    const all = raw(8, 5); // utterances 0..7 (5 s each)
    // The partner did utterances 2 and 3 as one chunk (position 2) and 6 (position 6).
    const external = {
      texts: new Map([
        [2, "partner two three"],
        [6, "partner six"],
      ]),
      covered: new Set([2, 3, 6]),
    };
    const keep = [0, 1, 4, 5, 7];
    processSession(meta, keep.map((i) => all[i]), {
      blocking: true,
      external,
      positions: keep,
    });
    await waitFor(() => api.submitted.length === 1, "submit");
    const t = api.submitted[0].transcript;
    // local chunks (c<marker>) and partner texts, chronological by first utterance
    expect(t.indexOf("c0")).toBeLessThan(t.indexOf("partner two three"));
    expect(t.indexOf("partner two three")).toBeLessThan(t.indexOf("c4"));
    expect(t.indexOf("c4")).toBeLessThan(t.indexOf("partner six"));
    expect(t.indexOf("partner six")).toBeLessThan(t.indexOf("c7"));
    // 0+1 merge (marker 0), 4+5 merge (marker 4), 7 alone. 0 and 4 must NOT merge across the gap the partner covered.
    expect(chunkIds(t)).toEqual([0, 4, 7]);
  });

  it("submits the partner's text even when the device itself cannot transcribe", async () => {
    vi.unstubAllGlobals();
    installBrowserStubs({ deviceMemory: 0.5 });
    installFakeWorker();
    const api = mockEndpoints();
    const meta = sessionMeta("partner-only");
    await saveSession(meta);
    processSession(meta, [], {
      blocking: true,
      external: { texts: new Map([[0, "everything the partner heard"]]), covered: new Set([0, 1]) },
    });
    await waitFor(() => api.submitted.length === 1, "submit");
    expect(api.submitted[0].transcript).toContain("everything the partner heard");
  });
});

describe("privacy defaults: speech stays on the student's own device", () => {
  it("with no flag set nothing but the finished TEXT is sent anywhere", async () => {
    const { cloudTranscribeEnabled, peerOffloadEnabled } = await import("@/lib/speaking-club/config");
    expect(cloudTranscribeEnabled()).toBe(false);
    expect(peerOffloadEnabled()).toBe(false);

    installFakeWorker({ perChunkMs: 5 });
    const urls: string[] = [];
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: unknown }) => {
      urls.push(String(url));
      bodies.push(init.body);
      return { status: 200, ok: true, json: async () => ({ ok: true }) };
    });
    const meta = sessionMeta("private-by-default");
    await saveSession(meta);
    processSession(meta, raw(6, 20), { blocking: true });
    await waitFor(() => urls.length === 1, "submit");
    await sleep(50);

    expect(urls).toEqual(["/api/speaking-club/submit-transcript"]); // no transcribe-chunk, nothing else
    expect(typeof bodies[0]).toBe("string"); // JSON text, not audio bytes
    expect(JSON.parse(bodies[0] as string).transcript).toMatch(/c0/);
  });
});
