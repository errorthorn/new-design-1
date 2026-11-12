import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunk, installBrowserStubs, sleep } from "./helpers";
import { liveChunkSeconds } from "@/lib/speaking-club/config";
import { deviceCanRunWhisper } from "@/lib/speaking-club/device";
import { ChunkTranscriber } from "@/lib/speaking-club/transcription/chunk-transcriber";
import {
  GeminiByokWorker,
  createByokWorker,
  getByokKey,
  isByokReady,
  saveByokKey,
  transcribeWithGemini,
  validateByokKey,
} from "@/lib/speaking-club/transcription/byok";
import { isWhisperReady, whisperNeedsSetup, whisperSetupRequired } from "@/lib/speaking-club/transcription/model";
import { startByokSetup, getWhisperPrepareState, cancelWhisperPrepare } from "@/lib/speaking-club/transcription/model-setup";

const KEY = "AIzaSyTestKeyTestKeyTestKeyTestKey1234";
const okBody = (text: string) => JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] });
const reply = (status: number, body = "") => new Response(body, { status });

beforeEach(() => {
  process.env.NEXT_PUBLIC_GEMINI_BYOK = "true";
  process.env.NEXT_PUBLIC_GEMINI_RETRY_WAIT_MS = "1";
});
afterEach(() => {
  process.env.NEXT_PUBLIC_GEMINI_BYOK = "false";
  delete process.env.NEXT_PUBLIC_GEMINI_RETRY_WAIT_MS;
  cancelWhisperPrepare();
  vi.unstubAllGlobals();
});

describe("BYOK Gemini: the call itself", () => {
  it("sends the audio with the student's key in a header (never in the URL)", async () => {
    const f = vi.fn(async () => reply(200, okBody("I goes to market yesterday")));
    vi.stubGlobal("fetch", f);
    const r = await transcribeWithGemini(KEY, new Int16Array(16000));
    expect(r).toEqual({ ok: true, text: "I goes to market yesterday" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    expect(String(init.body)).toContain("audio/wav");
  });

  it("treats \"no speech\" answers as an empty chunk", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody("No speech detected."))));
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toEqual({ ok: true, text: "" });
  });

  it("retries a rate limit (429) and then succeeds", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? reply(429, "{}") : reply(200, okBody("hello there"))));
    vi.stubGlobal("fetch", f);
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toEqual({ ok: true, text: "hello there" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("does not hang on a used-up quota (long retryDelay): gives up at once", async () => {
    const f = vi.fn(async () => reply(429, '{"error":{"details":[{"retryDelay":"3600s"}]}}'));
    vi.stubGlobal("fetch", f);
    const r = await transcribeWithGemini(KEY, new Int16Array(16000));
    expect(r).toMatchObject({ ok: false, error: { kind: "quota" } });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("validateByokKey explains why a key fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody("OK"))));
    expect(await validateByokKey(KEY)).toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}')));
    expect(await validateByokKey(KEY)).toEqual({ ok: false, reason: "invalid-key" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(403, "{}")));
    expect(await validateByokKey(KEY)).toEqual({ ok: false, reason: "forbidden" });
    vi.stubGlobal("fetch", vi.fn(async () => reply(429, "{}")));
    expect(await validateByokKey(KEY)).toEqual({ ok: false, reason: "quota" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await validateByokKey(KEY)).toEqual({ ok: false, reason: "network" });
  });
});

describe("BYOK Gemini: setup gate", () => {
  it("every phone that can record needs only a key — no model, no memory check", () => {
    installBrowserStubs({ deviceMemory: 0.5 });
    expect(deviceCanRunWhisper()).toBe(true);
    expect(whisperNeedsSetup()).toBe(true);
    expect(whisperSetupRequired()).toBe(true); // mandatory: can't enter a call without a key
    expect(liveChunkSeconds()).toBe(25);
  });

  it("a bad key keeps the student out; a working key opens the gate", async () => {
    installBrowserStubs();
    await startByokSetup("not-a-key");
    expect(getWhisperPrepareState()).toMatchObject({ phase: "error", error: "bad-format" });
    expect(isWhisperReady()).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => reply(400, '{"error":{"details":[{"reason":"API_KEY_INVALID"}]}}')));
    await startByokSetup(KEY);
    expect(getWhisperPrepareState()).toMatchObject({ phase: "error", error: "invalid-key" });
    expect(isWhisperReady()).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody("OK"))));
    await startByokSetup(KEY);
    expect(getWhisperPrepareState().phase).toBe("ready");
    expect(getByokKey()).toBe(KEY);
    expect(isWhisperReady()).toBe(true);
    expect(whisperSetupRequired()).toBe(false);
  });
});

describe("BYOK Gemini: works inside the existing pipeline", () => {
  it("the Whisper-worker adapter: no key = fatal load error; key = ready", async () => {
    installBrowserStubs();
    const got: unknown[] = [];
    const w = new GeminiByokWorker();
    w.onmessage = (e) => got.push(e.data);
    w.postMessage({ type: "load", modelId: "x" });
    await sleep(10);
    expect(got[0]).toMatchObject({ type: "error", fatal: true, message: "no-key" });
    saveByokKey(KEY);
    w.postMessage({ type: "load", modelId: "x" });
    await sleep(10);
    expect(got[1]).toEqual({ type: "ready" });
  });

  it("live ChunkTranscriber transcribes through Gemini", async () => {
    installBrowserStubs();
    saveByokKey(KEY);
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody("some spoken words"))));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    t.startLive();
    for (let i = 0; i < 4; i++) {
      t.enqueue(chunk(i));
      await sleep(15);
    }
    await t.stopLive();
    expect(t.takeQueue()).toHaveLength(0);
    expect([...t.texts.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(t.texts.get(0)).toBe("some spoken words");
  });

  it("a rejected key mid-call drops the ready flag so the pop-up asks again", async () => {
    installBrowserStubs();
    saveByokKey(KEY);
    expect(isByokReady()).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => reply(403, "{}")));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    await t.load();
    await t.processJob(chunk(0));
    expect(t.texts.size).toBe(0);
    expect(isByokReady()).toBe(false);
  });
});
