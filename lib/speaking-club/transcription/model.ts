// lib/speaking-club/transcription/model.ts
//
// The Whisper model on THIS device: which checkpoint, how to start its worker,
// and whether it has already been downloaded ("ready").
//
// The "ready" flag lives in localStorage but the model files live in the
// browser's Cache Storage, which the browser may evict or the user may clear, so
// `revalidateWhisperReady()` checks the files too.
import { WHISPER_MODEL_BASE, WHISPER_MODEL_TINY, byokEnabled, modelSetupRequired, whisperModelId } from "@/lib/speaking-club/config";
import { deviceCanRunWhisper } from "@/lib/speaking-club/device";
import { clearByokReady, createByokWorker, getByokKey, isByokReady, saveByokKey } from "@/lib/speaking-club/transcription/byok";

export const pickWhisperModel = whisperModelId;

/** The transcription "worker": the BYOK Gemini adapter, or (BYOK off) the on-device Whisper worker. */
export function createWhisperWorker(): Worker {
  if (byokEnabled()) return createByokWorker();
  return new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
}

const readyKey = () => `lc_whisper_ready:${pickWhisperModel()}`;
const CACHE_NAME = "transformers-cache"; // transformers.js' Cache Storage bucket

/** True once the model has been fully downloaded and initialised on this device. */
export function isWhisperReady(): boolean {
  if (byokEnabled()) return isByokReady(); // BYOK: "ready" = a working key is saved
  try {
    return localStorage.getItem(readyKey()) === "1";
  } catch {
    return false;
  }
}

export function markWhisperReady(): void {
  if (byokEnabled()) {
    // The key itself is saved by the setup step; here we only keep an existing key marked ready.
    const k = getByokKey();
    if (k) saveByokKey(k);
    return;
  }
  try {
    localStorage.setItem(readyKey(), "1");
  } catch {
    // storage blocked — the model is still cached by the browser
  }
}

/**
 * If the flag says ready but the model files are gone from Cache Storage, drop
 * the flag so the setup pop-up asks again, instead of silently re-downloading in
 * the middle of a call.
 */
export async function revalidateWhisperReady(): Promise<void> {
  if (byokEnabled()) {
    if (!getByokKey()) clearByokReady(); // key was cleared from the browser: ask again
    return;
  }
  try {
    if (!isWhisperReady() || typeof caches === "undefined") return;
    const id = pickWhisperModel();
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const present = keys.some((r) => r.url.includes(id) && /\.onnx(\?|$)/.test(r.url));
    if (!present) localStorage.removeItem(readyKey());
  } catch {
    // can't verify — trust the flag
  }
}

/** Does this device need the one-time download and not have it yet? */
export function whisperNeedsSetup(): boolean {
  return typeof window !== "undefined" && deviceCanRunWhisper() && !isWhisperReady();
}

/**
 * The setup is MANDATORY: such a student can't enter a call until the model is on
 * the device (the dashboard pop-up can't be skipped, the room redirects back).
 * Switched off with NEXT_PUBLIC_WHISPER_SETUP_REQUIRED=false.
 */
export function whisperSetupRequired(): boolean {
  return modelSetupRequired() && whisperNeedsSetup();
}

/**
 * Once the model is on the device every student goes straight to it (Web Speech
 * is never used next to a live call), instead of waiting for it to fail or stay silent.
 */
export function shouldPreferWhisper(): boolean {
  return deviceCanRunWhisper() && isWhisperReady();
}

/** Rough sizes (MB) shown in the pop-up: model files / whole download incl. the ONNX runtime. */
export function whisperSizesMB(): { model: number; total: number } {
  const id = pickWhisperModel();
  if (id === WHISPER_MODEL_BASE) return { model: 80, total: 100 };
  if (id === WHISPER_MODEL_TINY) return { model: 40, total: 60 };
  return { model: 60, total: 80 };
}
