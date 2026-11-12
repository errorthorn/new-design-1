// lib/speaking-club/config.ts
//
// Single source of truth for every deploy-time setting and operational limit of
// the Speaking Club AI-feedback pipeline (browser side). Nothing else in
// lib/speaking-club reads process.env or hard-codes these numbers.
//
// NEXT_PUBLIC_* variables must be referenced literally (process.env.NEXT_PUBLIC_X)
// for Next.js to inline them into the client bundle, so each one is read in its
// own getter. Getters (not constants) keep the values overridable in tests.

export const WHISPER_MODEL_TINY = "Xenova/whisper-tiny.en";
export const WHISPER_MODEL_BASE = "Xenova/whisper-base.en";
/** Moonshine (English only). Its cost grows with the audio length instead of a fixed 30 s window. Opt in with NEXT_PUBLIC_WHISPER_MODEL. */
export const WHISPER_MODEL_MOONSHINE = "onnx-community/moonshine-tiny-ONNX";

// ---- environment-driven settings ------------------------------------------

/**
 * Whisper checkpoint (transformers.js id). Default: tiny.en (~40 MB) for
 * everyone — roughly 2-3x faster than base, which is what lets live
 * transcription keep up with a talking student. base.en is more accurate but too
 * slow on most devices; opt in with NEXT_PUBLIC_WHISPER_MODEL.
 */
export function whisperModelId(): string {
  return process.env.NEXT_PUBLIC_WHISPER_MODEL || WHISPER_MODEL_TINY;
}

/** Serve the model files from your own storage/CDN instead of huggingface.co. */
export function whisperRemoteHost(): string | undefined {
  return process.env.NEXT_PUBLIC_WHISPER_REMOTE_HOST || undefined;
}

/** Transcribe during the call on devices with headroom. Off with NEXT_PUBLIC_WHISPER_LIVE=false. */
export function liveTranscriptionAllowed(): boolean {
  return process.env.NEXT_PUBLIC_WHISPER_LIVE !== "false";
}

/**
 * BYOK (default ON): instead of the on-device Whisper model, every student brings their own
 * free Gemini API key (Google AI Studio). Their speech chunks go straight from their browser
 * to Google with THEIR key; nothing passes through our server and no model is downloaded.
 * The key is entered once in the setup pop-up (mandatory) and kept in localStorage.
 * Switch back to Whisper with NEXT_PUBLIC_GEMINI_BYOK=false.
 */
export function byokEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GEMINI_BYOK !== "false";
}
/** Wait before the first re-try round of failed chunks (BYOK). NEXT_PUBLIC_FAILED_RETRY_WAIT_MS overrides (the tests use 1). */
export function failedChunkRetryWaitMs(): number {
  const raw = process.env.NEXT_PUBLIC_FAILED_RETRY_WAIT_MS;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : LIMITS.failedChunkRetryWaitMs;
}
export const GEMINI_BYOK = {
  endpoint: "https://generativelanguage.googleapis.com/v1beta",
  /** One request may not take longer than this. */
  requestTimeoutMs: 45_000,
  /** Extra tries for a rate-limited (429) or server-side (5xx) answer. */
  retries: 2,
  retryWaitMs: 8_000,
  /** Longest wait the server may ask for that we still honour (otherwise the quota is gone: give up on the chunk). */
  maxServerRetryMs: 30_000,
} as const;
/**
 * Which Gemini model transcribes. A lite model is the default because free keys have small
 * per-day request quotas (check the live limits in AI Studio). NEXT_PUBLIC_GEMINI_MODEL overrides.
 */
export function byokModel(): string {
  return process.env.NEXT_PUBLIC_GEMINI_MODEL || "gemini-3.1-flash-lite";
}

/** Students must finish the one-time model download before entering a call. Off with NEXT_PUBLIC_WHISPER_SETUP_REQUIRED=false. */
export function modelSetupRequired(): boolean {
  return process.env.NEXT_PUBLIC_WHISPER_SETUP_REQUIRED !== "false";
}

/**
 * Time budget (ms) for the mandatory wait after a call, model loading excluded.
 * Normally only a small tail is left; this bounds the worst case. Env:
 * NEXT_PUBLIC_WHISPER_MAX_WAIT_SEC.
 */
export function postCallWaitBudgetMs(): number {
  const n = Number(process.env.NEXT_PUBLIC_WHISPER_MAX_WAIT_SEC);
  return (Number.isFinite(n) && n > 0 ? n : 240) * 1000;
}

/**
 * OPT-IN speed-ups, default OFF so nothing changes until you have tested them on
 * real student phones. Turn on in Vercel env + redeploy.
 *  - NEXT_PUBLIC_WHISPER_WEBGPU=true: run Whisper on the GPU where the device has
 *    WebGPU; any failure falls back to the normal WASM path automatically.
 *  - NEXT_PUBLIC_WHISPER_MULTITHREAD=true: multi-thread WASM. Also needs the
 *    COOP/COEP headers on the room route (next.config.mjs, same flag).
 */
export function whisperWebGpuEnabled(): boolean {
  return process.env.NEXT_PUBLIC_WHISPER_WEBGPU === "true";
}

/**
 * Time budget (ms) for finishing a call in the BACKGROUND (weak device, big backlog
 * or an older session). Far larger than the blocking wait, so the whole call is
 * transcribed instead of a sample. Env: NEXT_PUBLIC_WHISPER_BACKGROUND_MAX_SEC.
 */
export function backgroundBudgetMs(): number {
  const n = Number(process.env.NEXT_PUBLIC_WHISPER_BACKGROUND_MAX_SEC);
  return (Number.isFinite(n) && n > 0 ? n : 45 * 60) * 1000;
}

/**
 * OPT-IN cloud fallback (default OFF). When on, speech that this device cannot
 * transcribe fast enough is sent, as short audio chunks, to OUR server route
 * (/api/speaking-club/transcribe-chunk), which relays it to a hosted Whisper API
 * (Groq) and returns text. It needs GROQ_API_KEY on the server. This changes the
 * "audio never leaves the device" promise, so the student-facing text must say so
 * (the setup dialog does when this is on).
 */
export function cloudTranscribeEnabled(): boolean {
  // Never together with BYOK: the BYOK pop-up promises the audio goes only to the student's own
  // Google key, never through our server (and never to Groq with OUR key).
  return !byokEnabled() && process.env.NEXT_PUBLIC_CLOUD_TRANSCRIBE === "true";
}

/**
 * OPT-IN partner offload (default OFF). A weak device sends its speech, compressed,
 * over a WebRTC data channel to the partner it is already talking to; if the
 * partner's device is strong, it transcribes it and sends the text back.
 */
export function peerOffloadEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PEER_OFFLOAD === "true";
}

/**
 * OPT-IN model copies working in parallel (default OFF; real RAM use per copy has not
 * been measured on real phones). One primary copy transcribes the student's speech as
 * it comes; helper copies share the chunks that piled up, while the student is silent
 * during the call and, after the call, as many as the device can spare. The transcript
 * order never depends on which copy finishes first.
 * NEXT_PUBLIC_WHISPER_POOL=true; NEXT_PUBLIC_WHISPER_POOL_MAX = most copies in total (default 3: the primary + 2 helpers).
 */
export function whisperPoolEnabled(): boolean {
  return !byokEnabled() && process.env.NEXT_PUBLIC_WHISPER_POOL === "true";
}
export function whisperPoolMax(): number {
  const n = Math.floor(Number(process.env.NEXT_PUBLIC_WHISPER_POOL_MAX));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 8) : 3;
}

/**
 * How much speech (seconds) the live step collects before it sends a chunk to the model.
 * Default 12 s: shorter chunks mean the part still waiting when the call ends (the "tail")
 * is small, so the background finish after the call is quick. Whisper's cost per chunk is
 * nearly fixed, so a device that is falling behind (throttled) switches to
 * SLOW_DEVICE_CHUNK_SECONDS to do less total work. Allowed 6-27.
 * Env: NEXT_PUBLIC_WHISPER_LIVE_CHUNK_SEC.
 */
export const SLOW_DEVICE_CHUNK_SECONDS = 22;
export function liveChunkSeconds(): number {
  const n = Number(process.env.NEXT_PUBLIC_WHISPER_LIVE_CHUNK_SEC);
  // BYOK: the cost is requests (free quota), not CPU, so use long chunks.
  return Number.isFinite(n) && n >= 6 && n <= 27 ? n : byokEnabled() ? 25 : 12;
}

export const CLOUD = {
  /** Chunks sent to the server at the same time. */
  concurrency: 3,
  /** On a device that is NOT cloud-first: switch the rest to the cloud when finishing locally would take longer than this. */
  switchProjectedMs: 120_000,
  /** ...but only after this many chunks were timed locally. */
  minLocalSamples: 2,
  requestTimeoutMs: 60_000,
  /** Server refuses audio longer than this (seconds). */
  maxChunkSeconds: 30,
  /** After a 429 the cloud is left alone for this long. */
  rateLimitPauseMs: 60_000,
} as const;

export const PEER = {
  /** Bytes of compressed audio per data-channel message (kept well under the 64 KB common limit). */
  frameBytes: 16 * 1024,
  /** Pause sending while this much is still queued in the channel. */
  highWaterBytes: 256 * 1024,
  /** How long the partner may take to answer one chunk. */
  requestTimeoutMs: 75_000,
  /** The helper refuses new work when its own backlog is above this many seconds. */
  helperMaxBacklogSec: 40,
  /** Stop offloading to a partner after this many failed chunks in a row. */
  maxFailures: 3,
} as const;

// ---- device gates ----------------------------------------------------------

/** Below this the model is not attempted at all. */
export const MODEL_MIN_MEMORY_GB = 1;

// ---- operational limits ----------------------------------------------------

export const LIMITS = {
  /** Speech kept IN MEMORY on devices that do not transcribe live (70 min ≈ 135 MB of 16-bit audio). */
  maxSpeechSecondsInMemory: 70 * 60,
  /** Live transcription slows down (≈50% duty) once this much speech is waiting... */
  liveThrottleAboveBacklogSec: 150,
  /** ...and returns to full speed once the backlog is back under this. */
  liveUnthrottleBelowBacklogSec: 45,
  /** Capture heartbeat (lets a later visit tell "still in a call" from "tab was closed"). */
  captureHeartbeatMs: 20_000,
  captureTrackWatchMs: 2_000,
  /** A "capturing" session whose heartbeat is this stale counts as abandoned and is resumed. */
  abandonedSessionMs: 90_000,
  /** A session that keeps failing is eventually given up on, and never kept longer than this. */
  postCallMaxAttempts: 5,
  postCallMaxAgeMs: 3 * 24 * 60 * 60 * 1000,
  /** Model download / load / one chunk may not take longer than this. */
  modelLoadTimeoutMs: 10 * 60_000,
  modelDownloadTimeoutMs: 20 * 60_000,
  chunkTimeoutMs: 120_000,
  /** After a call, at most this many leftover chunks (~25 s of speech each) keep the student on the wait screen. */
  blockingMaxChunks: 4,
  /** BYOK: a chunk that failed (network blip, Google hiccup) is tried again this many extra rounds, waiting 1x, 2x... this long before each round. */
  failedChunkRetryRounds: 2,
  failedChunkRetryWaitMs: 4_000,
  /** BYOK: during the call, a chunk that failed goes back to the end of the live queue this many times (waiting 1x, 2x the retry wait before each), so a hiccup is fixed while the call runs and not after it. */
  liveFailedRetries: 6,
  /** BYOK: longest pause (ms) before a failed live chunk goes back in the queue (the pause grows 1x, 2x, 3x... up to this). 6 tries cover a per-minute quota reset. */
  liveRetryMaxWaitMs: 30_000,
  /** BYOK: how many chunks are sent to Google at the same time during the call, so one slow request cannot hold the rest of a long call back. */
  byokLiveLanes: 2,
  /** BYOK: one chunk (all the request's own retries included) may take this long before it counts as failed. */
  byokChunkTimeoutMs: 200_000,
  /** BYOK: after the call, the extra rounds for chunks that still failed may not start later than this (ms) after those rounds begin. Bounds the wait a persistently failing chunk can cause. */
  postCallRetryBudgetMs: 90_000,
  /**
   * BYOK: if more than this share of a call's chunks (and at least 2) still failed after the retries, the
   * transcript is NOT sent: the audio stays on the device and the whole call is retried on a later visit
   * (a mostly-empty transcript would give the student wrong feedback and the audio would be gone).
   */
  retryLaterFailureRatio: 0.25,
  /** BYOK: a session whose last try failed is not retried again for this long (a page focus must not hammer the student's quota). */
  byokRetryCooldownMs: 5 * 60_000,
} as const;
