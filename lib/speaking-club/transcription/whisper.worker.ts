/// <reference lib="webworker" />
// lib/speaking-club/transcription/whisper.worker.ts
//
// Web Worker for the in-browser Whisper fallback of Speaking Club AI feedback
// (client side: lib/speaking-club/audio/capture.ts). Runs entirely on the
// student's device — no audio ever leaves the browser, only the resulting
// text is later submitted like any other transcript.
//
// Protocol
//   main -> worker  { type: "load", modelId, remoteHost? }
//                   { type: "transcribe", id, audio: Float32Array (16 kHz mono) }
//   worker -> main  { type: "progress", loaded, total }       (model download)
//                   { type: "ready" }
//                   { type: "result", id, text }
//                   { type: "error", id?, message, fatal }
//
// The model files come from the Hugging Face CDN on first use and are then
// kept by the browser (Cache Storage), so later visits load from disk.
import { pipeline, env } from "@huggingface/transformers";
import type { WorkerRequest, WorkerResponse } from "@/lib/speaking-club/transcription/protocol";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

env.allowLocalModels = false;
env.useBrowserCache = true;

type Asr = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

let asr: Asr | null = null;
let loading: Promise<void> | null = null;
let englishOnly = false;
let isMoonshine = false;

function post(msg: WorkerResponse) {
  ctx.postMessage(msg);
}

/**
 * Per-call model options. Whisper English-only checkpoints take none; multilingual
 * Whisper needs the language; Moonshine has no language option but caps the output
 * at 6 tokens per FULL second of audio, which would be 0 for a clip under 1 s, so
 * the cap is given explicitly.
 */
function callOptions(seconds: number): Record<string, unknown> {
  if (isMoonshine) return { max_new_tokens: Math.max(16, Math.ceil(seconds * 6)) };
  return englishOnly ? { return_timestamps: false } : { language: "english", task: "transcribe", return_timestamps: false };
}

// The model is not re-entrant: a call from this device's own transcription and one
// for a partner (peer offload) must never run at the same time.
let runChain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = runChain.then(fn, fn);
  runChain = p.catch(() => undefined);
  return p;
}

async function load(modelId: string, remoteHost?: string, webgpu?: boolean) {
  if (asr) {
    post({ type: "ready" });
    return;
  }
  if (loading) return loading;

  if (remoteHost) env.remoteHost = remoteHost;
  // ".en" checkpoints are English-only and REJECT a language/task option. So does Moonshine.
  isMoonshine = /moonshine/i.test(modelId);
  englishOnly = /\.en$/i.test(modelId) || isMoonshine;

  // Aggregate per-file download progress into one loaded/total pair, plus an
  // `allDone` flag (every file seen so far finished) so the UI can switch to
  // its "finishing" step while the ONNX runtime initialises.
  const files = new Map<string, { loaded: number; total: number; done: boolean }>();
  let lastPost = 0;
  const postProgress = (force: boolean) => {
    const now = Date.now();
    if (!force && now - lastPost < 250) return;
    lastPost = now;
    let loaded = 0;
    let total = 0;
    let allDone = files.size >= 3;
    files.forEach((f) => {
      loaded += f.loaded;
      total += f.total;
      if (!f.done) allDone = false;
    });
    post({ type: "progress", loaded, total, allDone });
  };

  // Multi-thread WASM only when the page is cross-origin isolated (the room route
  // sends COOP/COEP when NEXT_PUBLIC_WHISPER_MULTITHREAD is on). Otherwise 1 thread,
  // exactly as before. Leave one core for the call itself.
  try {
    if (ctx.crossOriginIsolated) {
      const cores = ctx.navigator?.hardwareConcurrency ?? 2;
      env.backends.onnx.wasm!.numThreads = Math.max(1, Math.min(4, cores - 1));
    }
  } catch {
    // keep the default
  }

  const runSelfTest = async (a: Asr) => {
    // Self-test. A model that merely LOADED can still fail to RUN on a device (WASM
    // out of memory, runtime blocked, an unsupported browser build...). Run one
    // second of silence now, so such a device is caught during the one-time setup
    // instead of in the middle of a student's call. It also warms the model up.
    await a(new Float32Array(16000), callOptions(1));
  };

  const progressCb = (info: unknown) => {
    const p = info as { status?: string; file?: string; loaded?: number; total?: number };
    if (typeof p?.file !== "string") return;
    if (p.status === "initiate") {
      files.set(p.file, { loaded: 0, total: 0, done: false });
    } else if (p.status === "progress") {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0, done: false });
      postProgress(false);
    } else if (p.status === "done") {
      const prev = files.get(p.file);
      const total = prev?.total ?? 0;
      files.set(p.file, { loaded: total, total, done: true });
      postProgress(true);
    }
  };

  loading = (async () => {
    // Optional GPU path (opt-in). ANY failure — no WebGPU, model files missing for
    // that dtype, self-test error — silently falls back to the proven WASM q8 path.
    const hasGpu = Boolean(webgpu) && typeof (ctx.navigator as unknown as { gpu?: unknown })?.gpu !== "undefined";
    if (hasGpu) {
      try {
        const gpuPipe = await pipeline("automatic-speech-recognition", modelId, {
          device: "webgpu",
          dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
          progress_callback: progressCb,
        });
        const candidate = gpuPipe as unknown as Asr;
        await runSelfTest(candidate);
        asr = candidate;
        post({ type: "ready" });
        return;
      } catch {
        asr = null; // fall through to WASM
      }
    }

    // 8-bit quantised weights: smallest download, runs on plain WASM
    // everywhere (no WebGPU / SharedArrayBuffer needed). For checkpoints that may
    // not ship q8 files (Moonshine) fall back to full precision rather than fail.
    const dtypes = isMoonshine ? (["q8", "fp32"] as const) : (["q8"] as const);
    let pipe: unknown = null;
    for (let i = 0; i < dtypes.length; i++) {
      try {
        pipe = await pipeline("automatic-speech-recognition", modelId, {
          dtype: dtypes[i],
          device: "wasm",
          progress_callback: progressCb,
        });
        break;
      } catch (err) {
        if (i === dtypes.length - 1) throw err;
      }
    }
    asr = pipe as unknown as Asr;
    try {
      await runSelfTest(asr);
    } catch (err) {
      asr = null;
      throw new Error(`self-test failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    post({ type: "ready" });
  })();

  try {
    await loading;
  } catch (err) {
    loading = null;
    post({ type: "error", message: err instanceof Error ? err.message : String(err), fatal: true });
  }
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "load") {
    await load(String(msg.modelId), typeof msg.remoteHost === "string" ? msg.remoteHost : undefined, msg.webgpu === true);
    return;
  }
  if (msg.type === "transcribe") {
    const id = msg.id;
    if (!asr) {
      post({ type: "error", id, message: "model not loaded", fatal: false });
      return;
    }
    try {
      // Utterances are cut to <= 27 s by the segmenter, so no chunking needed.
      const audio = msg.audio as Float32Array;
      const run = asr;
      const out = await serial(() => run(audio, callOptions(audio.length / 16000)));
      const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
      post({ type: "result", id, text: (text ?? "").trim() });
    } catch (err) {
      post({ type: "error", id, message: err instanceof Error ? err.message : String(err), fatal: false });
    }
  }
};
