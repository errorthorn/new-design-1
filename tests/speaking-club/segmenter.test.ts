import { describe, expect, it } from "vitest";
import {
  Resampler,
  SpeechSegmenter,
  cleanWhisperText,
  mergeSegments,
  samplingOrder,
} from "@/lib/speaking-club/audio/segmenter";

// Deterministic pseudo-noise so the tests never flake.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0xffffffff);

const RATE = 48000;
function tone(sec: number, amp: number, rate = RATE) {
  const n = Math.round(sec * rate);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = amp * Math.sin((2 * Math.PI * 220 * i) / rate) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 3 * i) / rate)) + (rnd() - 0.5) * 0.002;
  }
  return a;
}
function noise(sec: number, amp: number, rate = RATE) {
  const n = Math.round(sec * rate);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = (rnd() - 0.5) * 2 * amp;
  return a;
}
const cat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let k = 0;
  for (const p of parts) {
    out.set(p, k);
    k += p.length;
  }
  return out;
};
function segment(audio: Float32Array, rate = RATE, chunkSize = 2048) {
  const rs = new Resampler(rate);
  const sg = new SpeechSegmenter();
  const out = [];
  for (let i = 0; i < audio.length; i += chunkSize) out.push(...sg.push(rs.push(audio.subarray(i, Math.min(audio.length, i + chunkSize)))));
  const last = sg.flush();
  if (last) out.push(last);
  return out;
}

describe("Resampler", () => {
  it.each([48000, 44100, 16000, 8000])("produces ~16 kHz output from %i Hz input in odd-sized chunks", (rate) => {
    const rs = new Resampler(rate);
    const src = tone(5, 0.1, rate);
    let total = 0;
    for (let i = 0; i < src.length; i += 1999) total += rs.push(src.subarray(i, Math.min(src.length, i + 1999))).length;
    expect(Math.abs(total - 80000)).toBeLessThanOrEqual(rate / 16000 + 2);
  });
});

describe("SpeechSegmenter", () => {
  it("cuts speech into utterances and ignores a short click", () => {
    const audio = cat(noise(1, 0.003), tone(3, 0.1), noise(1.2, 0.003), tone(0.15, 0.2), noise(1, 0.003), tone(6, 0.08), noise(1, 0.003));
    const segs = segment(audio);
    expect(segs).toHaveLength(2);
    expect(segs[0].durationMs).toBeGreaterThan(3000);
    expect(segs[0].durationMs).toBeLessThan(4500);
    expect(segs[1].durationMs).toBeGreaterThan(6000);
    expect(segs[1].durationMs).toBeLessThan(7500);
  });

  it("still picks up quiet speech (soft-spoken student / distant mic)", () => {
    const segs = segment(cat(noise(1, 0.002), tone(4, 0.02), noise(1, 0.002)));
    expect(segs).toHaveLength(1);
  });

  it("never lets one utterance exceed Whisper's window", () => {
    const segs = segment(cat(noise(0.5, 0.003), tone(40, 0.1), noise(1, 0.003)));
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.every((s) => s.durationMs <= 27500)).toBe(true);
  });

  it("sends nothing for silence / room noise", () => {
    expect(segment(noise(20, 0.004))).toHaveLength(0);
  });

  it("returns the still-open utterance on flush", () => {
    const sg = new SpeechSegmenter();
    const rs = new Resampler(RATE);
    const audio = cat(noise(0.5, 0.003), tone(2, 0.1)); // call ends mid-sentence
    const out = [];
    for (let i = 0; i < audio.length; i += 2048) out.push(...sg.push(rs.push(audio.subarray(i, Math.min(audio.length, i + 2048)))));
    expect(out).toHaveLength(0);
    expect(sg.flush()?.durationMs).toBeGreaterThan(1500);
  });
});

describe("cleanWhisperText", () => {
  it.each([
    ["[BLANK_AUDIO]", 3000, ""],
    ["(music)", 2000, ""],
    ["Thank you.", 1200, ""], // typical hallucination on a short noise clip
    ["Thank you.", 6000, "Thank you."], // but real in a longer answer
    ["I go to the the the the the the market", 5000, "I go to the the market"],
    ["I am goes to school yesterday.", 4000, "I am goes to school yesterday."], // learner errors are preserved
  ])("%j (%ims) -> %j", (raw, ms, expected) => {
    expect(cleanWhisperText(raw, ms)).toBe(expected);
  });
});

describe("mergeSegments", () => {
  const seg = (secs: number) => new Int16Array(secs * 16000).fill(500);

  it("merges many short utterances into few <=28 s chunks, keeping chronological positions", () => {
    const chunks = mergeSegments(Array.from({ length: 30 }, (_, i) => ({ pos: i, data: seg(3) })));
    expect(chunks).toHaveLength(4);
    expect(chunks.every((c) => c.audio.length <= 28 * 16000)).toBe(true);
    expect(chunks.map((c) => c.pos)).toEqual([0, 8, 16, 24]);
  });

  it("handles a single long utterance and no input", () => {
    expect(mergeSegments([{ pos: 0, data: seg(27) }])).toHaveLength(1);
    expect(mergeSegments([])).toHaveLength(0);
  });
});

describe("samplingOrder", () => {
  it.each([1, 2, 3, 10, 40, 130])("is a permutation of 0..%i-1 starting with first and last", (n) => {
    const order = samplingOrder(n);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(order[0]).toBe(0);
    if (n > 1) expect(order[1]).toBe(n - 1);
  });

  it("spreads the first picks over the whole call (stopping early still covers it)", () => {
    expect(samplingOrder(10).slice(0, 5)).toEqual([0, 9, 4, 2, 6]);
  });
});
