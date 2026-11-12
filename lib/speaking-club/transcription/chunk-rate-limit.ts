// lib/speaking-club/transcription/chunk-rate-limit.ts
//
// Best-effort per-user cap for the cloud transcribe-chunk route (in memory: per server
// instance, so it only blunts runaway loops; Groq's own organisation limits are the real
// ceiling). Lives outside the route file because Next.js route files may only export
// HTTP handlers and route config (runtime, maxDuration, ...).

const WINDOW_MS = 60 * 60_000;
const MAX_CHUNKS_PER_WINDOW = 200;
const MAX_SECONDS_PER_WINDOW = 2 * 60 * 60;
const usage = new Map<string, { since: number; chunks: number; seconds: number }>();

/** Exported for tests. */
export function resetUsage(): void {
  usage.clear();
}

export function allow(email: string, seconds: number): boolean {
  const now = Date.now();
  let u = usage.get(email);
  if (!u || now - u.since > WINDOW_MS) {
    u = { since: now, chunks: 0, seconds: 0 };
    usage.set(email, u);
  }
  if (u.chunks + 1 > MAX_CHUNKS_PER_WINDOW || u.seconds + seconds > MAX_SECONDS_PER_WINDOW) return false;
  u.chunks += 1;
  u.seconds += seconds;
  return true;
}
