// lib/speaking-club/post-call/engine.ts
//
// Post-call engine for Speaking Club AI feedback (transcript-only).
//
// During the call, lib/speaking-club/audio/capture.ts collects the student's speech
// on their own device and — on devices with headroom — already transcribes it in
// the background (lib/speaking-club/transcription/chunk-transcriber.ts), so a whole hour of
// conversation is mostly done by the time the call ends. When the call is over,
// THIS module:
//   1. finishes whatever is still left (re-using the already-loaded model; on
//      devices that did not transcribe live, a time-bounded, evenly spread
//      sample of the call),
//   2. submits the TEXT to /api/speaking-club/submit-transcript (same payload
//      and server pipeline as always — the Gemini worker only ever sees text),
//   3. deletes the audio from the device.
// The student waits on a full-screen screen with a timer
// (components/speaking-club/post-call-banner.tsx) only for step 1 — usually a
// few seconds when live transcription kept up.
//
// Closing the tab / a crash / being offline never loses a session: the audio is
// also mirrored in the device's IndexedDB (lib/speaking-club/storage/segment-store.ts), and
// `resumePendingSessions()` — run when any page loads — finishes leftovers.
import { mergeSegments, samplingOrder, type ChunkJob, type MergeItem } from "@/lib/speaking-club/audio/segmenter";
import { ChunkTranscriber, type FailureReason } from "@/lib/speaking-club/transcription/chunk-transcriber";
import {
  deleteSession,
  listSessions,
  loadSegments,
  saveSession,
  type SessionMeta,
} from "@/lib/speaking-club/storage/segment-store";
import { isAnyCaptureActive } from "@/lib/speaking-club/audio/capture";
import { CLOUD, LIMITS, backgroundBudgetMs, byokEnabled, byokModel, cloudTranscribeEnabled, postCallWaitBudgetMs, whisperPoolEnabled, whisperPoolMax, whisperRemoteHost, whisperWebGpuEnabled } from "@/lib/speaking-club/config";
import { desiredHelpers } from "@/lib/speaking-club/transcription/pool-policy";
import { runPool } from "@/lib/run-pool";
import { cloudAvailable, cloudTranscribe } from "@/lib/speaking-club/transcription/cloud";
import { deviceCanRunWhisper, deviceHints } from "@/lib/speaking-club/device";
import { isByokReady } from "@/lib/speaking-club/transcription/byok";
import { createWhisperWorker, isWhisperReady, markWhisperReady, pickWhisperModel } from "@/lib/speaking-club/transcription/model";
import { recordSubmit } from "@/lib/speaking-club/submit-log";
import { cleanNoteLines } from "@/lib/speaking-club/pronunciation-notes";

export type PostCallState = {
  phase: "idle" | "loading" | "transcribing" | "submitting" | "done" | "error";
  done: number;
  total: number;
  modelPercent: number;
  /**
   * True for the call the student has JUST finished (and that has speech to
   * process): the UI then shows a full-screen wait with a running timer until
   * it's done. False for sessions resumed from an earlier visit (small banner).
   */
  blocking: boolean;
  startedAt: number; // ms epoch when this session's processing began
  transcribeStartedAt: number; // ms epoch when the first chunk started (for the time estimate)
  /** True when the call was too long to transcribe in full and an even sample of it is used. */
  sampled: boolean;
  /**
   * Set with phase "error" when the transcript could not be made and the audio was kept for a
   * later try (BYOK): the banner explains it (key problem, quota, network, ...).
   */
  reason?: FailureReason;
};

const IDLE: PostCallState = {
  phase: "idle",
  done: 0,
  total: 0,
  modelPercent: 0,
  blocking: false,
  startedAt: 0,
  transcribeStartedAt: 0,
  sampled: false,
};

// ---- keeping the mandatory wait bounded ----
// Normally only a small tail is left after the call (live transcription did the
// rest). On devices that don't transcribe live, or couldn't keep up, the
// remaining chunks are processed in an order that spreads evenly over the call
// (first, last, middle, quarters, ...) and stop when the time budget runs out,
// so the wait never grows with the length of the call. The budget for this step
// is `postCallWaitBudgetMs()` in config.ts (model loading is extra).
// ---------------------------------------------------------------------------
// observable state (for the banner)
// ---------------------------------------------------------------------------
let state: PostCallState = IDLE;
const listeners = new Set<() => void>();
let doneTimer: ReturnType<typeof setTimeout> | null = null;

function setState(next: PostCallState) {
  state = next;
  syncUnloadGuard();
  listeners.forEach((l) => l());
}
export function getPostCallState(): PostCallState {
  return state;
}
export function getPostCallServerState(): PostCallState {
  return IDLE;
}
export function subscribePostCall(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Ask the browser to warn before the tab is closed while work is in progress
// (the audio is saved on the device either way, so it's a nudge, not a lock).
let guardOn = false;
const beforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = "";
};
function syncUnloadGuard() {
  if (typeof window === "undefined") return;
  const busy = state.phase === "loading" || state.phase === "transcribing" || state.phase === "submitting";
  if (busy && !guardOn) {
    window.addEventListener("beforeunload", beforeUnload);
    guardOn = true;
  } else if (!busy && guardOn) {
    window.removeEventListener("beforeunload", beforeUnload);
    guardOn = false;
  }
}

// ---------------------------------------------------------------------------
// job queue (sessions are processed one at a time)
// ---------------------------------------------------------------------------
/** Text that someone else already produced during the call (the partner's device, see lib/speaking-club/peer). */
export type ExternalResults = { texts: Map<number, string>; covered: Set<number> };

type Job = {
  meta: SessionMeta;
  segments: Int16Array[] | null;
  /** Utterance index of each entry of `segments` (only when some utterances were left out because they are already covered). */
  positions?: number[];
  blocking: boolean;
  live: ChunkTranscriber | null;
  external: ExternalResults | null;
};
const jobs: Job[] = [];
const activeIds = new Set<string>();
let running = false;

/**
 * Hands a finished call to the engine: transcribe on this device, submit the
 * text, delete the audio. `segments` may be null to load them from IndexedDB.
 */
export function processSession(
  meta: SessionMeta,
  segments: Int16Array[] | null,
  opts?: { blocking?: boolean; live?: ChunkTranscriber | null; external?: ExternalResults | null; positions?: number[] },
): void {
  if (typeof window === "undefined" || activeIds.has(meta.sessionId)) return;
  activeIds.add(meta.sessionId);
  const job: Job = {
    meta,
    segments,
    positions: opts?.positions,
    blocking: Boolean(opts?.blocking),
    live: opts?.live ?? null,
    external: opts?.external ?? null,
  };
  // The call the student has just left goes first, ahead of any old leftovers.
  if (job.blocking) jobs.unshift(job);
  else jobs.push(job);
  void pump();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pump() {
  if (running) return;
  running = true;
  try {
    while (jobs.length > 0) {
      // Never compete with a live call in this tab for the CPU.
      while (isAnyCaptureActive()) await sleep(2000);
      const job = jobs.shift()!;
      try {
        await runJob(job);
      } catch {
        // runJob handles its own failures; this is only a last-resort guard
      } finally {
        activeIds.delete(job.meta.sessionId);
      }
    }
  } finally {
    running = false;
    if (state.phase !== "done" && state.phase !== "error") setState(IDLE);
  }
}

/**
 * Finishes sessions left over from earlier visits (tab closed, crash, offline).
 * Call when a page loads. Safe to call repeatedly.
 */
export async function resumePendingSessions(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    for (const s of await listSessions()) {
      if (activeIds.has(s.sessionId)) continue;
      if (now - s.createdAt > LIMITS.postCallMaxAgeMs || s.attempts >= LIMITS.postCallMaxAttempts) {
        await deleteSession(s.sessionId);
        continue;
      }
      const abandoned = s.status === "capturing" && now - s.updatedAt > LIMITS.abandonedSessionMs;
      if (byokEnabled()) {
        // No working key yet (Google rejected it): wait for the pop-up, don't even load the audio.
        if (!isByokReady()) continue;
        // A transcription try that just failed (quota, network...) is not repeated on every focus: give it a few
        // minutes. (A session that only has TEXT left needs no Google request, so it is retried at once.)
        if (s.status === "ready" && s.attempts > 0 && !s.priorTranscript.trim() && now - s.updatedAt < LIMITS.byokRetryCooldownMs) continue;
      }
      if (s.status === "ready" || abandoned) processSession({ ...s, status: "ready" }, null);
    }
  } catch {
    // resuming is best-effort
  }
}

// ---------------------------------------------------------------------------
// one session
// ---------------------------------------------------------------------------
function newTranscriber(): ChunkTranscriber {
  return new ChunkTranscriber({
    createWorker: createWhisperWorker,
    modelId: pickWhisperModel(),
    remoteHost: whisperRemoteHost(),
    webgpu: whisperWebGpuEnabled(),
  });
}

/** Merges utterances into chunks, never across a gap (an utterance somebody else already transcribed). */
function buildJobs(segs: Int16Array[], positions?: number[]): ChunkJob[] {
  const out: ChunkJob[] = [];
  let run: MergeItem[] = [];
  const flushRun = () => {
    if (run.length > 0) out.push(...mergeSegments(run));
    run = [];
  };
  segs.forEach((data, i) => {
    const pos = positions?.[i] ?? i;
    if (run.length > 0 && pos !== run[run.length - 1].pos + 1) flushRun();
    run.push({ pos, data });
  });
  flushRun();
  return out;
}

async function runJob({ meta, segments: given, positions, blocking, live, external }: Job) {
  let transcriber: ChunkTranscriber | null = live;
  try {
    // What is still to be transcribed: the live transcriber's queue, or (no live
    // transcription / resumed session) all the collected speech, merged into chunks.
    let jobs: ChunkJob[];
    if (transcriber) {
      await transcriber.stopLive(); // let the chunk being processed finish
      // Chunks that FAILED during the call (BYOK: network blip, Google hiccup) get another go now,
      // together with the ones that were never reached; they are not lost.
      jobs = [...transcriber.takeFailed(), ...transcriber.takeQueue()].sort((a, b) => a.pos - b.pos);
    } else {
      const segs = given ?? (await loadSegments(meta.sessionId));
      jobs = buildJobs(segs, given ? positions : undefined);
      // BYOK and Google rejected the key earlier (the "ready" flag was dropped): a session resumed from
      // an earlier visit waits, untouched and without using up an attempt, until the student has
      // entered a working key in the pop-up. (The audio stays safe on the device.)
      if (given === null && jobs.length > 0 && byokEnabled() && !isByokReady()) return;
    }
    const doneAlready = transcriber ? transcriber.chunksDone : 0;
    const externalCount = external?.texts.size ?? 0;
    const hasAudio = doneAlready + jobs.length + externalCount > 0;
    const canRunModel = deviceCanRunWhisper();
    const cloudOn = cloudTranscribeEnabled();
    // No live transcription on this device (weak, or off): when the cloud is on, it does
    // the work first, and the device only transcribes what the cloud could not.
    const cloudFirst = cloudOn && !transcriber;

    // Hold the student on the wait screen ONLY when it will be quick: live
    // transcription ran, the model is already on the device and just a small tail is
    // left — or the cloud does the work. Otherwise (weak device, model still to
    // download, big backlog) the call is finished in the BACKGROUND with a large time
    // budget, so the whole call is transcribed (no sampling) and nobody stares at a
    // timer. The audio is on the device (IndexedDB), so closing the tab only delays it.
    const quickTail = Boolean(transcriber) && isWhisperReady() && jobs.length <= LIMITS.blockingMaxChunks;
    const blockNow = blocking && jobs.length > 0 && (quickTail || (cloudFirst && cloudAvailable()));

    setState({
      ...IDLE,
      phase: jobs.length > 0 ? "loading" : "submitting",
      total: jobs.length,
      startedAt: Date.now(),
      // Only hold the student on a wait screen if there is actually something left to process.
      blocking: blockNow,
    });

    let transcript = meta.priorTranscript.trim();
    let notes: string[] = meta.priorNotes ?? []; // pronunciation notes (BYOK) that go with the transcript
    let partialNotes: string[] = [];
    let modelFailed = false;
    let holdReason: FailureReason | null = null; // BYOK: why the audio is being kept for a later try
    let partialTranscript = ""; // what we have, if the later try is not possible after all
    let stats: TranscribeStats | null = null;

    if (hasAudio) {
      try {
        if (!canRunModel && !cloudOn && externalCount === 0) throw new Error("cannot-transcribe");
        if (!transcriber) transcriber = newTranscriber();
        stats = await transcribeRemaining(transcriber, jobs, {
          budgetMs: blockNow ? postCallWaitBudgetMs() : backgroundBudgetMs(),
          cloudShiftId: cloudOn ? meta.shiftId : null,
          cloudFirst,
          canRunModel,
          external,
        });
        partialTranscript = [transcript, ...stats.texts].filter(Boolean).join(" ").trim();
        partialNotes = cleanNoteLines([...notes, ...stats.notes]);
        const failedHere = stats.failed > 0 && byokEnabled();
        const ratio = stats.chunkCount > 0 ? stats.failed / stats.chunkCount : 0;
        const tooManyGaps =
          failedHere &&
          (transcriber.giveUp || stats.texts.length === 0 || (stats.failed >= 2 && ratio > LIMITS.retryLaterFailureRatio));
        if (tooManyGaps) {
          // A transcript with big holes (or none at all) would give the student wrong feedback and the
          // audio would be gone for good. Keep the audio and try the whole call again later.
          modelFailed = true;
          holdReason = transcriber.failureReason ?? "network";
        } else {
          transcript = partialTranscript;
          notes = partialNotes;
          // Audio is no longer needed; keep only the text (and the pronunciation notes) in case the
          // submit fails and has to be retried later.
          await deleteSession(meta.sessionId);
          await saveSession({ ...meta, priorTranscript: transcript, priorNotes: notes, segmentCount: 0, status: "ready", updatedAt: Date.now() });
        }
      } catch (err) {
        modelFailed = true;
        if (byokEnabled() && err instanceof Error && err.message === "no-key") holdReason = "key";
      }
    }

    if (modelFailed) {
      // A rejected key / unusable model is not the session's fault: it must not use up an attempt
      // while the student has not had the chance to enter a new key (age limit still applies).
      const attempts = holdReason === "key" || holdReason === "model" ? meta.attempts : meta.attempts + 1;
      const persisted = given === null || (await loadSegments(meta.sessionId)).length > 0;
      if (attempts < LIMITS.postCallMaxAttempts && persisted) {
        // The audio is safe in IndexedDB: try again on a later visit.
        await saveSession({ ...meta, status: "ready", attempts, updatedAt: Date.now() });
        recordSubmit({ shiftId: meta.shiftId, words: 0, outcome: "transcribe_failed_will_retry", detail: holdReason ?? undefined });
        setState({ ...IDLE, phase: "error", reason: holdReason ?? undefined });
        scheduleIdle(holdReason ? 20_000 : 8000);
        return;
      }
      // Can't retry (audio only in memory) or out of attempts: send whatever text we do have.
      if (partialTranscript) {
        transcript = partialTranscript;
        notes = partialNotes;
      }
    }

    await submit(meta, transcript, stats, notes);
  } finally {
    transcriber?.dispose();
  }
}

type TranscribeStats = {
  texts: string[]; // chronological
  processed: number; // chunks transcribed (live + partner + cloud + after the call)
  chunkCount: number; // chunks in the whole call
  live: number; // chunks that were already transcribed DURING the call
  loadSec: number; // model load time
  cloud: number; // chunks transcribed by the cloud
  peer: number; // chunks transcribed by the partner's device
  failed: number; // chunks that could not be transcribed (and were not skipped on purpose to save time)
  notes: string[]; // pronunciation notes (BYOK), chronological
};

type RemainingOptions = {
  budgetMs: number;
  /** Set when the cloud may be used for this session. */
  cloudShiftId: string | null;
  /** Send everything to the cloud first (device does not transcribe live). */
  cloudFirst: boolean;
  canRunModel: boolean;
  external: ExternalResults | null;
};

function collectTexts(t: ChunkTranscriber, external: ExternalResults | null): string[] {
  const all = [...t.texts.entries(), ...(external ? external.texts.entries() : [])];
  return all.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
}

/** Finishes the chunks nobody transcribed during the call, within the time budget. */
async function transcribeRemaining(t: ChunkTranscriber, jobs: ChunkJob[], o: RemainingOptions): Promise<TranscribeStats> {
  const doneBefore = t.chunksDone;
  const extCount = o.external?.texts.size ?? 0;
  const chunkCount = doneBefore + jobs.length + extCount;
  let cloudDone = 0;
  let processed = 0; // chunks finished in this step (cloud + local)
  let failedCount = 0; // chunks that failed for good (BYOK)
  const result = (): TranscribeStats => ({
    texts: collectTexts(t, o.external),
    processed: doneBefore + extCount + processed,
    chunkCount,
    live: doneBefore,
    loadSec: t.loadSec,
    cloud: cloudDone,
    peer: extCount,
    failed: failedCount,
    notes: [...t.notes.entries()].sort((a, b) => a[0] - b[0]).flatMap((e) => e[1]),
  });
  if (jobs.length === 0) return result(); // live transcription / the partner covered everything: nothing left to wait for

  const progress = (extra: Partial<PostCallState> = {}) =>
    setState({ ...state, phase: "transcribing", done: processed, total: jobs.length, modelPercent: 100, ...extra });

  // One round of cloud transcription for `list`; returns the chunks the cloud could not do.
  const viaCloud = async (list: ChunkJob[]): Promise<ChunkJob[]> => {
    const failed: ChunkJob[] = [];
    progress({ transcribeStartedAt: state.transcribeStartedAt || Date.now() });
    await runPool(list, CLOUD.concurrency, async (job) => {
      const text = await cloudTranscribe(o.cloudShiftId!, job.audio);
      if (text === null) {
        failed.push(job);
        return;
      }
      t.recordExternal(job, text);
      processed++;
      cloudDone++;
      progress();
    });
    return failed.sort((a, b) => a.pos - b.pos);
  };

  let todo = jobs;
  if (o.cloudFirst && o.cloudShiftId !== null && cloudAvailable()) todo = await viaCloud(todo);
  if (todo.length === 0) return result(); // the model was never needed

  // From here on the DEVICE has to do the rest.
  if (!o.canRunModel) {
    if (doneBefore + extCount + processed === 0) throw new Error("cannot-transcribe");
    return result(); // submit what the partner / cloud did
  }
  // A long local job must not keep the student on the wait screen.
  if (state.blocking && todo.length > LIMITS.blockingMaxChunks) setState({ ...state, blocking: false });

  t.onModelProgress = (pct) => setState({ ...state, phase: "loading", modelPercent: pct });
  setState({ ...state, phase: "loading", done: processed, total: jobs.length, modelPercent: 0 });
  try {
    await t.load(); // instant when the live transcriber already loaded the model
  } catch (err) {
    if (doneBefore + extCount + processed > 0) return result(); // keep what the cloud / partner did
    throw err;
  }
  markWhisperReady();

  const startedAt = Date.now();
  const deadline = startedAt + o.budgetMs;
  let localDone = 0; // chunks finished on this device in this step, all copies together
  let switched = false;
  let outOfTime = false;
  const handled = new Set<ChunkJob>(); // done, in progress, or claimed by a cloud round
  const pending = samplingOrder(todo.length); // indexes still to do; a chunk a copy gave back goes to the front

  const nextIndex = (): number | null => {
    while (pending.length > 0) {
      const i = pending.shift()!;
      if (!handled.has(todo[i])) return i;
    }
    return null;
  };

  // One lane = one model copy working through the shared list. The primary lane is this
  // device's own copy; with the opt-in pool, helper lanes (copies of their own) join it.
  // The text is stored under the chunk's position, so the order of the conversation never
  // depends on which copy finished first.
  const lane = async (run: (job: ChunkJob) => Promise<boolean>, primary: boolean): Promise<void> => {
    for (;;) {
      if (outOfTime || (primary && t.isDead)) return;
      const i = nextIndex();
      if (i === null) return;
      // Stop when the next chunk would not fit in the time budget (at least one is always done).
      if (localDone > 0) {
        const avg = (Date.now() - startedAt) / localDone; // wall time per chunk, all copies together
        if (Date.now() + avg * 0.8 > deadline) {
          outOfTime = true;
          return;
        }
        // Too slow to finish on this device in reasonable time: hand the rest to the cloud (once).
        if (primary && !switched && o.cloudShiftId !== null && !o.cloudFirst && localDone >= CLOUD.minLocalSamples && cloudAvailable()) {
          const left = todo.filter((j) => !handled.has(j)); // includes todo[i]
          if (avg * left.length > CLOUD.switchProjectedMs) {
            switched = true;
            left.forEach((j) => handled.add(j));
            const failed = await viaCloud(left);
            for (const j of failed) {
              handled.delete(j);
              pending.unshift(todo.indexOf(j));
            }
            continue;
          }
        }
      }
      handled.add(todo[i]);
      progress({ transcribeStartedAt: state.transcribeStartedAt || startedAt });
      const ok = await run(todo[i]);
      if (!ok) {
        // This copy could not do it: hand the chunk back; another copy (or the primary) does it.
        handled.delete(todo[i]);
        pending.unshift(i);
        return;
      }
      processed++;
      localDone++;
      progress();
    }
  };

  const primaryRun = async (job: ChunkJob) => {
    await t.processJob(job); // a failed chunk (BYOK) stays in t's failed list and is counted below
    return true;
  };
  const helperLane = async () => {
    const h = newTranscriber();
    try {
      await h.load();
      await lane(async (job) => {
        const text = await h.transcribeExternal(job.audio);
        if (text === null) return false;
        t.recordExternal(job, text);
        return true;
      }, false);
    } catch {
      // this copy could not even load (out of memory...): the others carry on
    } finally {
      h.dispose();
    }
  };
  const helpers = whisperPoolEnabled()
    ? desiredHelpers({
        phase: "after",
        studentSpeaking: false,
        waitingChunks: todo.length,
        maxTotal: whisperPoolMax(),
        ...deviceHints(),
      })
    : 0;
  await Promise.all([lane(primaryRun, true), ...Array.from({ length: helpers }, helperLane)]);
  // A helper that failed may have handed its chunk back after the others were done: the primary finishes what is left.
  if (!outOfTime && !t.isDead) await lane(primaryRun, true);

  // BYOK: chunks that failed (a network blip, a Google hiccup) get another try before they count as lost.
  if (byokEnabled()) {
    await t.retryFailed(undefined, undefined, Date.now() + LIMITS.postCallRetryBudgetMs);
    // A failed chunk was counted as "handled" above; it only counts as processed if the retry worked.
    processed = Math.max(0, processed - t.failedCount);
    // Chunks never reached because the worker died are failures too; ones skipped to save time are not.
    const unreached = outOfTime ? 0 : todo.filter((j) => !handled.has(j)).length;
    failedCount = t.failedCount + unreached;
  }

  // The worker dying part-way is only a failure if nothing at all came out.
  if (t.isDead && t.texts.size === 0 && extCount === 0) throw new Error("worker-died");
  setState({ ...state, phase: "transcribing", done: processed, total: processed, modelPercent: 100, sampled: processed + failedCount < jobs.length });
  return result();
}

async function submit(meta: SessionMeta, transcript: string, stats: TranscribeStats | null, notes: string[] = []) {
  const words = transcript.split(/\s+/).filter(Boolean).length;
  // How long the on-device step took, and with which model — shown on the
  // Performance page so real-world waiting times can be judged.
  const secs = state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0;
  const detail =
    `${byokEnabled() ? `gemini ${byokModel()}` : `whisper ${pickWhisperModel().split("/").pop()}`} ${secs}s` +
    (stats
      ? ` (load ${stats.loadSec}s, chunks ${stats.processed}/${stats.chunkCount}, live ${stats.live}` +
        (stats.cloud ? `, cloud ${stats.cloud}` : "") +
        (stats.peer ? `, partner ${stats.peer}` : "") +
        (stats.failed ? `, failed ${stats.failed}` : "") +
        ")"
      : "");
  if (!transcript) {
    await deleteSession(meta.sessionId);
    recordSubmit({ shiftId: meta.shiftId, words: 0, outcome: "empty_transcript", detail });
    setState(IDLE); // nothing was heard: no "feedback is coming" message
    return;
  }

  setState({ ...state, phase: "submitting", done: state.total, modelPercent: 100 });
  recordSubmit({ shiftId: meta.shiftId, words, outcome: "sending", detail });
  try {
    const res = await fetch("/api/speaking-club/submit-transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shiftId: meta.shiftId,
        studentUsername: meta.studentUsername,
        transcript,
        // Words the model heard mispronounced (BYOK). The server stores them under the transcript.
        pronunciationNotes: notes.length > 0 ? notes : undefined,
        topicTitle: meta.topicTitle,
        cueCardQuestions: meta.cueCardQuestions,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) {
      await deleteSession(meta.sessionId);
      recordSubmit({
        shiftId: meta.shiftId,
        words,
        outcome: data?.skipped ? `skipped:${data.skipped}` : "saved",
        detail,
      });
      setState({ ...state, phase: "done" });
      scheduleIdle(state.blocking ? 4000 : 8000);
      return;
    }
    recordSubmit({
      shiftId: meta.shiftId,
      words,
      outcome: `rejected:${res.status}${data?.reason ? `:${data.reason}` : ""}`,
      detail,
    });
    // 400/403/404: the server will never accept this session — drop it.
    // 401 (logged out) / 5xx: keep the text and retry on a later visit.
    if ([400, 403, 404].includes(res.status)) {
      await deleteSession(meta.sessionId);
      setState({ ...IDLE, phase: "error" });
      scheduleIdle();
    } else {
      await keepForRetry(meta, transcript, notes);
    }
  } catch {
    recordSubmit({ shiftId: meta.shiftId, words, outcome: "network_error", detail });
    await keepForRetry(meta, transcript, notes);
  }
}

async function keepForRetry(meta: SessionMeta, transcript: string, notes: string[] = []) {
  const attempts = meta.attempts + 1;
  if (attempts >= LIMITS.postCallMaxAttempts) {
    await deleteSession(meta.sessionId);
  } else {
    await saveSession({ ...meta, priorTranscript: transcript, priorNotes: notes, segmentCount: 0, status: "ready", attempts, updatedAt: Date.now() });
  }
  setState({ ...IDLE, phase: "error" });
  scheduleIdle();
}

function scheduleIdle(ms = 8000) {
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(() => {
    if (!running && (state.phase === "done" || state.phase === "error")) setState(IDLE);
  }, ms);
}

// ---------------------------------------------------------------------------
// Whisper, in a worker
// ---------------------------------------------------------------------------
