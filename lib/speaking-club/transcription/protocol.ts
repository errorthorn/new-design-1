// lib/speaking-club/transcription/protocol.ts
//
// The messages exchanged with the Whisper Web Worker (whisper.worker.ts). One
// typed definition shared by the worker, the chunk transcriber and the model
// setup, so a wrong or misspelt message fails at compile time.

/** main thread → worker */
export type WorkerRequest =
  | { type: "load"; modelId: string; remoteHost?: string; webgpu?: boolean }
  | { type: "transcribe"; id: number; audio: Float32Array }; // 16 kHz mono

/** worker → main thread */
export type WorkerResponse =
  /** Model download progress (bytes over all files seen so far). */
  | { type: "progress"; loaded: number; total: number; allDone: boolean }
  /** Model loaded AND passed its self-test. */
  | { type: "ready" }
  /** `notes` (BYOK only): words that sounded mispronounced, written down by the model that heard the audio. */
  | { type: "result"; id: number; text: string; notes?: string[] }
  /** `fatal` = the model is unusable; otherwise only request `id` failed. */
  | { type: "error"; id?: number; message: string; fatal: boolean };
