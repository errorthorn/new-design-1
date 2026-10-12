// lib/speaking-whisper-client.ts
//
// In-browser, transcript-only speech capture for Speaking Club AI feedback.
//
// DURING the call this module only LISTENS (cheap): it takes the call's own,
// already-open mic track, cuts the student's speech into utterances (silence is
// dropped) and keeps them — in memory and in the device's own IndexedDB, as
// 16-bit 16 kHz audio. No model runs and nothing is transcribed while the call
// is live, so the conversation is exactly as smooth as without AI feedback.
// AFTER the call, lib/speaking-post-call.ts turns those utterances into text
// with a small Whisper model (Web Worker, on this device) and submits the TEXT
// like any other transcript. The audio never leaves the device and is deleted as
// soon as the text is submitted.
//
//   call mic track ──► AudioContext ──► Resampler(16 kHz) ──► SpeechSegmenter
//                                                                   │ utterances
//                          memory + IndexedDB  ◄────────────────────┘
//
// Respecting the call's mute button: we read the SAME track object the call
// uses (wrapped in a new MediaStream, never cloned), so while the student is
// muted the track delivers silence and nothing is captured.
//
// Everything here is best-effort and must never throw into, block, or slow
// down the live call.
import { Resampler, SpeechSegmenter, TARGET_SAMPLE_RATE } from "@/lib/whisper-segmenter";
import {
  deleteSegment,
  floatToInt16,
  saveSegment,
  saveSession,
  type SessionMeta,
} from "@/lib/speaking-segment-store";

export type CaptureStatus = "starting" | "capturing" | "error" | "too-weak";

export type CaptureState = {
  status: CaptureStatus;
  /** Seconds of the student's speech captured so far (silence excluded). */
  seconds: number;
  segments: number;
  error?: string;
};

// ---------------------------------------------------------------------------
// Model choice
// ---------------------------------------------------------------------------
// English-only checkpoints (".en") are smaller and more accurate for English
// than the multilingual ones of the same size. Both are 8-bit quantised.
//   tiny.en  ~40 MB download — phones / low-end laptops
//   base.en  ~80 MB download — desktops (clearly fewer mis-heard words, which
//            matters because the Gemini feedback is written from this text)
// Override with NEXT_PUBLIC_WHISPER_MODEL (any transformers.js-compatible
// Whisper id) and NEXT_PUBLIC_WHISPER_REMOTE_HOST (to serve the files from
// your own storage/CDN instead of huggingface.co).
const MODEL_TINY = "Xenova/whisper-tiny.en";
const MODEL_BASE = "Xenova/whisper-base.en";

export function pickWhisperModel(): string {
  const forced = process.env.NEXT_PUBLIC_WHISPER_MODEL;
  if (forced) return forced;
  if (typeof navigator === "undefined") return MODEL_TINY;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || isIos();
  const cores = navigator.hardwareConcurrency ?? 2;
  const mem = (navigator as any).deviceMemory as number | undefined; // GB, Chromium only
  return !mobile && cores >= 4 && (mem === undefined || mem >= 4) ? MODEL_BASE : MODEL_TINY;
}

/** Cheap capability gate — only rules out devices that clearly can't do it. */
export function deviceCanRunWhisper(): boolean {
  if (typeof WebAssembly === "undefined" || typeof Worker === "undefined") return false;
  if (typeof AudioContext === "undefined" && typeof (window as any).webkitAudioContext === "undefined") return false;
  const mem = (navigator as any).deviceMemory as number | undefined;
  if (mem !== undefined && mem < 1) return false;
  return true;
}

export function createWhisperWorker(): Worker {
  return new Worker(new URL("./speaking-whisper.worker.ts", import.meta.url), { type: "module" });
}

// ---------------------------------------------------------------------------
// One-time setup (dashboard pop-up): the student taps "Download", we fetch the
// model into the browser cache, remember it is ready. Nothing downloads without
// that tap, on Wi-Fi and mobile data alike, so there is never a surprise.
// ---------------------------------------------------------------------------

/** iPhone/iPad/iPod, including iPadOS which reports itself as a Mac. */
function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

/**
 * EVERY browser uses the in-browser Whisper model for Speaking Club feedback —
 * no exceptions by browser. Web Speech is unreliable or conflicts with the live
 * call on too many platforms (Android, iOS, Edge, Linux, Firefox, WebViews) to
 * trust on any of them, so it is kept only as an emergency backup for devices
 * that can't run the model at all (see deviceCanRunWhisper) or when the
 * requirement is switched off (NEXT_PUBLIC_WHISPER_SETUP_REQUIRED=false).
 */
export function likelyNeedsWhisper(): boolean {
  return typeof window !== "undefined";
}

const readyKey = () => `lc_whisper_ready:${pickWhisperModel()}`;

/** True once the model has been fully downloaded and initialised on this device. */
export function isWhisperReady(): boolean {
  try {
    return localStorage.getItem(readyKey()) === "1";
  } catch {
    return false;
  }
}

export function markWhisperReady() {
  try {
    localStorage.setItem(readyKey(), "1");
  } catch {
    // storage blocked — the model is still cached by the browser
  }
}

/** Does this device need the one-time download and doesn't have it yet? */
export function whisperNeedsSetup(): boolean {
  return likelyNeedsWhisper() && deviceCanRunWhisper() && !isWhisperReady();
}

/**
 * The setup is MANDATORY: such a student can't enter a call until the model is
 * on the device (dashboard pop-up can't be skipped, the room redirects back).
 * Set NEXT_PUBLIC_WHISPER_SETUP_REQUIRED=false to switch the requirement off
 * (then the model just downloads inside the room as before).
 */
export function whisperSetupRequired(): boolean {
  return process.env.NEXT_PUBLIC_WHISPER_SETUP_REQUIRED !== "false" && whisperNeedsSetup();
}

/**
 * The "ready" flag lives in localStorage but the model files live in the
 * browser's Cache Storage, which the browser may evict or the user may clear.
 * If the flag says ready but the files are gone, drop the flag so the setup
 * pop-up asks again instead of silently re-downloading in the middle of a call.
 */
export async function revalidateWhisperReady(): Promise<void> {
  try {
    if (!isWhisperReady() || typeof caches === "undefined") return;
    const id = pickWhisperModel();
    const cache = await caches.open("transformers-cache");
    const keys = await cache.keys();
    const present = keys.some((r) => r.url.includes(id) && /\.onnx(\?|$)/.test(r.url));
    if (!present) localStorage.removeItem(readyKey());
  } catch {
    // can't verify — trust the flag
  }
}

/**
 * Once the model is on the device every student goes straight to it (Web
 * Speech is never used next to a live call), instead of waiting for Web Speech
 * to fail or stay silent.
 */
export function shouldPreferWhisper(): boolean {
  return deviceCanRunWhisper() && isWhisperReady();
}

/** True on cellular / Data Saver, where the download costs the student real money. */
export function onMeteredConnection(): boolean {
  const conn = typeof navigator !== "undefined" ? (navigator as any).connection : null;
  return Boolean(conn?.saveData || conn?.type === "cellular");
}

/** Rough sizes (MB) shown in the pop-up: model files / whole download incl. ONNX runtime. */
export function whisperSizesMB(): { model: number; total: number } {
  const id = pickWhisperModel();
  if (id === MODEL_BASE) return { model: 80, total: 100 };
  if (id === MODEL_TINY) return { model: 40, total: 60 };
  return { model: 60, total: 80 };
}

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
  const timer = setTimeout(() => finish({ ...IDLE_PREPARE, phase: "error", error: "timeout" }), 20 * 60_000);

  worker.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m?.type === "progress") {
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
    } else if (m?.type === "ready") {
      markWhisperReady();
      finish({ phase: "ready", percent: 100, loadedMB: sizes.model, expectedMB: sizes.model });
    } else if (m?.type === "error") {
      finish({ ...IDLE_PREPARE, phase: "error", error: String(m.message ?? "download-failed") });
    }
  };
  worker.onerror = (e) => finish({ ...IDLE_PREPARE, phase: "error", error: e.message || "worker-error" });
  worker.postMessage({ type: "load", modelId: pickWhisperModel(), remoteHost: process.env.NEXT_PUBLIC_WHISPER_REMOTE_HOST });
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

// ---------------------------------------------------------------------------
// The in-call capture
// ---------------------------------------------------------------------------

// Cap on how much speech we keep per call: ~30 min of actual talking is about
// 58 MB of 16-bit audio. Beyond that the OLDEST utterances are dropped.
const MAX_SPEECH_SECONDS = 30 * 60;
const TRACK_WATCH_MS = 2000;
const HEARTBEAT_MS = 20_000;

let activeCaptures = 0;
/** True while any call in this tab is being captured (the post-call engine waits for it). */
export function isAnyCaptureActive(): boolean {
  return activeCaptures > 0;
}

export type CaptureResult = { meta: SessionMeta; segments: Int16Array[] };

type CaptureSessionInfo = Pick<SessionMeta, "shiftId" | "studentUsername" | "topicTitle" | "cueCardQuestions">;

export class SpeakingAudioCapture {
  private readonly getTrack: () => MediaStreamTrack | null;
  private readonly getInfo: () => CaptureSessionInfo | null;
  private readonly getPrior: () => string;
  private readonly onState: (state: CaptureState) => void;

  private readonly sessionId: string;
  private readonly createdAt = Date.now();
  private state: CaptureState = { status: "starting", seconds: 0, segments: 0 };
  private entries: { idx: number; data: Int16Array }[] = [];
  private nextIdx = 0;
  private seconds = 0;
  private started = false;
  private stopped = false;
  private disposed = false;
  private counted = false;

  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioNode | null = null;
  private sinkNode: GainNode | null = null;
  private currentTrack: MediaStreamTrack | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unlockHandler: (() => void) | null = null;
  private resampler: Resampler | null = null;
  private segmenter = new SpeechSegmenter();

  constructor(opts: {
    getTrack: () => MediaStreamTrack | null;
    /** Who/what this session belongs to; null until a real shift is known. */
    getInfo: () => CaptureSessionInfo | null;
    /** Text another engine (Web Speech) already captured earlier in this call. */
    getPrior: () => string;
    onState: (state: CaptureState) => void;
  }) {
    this.getTrack = opts.getTrack;
    this.getInfo = opts.getInfo;
    this.getPrior = opts.getPrior;
    this.onState = opts.onState;
    this.sessionId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private setState(patch: Partial<CaptureState>) {
    this.state = { ...this.state, ...patch, seconds: Math.round(this.seconds), segments: this.entries.length };
    try {
      this.onState(this.state);
    } catch {
      // UI callbacks must never break capture
    }
  }

  private buildMeta(status: SessionMeta["status"]): SessionMeta | null {
    const info = this.getInfo();
    if (!info) return null;
    return {
      sessionId: this.sessionId,
      ...info,
      priorTranscript: this.getPrior(),
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      status,
      attempts: 0,
      segmentCount: this.entries.length,
    };
  }

  /** Starts listening to the call's mic. Idempotent; never throws. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;

    if (!deviceCanRunWhisper()) {
      this.setState({ status: "too-weak", error: "device-unsupported" });
      return;
    }
    try {
      activeCaptures++;
      this.counted = true;
      await this.attachAudio();
      this.watchTimer = setInterval(() => this.watchTrack(), TRACK_WATCH_MS);
      this.heartbeatTimer = setInterval(() => {
        const meta = this.buildMeta("capturing");
        if (meta) void saveSession(meta);
      }, HEARTBEAT_MS);
      const meta = this.buildMeta("capturing");
      if (meta) void saveSession(meta);
      this.setState({ status: "capturing" });
    } catch (err) {
      this.setState({ status: "error", error: err instanceof Error ? err.message : "start-failed" });
    }
  }

  // ---- audio capture ------------------------------------------------------

  private async attachAudio() {
    const track = this.getTrack();
    if (!track || track.readyState !== "live") return; // watchTrack() retries
    this.currentTrack = track;

    const Ctor: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!this.audioCtx) {
      // Default sample rate on purpose: forcing 16 kHz makes Firefox/Safari
      // refuse to connect a MediaStream source. We resample ourselves.
      this.audioCtx = new Ctor();
      this.resampler = new Resampler(this.audioCtx.sampleRate, TARGET_SAMPLE_RATE);
    }
    const audioCtx = this.audioCtx;
    if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
    if (!this.unlockHandler) {
      // iOS Safari starts (and after a phone call / app switch, "interrupts")
      // AudioContexts until a user gesture: resume on any tap/key and on state
      // changes so capture can't silently stay dead.
      this.unlockHandler = () => {
        const st = this.audioCtx?.state as string | undefined;
        if (st === "suspended" || st === "interrupted") void this.audioCtx?.resume().catch(() => {});
      };
      for (const ev of ["pointerdown", "touchend", "keydown"]) {
        window.addEventListener(ev, this.unlockHandler, { passive: true });
      }
      document.addEventListener("visibilitychange", this.unlockHandler);
      audioCtx.onstatechange = this.unlockHandler;
    }

    this.detachSource();
    // Same track the call uses, wrapped (not cloned) so call-mute silences us too.
    this.sourceNode = audioCtx.createMediaStreamSource(new MediaStream([track]));

    if (!this.captureNode) {
      this.sinkNode = audioCtx.createGain();
      this.sinkNode.gain.value = 0; // keeps the graph pulled without any audible output
      this.sinkNode.connect(audioCtx.destination);

      let node: AudioNode | null = null;
      if (typeof AudioWorkletNode !== "undefined" && audioCtx.audioWorklet) {
        try {
          const code = `
            class LcCapture extends AudioWorkletProcessor {
              constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
              process(inputs) {
                const ch = inputs[0] && inputs[0][0];
                if (ch) {
                  for (let i = 0; i < ch.length; i++) {
                    this.buf[this.n++] = ch[i];
                    if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0; }
                  }
                }
                return true;
              }
            }
            registerProcessor("lc-capture", LcCapture);`;
          const url = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
          await audioCtx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);
          const wn = new AudioWorkletNode(audioCtx, "lc-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
          wn.port.onmessage = (e: MessageEvent<Float32Array>) => this.onAudio(e.data);
          node = wn;
        } catch {
          node = null; // e.g. CSP or old Safari — use the ScriptProcessor below
        }
      }
      if (!node) {
        // Deprecated but universally available fallback.
        const sp = audioCtx.createScriptProcessor(4096, 1, 1);
        sp.onaudioprocess = (e) => this.onAudio(new Float32Array(e.inputBuffer.getChannelData(0)));
        node = sp;
      }
      node.connect(this.sinkNode);
      this.captureNode = node;
    }

    this.sourceNode.connect(this.captureNode!);
  }

  private detachSource() {
    try {
      this.sourceNode?.disconnect();
    } catch {
      // already disconnected
    }
    this.sourceNode = null;
  }

  /** The call may replace its mic track (reconnect, device change): follow it. */
  private watchTrack() {
    if (this.disposed || this.stopped) return;
    const st = this.audioCtx?.state as string | undefined;
    if (st === "suspended" || st === "interrupted") void this.audioCtx?.resume().catch(() => {});
    const latest = this.getTrack();
    if (!latest || latest.readyState !== "live") return;
    if (latest !== this.currentTrack) {
      void this.attachAudio().catch(() => {});
    }
  }

  private onAudio(chunk: Float32Array) {
    if (this.disposed || this.stopped || !this.resampler) return;
    try {
      const pcm = this.resampler.push(chunk);
      if (pcm.length === 0) return;
      for (const seg of this.segmenter.push(pcm)) this.addSegment(seg.samples, seg.durationMs);
    } catch {
      // never let audio processing throw into the audio thread callback
    }
  }

  private addSegment(samples: Float32Array, durationMs: number) {
    const data = floatToInt16(samples);
    const idx = this.nextIdx++;
    this.entries.push({ idx, data });
    this.seconds += durationMs / 1000;
    void saveSegment(this.sessionId, idx, data); // mirror to IndexedDB (best-effort)

    // Memory cap: drop the oldest utterances once past ~30 min of speech.
    while (this.seconds > MAX_SPEECH_SECONDS && this.entries.length > 1) {
      const old = this.entries.shift()!;
      this.seconds -= old.data.length / TARGET_SAMPLE_RATE;
      void deleteSegment(this.sessionId, old.idx);
    }
    this.setState({});
  }

  // ---- finishing ----------------------------------------------------------

  /**
   * Ends the capture (call over): closes the open utterance, releases the audio
   * graph and returns everything captured, to be handed to the post-call engine.
   * Returns null if capture never started or no shift is known.
   */
  stop(): CaptureResult | null {
    if (this.stopped) return null;
    this.stopped = true;
    try {
      const last = this.segmenter.flush();
      if (last) this.addSegment(last.samples, last.durationMs);
    } catch {
      // ignore
    }
    const meta = this.started ? this.buildMeta("ready") : null;
    if (meta) void saveSession(meta); // the engine re-saves with its own bookkeeping later
    const segments = this.entries.map((e) => e.data);
    this.releaseAudio();
    return meta ? { meta, segments } : null;
  }

  /** Stops listening WITHOUT handing anything over (page left mid-call, etc.). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseAudio();
  }

  private releaseAudio() {
    if (this.watchTimer) clearInterval(this.watchTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.watchTimer = null;
    this.heartbeatTimer = null;
    if (this.unlockHandler) {
      for (const ev of ["pointerdown", "touchend", "keydown"]) window.removeEventListener(ev, this.unlockHandler);
      document.removeEventListener("visibilitychange", this.unlockHandler);
      this.unlockHandler = null;
    }
    this.detachSource();
    try {
      this.captureNode?.disconnect();
      this.sinkNode?.disconnect();
    } catch {
      // ignore
    }
    try {
      void this.audioCtx?.close();
    } catch {
      // ignore
    }
    this.audioCtx = null;
    this.captureNode = null;
    this.sinkNode = null;
    if (this.counted) {
      this.counted = false;
      activeCaptures = Math.max(0, activeCaptures - 1);
    }
  }
}
