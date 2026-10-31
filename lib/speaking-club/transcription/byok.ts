// lib/speaking-club/transcription/byok.ts
//
// BYOK ("bring your own key") transcription. Each student pastes their own free Gemini API
// key (Google AI Studio) once; their speech chunks then go straight from THEIR browser to
// Google with THEIR key. Nothing passes through our server and no model is downloaded.
//
// To change as little as possible, this file also provides `GeminiByokWorker`: an object that
// speaks the same messages as the Whisper Web Worker (protocol.ts), so the chunk transcriber,
// the live capture, the queue and the post-call engine work unchanged. `createWhisperWorker()`
// (model.ts) hands it out when BYOK is on.
import { encodeWav16k } from "@/lib/speaking-club/audio/wav";
import { MAX_NOTES_PER_CHUNK, PRON_MARKER, parseTranscriptReply } from "@/lib/speaking-club/pronunciation-notes";
import { GEMINI_BYOK, byokModel } from "@/lib/speaking-club/config";
import type { WorkerRequest, WorkerResponse } from "@/lib/speaking-club/transcription/protocol";

const KEY_STORE = "lc_gemini_key";
const READY_STORE = "lc_gemini_ready";

// ---- key storage -----------------------------------------------------------

export function getByokKey(): string | null {
  try {
    const k = localStorage.getItem(KEY_STORE);
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

/** True once a key was saved AND passed the test call. */
export function isByokReady(): boolean {
  try {
    return getByokKey() !== null && localStorage.getItem(READY_STORE) === "1";
  } catch {
    return false;
  }
}

export function saveByokKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORE, key.trim());
    localStorage.setItem(READY_STORE, "1");
  } catch {
    // storage blocked: the key then lives only for this page load (isByokReady stays false)
  }
}

/** Forgets the "ready" flag (key rejected / removed) so the setup pop-up asks again. */
export function clearByokReady(): void {
  try {
    localStorage.removeItem(READY_STORE);
  } catch {
    // ignore
  }
}

export function clearByok(): void {
  try {
    localStorage.removeItem(KEY_STORE);
    localStorage.removeItem(READY_STORE);
  } catch {
    // ignore
  }
}

/**
 * Light shape check before spending a request. Google issues keys in more than one format
 * ("AIza…" and the newer "AQ.…"), so only the character set and length are checked here;
 * Google's own response is the real validation.
 */
export function looksLikeGeminiKey(key: string): boolean {
  return /^[0-9A-Za-z_.-]{20,}$/.test(key.trim());
}

// ---- the Gemini call -------------------------------------------------------

export type GeminiErrorKind = "invalid-key" | "forbidden" | "model" | "quota" | "server" | "network" | "blocked" | "other";
export type GeminiError = { kind: GeminiErrorKind; status?: number; retryAfterMs?: number };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryWaitMs(): number {
  const n = Number(process.env.NEXT_PUBLIC_GEMINI_RETRY_WAIT_MS);
  return Number.isFinite(n) && n >= 0 ? n : GEMINI_BYOK.retryWaitMs;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

async function classify(res: Response): Promise<GeminiError> {
  const status = res.status;
  let body = "";
  try {
    body = await res.text();
  } catch {
    // ignore
  }
  if (status === 429) {
    const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
    return { kind: "quota", status, retryAfterMs: m ? Math.ceil(Number(m[1]) * 1000) : undefined };
  }
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(body)) return { kind: "invalid-key", status };
  if (status === 401) return { kind: "invalid-key", status };
  if (status === 403) return { kind: "forbidden", status };
  if (status === 404) return { kind: "model", status };
  if (status >= 500) return { kind: "server", status };
  return { kind: "other", status };
}

// Why Gemini stopped without giving a transcript (a refusal is NOT silence).
const BLOCKING_FINISH = /^(SAFETY|RECITATION|BLOCKLIST|PROHIBITED_CONTENT|SPII|OTHER|LANGUAGE)$/;

type GeminiAnswer = {
  promptFeedback?: { blockReason?: string };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
};

async function generate(key: string, body: unknown): Promise<{ ok: true; text: string } | { ok: false; error: GeminiError }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GEMINI_BYOK.requestTimeoutMs);
  try {
    const res = await fetch(`${GEMINI_BYOK.endpoint}/models/${encodeURIComponent(byokModel())}:generateContent`, {
      method: "POST",
      // The key goes in a header, never in the URL (URLs end up in logs / history).
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: await classify(res) };
    const data = (await res.json().catch(() => null)) as GeminiAnswer | null;
    // An answer we cannot read is a failed request (retried), not a silent chunk.
    if (!data || typeof data !== "object") return { ok: false, error: { kind: "server", status: res.status } };
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts ?? [])
      .filter((p) => !p.thought) // never mix the model's thinking into the student's words
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      // No text because Gemini refused / blocked it: that is a failure to report, not "no speech".
      if (data.promptFeedback?.blockReason || (cand?.finishReason && BLOCKING_FINISH.test(cand.finishReason))) {
        return { ok: false, error: { kind: "blocked", status: res.status } };
      }
    }
    return { ok: true, text };
  } catch {
    return { ok: false, error: { kind: "network" } };
  } finally {
    clearTimeout(timer);
  }
}

/** One short test request: proves the key works for this model, region and quota. */
export async function validateByokKey(key: string): Promise<{ ok: true } | { ok: false; reason: GeminiErrorKind }> {
  const r = await generate(key.trim(), {
    contents: [{ parts: [{ text: "Reply with the single word OK." }] }],
    generationConfig: { maxOutputTokens: 8, temperature: 0 },
  });
  return r.ok ? { ok: true } : { ok: false, reason: r.error.kind };
}

// The rules go in the SYSTEM instruction (models follow those more strictly than text next to the audio).
const SYSTEM_PROMPT =
  "You are a verbatim speech-to-text engine for an IELTS speaking practice tool. The speakers are English learners. " +
  "Your transcript will be used to give the student an official-style IELTS speaking band score and feedback on " +
  "Grammatical Range and Accuracy, Lexical Resource and Fluency. If you correct, polish or smooth anything, the " +
  "student gets a WRONG (too high) score and will not learn from their real mistakes, so accuracy to what was " +
  "actually said matters more than a clean-looking sentence. Your ONLY job is to write down the words that were " +
  "actually spoken, word for word, like a court stenographer.\n" +
  "Rules:\n" +
  "1. NEVER correct, improve, complete or smooth anything: keep wrong grammar, wrong tenses, wrong word forms, " +
  "wrong prepositions, missing articles, false starts, repeated words and fillers (um, uh).\n" +
  "2. Example: if the speaker says \"yesterday I go to market and he don't like it\", write exactly " +
  "\"yesterday I go to market and he don't like it\" (NOT \"went\", NOT \"doesn't\"). " +
  "Example: \"I am agree with this\" stays \"I am agree with this\".\n" +
  "3. Do not translate, summarise or explain anything. Do not add anything to the transcript itself.\n" +
  "4. If there is no clear speech, output nothing at all (no notes either).\n" +
  "5. PRONUNCIATION: the written transcript cannot show how words sounded, so a mispronounced word looks perfectly fine in it. " +
  "Write the transcript with the words the speaker MEANT (never respell words to show an accent). Then, if you clearly heard " +
  "words pronounced wrongly (wrong sound, wrong word stress, a sound dropped or added), add a new line containing exactly " +
  `${PRON_MARKER} and under it one short line per mispronounced word, at most ${MAX_NOTES_PER_CHUNK}, in the form ` +
  "\"- word: heard as /what you heard/ (the sound problem)\", e.g. \"- think: heard as 'sink' (th pronounced as s)\". " +
  "Note EVERY word you clearly heard mispronounced, including the same sound problem in different words, because the student " +
  "is told about each one. Never guess and never note normal accent differences that do not change the sound of the word. " +
  "If you heard no clear pronunciation mistakes, write no marker and no notes.";
const PROMPT = "Transcribe this recording verbatim, keeping every grammar mistake exactly as spoken.";

// Gemini sometimes describes silence instead of returning nothing.
const NO_SPEECH = /^\W*(no (clear )?speech( detected)?|silence|inaudible|\[?(silence|inaudible|no speech)\]?)\W*$/i;

/** Transcribes one 16 kHz mono chunk. Retries rate limits / server hiccups a couple of times. */
export async function transcribeWithGemini(
  key: string,
  pcm: Int16Array,
): Promise<{ ok: true; text: string; notes?: string[] } | { ok: false; error: GeminiError }> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        parts: [{ inline_data: { mime_type: "audio/wav", data: toBase64(encodeWav16k(pcm)) } }, { text: PROMPT }],
      },
    ],
    generationConfig: { temperature: 0 },
  };
  let last: GeminiError = { kind: "other" };
  for (let attempt = 0; attempt <= GEMINI_BYOK.retries; attempt++) {
    const r = await generate(key, body);
    if (r.ok) {
      const { text, notes } = parseTranscriptReply(r.text);
      // No speech = no notes (the model may "note" things about silence).
      if (!text || NO_SPEECH.test(text)) return { ok: true, text: "" };
      return notes.length > 0 ? { ok: true, text, notes } : { ok: true, text };
    }
    last = r.error;
    const retryable = last.kind === "quota" || last.kind === "server" || last.kind === "network";
    if (!retryable || attempt === GEMINI_BYOK.retries) break;
    // A quota answer that asks for a long wait means the quota is used up: don't hang on it.
    if (last.kind === "quota" && (last.retryAfterMs ?? 0) > GEMINI_BYOK.maxServerRetryMs) break;
    await sleep(last.retryAfterMs ?? retryWaitMs());
  }
  return { ok: false, error: last };
}

// ---- Worker-compatible adapter --------------------------------------------

const floatToInt16 = (f: Float32Array): Int16Array => {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, f[i])) * 32767);
  return out;
};

/** Looks like the Whisper worker to its callers (load -> ready, transcribe -> result). */
export class GeminiByokWorker {
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  private terminated = false;

  postMessage(req: WorkerRequest, _transfer?: Transferable[]): void {
    void _transfer;
    if (this.terminated) return;
    if (req.type === "load") {
      // Nothing to download: just make sure a key is there.
      setTimeout(() => {
        if (getByokKey()) this.emit({ type: "ready" });
        else this.emit({ type: "error", message: "no-key", fatal: true });
      }, 0);
    } else {
      void this.transcribe(req.id, req.audio);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(m: WorkerResponse): void {
    if (!this.terminated) this.onmessage?.({ data: m } as MessageEvent<WorkerResponse>);
  }

  private async transcribe(id: number, audio: Float32Array): Promise<void> {
    const key = getByokKey();
    if (!key) {
      this.emit({ type: "error", id, message: "no-key", fatal: false });
      return;
    }
    const r = await transcribeWithGemini(key, floatToInt16(audio));
    if (r.ok) {
      this.emit(r.notes ? { type: "result", id, text: r.text, notes: r.notes } : { type: "result", id, text: r.text });
      return;
    }
    // A rejected key must not stay "ready": the setup pop-up asks for a new one next visit.
    if (r.error.kind === "invalid-key" || r.error.kind === "forbidden") clearByokReady();
    this.emit({ type: "error", id, message: r.error.kind, fatal: false });
  }
}

export function createByokWorker(): Worker {
  return new GeminiByokWorker() as unknown as Worker;
}
