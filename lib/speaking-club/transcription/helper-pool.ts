// lib/speaking-club/transcription/helper-pool.ts
//
// Extra model copies that help the primary ChunkTranscriber with the chunks that piled
// up during a call. The primary stays the main worker: it transcribes the student's
// speech as it comes. Helpers take chunks from the SAME queue (so no chunk is done
// twice) and hand their text to the primary, which stores it under the chunk's
// position — the final transcript is sorted by position, so the order of the
// conversation is kept no matter which copy finished first.
//
// A helper loads its model lazily (only when there is work), gives the chunk back if
// anything goes wrong, and is shut down after a while without work to free its RAM.
import type { ChunkJob } from "@/lib/speaking-club/audio/segmenter";

/** What the pool needs from a model copy (a ChunkTranscriber satisfies this). */
export interface HelperRunner {
  load(): Promise<void>;
  transcribeExternal(audio: Int16Array): Promise<string | null>;
  dispose(): void;
}

/** What the pool needs from the primary transcriber. */
export interface PoolPrimary {
  takeNext(): ChunkJob | null;
  requeue(job: ChunkJob): void;
  readonly queueLength: number;
  recordExternal(job: ChunkJob, text: string): void;
}

export type HelperPoolOptions = {
  create: () => HelperRunner;
  /** How many helpers should be working right now. */
  desired: () => number;
  /** A helper without work for this long is shut down to free its memory. */
  idleMs?: number;
  tickMs?: number;
  /** Give up (for good) after this many failed chunks. */
  maxFailures?: number;
  /** After a failure, leave helpers alone for this long. */
  pauseMs?: number;
};

type Slot = { index: number; runner: HelperRunner | null; running: Promise<void> | null; lastWork: number };

export class HelperPool {
  private readonly primary: PoolPrimary;
  private readonly o: Required<HelperPoolOptions>;
  private slots: Slot[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private disabled = false;
  private failures = 0;
  private pausedUntil = 0;
  /** Chunks finished by helpers (for monitoring). */
  helped = 0;

  constructor(primary: PoolPrimary, options: HelperPoolOptions) {
    this.primary = primary;
    this.o = { idleMs: 20_000, tickMs: 1000, maxFailures: 2, pauseMs: 60_000, ...options };
  }

  /** Starts the periodic check (also call kick() whenever the situation changes). */
  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => this.kick(), this.o.tickMs);
  }

  /** Looks at the queue and the policy, and puts helpers to work. */
  kick(): void {
    if (this.stopped || this.disabled) return;
    const now = Date.now();
    // Free the memory of helpers that have been idle for a while.
    for (const s of this.slots) {
      if (!s.running && s.runner && now - s.lastWork > this.o.idleMs) {
        s.runner.dispose();
        s.runner = null;
      }
    }
    if (now < this.pausedUntil) return;
    const want = this.o.desired();
    for (let i = 0; i < want; i++) {
      const slot = (this.slots[i] ??= { index: i, runner: null, running: null, lastWork: now });
      if (!slot.running && this.primary.queueLength > 0) {
        slot.running = this.run(slot).finally(() => {
          slot.running = null;
        });
      }
    }
  }

  private async run(slot: Slot): Promise<void> {
    try {
      if (!slot.runner) {
        slot.runner = this.o.create();
        await slot.runner.load();
      }
      while (!this.stopped && slot.index < this.o.desired()) {
        const job = this.primary.takeNext();
        if (!job) break;
        const text = await slot.runner.transcribeExternal(job.audio);
        if (text === null) {
          // Hand the chunk back and back off: the primary (or the post-call step) does it.
          this.primary.requeue(job);
          this.failures++;
          if (this.failures >= this.o.maxFailures) this.disabled = true;
          this.pausedUntil = Date.now() + this.o.pauseMs;
          slot.runner.dispose();
          slot.runner = null;
          return;
        }
        this.primary.recordExternal(job, text);
        this.helped++;
        slot.lastWork = Date.now();
      }
    } catch {
      // the copy could not even load (out of memory, no worker...): no more helpers this session
      this.disabled = true;
      slot.runner?.dispose();
      slot.runner = null;
    }
  }

  /** No new chunks are taken from now on (the call is over). Chunks already being processed still finish. */
  stopTaking(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Stops, waits for the chunks in progress, and frees every copy. */
  async finish(): Promise<void> {
    this.stopTaking();
    await Promise.all(this.slots.map((s) => s.running ?? Promise.resolve()));
    this.dispose();
  }

  /** Frees every copy right away (chunks in progress are lost: only for an abandoned call). */
  dispose(): void {
    this.stopTaking();
    for (const s of this.slots) {
      s.runner?.dispose();
      s.runner = null;
    }
  }
}
