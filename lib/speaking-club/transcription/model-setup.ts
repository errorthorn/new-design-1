// lib/speaking-club/transcription/model-setup.ts
//
// The one-time "download the Whisper model" step behind the dashboard pop-up
// (components/speaking-club/whisper-setup-dialog.tsx), as a small observable
// state machine. Nothing downloads without the student tapping the button, on
// Wi-Fi and mobile data alike, so there is never a surprise.
import { LIMITS, whisperRemoteHost } from "@/lib/speaking-club/config";
import { looksLikeGeminiKey, saveByokKey, validateByokKey, type GeminiErrorKind } from "@/lib/speaking-club/transcription/byok";
import { createWhisperWorker, markWhisperReady, pickWhisperModel, whisperSizesMB } from "@/lib/speaking-club/transcription/model";
import type { WorkerRequest, WorkerResponse } from "@/lib/speaking-club/transcription/protocol";

export type WhisperPrepareState = {
  phase: "idle" | "downloading" | "finishing" | "ready" | "error";
  percent: number; // 0-100
  loadedMB: number;
  expectedMB: number;
  error?: string;
};

const IDLE_PREPARE: WhisperPrepareState = { phase: "idle", percent: 0, loadedMB: 0, expectedMB: 0 };
let prepState: WhisperPrepareState = IDLE_PREPARE;
let prepWorker: Worker | null = null;
const prepListeners = new Set<() => void>();

function setPrep(next: WhisperPrepareState) {
  prepState = next;
  prepListeners.forEach((l) => l());
}

export function getWhisperPrepareState(): WhisperPrepareState {
  return prepState;
}
export function getWhisperPrepareServerState(): WhisperPrepareState {
  return IDLE_PREPARE;
}
export function subscribeWhisperPrepare(cb: () => void): () => void {
  prepListeners.add(cb);
  return () => {
    prepListeners.delete(cb);
  };
}

/**
 * Starts (or retries) the one-time download. Files already fetched by an earlier
 * interrupted attempt are served from the browser cache, so a retry resumes.
 */
export function startWhisperPrepare(): void {
  if (prepState.phase === "downloading" || prepState.phase === "finishing") return;
  const sizes = whisperSizesMB();
  setPrep({ phase: "downloading", percent: 0, loadedMB: 0, expectedMB: sizes.model });

  let worker: Worker;
  try {
    worker = createWhisperWorker();
  } catch (err) {
    setPrep({ ...IDLE_PREPARE, phase: "error", error: err instanceof Error ? err.message : "worker-failed" });
    return;
  }
  prepWorker = worker;
  const finish = (next: WhisperPrepareState) => {
    clearTimeout(timer);
    try {
      worker.terminate();
    } catch {
      // ignore
    }
    if (prepWorker === worker) prepWorker = null;
    setPrep(next);
  };
  const timer = setTimeout(() => finish({ ...IDLE_PREPARE, phase: "error", error: "timeout" }), LIMITS.modelDownloadTimeoutMs);

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const m = e.data;
    if (m.type === "progress") {
      const loadedMB = m.loaded / 1048576;
      const expectedMB = Math.max(sizes.model, m.total / 1048576);
      const percent = Math.min(97, Math.round((loadedMB / expectedMB) * 100));
      // `allDone` alone can be true while only the tiny config files have finished
      // (the big model files not yet requested), so also require real bytes.
      const finishing = (Boolean(m.allDone) && loadedMB >= sizes.model * 0.5) || percent >= 97;
      setPrep({
        phase: finishing ? "finishing" : "downloading",
        percent: finishing ? 97 : percent,
        loadedMB: Math.round(loadedMB),
        expectedMB: Math.round(expectedMB),
      });
    } else if (m.type === "ready") {
      markWhisperReady();
      finish({ phase: "ready", percent: 100, loadedMB: sizes.model, expectedMB: sizes.model });
    } else if (m.type === "error") {
      finish({ ...IDLE_PREPARE, phase: "error", error: m.message || "download-failed" });
    }
  };
  worker.onerror = (e) => finish({ ...IDLE_PREPARE, phase: "error", error: e.message || "worker-error" });
  const request: WorkerRequest = { type: "load", modelId: pickWhisperModel(), remoteHost: whisperRemoteHost() };
  worker.postMessage(request);
}

export function cancelWhisperPrepare(): void {
  try {
    prepWorker?.terminate();
  } catch {
    // ignore
  }
  prepWorker = null;
  setPrep(IDLE_PREPARE);
}

/**
 * BYOK setup: tests the pasted Gemini key with one tiny request and, if it works, saves it.
 * Uses the same observable state as the Whisper download, so the pop-up logic is shared.
 * `error` holds a GeminiErrorKind (or "bad-format") for the pop-up to explain.
 */
export async function startByokSetup(rawKey: string): Promise<void> {
  if (prepState.phase === "finishing") return;
  const key = rawKey.trim();
  if (!looksLikeGeminiKey(key)) {
    setPrep({ ...IDLE_PREPARE, phase: "error", error: "bad-format" });
    return;
  }
  setPrep({ phase: "finishing", percent: 100, loadedMB: 0, expectedMB: 0 });
  const r = await validateByokKey(key);
  if (r.ok) {
    saveByokKey(key);
    setPrep({ phase: "ready", percent: 100, loadedMB: 0, expectedMB: 0 });
  } else {
    const reason: GeminiErrorKind = r.reason;
    setPrep({ ...IDLE_PREPARE, phase: "error", error: reason });
  }
}
