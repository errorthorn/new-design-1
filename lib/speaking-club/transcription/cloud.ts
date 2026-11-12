// lib/speaking-club/transcription/cloud.ts
//
// OPT-IN cloud fallback (NEXT_PUBLIC_CLOUD_TRANSCRIBE=true): one chunk of the
// student's own speech goes to OUR route /api/speaking-club/transcribe-chunk, which
// relays it to a hosted Whisper API and returns the text. Used for speech a weak
// device cannot transcribe in reasonable time. Best-effort: null means "no text from
// the cloud", and the caller transcribes the chunk on the device instead.
import { cleanWhisperText } from "@/lib/speaking-club/audio/segmenter";
import { encodeWav16k } from "@/lib/speaking-club/audio/wav";
import { CLOUD, cloudTranscribeEnabled } from "@/lib/speaking-club/config";

let disabled = false; // server says "not configured / not allowed": stop asking this session
let pausedUntil = 0; // after a rate limit: leave the cloud alone for a while

export function resetCloudState(): void {
  disabled = false;
  pausedUntil = 0;
}

/** True when the cloud may be tried right now. */
export function cloudAvailable(): boolean {
  return cloudTranscribeEnabled() && !disabled && Date.now() >= pausedUntil;
}

export async function cloudTranscribe(shiftId: string, audio: Int16Array): Promise<string | null> {
  if (!cloudAvailable() || audio.length === 0) return null;
  const seconds = audio.length / 16000;
  if (seconds > CLOUD.maxChunkSeconds) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLOUD.requestTimeoutMs);
  try {
    const res = await fetch("/api/speaking-club/transcribe-chunk", {
      method: "POST",
      headers: { "Content-Type": "audio/wav", "x-shift-id": shiftId },
      body: encodeWav16k(audio).buffer as ArrayBuffer,
      signal: ctrl.signal,
    });
    if (res.status === 429) {
      pausedUntil = Date.now() + CLOUD.rateLimitPauseMs;
      return null;
    }
    if ([401, 403, 404, 503].includes(res.status)) {
      disabled = true;
      return null;
    }
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as { ok?: boolean; text?: unknown } | null;
    if (!data?.ok || typeof data.text !== "string") return null;
    return cleanWhisperText(data.text, seconds * 1000);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
