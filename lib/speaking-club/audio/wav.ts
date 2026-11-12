// lib/speaking-club/audio/wav.ts
//
// Minimal 16-bit PCM WAV helpers (pure, no browser APIs): the client wraps a chunk
// of 16 kHz mono speech into a WAV file for the cloud route, and the server route
// reads the header back to check what it was sent before relaying it.

export function encodeWav16k(pcm: Int16Array, sampleRate = 16000): Uint8Array {
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  tag(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
  return out;
}

export type WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; dataBytes: number; durationSec: number };

/** Reads a PCM WAV header. Returns null for anything that is not a well-formed 16-bit PCM WAV. */
export function parseWavInfo(buf: Uint8Array): WavInfo | null {
  if (buf.length < 44) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (at: number) => String.fromCharCode(buf[at], buf[at + 1], buf[at + 2], buf[at + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let at = 12;
  let fmt: { channels: number; sampleRate: number; bits: number; format: number } | null = null;
  while (at + 8 <= buf.length) {
    const id = tag(at);
    const size = v.getUint32(at + 4, true);
    if (id === "fmt " && at + 8 + 16 <= buf.length) {
      fmt = {
        format: v.getUint16(at + 8, true),
        channels: v.getUint16(at + 10, true),
        sampleRate: v.getUint32(at + 12, true),
        bits: v.getUint16(at + 22, true),
      };
    } else if (id === "data") {
      if (!fmt || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels < 1 || fmt.sampleRate < 1) return null;
      const dataBytes = Math.min(size, buf.length - (at + 8));
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bits,
        dataBytes,
        durationSec: dataBytes / (fmt.sampleRate * fmt.channels * 2),
      };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}
