// lib/speaking-club/transcription/pool-policy.ts
//
// How many model copies ("helpers", besides the one primary) may work right now.
// Pure functions, so the rules are easy to read and to test.
//
// The thinking: during the call the student's own device is busy with the call, so
//   * while the student is TALKING only the primary works (the call needs the CPU);
//   * while the student is SILENT (the partner talks) the chunks that piled up are
//     shared with helpers, so a backlog melts quickly;
//   * after the call there is no call left to protect: use every core we can spare.
// A helper is only worth starting when at least one OTHER chunk is waiting (the primary
// takes the next one itself).
//
// The memory / core limits below are GUESSES, not measurements (a model copy's real
// RAM use has not been measured on real phones). They are the thing to tune after
// testing on real devices.

export type PoolPhase = "live" | "after";

export type PoolInput = {
  phase: PoolPhase;
  /** The student is talking right now (only meaningful while live). */
  studentSpeaking: boolean;
  /** Chunks waiting for a worker (not counting the ones being processed). */
  waitingChunks: number;
  cores?: number;
  /** navigator.deviceMemory in GB (Chromium only; undefined on iPhone / Firefox). */
  memoryGB?: number;
  /** Upper limit on model copies in total, primary included. */
  maxTotal: number;
};

/** The most model copies (primary included) this device should run at once. */
export function totalWorkerCap(i: Pick<PoolInput, "phase" | "cores" | "memoryGB" | "maxTotal">): number {
  const byMemory = i.memoryGB === undefined ? 2 : i.memoryGB < 2 ? 1 : i.memoryGB < 4 ? 2 : i.memoryGB < 6 ? 3 : 5;
  // Live: keep two cores for the call itself (audio decode/encode, echo cancellation, the page).
  const byCores = i.cores === undefined ? 2 : i.phase === "live" ? i.cores - 2 : i.cores - 1;
  return Math.max(1, Math.min(byMemory, byCores, i.maxTotal));
}

/** How many helper copies should be working right now (0 = only the primary). */
export function desiredHelpers(i: PoolInput): number {
  if (i.phase === "live" && i.studentSpeaking) return 0;
  const cap = totalWorkerCap(i) - 1;
  const useful = Math.max(0, i.waitingChunks - 1);
  return Math.max(0, Math.min(cap, useful));
}
