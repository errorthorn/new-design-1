/// <reference lib="webworker" />
// lib/speaking-whisper.worker.ts
//
// Web Worker for the in-browser Whisper fallback of Speaking Club AI feedback
// (client side: lib/speaking-whisper-client.ts). Runs entirely on the
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

const ctx = self as unknown as DedicatedWorkerGlobalScope;

env.allowLocalModels = false;
env.useBrowserCache = true;

type Asr = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>;

let asr: Asr | null = null;
let loading: Promise<void> | null = null;
let englishOnly = false;

function post(msg: Record<string, unknown>) {
  ctx.postMessage(msg);
}

async function load(modelId: string, remoteHost?: string) {
  if (asr) {
    post({ type: "ready" });
    return;
  }
  if (loading) return loading;

  if (remoteHost) env.remoteHost = remoteHost;
  // ".en" checkpoints are English-only and REJECT a language/task option.
  englishOnly = /\.en$/i.test(modelId);

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

  loading = (async () => {
    const pipe = await pipeline("automatic-speech-recognition", modelId, {
      // 8-bit quantised weights: smallest download, runs on plain WASM
      // everywhere (no WebGPU / SharedArrayBuffer needed).
      dtype: "q8",
      device: "wasm",
      progress_callback: (p: any) => {
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
      },
    });
    asr = pipe as unknown as Asr;
    post({ type: "ready" });
  })();

  try {
    await loading;
  } catch (err) {
    loading = null;
    post({ type: "error", message: err instanceof Error ? err.message : String(err), fatal: true });
  }
}

ctx.onmessage = async (event: MessageEvent) => {
  const msg = event.data;
  if (msg?.type === "load") {
    await load(String(msg.modelId), typeof msg.remoteHost === "string" ? msg.remoteHost : undefined);
    return;
  }
  if (msg?.type === "transcribe") {
    const id = msg.id as number;
    if (!asr) {
      post({ type: "error", id, message: "model not loaded", fatal: false });
      return;
    }
    try {
      // Utterances are cut to <= 27 s by the segmenter, so no chunking needed.
      const out = await asr(
        msg.audio as Float32Array,
        englishOnly ? { return_timestamps: false } : { language: "english", task: "transcribe", return_timestamps: false },
      );
      const text = Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text;
      post({ type: "result", id, text: (text ?? "").trim() });
    } catch (err) {
      post({ type: "error", id, message: err instanceof Error ? err.message : String(err), fatal: false });
    }
  }
};
