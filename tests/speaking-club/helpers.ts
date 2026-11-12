// Small browser stand-ins so the pipeline can run in Node.
import { vi } from "vitest";
import type { ChunkJob } from "@/lib/speaking-club/audio/segmenter";
import type { SessionMeta } from "@/lib/speaking-club/storage/segment-store";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** window / localStorage / navigator / WebAssembly / AudioContext, enough for the capability checks. */
export function installBrowserStubs(nav: Partial<{ hardwareConcurrency: number; deviceMemory: number; userAgent: string }> = {}) {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("navigator", {
    userAgent: "vitest",
    platform: "test",
    maxTouchPoints: 0,
    hardwareConcurrency: 8,
    ...nav,
  });
  vi.stubGlobal("AudioContext", function () {});
  return store;
}

export type FakeWorkerOptions = {
  /** Time one chunk takes to transcribe. */
  perChunkMs?: number;
  /** Make loading the model fail. */
  failLoad?: boolean;
};

/** Stands in for the Whisper Web Worker: answers "load" and "transcribe" messages. */
export function installFakeWorker(opts: FakeWorkerOptions = {}) {
  const state = { created: 0, terminated: 0, options: opts };
  class FakeWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    constructor() {
      state.created++;
    }
    postMessage(m: { type: string; id?: number; audio?: Float32Array }) {
      setTimeout(() => {
        if (m.type === "load") {
          if (state.options.failLoad) this.onmessage?.({ data: { type: "error", message: "model-not-found", fatal: true } });
          else {
            this.onmessage?.({ data: { type: "progress", loaded: 5, total: 10 } });
            this.onmessage?.({ data: { type: "ready" } });
          }
        } else if (m.type === "transcribe") {
          // The transcript of a chunk encodes the chunk's marker so tests can see WHICH chunks were done.
          const marker = Math.round((m.audio?.[0] ?? 0) * 32767);
          setTimeout(() => this.onmessage?.({ data: { type: "result", id: m.id, text: `c${marker} some words here` } }), state.options.perChunkMs ?? 5);
        }
      }, 1);
    }
    terminate() {
      state.terminated++;
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  return state;
}

/** A chunk of `secs` seconds whose first sample carries `pos` (shows up in the fake transcript as `c<pos>`). */
export function chunk(pos: number, secs = 20): ChunkJob {
  const audio = new Int16Array(secs * 16000).fill(300);
  audio[0] = pos;
  return { pos, audio };
}

export function sessionMeta(id: string, over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: id,
    shiftId: "shift-1",
    studentUsername: "student@example.com",
    priorTranscript: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "ready",
    attempts: 0,
    segmentCount: 0,
    ...over,
  };
}

/** Mock of POST /api/speaking-club/submit-transcript; collects the bodies it receives. */
export function mockSubmitEndpoint(status = 200) {
  const bodies: { transcript: string; shiftId: string }[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return { status, ok: status < 300, json: async () => ({ ok: status < 300 }) };
  });
  return { bodies, setStatus: (s: number) => (status = s) };
}

/** Polls until `cond` is true (or fails the test after ~10 s). */
export async function waitFor(cond: () => boolean | Promise<boolean>, what = "condition") {
  for (let i = 0; i < 400; i++) {
    if (await cond()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Chunk ids ("c12") found in a submitted transcript, in order. */
export const chunkIds = (transcript: string | undefined) => ((transcript ?? "").match(/c(\d+)/g) ?? []).map((x) => Number(x.slice(1)));
