// lib/speaking-club/device.ts
//
// Browser / device capability checks for the Speaking Club AI-feedback pipeline.
// Pure functions of `navigator` / `window`; safe to call during SSR (they just
// answer "no").
import { MODEL_MIN_MEMORY_GB, byokEnabled, liveTranscriptionAllowed } from "@/lib/speaking-club/config";

type NavigatorWithHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; type?: string } };
const nav = (): NavigatorWithHints | null => (typeof navigator === "undefined" ? null : (navigator as NavigatorWithHints));

/** iPhone/iPad/iPod, including iPadOS which reports itself as a Mac. */
export function isIos(): boolean {
  const n = nav();
  if (!n) return false;
  return /iPad|iPhone|iPod/.test(n.userAgent) || (n.platform === "MacIntel" && (n.maxTouchPoints ?? 0) > 1);
}

/** Cheap capability gate: only rules out devices that clearly cannot run the model at all. */
export function deviceCanRunWhisper(): boolean {
  // BYOK: the work happens at Google, so the phone only has to be able to record.
  if (byokEnabled()) return deviceCanCaptureAudio();
  if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") return false;
  const hasAudioContext =
    typeof AudioContext !== "undefined" ||
    (typeof window !== "undefined" && typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined");
  if (!hasAudioContext) return false;
  const mem = nav()?.deviceMemory;
  if (mem !== undefined && mem < MODEL_MIN_MEMORY_GB) return false;
  return true;
}

/** Cores / RAM as far as the browser tells (RAM is Chromium-only and rounded). */
export function deviceHints(): { cores?: number; memoryGB?: number } {
  const n = nav();
  return { cores: n?.hardwareConcurrency, memoryGB: n?.deviceMemory };
}

/** Can this browser at least COLLECT the student's speech (so the cloud or a partner can transcribe it later)? */
export function deviceCanCaptureAudio(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof AudioContext !== "undefined" ||
    typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext !== "undefined"
  );
}

/**
 * Live (during-call) transcription runs on EVERY device that can run the model,
 * weak phones included. A slow device is not excluded: ChunkTranscriber throttles
 * itself (~50% duty) so the call stays smooth, and the post-call step finishes the rest.
 */
export function liveTranscriptionEnabled(): boolean {
  return liveTranscriptionAllowed() && nav() !== null;
}

/** True on cellular / Data Saver, where the model download costs the student real money. */
export function onMeteredConnection(): boolean {
  const c = nav()?.connection;
  return Boolean(c?.saveData || c?.type === "cellular");
}
