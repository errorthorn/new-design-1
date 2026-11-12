// lib/speaking-club/submit-log.ts
//
// Best-effort diagnostics about the LAST Speaking Club transcript submission on
// this device (shown on the Performance page so a silent failure has a visible
// reason). Lives here — not in the hook — because both the live hook and the
// post-call engine (lib/speaking-club/post-call/engine.ts) write to it.

const LAST_SUBMIT_KEY = "lc_speaking_last_submit";

export type LastSpeakingSubmit = {
  at: string; // ISO time
  shiftId: string | null;
  words: number;
  outcome: string; // machine-ish code, see recordSubmit callers
  detail?: string;
};

export function recordSubmit(entry: Omit<LastSpeakingSubmit, "at">) {
  try {
    localStorage.setItem(LAST_SUBMIT_KEY, JSON.stringify({ at: new Date().toISOString(), ...entry }));
  } catch {
    // storage blocked — diagnostics are best-effort only
  }
}

export function readLastSpeakingSubmit(): LastSpeakingSubmit | null {
  try {
    const raw = localStorage.getItem(LAST_SUBMIT_KEY);
    return raw ? (JSON.parse(raw) as LastSpeakingSubmit) : null;
  } catch {
    return null;
  }
}
