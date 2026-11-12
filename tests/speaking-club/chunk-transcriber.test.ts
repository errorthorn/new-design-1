import { afterEach, describe, expect, it, vi } from "vitest";
import { chunk, installBrowserStubs, installFakeWorker, sleep } from "./helpers";
import { ChunkTranscriber } from "@/lib/speaking-club/transcription/chunk-transcriber";

afterEach(() => vi.unstubAllGlobals());

const make = () => new ChunkTranscriber({ createWorker: () => new Worker("x"), modelId: "test-model" });

describe("ChunkTranscriber — live transcription during the call", () => {
  it("keeps up with a normal device: everything is transcribed by the time the call ends", async () => {
    installBrowserStubs();
    installFakeWorker({ perChunkMs: 5 });
    const t = make();
    t.startLive();
    for (let i = 0; i < 10; i++) {
      t.enqueue(chunk(i));
      await sleep(25);
    }
    await t.stopLive();
    expect(t.takeQueue()).toHaveLength(0);
    expect([...t.texts.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(t.throttled).toBe(false);
  });

  it("only loads the model when the first chunk arrives (no CPU spike at call start)", async () => {
    installBrowserStubs();
    const w = installFakeWorker();
    const t = make();
    t.startLive();
    await sleep(30);
    expect(w.created).toBe(0);
    t.enqueue(chunk(0));
    await sleep(50);
    expect(w.created).toBe(1);
  });

  it("on a slow device it throttles instead of stopping, and keeps making progress", async () => {
    installBrowserStubs();
    installFakeWorker({ perChunkMs: 60 });
    const t = make();
    t.startLive();
    // a new 20 s chunk of speech every 50 ms, but each one takes 60 ms to transcribe
    for (let i = 0; i < 60; i++) {
      t.enqueue(chunk(i));
      await sleep(50);
    }
    expect(t.throttled).toBe(true);
    expect(t.chunksDone).toBeGreaterThan(15); // a "give up" design would have stopped near 8
    expect(t.chunksDone).toBeLessThan(60);

    const started = Date.now();
    await t.stopLive();
    expect(Date.now() - started).toBeLessThan(500); // never makes the student wait out a throttle rest
    expect(t.takeQueue().length).toBeGreaterThan(0); // the rest is left for the post-call step
  });

  it("leaves everything queued when the model cannot load", async () => {
    installBrowserStubs();
    installFakeWorker({ failLoad: true });
    const t = make();
    t.startLive();
    for (let i = 0; i < 3; i++) t.enqueue(chunk(i));
    await sleep(80);
    expect(t.isDead).toBe(true);
    expect(t.texts.size).toBe(0);
    expect(t.takeQueue()).toHaveLength(3);
  });

  it("dispose() terminates the worker", async () => {
    installBrowserStubs();
    const w = installFakeWorker();
    const t = make();
    await t.load();
    t.dispose();
    expect(w.terminated).toBe(1);
  });
});
