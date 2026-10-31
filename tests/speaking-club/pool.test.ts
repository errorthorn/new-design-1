import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunk, chunkIds, installBrowserStubs, installFakeWorker, mockSubmitEndpoint, sessionMeta, sleep, waitFor } from "./helpers";
import { ChunkTranscriber } from "@/lib/speaking-club/transcription/chunk-transcriber";
import { HelperPool, type HelperRunner } from "@/lib/speaking-club/transcription/helper-pool";
import { desiredHelpers, totalWorkerCap } from "@/lib/speaking-club/transcription/pool-policy";
import { processSession } from "@/lib/speaking-club/post-call/engine";
import { saveSession } from "@/lib/speaking-club/storage/segment-store";

beforeEach(() => installBrowserStubs());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const raw = (n: number, secs = 20) =>
  Array.from({ length: n }, (_, i) => {
    const a = new Int16Array(secs * 16000).fill(300);
    a[0] = i;
    return a;
  });

describe("pool policy", () => {
  it("by default: the primary plus two helpers, never more", async () => {
    const { whisperPoolMax } = await import("@/lib/speaking-club/config");
    expect(whisperPoolMax()).toBe(3);
    const big = { phase: "after" as const, studentSpeaking: false, waitingChunks: 40, cores: 16, memoryGB: 16, maxTotal: whisperPoolMax() };
    expect(desiredHelpers(big)).toBe(2);
    // a 4-core / 4 GB phone during a call keeps 2 cores for the call: primary + 1 helper
    expect(desiredHelpers({ ...big, phase: "live", cores: 4, memoryGB: 4 })).toBe(1);
  });

  it("keeps the call's CPU free while the student talks, and shares a backlog when silent", () => {
    const base = { phase: "live" as const, waitingChunks: 6, cores: 8, memoryGB: 8, maxTotal: 5 };
    expect(desiredHelpers({ ...base, studentSpeaking: true })).toBe(0);
    expect(desiredHelpers({ ...base, studentSpeaking: false })).toBe(4); // 5 copies in total
    expect(desiredHelpers({ ...base, studentSpeaking: false, waitingChunks: 1 })).toBe(0); // the primary takes that one
    expect(desiredHelpers({ ...base, studentSpeaking: false, waitingChunks: 3 })).toBe(2);
  });

  it("is careful on small devices", () => {
    expect(totalWorkerCap({ phase: "live", cores: 4, memoryGB: 4, maxTotal: 5 })).toBe(2); // 2 cores left for the call
    expect(totalWorkerCap({ phase: "live", cores: 2, memoryGB: 8, maxTotal: 5 })).toBe(1);
    expect(totalWorkerCap({ phase: "after", cores: 4, memoryGB: 2, maxTotal: 5 })).toBe(2); // limited by RAM
    expect(totalWorkerCap({ phase: "after", cores: 8, memoryGB: 1, maxTotal: 5 })).toBe(1);
    expect(totalWorkerCap({ phase: "after", cores: 16, memoryGB: 16, maxTotal: 3 })).toBe(3);
    expect(totalWorkerCap({ phase: "after" , maxTotal: 5 })).toBe(2); // unknown hardware: stay modest
  });
});

/** A stand-in model copy with a controllable speed. */
function runner(opts: { ms?: number; fail?: boolean } = {}) {
  const r = {
    loads: 0,
    disposed: false,
    done: [] as number[],
    async load() {
      r.loads++;
    },
    async transcribeExternal(audio: Int16Array) {
      await sleep(opts.ms ?? 5);
      if (opts.fail) return null;
      const marker = audio[0];
      r.done.push(marker);
      return `c${marker} words`;
    },
    dispose() {
      r.disposed = true;
    },
  };
  return r satisfies HelperRunner & Record<string, unknown>;
}

function fakePrimary(n: number) {
  const queue = Array.from({ length: n }, (_, i) => chunk(i, 2));
  const texts = new Map<number, string>();
  return {
    texts,
    queue,
    takeNext: () => queue.shift() ?? null,
    requeue: (j: (typeof queue)[number]) => void queue.unshift(j),
    get queueLength() {
      return queue.length;
    },
    recordExternal: (j: { pos: number }, t: string) => void texts.set(j.pos, t),
  };
}

describe("HelperPool", () => {
  it("helpers take chunks from the shared queue: none twice, none lost, text under the right position", async () => {
    const primary = fakePrimary(12);
    const runners: ReturnType<typeof runner>[] = [];
    const pool = new HelperPool(primary, { create: () => (runners.push(runner({ ms: 15 })), runners[runners.length - 1]), desired: () => 3, tickMs: 10 });
    pool.start();
    pool.kick();
    await waitFor(() => primary.texts.size === 12, "all chunks done");
    expect([...primary.texts.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    const all = runners.flatMap((r) => r.done);
    expect(all.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i)); // each exactly once
    expect(runners.length).toBe(3); // three copies worked in parallel
    await pool.finish();
    expect(runners.every((r) => r.disposed)).toBe(true);
  });

  it("does nothing while the policy says 0 (student talking), and starts when it allows", async () => {
    const primary = fakePrimary(6);
    let want = 0;
    const runners: ReturnType<typeof runner>[] = [];
    const pool = new HelperPool(primary, { create: () => (runners.push(runner()), runners[runners.length - 1]), desired: () => want, tickMs: 10 });
    pool.start();
    pool.kick();
    await sleep(60);
    expect(runners.length).toBe(0); // no copy was even created
    expect(primary.queue.length).toBe(6);
    want = 2;
    pool.kick();
    await waitFor(() => primary.texts.size === 6, "helpers worked once allowed");
    await pool.finish();
  });

  it("a helper that fails gives the chunk back, and the pool gives up after repeated failures", async () => {
    const primary = fakePrimary(4);
    const pool = new HelperPool(primary, { create: () => runner({ fail: true }), desired: () => 2, tickMs: 10, maxFailures: 2, pauseMs: 5 });
    pool.start();
    pool.kick();
    await sleep(120);
    expect(primary.queue.length).toBe(4); // every chunk is back in the queue for the primary
    expect(primary.texts.size).toBe(0);
    expect(pool.helped).toBe(0);
    await pool.finish();
  });

  it("a copy that cannot even load disables the helpers (never breaks the primary)", async () => {
    const primary = fakePrimary(4);
    const bad: HelperRunner = {
      load: async () => {
        throw new Error("out of memory");
      },
      transcribeExternal: async () => "x",
      dispose: () => {},
    };
    const pool = new HelperPool(primary, { create: () => bad, desired: () => 2, tickMs: 10 });
    pool.start();
    pool.kick();
    await sleep(50);
    expect(primary.queue.length).toBe(4);
    await pool.finish();
  });

  it("shuts down an idle copy to free its memory", async () => {
    const primary = fakePrimary(2);
    const r = runner({ ms: 1 });
    const pool = new HelperPool(primary, { create: () => r, desired: () => 1, tickMs: 10, idleMs: 30 });
    pool.start();
    pool.kick();
    await waitFor(() => primary.queue.length === 0 && r.done.length >= 1, "work done");
    await waitFor(() => r.disposed, "idle copy freed");
    await pool.finish();
  });
});

describe("live: primary + helpers on a real ChunkTranscriber", () => {
  it("while the student talks only the primary works; when silent the backlog is shared; order is kept", async () => {
    const w = installFakeWorker({ perChunkMs: 40 });
    const make = () => new ChunkTranscriber({ createWorker: () => new Worker("x"), modelId: "m" });
    const primary = make();
    let speaking = true;
    const pool = new HelperPool(primary, {
      create: make,
      desired: () => desiredHelpers({ phase: "live", studentSpeaking: speaking, waitingChunks: primary.queueLength, cores: 8, memoryGB: 8, maxTotal: 4 }),
      tickMs: 10,
    });
    primary.helperDrain = () => pool.finish();
    pool.start();
    primary.startLive();
    for (let i = 0; i < 8; i++) primary.enqueue(chunk(i)); // a backlog (the student spoke a lot)
    pool.kick();
    await sleep(100); // student still talking: only the primary may work
    expect(pool.helped).toBe(0);
    expect(w.created).toBe(1);

    speaking = false; // the partner talks now
    pool.kick();
    await waitFor(() => primary.texts.size === 8, "backlog finished");
    expect(pool.helped).toBeGreaterThan(0);
    expect(w.created).toBeGreaterThan(1);
    // The transcript is chronological, whichever copy finished a chunk first.
    const ordered = [...primary.texts.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join(" ");
    expect(chunkIds(ordered)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    await primary.stopLive();
  });

  it("when the call ends, stopLive waits for chunks the helpers hold: nothing is lost", async () => {
    installFakeWorker({ perChunkMs: 60 });
    const make = () => new ChunkTranscriber({ createWorker: () => new Worker("x"), modelId: "m" });
    const primary = make();
    const pool = new HelperPool(primary, {
      create: make,
      desired: () => 3,
      tickMs: 10,
    });
    primary.helperDrain = () => pool.finish();
    pool.start();
    primary.startLive();
    for (let i = 0; i < 9; i++) primary.enqueue(chunk(i));
    pool.kick();
    await sleep(90); // some chunks done, some in progress in helpers, some still waiting
    pool.stopTaking(); // what capture.stop() does
    await primary.stopLive(); // what the post-call engine does first
    const left = primary.takeQueue();
    const ids = new Set([...primary.texts.keys(), ...left.map((j) => j.pos)]);
    expect([...ids].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]); // every chunk is either done or still queued
    expect(primary.texts.size + left.length).toBe(9); // and none twice
  });
});

describe("post-call: parallel copies", () => {
  async function timed(poolOn: boolean) {
    vi.unstubAllEnvs();
    if (poolOn) vi.stubEnv("NEXT_PUBLIC_WHISPER_POOL", "true");
    installBrowserStubs({ hardwareConcurrency: 8, deviceMemory: 8 });
    const w = installFakeWorker({ perChunkMs: 80 });
    const api = mockSubmitEndpoint();
    const meta = sessionMeta(`par-${poolOn}`);
    await saveSession(meta);
    const t0 = Date.now();
    processSession(meta, raw(10, 20), { blocking: false });
    await waitFor(() => api.bodies.length === 1, "submit");
    return { ms: Date.now() - t0, created: w.created, ids: chunkIds(api.bodies[0].transcript) };
  }

  it("finishes the same call faster with copies in parallel, with the order intact", async () => {
    const one = await timed(false);
    const many = await timed(true);
    expect(one.created).toBe(1);
    expect(many.created).toBeGreaterThan(1);
    expect(many.ids).toEqual(Array.from({ length: 10 }, (_, i) => i)); // all 10, in conversation order
    expect(one.ids).toEqual(many.ids);
    expect(many.ms).toBeLessThan(one.ms * 0.7);
  });
});
