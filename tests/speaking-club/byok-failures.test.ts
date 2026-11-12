// BYOK (student's own Gemini key): a chunk that fails must never silently become a hole in the
// transcript, and a call whose transcript could not be made must not lose its audio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunk, installBrowserStubs, mockSubmitEndpoint, sessionMeta, sleep, waitFor } from "./helpers";
import { ChunkTranscriber } from "@/lib/speaking-club/transcription/chunk-transcriber";
import { createByokWorker, isByokReady, saveByokKey, transcribeWithGemini } from "@/lib/speaking-club/transcription/byok";
import { PRON_MARKER } from "@/lib/speaking-club/pronunciation-notes";
import { getPostCallState, processSession, resumePendingSessions } from "@/lib/speaking-club/post-call/engine";
import { listSessions, loadSegments, saveSegment, saveSession } from "@/lib/speaking-club/storage/segment-store";

const KEY = "AIzaSyTestKeyTestKeyTestKeyTestKey1234";
const okBody = (text: string, finishReason = "STOP") =>
  JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
const emptyBody = (finishReason: string) => JSON.stringify({ candidates: [{ finishReason, content: { parts: [] } }] });
const reply = (status: number, body = "") => new Response(body, { status });

beforeEach(() => {
  process.env.NEXT_PUBLIC_GEMINI_BYOK = "true";
  process.env.NEXT_PUBLIC_GEMINI_RETRY_WAIT_MS = "1";
  process.env.NEXT_PUBLIC_FAILED_RETRY_WAIT_MS = "1";
  installBrowserStubs();
});
afterEach(() => {
  process.env.NEXT_PUBLIC_GEMINI_BYOK = "false";
  delete process.env.NEXT_PUBLIC_GEMINI_RETRY_WAIT_MS;
  delete process.env.NEXT_PUBLIC_FAILED_RETRY_WAIT_MS;
  vi.unstubAllGlobals();
});

describe("BYOK Gemini: what the answer means", () => {
  it("a refusal (safety block) is a failure, not silence", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, emptyBody("SAFETY"))));
    const r = await transcribeWithGemini(KEY, new Int16Array(16000));
    expect(r).toMatchObject({ ok: false, error: { kind: "blocked" } });
  });

  it("a prompt blocked up front is a failure too", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, JSON.stringify({ promptFeedback: { blockReason: "OTHER" } }))));
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toMatchObject({ ok: false, error: { kind: "blocked" } });
  });

  it("a normal stop with no text is real silence (empty chunk, not a failure)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, emptyBody("STOP"))));
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toEqual({ ok: true, text: "" });
  });

  it("an unreadable answer is retried as a server problem, not taken as silence", async () => {
    let n = 0;
    const f = vi.fn(async () => (++n === 1 ? reply(200, "not json") : reply(200, okBody("hello again"))));
    vi.stubGlobal("fetch", f);
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toEqual({ ok: true, text: "hello again" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("the model's 'thinking' parts never end up in the transcript", async () => {
    const body = JSON.stringify({
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "internal notes", thought: true }, { text: "the real words" }] } }],
    });
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, body)));
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toEqual({ ok: true, text: "the real words" });
  });

  it("asks for a verbatim transcript (no grammar fixing)", async () => {
    const f = vi.fn(async () => reply(200, okBody("x")));
    vi.stubGlobal("fetch", f);
    await transcribeWithGemini(KEY, new Int16Array(16000));
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toMatch(/word for word/);
    expect(body.systemInstruction.parts[0].text).toMatch(/NEVER correct/);
    expect(body.systemInstruction.parts[0].text).toMatch(/IELTS speaking band score/); // it is told what the transcript is used for
    expect(body.systemInstruction.parts[0].text).toMatch(/he don't like it/); // the worked example
  });
});

let n = 0;
beforeEach(() => {
  n = 0;
});

describe("BYOK Gemini: ChunkTranscriber keeps failed chunks", () => {
  it("a failed chunk is not counted as done and is kept with its audio", async () => {
    saveByokKey(KEY);
    vi.stubGlobal("fetch", vi.fn(async () => reply(500)));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    await t.load();
    expect(await t.processJob(chunk(0))).toBe(false);
    expect(t.chunksDone).toBe(0);
    expect(t.texts.size).toBe(0);
    expect(t.failedCount).toBe(1);
    expect(t.failureReason).toBe("network");
    expect(t.giveUp).toBe(false); // a server hiccup says nothing about the key
  });

  it("retryFailed recovers a chunk once Google answers again", async () => {
    saveByokKey(KEY);
    let up = false;
    vi.stubGlobal("fetch", vi.fn(async () => (up ? reply(200, okBody("back again")) : reply(500))));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    await t.load();
    await t.processJob(chunk(3));
    expect(t.failedCount).toBe(1);
    up = true;
    await t.retryFailed(1, 1);
    expect(t.failedCount).toBe(0);
    expect(t.texts.get(3)).toBe("back again");
    expect(t.chunksDone).toBe(1);
  });

  it("during the call a failed chunk is retried by the live queue itself (not left for after the call)", async () => {
    saveByokKey(KEY);
    let calls = 0;
    // The first answer is a Google hiccup; every later one works.
    vi.stubGlobal("fetch", vi.fn(async () => (++calls <= 3 ? reply(500) : reply(200, okBody("fixed live")))));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    t.startLive();
    t.enqueue(chunk(0));
    await waitFor(() => t.texts.has(0), "live retry");
    expect(t.texts.get(0)).toBe("fixed live");
    expect(t.failedCount).toBe(0); // nothing left over for the wait after the call
    await t.stopLive();
    expect(t.takeQueue()).toHaveLength(0);
    t.dispose();
  });

  it("a long call (130 chunks, some failing at first) is done live: nothing is left for after the call", async () => {
    saveByokKey(KEY);
    // Every 10th request fails (a Google hiccup).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        n++;
        return n % 10 === 0 ? reply(500) : reply(200, okBody(`w${n}`));
      }),
    );
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    t.startLive();
    for (let i = 0; i < 130; i++) t.enqueue(chunk(i, 1));
    await waitFor(() => t.chunksDone === 130, "all 130 chunks live");
    await t.stopLive();
    expect(t.takeQueue()).toHaveLength(0);
    expect(t.failedCount).toBe(0);
    t.dispose();
  });

  it("a chunk Gemini refuses (blocked) is not asked again and does not hold anything up", async () => {
    saveByokKey(KEY);
    const f = vi.fn(async () => reply(200, emptyBody("SAFETY")));
    vi.stubGlobal("fetch", f);
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    t.startLive();
    t.enqueue(chunk(0));
    await waitFor(() => t.failedCount === 1, "blocked chunk kept");
    await sleep(30);
    expect(f).toHaveBeenCalledTimes(1);
    await t.retryFailed(2, 1);
    expect(f).toHaveBeenCalledTimes(1);
    expect(t.failedCount).toBe(1);
    t.dispose();
  });

  it("a chunk that keeps failing live is kept for the post-call step after the live retries", async () => {
    saveByokKey(KEY);
    vi.stubGlobal("fetch", vi.fn(async () => reply(500)));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    t.startLive();
    t.enqueue(chunk(0));
    await waitFor(() => t.failedCount === 1 && t.queueLength === 0, "gave up live");
    await t.stopLive();
    expect(t.takeFailed()).toHaveLength(1);
    t.dispose();
  });

  it("retryFailed does not start new rounds once its deadline has passed", async () => {
    saveByokKey(KEY);
    const f = vi.fn(async () => reply(500));
    vi.stubGlobal("fetch", f);
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    await t.load();
    await t.processJob(chunk(0));
    const before = f.mock.calls.length;
    await t.retryFailed(2, 1, Date.now() - 1);
    expect(f.mock.calls.length).toBe(before);
    expect(t.failedCount).toBe(1); // still kept, not lost
    t.dispose();
  });

  it("a rejected key stops the requests at once (nothing is wasted) and keeps every chunk", async () => {
    saveByokKey(KEY);
    const f = vi.fn(async () => reply(403, "{}"));
    vi.stubGlobal("fetch", f);
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    await t.load();
    for (let i = 0; i < 4; i++) await t.processJob(chunk(i));
    expect(f).toHaveBeenCalledTimes(1);
    expect(t.giveUp).toBe(true);
    expect(t.failureReason).toBe("key");
    expect(t.failedCount).toBe(4);
    expect(t.takeFailed().map((j) => j.pos)).toEqual([0, 1, 2, 3]);
    expect(isByokReady()).toBe(false);
  });

  it("a quota answer is reported as quota", async () => {
    saveByokKey(KEY);
    vi.stubGlobal("fetch", vi.fn(async () => reply(429, '{"error":{"details":[{"retryDelay":"3600s"}]}}')));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    await t.load();
    await t.processJob(chunk(0));
    expect(t.failureReason).toBe("quota");
    expect(t.giveUp).toBe(false); // a per-minute limit may pass: the chunk is tried again later
  });
});

// ---------------------------------------------------------------------------
// the whole post-call step
// ---------------------------------------------------------------------------

/** Four-chunk calls: 20 s segments are never merged (25 s chunks), and segment i starts with sample i. */
const raw = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const a = new Int16Array(20 * 16000).fill(300);
    a[0] = i;
    return a;
  });

/** Which chunk a Gemini request carries (first sample of the WAV, right after the 44-byte header). */
function chunkOf(init: RequestInit): number {
  const body = JSON.parse(String(init.body));
  const b64: string = body.contents[0].parts[0].inline_data.data;
  return atob(b64.slice(0, 80)).charCodeAt(44);
}

/** Gemini goes to `gemini`, our submit route to the usual mock. */
function wire(gemini: (chunkIndex: number) => Response | Promise<Response>) {
  const api = mockSubmitEndpoint();
  const submit = globalThis.fetch as unknown as (u: string, i: unknown) => Promise<unknown>;
  const calls: number[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (String(url).includes("generativelanguage")) {
      const i = chunkOf(init);
      calls.push(i);
      return gemini(i);
    }
    return submit(url, init);
  });
  return { api, calls };
}

const waitState = (phase: string) => waitFor(() => getPostCallState().phase === phase, `state ${phase}`);
const stored = async (id: string) => (await listSessions()).find((s) => s.sessionId === id);
async function start(id: string, n = 4) {
  const meta = sessionMeta(id);
  await saveSession(meta);
  for (const [i, s] of raw(n).entries()) await saveSegment(id, i, s);
  return { meta, segs: raw(n) };
}

describe("BYOK post-call: no silent holes, no lost audio", () => {
  it("every chunk fails (no internet / Google down): nothing is submitted and the audio is kept", async () => {
    saveByokKey(KEY);
    const { api } = wire(() => reply(500));
    const { meta, segs } = await start("all-fail");
    processSession(meta, segs);
    await waitState("error");
    await sleep(30);

    expect(api.bodies).toHaveLength(0);
    expect(getPostCallState().reason).toBe("network");
    expect((await stored("all-fail"))?.attempts).toBe(1);
    expect(await loadSegments("all-fail")).toHaveLength(4); // the audio is still there
  });

  it("a rejected key: audio kept, no attempt used up, the key is asked for again — then the call is finished", async () => {
    saveByokKey(KEY);
    const w = wire(() => reply(403, "{}"));
    const { meta, segs } = await start("bad-key");
    processSession(meta, segs);
    await waitState("error");
    await sleep(30);

    expect(w.api.bodies).toHaveLength(0);
    expect(getPostCallState().reason).toBe("key");
    expect(w.calls).toHaveLength(1); // one rejected request, not one per chunk
    expect(isByokReady()).toBe(false);
    expect((await stored("bad-key"))?.attempts).toBe(0);
    expect(await loadSegments("bad-key")).toHaveLength(4);

    // Next visit WITHOUT a working key: nothing happens (and no request is made).
    await resumePendingSessions();
    await sleep(50);
    expect(w.calls).toHaveLength(1);
    expect(w.api.bodies).toHaveLength(0);

    // The student enters a new key: the call is transcribed from the kept audio.
    saveByokKey(KEY);
    const again = wire((i) => reply(200, okBody(`w${i}`)));
    await resumePendingSessions();
    await waitFor(() => again.api.bodies.length === 1, "submit after the new key");
    expect(again.api.bodies[0].transcript).toBe("w0 w1 w2 w3");
    expect(await stored("bad-key")).toBeUndefined();
  });

  it("a chunk that fails now but works a moment later is NOT lost", async () => {
    saveByokKey(KEY);
    const seen = new Map<number, number>();
    const { api } = wire((i) => {
      const n = (seen.get(i) ?? 0) + 1;
      seen.set(i, n);
      // chunk 2: all three tries of the first round fail, the re-try round works
      return i === 2 && n <= 3 ? reply(500) : reply(200, okBody(`w${i}`));
    });
    const { meta, segs } = await start("blip");
    processSession(meta, segs);
    await waitFor(() => api.bodies.length === 1, "submit");
    expect(api.bodies[0].transcript).toBe("w0 w1 w2 w3");
    expect(await stored("blip")).toBeUndefined();
  });

  it("one chunk that can never be transcribed does not hold back the rest (partial transcript is sent)", async () => {
    saveByokKey(KEY);
    const { api } = wire((i) => (i === 1 ? reply(200, emptyBody("SAFETY")) : reply(200, okBody(`w${i}`))));
    const { meta, segs } = await start("one-gap", 8);
    processSession(meta, segs);
    await waitFor(() => api.bodies.length === 1, "submit");
    expect(api.bodies[0].transcript).toBe("w0 w2 w3 w4 w5 w6 w7");
    expect(await stored("one-gap")).toBeUndefined();
  });

  it("most chunks failing is NOT sent as a 'transcript': the call is kept for a later try", async () => {
    saveByokKey(KEY);
    const { api } = wire((i) => (i < 5 ? reply(500) : reply(200, okBody(`w${i}`))));
    const { meta, segs } = await start("mostly-fail", 8);
    processSession(meta, segs);
    await waitState("error");
    await sleep(30);
    expect(api.bodies).toHaveLength(0);
    expect((await stored("mostly-fail"))?.attempts).toBe(1);
    expect(await loadSegments("mostly-fail")).toHaveLength(8);
  });

  it("chunks that failed DURING the call are tried again after it (live transcriber)", async () => {
    saveByokKey(KEY);
    let up = false;
    const { api } = wire((i) => (up ? reply(200, okBody(`w${i}`)) : reply(500)));
    const { meta } = await start("live-fail");
    const live = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    live.startLive();
    for (let i = 0; i < 4; i++) live.enqueue({ pos: i, audio: raw(4)[i] });
    await waitFor(() => live.failedCount === 4, "live failures");
    up = true; // the connection is back when the call ends
    processSession(meta, null, { live });
    await waitFor(() => api.bodies.length === 1, "submit");
    expect(api.bodies[0].transcript).toBe("w0 w1 w2 w3");
  });
});

// ---------------------------------------------------------------------------
// pronunciation notes: the transcript cannot show how words sounded, so the model that LISTENED
// writes the mispronounced words under it
// ---------------------------------------------------------------------------
const withNotes = (text: string, ...notes: string[]) => `${text}\n${PRON_MARKER}\n${notes.map((n) => `- ${n}`).join("\n")}`;

describe("BYOK pronunciation notes", () => {
  it("splits the reply into the spoken text and the notes under it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody(withNotes("I think it is good", "think: heard as 'sink' (th as s)")))));
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toEqual({
      ok: true,
      text: "I think it is good",
      notes: ["think: heard as 'sink' (th as s)"],
    });
  });

  it("notes about silence are dropped (no speech = no notes)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody(withNotes("", "something: heard wrong")))));
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toEqual({ ok: true, text: "" });
  });

  it("a reply without notes is unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody("just words"))));
    expect(await transcribeWithGemini(KEY, new Int16Array(16000))).toEqual({ ok: true, text: "just words" });
  });

  it("the prompt asks for the notes, in a form that never changes the transcript", async () => {
    const f = vi.fn(async () => reply(200, okBody("x")));
    vi.stubGlobal("fetch", f);
    await transcribeWithGemini(KEY, new Int16Array(16000));
    const sys = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).systemInstruction.parts[0].text;
    expect(sys).toContain(PRON_MARKER);
    expect(sys).toMatch(/never respell words/);
  });

  it("the transcriber keeps the notes by chunk, and not for a chunk that failed", async () => {
    saveByokKey(KEY);
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody(withNotes("hello world", "world: heard as 'vorld'")))));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    await t.load();
    await t.processJob(chunk(5));
    expect(t.notes.get(5)).toEqual(["world: heard as 'vorld'"]);
    expect(t.texts.get(5)).toBe("hello world");
  });

  it("the notes are submitted SEPARATELY from the transcript, in order, without duplicates", async () => {
    saveByokKey(KEY);
    const { api } = wire((i) => reply(200, okBody(withNotes(`w${i}`, `word${i}: heard wrong`, "think: heard as 'sink'"))));
    const { meta, segs } = await start("with-notes");
    processSession(meta, segs);
    await waitFor(() => api.bodies.length === 1, "submit");
    const body = api.bodies[0] as unknown as { transcript: string; pronunciationNotes: string[] };
    expect(body.transcript).toBe("w0 w1 w2 w3"); // the spoken words only
    expect(body.pronunciationNotes).toEqual(["word0: heard wrong", "think: heard as 'sink'", "word1: heard wrong", "word2: heard wrong", "word3: heard wrong"]);
  });

  it("a submit that fails keeps the notes with the text for the retry", async () => {
    saveByokKey(KEY);
    const { api } = wire((i) => reply(200, okBody(withNotes(`w${i}`, `word${i}: heard wrong`))));
    api.setStatus(500);
    const { meta, segs } = await start("notes-retry");
    processSession(meta, segs);
    await waitFor(() => api.bodies.length === 1 && getPostCallState().phase === "error", "failed submit");
    expect((await stored("notes-retry"))?.priorNotes).toEqual(["word0: heard wrong", "word1: heard wrong", "word2: heard wrong", "word3: heard wrong"]);
    api.setStatus(200);
    await resumePendingSessions();
    await waitFor(() => api.bodies.length === 2, "retry");
    expect((api.bodies[1] as unknown as { pronunciationNotes: string[] }).pronunciationNotes).toHaveLength(4);
  });
});

describe("BYOK live transcription of a long call (everything is done DURING the call)", () => {
  it("never throttles itself, even with a big backlog (the work is at Google, resting would only leave more for later)", async () => {
    saveByokKey(KEY);
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, okBody("hello there my friend"))));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    t.startLive();
    for (let i = 0; i < 30; i++) t.enqueue(chunk(i)); // 30 x 20 s waiting at once
    expect(t.throttled).toBe(false);
    await waitFor(() => t.chunksDone === 30, "backlog cleared live");
    await t.stopLive();
    expect(t.takeQueue()).toHaveLength(0);
    t.dispose();
  });

  it("one slow request does not hold the rest of the call back (several chunks are sent at once)", async () => {
    saveByokKey(KEY);
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const i = ++n;
        if (i === 1) await sleep(200); // the first request hangs for a while
        return reply(200, okBody(`hello number ${i} today`));
      }),
    );
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    t.startLive();
    for (let i = 0; i < 3; i++) t.enqueue(chunk(i));
    await waitFor(() => t.texts.has(1) && t.texts.has(2), "later chunks finish while the first is slow");
    expect(t.texts.has(0)).toBe(false);
    await waitFor(() => t.texts.has(0), "the slow one finishes too");
    expect(t.failedCount).toBe(0);
    await t.stopLive();
    t.dispose();
  });

  it("a chunk that fails several times in a row (a minute of quota trouble) is still fixed during the call", async () => {
    saveByokKey(KEY);
    let calls = 0;
    // 15 failed requests = 5 failed attempts (3 requests each); the 6th live try works.
    vi.stubGlobal("fetch", vi.fn(async () => (++calls <= 15 ? reply(500) : reply(200, okBody("finally worked today")))));
    const t = new ChunkTranscriber({ createWorker: createByokWorker, modelId: "gemini" });
    t.startLive();
    t.enqueue(chunk(0));
    await waitFor(() => t.texts.has(0), "fixed live after repeated failures");
    expect(t.failedCount).toBe(0);
    await t.stopLive();
    expect(t.takeQueue()).toHaveLength(0);
    t.dispose();
  });
});
