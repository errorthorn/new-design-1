// lib/speaking-club/peer/adpcm.ts
//
// IMA ADPCM (4 bits per sample, 4:1) for sending a chunk of 16 kHz speech to a
// partner's device over a data channel without doubling the call's bandwidth
// (16 kHz × 4 bit = 64 kbit/s instead of 256 kbit/s). Pure functions, no browser APIs.
// Lossy but plenty for speech recognition.

const STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
  130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484,
  7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const INDEX = [-1, -1, -1, -1, 2, 4, 6, 8];

const clamp16 = (n: number) => (n > 32767 ? 32767 : n < -32768 ? -32768 : n);
const clampIdx = (n: number) => (n < 0 ? 0 : n > 88 ? 88 : n);

export type AdpcmBlock = {
  /** Two samples per byte (low nibble first). */
  data: Uint8Array;
  /** Decoder starting state. */
  predictor: number;
  stepIndex: number;
};

export function adpcmEncode(pcm: Int16Array): AdpcmBlock {
  const startPredictor = pcm.length > 0 ? pcm[0] : 0;
  let pred = startPredictor;
  let index = 0;
  const data = new Uint8Array(Math.ceil(pcm.length / 2));
  for (let i = 0; i < pcm.length; i++) {
    const step = STEP[index];
    let diff = pcm[i] - pred;
    let code = 0;
    if (diff < 0) {
      code = 8;
      diff = -diff;
    }
    let vp = step >> 3;
    if (diff >= step) {
      code |= 4;
      diff -= step;
      vp += step;
    }
    if (diff >= step >> 1) {
      code |= 2;
      diff -= step >> 1;
      vp += step >> 1;
    }
    if (diff >= step >> 2) {
      code |= 1;
      vp += step >> 2;
    }
    pred = clamp16(code & 8 ? pred - vp : pred + vp);
    index = clampIdx(index + INDEX[code & 7]);
    data[i >> 1] |= (i & 1 ? code << 4 : code) & 0xff;
  }
  return { data, predictor: startPredictor, stepIndex: 0 };
}

export function adpcmDecode(data: Uint8Array, samples: number, predictor: number, stepIndex: number): Int16Array {
  const out = new Int16Array(samples);
  let pred = clamp16(predictor);
  let index = clampIdx(stepIndex);
  for (let i = 0; i < samples; i++) {
    const byte = data[i >> 1] ?? 0;
    const code = i & 1 ? byte >> 4 : byte & 0x0f;
    const step = STEP[index];
    let vp = step >> 3;
    if (code & 4) vp += step;
    if (code & 2) vp += step >> 1;
    if (code & 1) vp += step >> 2;
    pred = clamp16(code & 8 ? pred - vp : pred + vp);
    index = clampIdx(index + INDEX[code & 7]);
    out[i] = pred;
  }
  return out;
}
