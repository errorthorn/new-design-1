// lib/speaking-post-call.ts
//
// Post-call engine for Speaking Club AI feedback (transcript-only).
//
// While a call runs, lib/speaking-whisper-client.ts only collects the student's
// speech on their own device. When the call is over, THIS module:
//   1. loads the Whisper model in a Web Worker (it is already in the browser
//      cache from the one-time setup, so this takes seconds),
//   2. turns the collected utterances into text, one by one,
//   3. submits the TEXT to /api/speaking-club/submit-transcript (same payload
//      and server pipeline as always — the Gemini worker only ever sees text),
//   4. deletes the audio from the device.
// The student is NOT held on the call screen: they can move on while a small
// global banner (components/speaking-club/post-call-banner.tsx) shows progress.
//
// Closing the tab / a crash / being offline never loses a session: the audio is
// also mirrored in the device's IndexedDB (lib/speaking-segment-store.ts), and
// `resumePendingSessions()` — run when any page loads — finishes leftovers.
import { cleanWhisperText } from "@/lib/whisper-segmenter";
import {
  deleteSession,
  int16ToFloat,
  listSessions,
  loadSegments,
  saveSession,
  type SessionMeta,
} from "@/lib/speaking-segment-store";
import {
  createWhisperWorker,
  deviceCanRunWhisper,
  isAnyCaptureActive,
  markWhisperReady,
  pickWhisperModel,
} from "@/lib/speaking-whisper-client";
import { recordSubmit } from "@/lib/speaking-submit-log";

export type PostCallState = {
  phase: "idle" | "loading" | "transcribing" | "submitting" | "done" | "error";
  done: number;
  total: number;
  modelPercent: number;
  /**
   * True for the call the student has JUST finished (and that has speech to
   * process): the UI then shows a full-screen wait with a running timer until
   * it's done. False for sessions resumed from an earlier visit (small banner).
   */
  blocking: boolean;
  startedAt: number; // ms epoch when this session's processing began
  transcribeStartedAt: number; // ms epoch when the first utterance started (for the time estimate)
};

const IDLE: PostCallState = {
  phase: "idle",
  done: 0,
  total: 0,
  modelPercent: 0,
  blocking: false,
  startedAt: 0,
  transcribeStartedAt: 0,
};

const MAX_ATTEMPTS = 5; // a session that keeps failing is eventually given up on
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // ...and never kept longer than 3 days
const ABANDON_MS = 90_000; // "capturing" session whose heartbeat is this stale = tab was closed
const MODEL_LOAD_TIMEOUT_MS = 10 * 60_000;
const SEGMENT_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// observable state (for the banner)
// ---------------------------------------------------------------------------
let state: PostCallState = IDLE;
const listeners = new Set<() => void>();
let doneTimer: ReturnType<typeof setTimeout> | null = null;

function setState(next: PostCallState) {
  state = next;
  syncUnloadGuard();
  listeners.forEach((l) => l());
}
export function getPostCallState(): PostCallState {
  return state;
}
export function getPostCallServerState(): PostCallState {
  return IDLE;
}
export function subscribePostCall(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Ask the browser to warn before the tab is closed while work is in progress
// (the audio is saved on the device either way, so it's a nudge, not a lock).
let guardOn = false;
const beforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "";
};
function syncUnloadGuard() {
  if (typeof window === "undefined") return;
  const busy = state.phase === "loading" || state.phase === "transcribing" || state.phase === "submitting";
  if (busy && !guardOn) {
    window.addEventListener("beforeunload", beforeUnload);
    guardOn = true;
  } else if (!busy && guardOn) {
    window.removeEventListener("beforeunload", beforeUnload);
    guardOn = false;
  }
}

// ---------------------------------------------------------------------------
// job queue (sessions are processed one at a time)
// ---------------------------------------------------------------------------
type Job = { meta: SessionMeta; segments: Int16Array[] | null; blocking: boolean };
const jobs: Job[] = [];
const activeIds = new Set<string>();
let running = false;

/**
 * Hands a finished call to the engine: transcribe on this device, submit the
 * text, delete the audio. `segments` may be null to load them from IndexedDB.
 */
export function processSession(
  meta: SessionMeta,
  segments: Int16Array[] | null,
  opts?: { blocking?: boolean },
): void {
  if (typeof window === "undefined" || activeIds.has(meta.sessionId)) return;
  activeIds.add(meta.sessionId);
  const job: Job = { meta, segments, blocking: Boolean(opts?.blocking) };
  // The call the student has just left goes first, ahead of any old leftovers.
  if (job.blocking) jobs.unshift(job);
  else jobs.push(job);
  void pump();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pump() {
  if (running) return;
  running = true;
  try {
    while (jobs.length > 0) {
      // Never compete with a live call in this tab for the CPU.
      while (isAnyCaptureActive()) await sleep(2000);
      const job = jobs.shift()!;
      try {
        await runJob(job);
      } catch {
        // runJob handles its own failures; this is only a last-resort guard
      } finally {
        activeIds.delete(job.meta.sessionId);
      }
    }
  } finally {
    running = false;
    if (state.phase !== "done" && state.phase !== "error") setState(IDLE);
  }
}

/**
 * Finishes sessions left over from earlier visits (tab closed, crash, offline).
 * Call when a page loads. Safe to call repeatedly.
 */
export async function resumePendingSessions(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    for (const s of await listSessions()) {
      if (activeIds.has(s.sessionId)) continue;
      if (now - s.createdAt > MAX_AGE_MS || s.attempts >= MAX_ATTEMPTS) {
        await deleteSession(s.sessionId);
        continue;
      }
      const abandoned = s.status === "capturing" && now - s.updatedAt > ABANDON_MS;
      if (s.status === "ready" || abandoned) processSession({ ...s, status: "ready" }, null);
    }
  } catch {
    // resuming is best-effort
  }
}

// ---------------------------------------------------------------------------
// one session
// ---------------------------------------------------------------------------
async function runJob({ meta, segments: given, blocking }: Job) {
  const segments = given ?? (await loadSegments(meta.sessionId));
  setState({
    ...IDLE,
    phase: segments.length > 0 ? "loading" : "submitting",
    total: segments.length,
    startedAt: Date.now(),
    // Only hold the student on a wait screen if there is actually something to process.
    blocking: blocking && segments.length > 0,
  });
  let transcript = meta.priorTranscript.trim();
  let modelFailed = false;

  if (segments.length > 0) {
    if (!deviceCanRunWhisper()) {
      modelFailed = true;
    } else {
      try {
        const texts = await transcribeAll(segments);
        transcript = [transcript, ...texts].filter(Boolean).join(" ").trim();
        // Audio is no longer needed; keep only the text in case the submit
        // fails and has to be retried later.
        await deleteSession(meta.sessionId);
        await saveSession({ ...meta, priorTranscript: transcript, segmentCount: 0, status: "ready", updatedAt: Date.now() });
      } catch {
        modelFailed = true;
      }
    }
  }

  if (modelFailed) {
    const attempts = meta.attempts + 1;
    const persisted = given === null || (await loadSegments(meta.sessionId)).length > 0;
    if (attempts < MAX_ATTEMPTS && persisted) {
      // The audio is safe in IndexedDB: try again on a later visit.
      await saveSession({ ...meta, status: "ready", attempts, updatedAt: Date.now() });
      recordSubmit({ shiftId: meta.shiftId, words: 0, outcome: "transcribe_failed_will_retry" });
      setState({ ...IDLE, phase: "error" });
      scheduleIdle();
      return;
    }
    // Can't retry (audio only in memory) or out of attempts: send whatever text we do have.
  }

  await submit(meta, transcript);
}

async function submit(meta: SessionMeta, transcript: string) {
  const words = transcript.split(/\s+/).filter(Boolean).length;
  // How long the on-device step took, and with which model — shown on the
  // Performance page so real-world waiting times can be judged.
  const secs = state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0;
  const detail = `whisper ${pickWhisperModel().split("/").pop()} ${secs}s`;
  if (!transcript) {
    await deleteSession(meta.sessionId);
    recordSubmit({ shiftId: meta.shiftId, words: 0, outcome: "empty_transcript", detail });
    setState(IDLE); // nothing was heard: no "feedback is coming" message
    return;
  }

  setState({ ...state, phase: "submitting", done: state.total, modelPercent: 100 });
  recordSubmit({ shiftId: meta.shiftId, words, outcome: "sending", detail });
  try {
    const res = await fetch("/api/speaking-club/submit-transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shiftId: meta.shiftId,
        studentUsername: meta.studentUsername,
        transcript,
        topicTitle: meta.topicTitle,
        cueCardQuestions: meta.cueCardQuestions,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) {
      await deleteSession(meta.sessionId);
      recordSubmit({
        shiftId: meta.shiftId,
        words,
        outcome: data?.skipped ? `skipped:${data.skipped}` : "saved",
        detail,
      });
      setState({ ...state, phase: "done" });
      scheduleIdle(state.blocking ? 4000 : 8000);
      return;
    }
    recordSubmit({
      shiftId: meta.shiftId,
      words,
      outcome: `rejected:${res.status}${data?.reason ? `:${data.reason}` : ""}`,
      detail,
    });
    // 400/403/404: the server will never accept this session — drop it.
    // 401 (logged out) / 5xx: keep the text and retry on a later visit.
    if ([400, 403, 404].includes(res.status)) {
      await deleteSession(meta.sessionId);
      setState({ ...IDLE, phase: "error" });
      scheduleIdle();
    } else {
      await keepForRetry(meta, transcript);
    }
  } catch {
    recordSubmit({ shiftId: meta.shiftId, words, outcome: "network_error", detail });
    await keepForRetry(meta, transcript);
  }
}

async function keepForRetry(meta: SessionMeta, transcript: string) {
  const attempts = meta.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await deleteSession(meta.sessionId);
  } else {
    await saveSession({ ...meta, priorTranscript: transcript, segmentCount: 0, status: "ready", attempts, updatedAt: Date.now() });
  }
  setState({ ...IDLE, phase: "error" });
  scheduleIdle();
}

function scheduleIdle(ms = 8000) {
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(() => {
    if (!running && (state.phase === "done" || state.phase === "error")) setState(IDLE);
  }, ms);
}

// ---------------------------------------------------------------------------
// Whisper, in a worker
// ---------------------------------------------------------------------------
async function transcribeAll(segments: Int16Array[]): Promise<string[]> {
  const total = segments.length;
  setState({ ...state, phase: "loading", done: 0, total, modelPercent: 0 });

  const worker = createWhisperWorker();
  const pending = new Map<number, (text: string | null) => void>();
  let dead = false;
  const killPending = () => {
    dead = true;
    pending.forEach((resolve) => resolve(null));
    pending.clear();
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("model-timeout")), MODEL_LOAD_TIMEOUT_MS);
      worker.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m?.type === "progress") {
          const pct = m.total > 0 ? Math.min(99, Math.round((m.loaded / m.total) * 100)) : 0;
          setState({ ...state, phase: "loading", modelPercent: pct });
        } else if (m?.type === "ready") {
          clearTimeout(timer);
          resolve();
        } else if (m?.type === "error" && m.fatal) {
          clearTimeout(timer);
          reject(new Error(String(m.message ?? "load-failed")));
        }
      };
      worker.onerror = (ev) => {
        clearTimeout(timer);
        reject(new Error(ev.message || "worker-error"));
      };
      worker.postMessage({
        type: "load",
        modelId: pickWhisperModel(),
        remoteHost: process.env.NEXT_PUBLIC_WHISPER_REMOTE_HOST,
      });
    });
    markWhisperReady();

    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m?.type === "result") {
        pending.get(m.id)?.(String(m.text ?? ""));
        pending.delete(m.id);
      } else if (m?.type === "error" && typeof m.id === "number") {
        pending.get(m.id)?.(null);
        pending.delete(m.id);
      }
    };
    worker.onerror = () => killPending();

    const texts: string[] = [];
    for (let i = 0; i < total; i++) {
      if (dead) break;
      setState({
        ...state,
        phase: "transcribing",
        done: i,
        total,
        modelPercent: 100,
        transcribeStartedAt: state.transcribeStartedAt || Date.now(),
      });
      const audio = int16ToFloat(segments[i]);
      const durationMs = (audio.length / 16000) * 1000;
      const text = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(i);
          resolve(null);
        }, SEGMENT_TIMEOUT_MS);
        pending.set(i, (t) => {
          clearTimeout(timer);
          resolve(t);
        });
        worker.postMessage({ type: "transcribe", id: i, audio }, [audio.buffer]);
      });
      if (text !== null) {
        const cleaned = cleanWhisperText(text, durationMs);
        if (cleaned) texts.push(cleaned);
      }
    }
    // The worker dying part-way is only a failure if nothing at all came out.
    if (dead && texts.length === 0) throw new Error("worker-died");
    setState({ ...state, phase: "transcribing", done: total, total, modelPercent: 100 });
    return texts;
  } finally {
    try {
      worker.terminate();
    } catch {
      // ignore
    }
  }
}
