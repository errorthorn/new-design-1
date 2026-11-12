// lib/speaking-club/transcription/chunk-transcriber.ts
//
// One Whisper Web Worker plus a queue of audio chunks. It is used twice for the
// same call:
//   * LIVE, while the call is running: chunks are transcribed in the background
//     as the student talks, so a full hour of conversation is mostly done by the
//     time the call ends (this is the only way a whole hour can be covered when
//     the device transcribes slower than real time),
//   * AFTER the call: whatever is still queued is finished by the post-call
//     engine (lib/speaking-club/post-call/engine.ts), re-using the already-loaded model.
//
// If the device can't keep up live (the backlog grows), it does NOT stop: it
// switches to a throttled mode (work for a chunk's duration, then rest for as
// long, ~50% duty) so it keeps making progress through the rest of the call
// without hogging the CPU. Whatever is still waiting at the end is finished by
// the post-call step.
//
// Dependencies are injected (worker factory, model id) so this file has no
// imports from the browser-specific client module.
import { cleanWhisperText, type ChunkJob } from "@/lib/speaking-club/audio/segmenter";
import { LIMITS, byokEnabled, failedChunkRetryWaitMs } from "@/lib/speaking-club/config";
import type { WorkerRequest, WorkerResponse } from "@/lib/speaking-club/transcription/protocol";
import { int16ToFloat } from "@/lib/speaking-club/storage/segment-store";

export type ChunkTranscriberOptions = {
  createWorker: () => Worker;
  modelId: string;
  remoteHost?: string;
  /** Try WebGPU first (falls back to WASM on any failure). */
  webgpu?: boolean;
};

/** Why chunks failed (BYOK): shown to the student and used to decide what happens to the audio. */
export type FailureReason = "key" | "model" | "quota" | "blocked" | "network";

const reasonOf = (err: string | undefined): FailureReason => {
  if (err === "invalid-key" || err === "forbidden" || err === "no-key") return "key";
  if (err === "model") return "model";
  if (err === "quota") return "quota";
  if (err === "blocked") return "blocked";
  return "network";
};
// Most useful to tell the student first.
const REASON_RANK: FailureReason[] = ["key", "model", "quota", "network", "blocked"];

export class ChunkTranscriber {
  /** Finished text by chunk position (chronological key). */
  readonly texts = new Map<number, string>();
  /** BYOK: pronunciation notes by chunk position (words the model heard mispronounced). */
  readonly notes = new Map<number, string[]>();
  /** How many chunks have been run through the model (including ones that produced no text). */
  chunksDone = 0;
  loadSec = 0;
  onModelProgress: ((pct: number) => void) | null = null;
  /** True while live processing is throttled because the device is falling behind. */
  throttled = false;

  private readonly opts: ChunkTranscriberOptions;
  private worker: Worker | null = null;
  private loadPromise: Promise<void> | null = null;
  private loaded = false;
  private dead = false;
  private disposed = false;
  private pending = new Map<number, (text: string | null, err?: string, notes?: string[]) => void>();
  /** BYOK only: chunks that could not be transcribed (kept, with their audio, to be tried again). */
  private failed: ChunkJob[] = [];
  /** BYOK, live: how many times a failed chunk was already put back in the queue during the call. */
  private liveTries = new Map<ChunkJob, number>();
  /** BYOK, live: failed chunks waiting out their pause before going back in the queue (the lane keeps working meanwhile). */
  private retryTimers = new Map<ReturnType<typeof setTimeout>, ChunkJob>();
  /** BYOK: chunks Gemini refused (safety / language / other). Asking again gives the same refusal, so they are not retried. */
  private blockedJobs = new Set<ChunkJob>();
  private reasons = new Set<FailureReason>();
  /** BYOK only: the key / model is rejected, so more requests are pointless until the student fixes it. */
  private giveUpFlag = false;
  private nextReqId = 1;
  private queue: ChunkJob[] = [];
  private live = false;
  /** Live workers running right now (BYOK uses several; Whisper one). */
  private lanes = 0;
  private idleWaiters: (() => void)[] = [];
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepResolve: (() => void) | null = null;
  /** Set by the helper pool: stops it and waits for the chunks it is still processing. */
  helperDrain: (() => Promise<void>) | null = null;

  constructor(opts: ChunkTranscriberOptions) {
    this.opts = opts;
  }

  get isDead(): boolean {
    return this.dead;
  }
  /** BYOK: Google rejected the key (or the model): stop sending requests, keep the audio. */
  get giveUp(): boolean {
    return this.giveUpFlag;
  }
  /** BYOK: chunks that failed and are waiting to be tried again. */
  get failedCount(): number {
    return this.failed.length;
  }
  /** BYOK: the most important reason chunks failed, or null if none did. */
  get failureReason(): FailureReason | null {
    return REASON_RANK.find((r) => this.reasons.has(r)) ?? null;
  }
  /** The model is loaded and usable right now. */
  get isLoaded(): boolean {
    return this.loaded && !this.dead && !this.disposed;
  }
  /** Chunks waiting for a worker. */
  get queueLength(): number {
    return this.queue.length;
  }
  get queuedSeconds(): number {
    return this.queue.reduce((n, j) => n + j.audio.length, 0) / 16000;
  }

  // ---- model --------------------------------------------------------------

  /** Loads the model (idempotent; instant if already loaded). Rejects if it can't. */
  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = new Promise<void>((resolve, reject) => {
      const started = Date.now();
      let worker: Worker;
      try {
        worker = this.opts.createWorker();
      } catch (err) {
        this.dead = true;
        reject(err instanceof Error ? err : new Error("worker-failed"));
        return;
      }
      this.worker = worker;
      const timer = setTimeout(() => fail(new Error("model-timeout")), LIMITS.modelLoadTimeoutMs);
      const fail = (err: Error) => {
        clearTimeout(timer);
        this.dead = true;
        reject(err);
      };
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const m = e.data;
        if (m.type === "progress") {
          const pct = m.total > 0 ? Math.min(99, Math.round((m.loaded / m.total) * 100)) : 0;
          this.onModelProgress?.(pct);
        } else if (m.type === "ready") {
          clearTimeout(timer);
          this.loaded = true;
          this.loadSec = Math.round((Date.now() - started) / 1000);
          worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
          worker.onerror = () => this.killPending();
          resolve();
        } else if (m.type === "error" && m.fatal) {
          fail(new Error(m.message || "load-failed"));
        }
      };
      worker.onerror = (ev) => fail(new Error(ev.message || "worker-error"));
      this.send({ type: "load", modelId: this.opts.modelId, remoteHost: this.opts.remoteHost, webgpu: this.opts.webgpu });
    });
    this.loadPromise.catch(() => {}); // callers handle the rejection; this just avoids an unhandled one
    return this.loadPromise;
  }

  /** Typed postMessage: a wrong message shape fails at compile time. */
  private send(req: WorkerRequest, transfer: Transferable[] = []) {
    this.worker!.postMessage(req, transfer);
  }

  private onMessage(m: WorkerResponse) {
    if (m.type === "result") {
      this.pending.get(m.id)?.(m.text, undefined, m.notes);
      this.pending.delete(m.id);
    } else if (m.type === "error" && typeof m.id === "number") {
      this.pending.get(m.id)?.(null, m.message);
      this.pending.delete(m.id);
    }
  }

  private killPending() {
    this.dead = true;
    this.pending.forEach((resolve) => resolve(null));
    this.pending.clear();
  }

  // ---- one chunk ----------------------------------------------------------

  /**
   * Runs one chunk through the model now and stores its text. Never throws.
   * Returns false when the chunk FAILED (BYOK only): it is then NOT counted as done; it is kept
   * (see takeFailed / retryFailed) instead of silently becoming a hole in the transcript.
   * With Whisper a failed chunk is counted as done, as before.
   */
  async processJob(job: ChunkJob): Promise<boolean> {
    const { text, err, notes } = await this.transcribeDetailed(job);
    if (text === null && byokEnabled()) {
      this.failed.push(job);
      if (err !== "gave-up") this.reasons.add(reasonOf(err));
      if (err === "blocked") this.blockedJobs.add(job);
      if (err === "invalid-key" || err === "forbidden" || err === "no-key" || err === "model") this.giveUpFlag = true;
      return false;
    }
    this.chunksDone++;
    if (text) {
      this.texts.set(job.pos, text);
      if (notes && notes.length > 0) this.notes.set(job.pos, notes);
    }
    return text !== null;
  }

  /** Removes and returns the chunks that failed, oldest speech first. */
  takeFailed(): ChunkJob[] {
    const f = this.failed.sort((a, b) => a.pos - b.pos);
    this.failed = [];
    return f;
  }

  /**
   * BYOK: one more try for the chunks that failed (a network blip or a Google hiccup usually
   * passes within seconds). Chunks that still fail stay in the failed list. Skipped when the key
   * itself is rejected, since another request cannot help.
   */
  async retryFailed(
    rounds: number = LIMITS.failedChunkRetryRounds,
    baseWaitMs: number = failedChunkRetryWaitMs(),
    deadline: number = Infinity,
  ): Promise<void> {
    for (let r = 1; r <= rounds; r++) {
      if (this.failed.length === 0 || this.giveUpFlag || this.dead || this.disposed) return;
      // A chunk that keeps failing must not hold the call's result back for minutes: stop starting new rounds past the deadline.
      if (Date.now() + baseWaitMs * r >= deadline) return;
      await new Promise<void>((resolve) => setTimeout(resolve, baseWaitMs * r));
      if (this.giveUpFlag || this.dead || this.disposed) return;
      for (const job of this.takeFailed()) {
        if (Date.now() >= deadline || this.blockedJobs.has(job)) this.failed.push(job);
        else await this.processJob(job);
      }
    }
  }

  /** Stores text that was produced elsewhere (partner / cloud) for a chunk, as if it had been transcribed here. */
  recordExternal(job: ChunkJob, text: string): void {
    this.chunksDone++;
    if (text) this.texts.set(job.pos, text);
  }

  /** Transcribes audio for someone else (peer offload). Does not touch this transcriber's own results. */
  transcribeExternal(audio: Int16Array): Promise<string | null> {
    return this.transcribe({ pos: -1, audio });
  }

  private async transcribe(job: ChunkJob): Promise<string | null> {
    return (await this.transcribeDetailed(job)).text;
  }

  /** Like transcribe(), but also says WHY it failed (the worker's error message). */
  private async transcribeDetailed(job: ChunkJob): Promise<{ text: string | null; err?: string; notes?: string[] }> {
    if (this.giveUpFlag) return { text: null, err: "gave-up" }; // key rejected: no pointless requests
    if (!this.worker || !this.loaded || this.dead || this.disposed) return { text: null, err: "not-ready" };
    const id = this.nextReqId++;
    const audio = int16ToFloat(job.audio);
    const durationMs = (audio.length / 16000) * 1000;
    const res = await new Promise<{ text: string | null; err?: string; notes?: string[] }>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ text: null, err: "timeout" });
      }, byokEnabled() ? LIMITS.byokChunkTimeoutMs : LIMITS.chunkTimeoutMs);
      this.pending.set(id, (t, err, notes) => {
        clearTimeout(timer);
        resolve({ text: t, err, notes });
      });
      try {
        this.send({ type: "transcribe", id, audio }, [audio.buffer]);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ text: null, err: "send-failed" });
      }
    });
    return res.text === null ? res : { text: cleanWhisperText(res.text, durationMs), notes: res.notes };
  }

  // ---- live mode ----------------------------------------------------------

  /** Queues a chunk. In live mode it is transcribed in the background right away. */
  enqueue(job: ChunkJob) {
    if (this.disposed) return;
    this.queue.push(job);
    if (this.live) {
      // Whisper not keeping up: slow down (rather than stop) so the call isn't starved. BYOK never
      // throttles: the work happens at Google, so resting would only leave more for after the call.
      if (!byokEnabled() && this.queuedSeconds > LIMITS.liveThrottleAboveBacklogSec) this.throttled = true;
      this.pump();
    }
  }

  /** Starts background transcription of queued/future chunks (the model loads on the first chunk). */
  startLive() {
    this.live = true;
    this.pump();
  }

  private maxLanes(): number {
    return byokEnabled() ? LIMITS.byokLiveLanes : 1;
  }

  private pump() {
    if (!this.live || this.disposed) return;
    while (this.lanes < this.maxLanes() && this.queue.length > 0) {
      void this.runLane();
      if (this.lanes >= this.maxLanes()) break;
    }
  }

  private runLane(): Promise<void> {
    this.lanes++;
    return (async () => {
      try {
        await this.load();
        while (this.live && !this.disposed && !this.dead && this.queue.length > 0) {
          const job = this.queue.shift()!;
          const started = Date.now();
          const ok = await this.processJob(job);
          // BYOK: a chunk that failed (network blip, Google hiccup, quota) is tried again HERE, while the call
          // is still running, instead of piling up for the wait after the call. If it keeps failing it stays
          // in the failed list and the post-call step deals with it.
          if (!ok && byokEnabled() && !this.giveUpFlag && !this.dead && !this.blockedJobs.has(job)) {
            const tries = (this.liveTries.get(job) ?? 0) + 1;
            if (tries <= LIMITS.liveFailedRetries) {
              this.liveTries.set(job, tries);
              const i = this.failed.lastIndexOf(job);
              if (i >= 0) this.failed.splice(i, 1);
              // The pause happens in a timer, NOT in this loop: newer speech keeps being transcribed meanwhile,
              // so one stubborn chunk can never hold up the rest of a long call.
              const timer = setTimeout(() => {
                this.retryTimers.delete(timer);
                if (this.disposed) return;
                this.queue.push(job);
                if (this.live) this.pump();
              }, Math.min(failedChunkRetryWaitMs() * tries, LIMITS.liveRetryMaxWaitMs));
              this.retryTimers.set(timer, job);
              continue;
            }
          }
          if (this.throttled) {
            if (this.queuedSeconds < LIMITS.liveUnthrottleBelowBacklogSec) this.throttled = false;
            else await this.sleep(Date.now() - started); // rest as long as the work took (~50% duty)
          }
        }
      } catch {
        // model failed to load: leave everything queued for the post-call step
      } finally {
        this.lanes--;
        if (this.lanes === 0) {
          const waiters = this.idleWaiters;
          this.idleWaiters = [];
          waiters.forEach((w) => w());
        }
      }
    })();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.sleepResolve = resolve;
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        this.sleepResolve = null;
        resolve();
      }, ms);
    });
  }

  private wake() {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
    const r = this.sleepResolve;
    this.sleepResolve = null;
    r?.();
  }

  /** Ends live mode and waits for the chunk being processed (if any) to finish, helpers' too. */
  async stopLive(): Promise<void> {
    this.live = false;
    this.flushRetryTimers(); // chunks waiting out a retry pause go to the post-call step right now
    this.wake(); // don't make the student wait out a throttle rest
    if (this.lanes > 0) await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
    await this.helperDrain?.();
  }

  private flushRetryTimers() {
    for (const [timer, job] of this.retryTimers) {
      clearTimeout(timer);
      this.queue.push(job);
    }
    this.retryTimers.clear();
  }

  /** Takes the next waiting chunk (for a helper), or null. */
  takeNext(): ChunkJob | null {
    return this.queue.shift() ?? null;
  }

  /** Puts a chunk back at the front of the queue (a helper could not do it). */
  requeue(job: ChunkJob): void {
    if (this.disposed) return;
    this.queue.unshift(job);
    if (this.live) this.pump();
  }

  /** Removes and returns the chunks that were not transcribed live. */
  takeQueue(): ChunkJob[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.live = false;
    this.wake();
    for (const timer of this.retryTimers.keys()) clearTimeout(timer);
    this.retryTimers.clear();
    this.queue = [];
    this.failed = [];
    this.notes.clear();
    this.killPending();
    try {
      this.worker?.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
  }
}
