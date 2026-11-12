// lib/speaking-club/audio/segmenter.ts
//
// Pure (no browser APIs) audio helpers for the in-browser Whisper fallback of
// Speaking Club AI feedback (see lib/speaking-club/audio/capture.ts):
//
//   mic samples @ any rate --Resampler--> 16 kHz --SpeechSegmenter--> utterances
//
// Whisper wants 16 kHz mono Float32 and handles at most ~30 s per call, and a
// call costs roughly the same whether the clip is 2 s or 25 s. So instead of
// streaming fixed windows we cut the student's speech into natural utterances
// (energy-based voice activity detection) and transcribe one utterance at a
// time. Silence is never sent to the model at all, which is also what keeps the
// CPU cost low while the partner is the one talking.
//
// Kept dependency-free so it can be unit-tested in plain Node.

export const TARGET_SAMPLE_RATE = 16000;

/**
 * Streaming box-filter resampler (any input rate -> 16 kHz). Keeps its
 * fractional position between chunks, so chunk borders don't glitch.
 */
export class Resampler {
  private readonly ratio: number;
  private buf: Float32Array = new Float32Array(0);
  private pos = 0;

  constructor(inputRate: number, outputRate: number = TARGET_SAMPLE_RATE) {
    this.ratio = inputRate / outputRate;
  }

  push(chunk: Float32Array): Float32Array {
    if (this.ratio === 1) return chunk;

    const merged = new Float32Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);

    const out = new Float32Array(Math.max(0, Math.floor((merged.length - this.pos) / this.ratio)));
    let n = 0;
    let pos = this.pos;
    for (;;) {
      const end = pos + this.ratio;
      const hi = Math.ceil(end);
      if (hi > merged.length || n >= out.length) break; // need the whole window first
      let sum = 0;
      let cnt = 0;
      for (let j = Math.floor(pos); j < hi; j++) {
        sum += merged[j];
        cnt++;
      }
      out[n++] = cnt > 0 ? sum / cnt : 0;
      pos = end;
    }

    const consumed = Math.floor(pos);
    this.buf = merged.slice(consumed);
    this.pos = pos - consumed;
    return out.subarray(0, n);
  }
}

export type SpeechSegment = {
  samples: Float32Array; // 16 kHz mono
  durationMs: number;
};

export type SegmenterOptions = {
  frameMs?: number; // analysis frame length
  minSpeechMs?: number; // shorter bursts (coughs, clicks) are dropped
  endSilenceMs?: number; // this much silence closes an utterance
  softMaxMs?: number; // after this long, close at the next short pause
  hardMaxMs?: number; // never exceed this (Whisper window is 30 s)
  prerollMs?: number; // audio kept from before speech onset (soft consonants)
};

const DEFAULTS: Required<SegmenterOptions> = {
  frameMs: 30,
  minSpeechMs: 400,
  endSilenceMs: 800,
  softMaxMs: 18000,
  hardMaxMs: 27000,
  prerollMs: 300,
};

function frameRms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Energy-based utterance cutter with an adaptive noise floor.
 * Feed it 16 kHz samples in any chunk size; it returns finished utterances.
 */
export class SpeechSegmenter {
  private readonly o: Required<SegmenterOptions>;
  private readonly frameLen: number;
  private carry: Float32Array = new Float32Array(0);

  private noiseFloor = 0.004;
  private speaking = false;
  private onsetFrames = 0;
  private silenceMs = 0;
  private speechMs = 0;
  private segFrames: Float32Array[] = [];
  private preroll: Float32Array[] = [];

  constructor(options: SegmenterOptions = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.frameLen = Math.round((TARGET_SAMPLE_RATE * this.o.frameMs) / 1000);
  }

  /** True while an utterance is in progress (the student is talking right now). */
  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Current speech/silence thresholds — exposed for tests and debugging. */
  thresholds() {
    return {
      // Absolute floors are deliberately low: a soft-spoken student or a distant
      // laptop mic must still register, and a false trigger only costs one
      // empty Whisper result, whereas a missed utterance silently loses feedback.
      start: Math.max(0.008, this.noiseFloor * 3.5),
      end: Math.max(0.005, this.noiseFloor * 2.2),
    };
  }

  push(samples: Float32Array): SpeechSegment[] {
    const out: SpeechSegment[] = [];
    let data = samples;
    if (this.carry.length > 0) {
      data = new Float32Array(this.carry.length + samples.length);
      data.set(this.carry, 0);
      data.set(samples, this.carry.length);
    }
    let i = 0;
    for (; i + this.frameLen <= data.length; i += this.frameLen) {
      const seg = this.pushFrame(data.subarray(i, i + this.frameLen));
      if (seg) out.push(seg);
    }
    this.carry = data.slice(i);
    return out;
  }

  /** Call at the end of the call to get whatever utterance is still open. */
  flush(): SpeechSegment | null {
    if (this.carry.length > 0) {
      const padded = new Float32Array(this.frameLen);
      padded.set(this.carry);
      this.carry = new Float32Array(0);
      const seg = this.pushFrame(padded);
      if (seg) return seg;
    }
    return this.speaking ? this.finish() : null;
  }

  private pushFrame(frame: Float32Array): SpeechSegment | null {
    const copy = frame.slice();
    const rms = frameRms(copy);
    const { start, end } = this.thresholds();

    if (!this.speaking) {
      // Learn the room noise while nobody speaks.
      this.noiseFloor = Math.min(0.05, Math.max(0.0015, this.noiseFloor * 0.97 + rms * 0.03));

      this.preroll.push(copy);
      const maxPre = Math.ceil(this.o.prerollMs / this.o.frameMs);
      while (this.preroll.length > maxPre) this.preroll.shift();

      this.onsetFrames = rms > start ? this.onsetFrames + 1 : 0;
      if (this.onsetFrames >= 2) {
        // Two loud frames in a row = speech onset (ignores single clicks).
        this.speaking = true;
        this.segFrames = this.preroll.slice();
        this.preroll = [];
        this.silenceMs = 0;
        this.speechMs = this.onsetFrames * this.o.frameMs;
        this.onsetFrames = 0;
      }
      return null;
    }

    this.segFrames.push(copy);
    if (rms > end) {
      this.silenceMs = 0;
      this.speechMs += this.o.frameMs;
    } else {
      this.silenceMs += this.o.frameMs;
    }

    const lengthMs = this.segFrames.length * this.o.frameMs;
    const closeBySilence = this.silenceMs >= this.o.endSilenceMs;
    const closeSoft = lengthMs >= this.o.softMaxMs && this.silenceMs >= 250;
    const closeHard = lengthMs >= this.o.hardMaxMs;
    if (closeBySilence || closeSoft || closeHard) return this.finish();
    return null;
  }

  private finish(): SpeechSegment | null {
    const frames = this.segFrames;
    const speechMs = this.speechMs;
    this.segFrames = [];
    this.speaking = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.onsetFrames = 0;
    this.preroll = [];

    if (speechMs < this.o.minSpeechMs || frames.length === 0) return null;

    // Trim most of the trailing silence, keep a little tail so words don't end abruptly.
    const keepTail = Math.ceil(200 / this.o.frameMs);
    let last = frames.length - 1;
    while (last > 0 && frameRms(frames[last]) <= this.thresholds().end) last--;
    const trimmed = frames.slice(0, Math.min(frames.length, last + 1 + keepTail));

    const samples = new Float32Array(trimmed.length * this.frameLen);
    trimmed.forEach((f, idx) => samples.set(f, idx * this.frameLen));
    return { samples, durationMs: (samples.length / TARGET_SAMPLE_RATE) * 1000 };
  }
}

// ---------------------------------------------------------------------------
// Whisper output cleanup
// ---------------------------------------------------------------------------

// Phrases Whisper tends to invent out of near-silence / noise. Only dropped
// when the clip is short, so a student genuinely saying "thank you" in a
// longer answer is never touched.
const HALLUCINATIONS = new Set([
  "you",
  "thank you",
  "thank you.",
  "thanks.",
  "thanks for watching",
  "thanks for watching!",
  "bye.",
  "bye",
  "the end.",
  "uh",
  "um",
  "hmm",
  "mm-hmm",
]);

/**
 * Cleans one Whisper result. Returns "" if it should be discarded.
 */
export function cleanWhisperText(raw: string, durationMs: number): string {
  let t = (raw ?? "")
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ") // [BLANK_AUDIO], (music), *noise*
    .replace(/\s+/g, " ")
    .trim();
  if (!/[A-Za-z]/.test(t)) return "";
  if (durationMs < 2500 && HALLUCINATIONS.has(t.toLowerCase())) return "";
  // Pathological repetition loop ("the the the the ...") — keep first few words.
  t = t.replace(/\b(\w+)(\s+\1\b){4,}/gi, "$1 $1");
  return t;
}

// ---------------------------------------------------------------------------
// Chunking for Whisper (merge utterances; pick a spread-out processing order)
// ---------------------------------------------------------------------------

/** One piece of audio for one Whisper call. `pos` = index of its first utterance (for chronological order). */
export type ChunkJob = { pos: number; audio: Int16Array; /** utterance indexes merged into this chunk */ members?: number[] };
export type MergeItem = { pos: number; data: Int16Array };

// Whisper's window is 30 s and each call has a large fixed cost, so many short
// utterances are merged into chunks of at most ~28 s (0.2 s of silence between them).
export const MAX_CHUNK_SAMPLES = 28 * TARGET_SAMPLE_RATE;
export const CHUNK_GAP_SAMPLES = Math.round(0.2 * TARGET_SAMPLE_RATE);

export function mergeSegments(items: MergeItem[]): ChunkJob[] {
  const chunks: ChunkJob[] = [];
  let group: MergeItem[] = [];
  let len = 0;
  const flush = () => {
    if (group.length === 0) return;
    const total = group.reduce((n, g) => n + g.data.length, 0) + CHUNK_GAP_SAMPLES * (group.length - 1);
    const out = new Int16Array(total);
    let at = 0;
    group.forEach((g, i) => {
      out.set(g.data, at);
      at += g.data.length + (i < group.length - 1 ? CHUNK_GAP_SAMPLES : 0);
    });
    chunks.push({ pos: group[0].pos, audio: out, members: group.map((g) => g.pos) });
    group = [];
    len = 0;
  };
  for (const item of items) {
    const add = item.data.length + (group.length > 0 ? CHUNK_GAP_SAMPLES : 0);
    if (group.length > 0 && len + add > MAX_CHUNK_SAMPLES) flush();
    len += item.data.length + (group.length > 0 ? CHUNK_GAP_SAMPLES : 0);
    group.push(item);
  }
  flush();
  return chunks;
}

/**
 * Order in which to process n chunks so that, whenever we stop, what has been
 * done is spread evenly over the call: first, last, middle, then quarters, ...
 */
export function samplingOrder(n: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (i: number) => {
    if (i >= 0 && i < n && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  };
  push(0);
  push(n - 1);
  const queue: [number, number][] = [[0, n - 1]];
  while (queue.length > 0) {
    const [lo, hi] = queue.shift()!;
    if (hi - lo < 2) continue;
    const mid = (lo + hi) >> 1;
    push(mid);
    queue.push([lo, mid], [mid, hi]);
  }
  return out;
}
