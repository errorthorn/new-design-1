import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunk, chunkIds, installBrowserStubs, installFakeWorker, mockSubmitEndpoint, sessionMeta, sleep, waitFor } from "./helpers";
import { ChunkTranscriber } from "@/lib/speaking-club/transcription/chunk-transcriber";
import { markWhisperReady } from "@/lib/speaking-club/transcription/model";
import {
  getPostCallState,
  processSession,
  resumePendingSessions,
  subscribePostCall,
} from "@/lib/speaking-club/post-call/engine";
import { listSessions, loadSegments, saveSegment, saveSession } from "@/lib/speaking-club/storage/segment-store";

beforeEach(() => {
  installBrowserStubs();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Raw utterances as the capture collects them: segment i starts with the sample `i`. */
const raw = (n: number, secs = 1) =>
  Array.from({ length: n }, (_, i) => {
    const a = new Int16Array(secs * 16000).fill(300);
    a[0] = i;
    return a;
  });
const sessionIds = async () => (await listSessions()).map((s) => s.sessionId);
const idle = () => ["idle", "done", "error"].includes(getPostCallState().phase);

describe("post-call engine — device without live transcription", () => {
  it("transcribes the collected speech, submits ONLY text, and deletes the audio", async () => {
    installFakeWorker();
    const api = mockSubmitEndpoint();
    const meta = sessionMeta("plain", { priorTranscript: "earlier words" });
    await saveSession(meta);
    for (const [i, s] of raw(3).entries()) await saveSegment("plain", i, s);

    processSession(meta, raw(3));
    await waitFor(() => api.bodies.length === 1, "submit");

    expect(api.bodies[0].shiftId).toBe("shift-1");
    expect(api.bodies[0].transcript).toMatch(/^earlier words c0 some words here/);
    expect(await sessionIds()).not.toContain("plain"); // audio + session removed
    expect(await loadSegments("plain")).toHaveLength(0);
  });

  it("keeps the TEXT (not the audio) when the submit fails, and retries without a model on the next visit", async () => {
    const w = installFakeWorker();
    const api = mockSubmitEndpoint(500);
    const meta = sessionMeta("net-fail");
    await saveSession(meta);
    processSession(meta, raw(2));
    await waitFor(() => api.bodies.length === 1 && idle(), "failed submit");

    const left = (await listSessions()).find((s) => s.sessionId === "net-fail");
    expect(left?.attempts).toBe(1);
    expect(left?.priorTranscript).toContain("c0");
    expect(await loadSegments("net-fail")).toHaveLength(0);

    const workersBefore = w.created;
    api.setStatus(200);
    await resumePendingSessions();
    await waitFor(() => api.bodies.length === 2, "retry");
    expect(w.created).toBe(workersBefore); // text only: no model needed
    expect(await sessionIds()).not.toContain("net-fail");
  });

  it("keeps the audio for a later retry when the model cannot load, nothing is submitted", async () => {
    const w = installFakeWorker({ failLoad: true });
    const api = mockSubmitEndpoint();
    const meta = sessionMeta("no-model");
    await saveSession(meta);
    for (const [i, s] of raw(2).entries()) await saveSegment("no-model", i, s);

    processSession(meta, raw(2));
    await waitFor(() => idle() && w.created > 0, "model failure");
    await sleep(50);

    const left = (await listSessions()).find((s) => s.sessionId === "no-model");
    expect(left?.attempts).toBe(1);
    expect(await loadSegments("no-model")).toHaveLength(2);
    expect(api.bodies).toHaveLength(0);

    w.options.failLoad = false; // e.g. the network came back
    await resumePendingSessions();
    await waitFor(() => api.bodies.length === 1, "successful retry");
    expect(await sessionIds()).not.toContain("no-model");
  });

  it("drops a session the server will never accept (403)", async () => {
    installFakeWorker();
    const api = mockSubmitEndpoint(403);
    const meta = sessionMeta("rejected");
    await saveSession(meta);
    processSession(meta, raw(1));
    await waitFor(() => api.bodies.length === 1, "submit");
    await sleep(50);
    expect(await sessionIds()).not.toContain("rejected");
  });

  it("resumes an abandoned capture (closed tab) but not one that is still being captured", async () => {
    installFakeWorker();
    const api = mockSubmitEndpoint();
    await saveSession(sessionMeta("abandoned", { status: "capturing", updatedAt: Date.now() - 200_000 }));
    await saveSegment("abandoned", 0, raw(1)[0]);
    await saveSession(sessionMeta("fresh", { status: "capturing", updatedAt: Date.now() - 1_000 }));

    await resumePendingSessions();
    await waitFor(() => api.bodies.length === 1, "resume");
    expect(await sessionIds()).toContain("fresh");
    expect(await sessionIds()).not.toContain("abandoned");
  });

  it("finishes the WHOLE call in the background (no sampling, no wait screen) on a device without live transcription", async () => {
    installFakeWorker({ perChunkMs: 5 });
    const api = mockSubmitEndpoint();
    const meta = sessionMeta("weak-whole");
    await saveSession(meta);
    const blocking: boolean[] = [];
    const un = subscribePostCall(() => blocking.push(getPostCallState().blocking));

    processSession(meta, raw(12, 20), { blocking: true }); // even a call that has just ended
    await waitFor(() => api.bodies.length === 1, "submit");
    un();

    expect(chunkIds(api.bodies[0].transcript)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(blocking).not.toContain(true);
    expect(getPostCallState().sampled).toBe(false);
  });

  it("bounds the background work: a very long call is sampled evenly within the (configurable) budget", async () => {
    vi.stubEnv("NEXT_PUBLIC_WHISPER_BACKGROUND_MAX_SEC", "0.5");
    installFakeWorker({ perChunkMs: 100 });
    const api = mockSubmitEndpoint();
    const meta = sessionMeta("long");
    await saveSession(meta);

    const t0 = Date.now();
    processSession(meta, raw(12, 20), { blocking: true }); // 12 utterances of 20 s = 12 chunks
    await waitFor(() => api.bodies.length === 1, "submit");

    const ids = chunkIds(api.bodies[0].transcript);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    expect(ids.length).toBeLessThan(12);
    expect(ids[0]).toBe(0); // starts with the first chunk...
    expect(ids).toContain(11); // ...and includes the last one
    expect(ids).toEqual([...ids].sort((a, b) => a - b)); // still chronological
    expect(getPostCallState().sampled).toBe(true);
  });
});

describe("post-call engine — live transcription already did the work", () => {
  it("submits straight away with NO wait screen when nothing is left", async () => {
    installFakeWorker({ perChunkMs: 5 });
    const api = mockSubmitEndpoint();
    const t = new ChunkTranscriber({ createWorker: () => new Worker("x"), modelId: "m" });
    t.startLive();
    for (let i = 0; i < 10; i++) {
      t.enqueue(chunk(i));
      await sleep(25);
    }
    const meta = sessionMeta("live-ok");
    await saveSession(meta);

    const phases: string[] = [];
    const un = subscribePostCall(() => phases.push(getPostCallState().phase + (getPostCallState().blocking ? "*" : "")));
    processSession(meta, [], { blocking: true, live: t });
    await waitFor(() => api.bodies.length === 1, "submit");
    un();

    expect(chunkIds(api.bodies[0].transcript)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(phases.some((p) => p.endsWith("*"))).toBe(false); // the student is never held on a wait screen
  });

  it("transcribes a whole hour (130 chunks) completely and in order", async () => {
    installFakeWorker({ perChunkMs: 1 });
    const api = mockSubmitEndpoint();
    const t = new ChunkTranscriber({ createWorker: () => new Worker("x"), modelId: "m" });
    t.startLive();
    for (let i = 0; i < 130; i++) {
      t.enqueue(chunk(i, 25));
      await sleep(2);
    }
    const meta = sessionMeta("hour");
    await saveSession(meta);
    processSession(meta, [], { blocking: true, live: t });
    await waitFor(() => api.bodies.length === 1, "submit");

    const ids = chunkIds(api.bodies[0].transcript);
    expect(ids).toHaveLength(130);
    expect(ids).toEqual(Array.from({ length: 130 }, (_, i) => i));
  });

  it("finishes only the leftover when live fell behind, re-using the already loaded model", async () => {
    const w = installFakeWorker({ perChunkMs: 40 });
    const api = mockSubmitEndpoint();
    const t = new ChunkTranscriber({ createWorker: () => new Worker("x"), modelId: "m" });
    t.startLive();
    for (let i = 0; i < 20; i++) {
      t.enqueue(chunk(i)); // 20 chunks arrive much faster than they can be transcribed
      await sleep(5);
    }
    const meta = sessionMeta("behind");
    await saveSession(meta);
    const doneLive = t.chunksDone;
    const blocking: boolean[] = [];
    const un = subscribePostCall(() => blocking.push(getPostCallState().blocking));
    processSession(meta, [], { blocking: true, live: t });
    await waitFor(() => api.bodies.length === 1, "submit");
    un();

    const ids = chunkIds(api.bodies[0].transcript);
    expect(ids.length).toBeGreaterThan(doneLive); // the post-call step added more
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(w.created).toBe(1); // one model instance for the whole call
    expect(blocking).not.toContain(true); // a big leftover finishes in the background, no wait screen
  });

  it("keeps the wait screen only when a SMALL tail is left and the model is already on the device", async () => {
    markWhisperReady();
    installFakeWorker({ perChunkMs: 30 });
    const api = mockSubmitEndpoint();
    const t = new ChunkTranscriber({ createWorker: () => new Worker("x"), modelId: "m" });
    t.startLive();
    for (let i = 0; i < 3; i++) t.enqueue(chunk(i)); // 3 chunks at once: a couple are still waiting when the call ends
    await sleep(15);
    const meta = sessionMeta("small-tail");
    await saveSession(meta);
    const blocking: boolean[] = [];
    const un = subscribePostCall(() => blocking.push(getPostCallState().blocking));
    processSession(meta, [], { blocking: true, live: t });
    await waitFor(() => api.bodies.length === 1, "submit");
    un();

    expect(chunkIds(api.bodies[0].transcript)).toEqual([0, 1, 2]);
    expect(blocking).toContain(true);
  });
});

describe("post-call engine — which sessions block the student", () => {
  it("holds the student on the wait screen only for the call just finished, not for resumed sessions", async () => {
    markWhisperReady();
    installFakeWorker({ perChunkMs: 30 });
    mockSubmitEndpoint();
    const seen: boolean[] = [];
    const un = subscribePostCall(() => seen.push(getPostCallState().blocking));

    const t = new ChunkTranscriber({ createWorker: () => new Worker("x"), modelId: "m" });
    t.startLive();
    for (let i = 0; i < 3; i++) t.enqueue(chunk(i));
    await sleep(15);
    const meta = sessionMeta("blocking-yes");
    await saveSession(meta);
    processSession(meta, [], { blocking: true, live: t });
    await waitFor(() => seen.includes(true), "blocking state");
    await waitFor(idle, "finish");

    seen.length = 0;
    await saveSession(sessionMeta("blocking-no"));
    await saveSegment("blocking-no", 0, raw(1)[0]);
    await resumePendingSessions();
    await waitFor(() => seen.length > 0, "resumed state");
    await waitFor(idle, "finish resumed");
    un();
    expect(seen.includes(true)).toBe(false);
  });
});
