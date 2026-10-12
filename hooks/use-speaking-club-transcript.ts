"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SpeakingAudioCapture,
  shouldPreferWhisper,
  type CaptureState,
} from "@/lib/speaking-whisper-client";
import { processSession } from "@/lib/speaking-post-call";
import { readLastSpeakingSubmit, recordSubmit, type LastSpeakingSubmit } from "@/lib/speaking-submit-log";

// ---------------------------------------------------------------------------
// PHASE B (SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §5/§6 Phase B) — client-side
// transcript capture for the automatic AI feedback + mistake log feature.
//
// This is deliberately separate from useSpeakingRoomCall's WebRTC audio
// stream: the Web Speech API (`webkitSpeechRecognition`) opens its own mic
// permission and transcribes locally in this browser only — the same
// "each student's own mic, never mixed" isolation the call audio already
// uses. Nothing here touches or depends on the WebRTC peer connection.
//
// Browser support (plan §6 Phase B prerequisite — re-checked here, not
// assumed): Chrome/Edge/Opera/Samsung Internet and Safari (macOS 14.1+,
// iOS/iPadOS 14.5+) support this. Firefox does NOT by default (the feature
// exists but sits behind a flag almost no user has touched) — treated as
// unsupported. Facebook's in-app browser (WebView) is also known to behave
// unreliably here even on an underlying Chrome/Safari engine, despite
// otherwise looking supported by feature-detection — students clicking
// through from a Facebook ad/post (this feature's own marketing channel)
// will often land there.
//
// Transcript-only. Two engines, and NEVER any audio upload:
//   1. In-browser Whisper (primary, every browser): DURING the call this only
//      collects the student's speech on their own device, from the call's OWN
//      mic track (no second mic capture, call-mute respected, no CPU spent on
//      transcribing, so the conversation stays smooth). When the call ends the
//      speech is transcribed on the same device (lib/speaking-post-call.ts) and
//      only the resulting TEXT is submitted.
//   2. Web Speech API (this file's recognition code) — emergency backup only,
//      for devices that can't run the model or when the setup requirement is
//      switched off.
// If neither engine can run, that session gets no feedback and `diag` says why.
// Either way this hook never throws, blocks or interrupts the call.
// ---------------------------------------------------------------------------

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  onaudiostart: (() => void) | null;
  onspeechstart: (() => void) | null;
  start: () => void;
  stop: () => void;
};

// ---------------------------------------------------------------------------
// DIAGNOSTICS — so a "no feedback arrived" report can be traced to a real
// cause instead of guessed at. Two pieces:
//   1. `diag` (returned from the hook) — live state of speech capture,
//      shown as a small status chip inside the room.
//   2. A "last submit attempt" record kept in localStorage, shown on the
//      Performance page — says exactly what happened when the call ended
//      (nothing captured / no shift / server said X / sent OK).
// Purely additive: none of this changes when or what gets submitted.
// ---------------------------------------------------------------------------
export type TranscriptDiag = {
  supported: boolean; // browser has SpeechRecognition at all
  listening: boolean; // recognition.start() succeeded and hasn't ended for good
  heardAudio: boolean; // browser reported it is receiving mic audio
  heardSpeech: boolean; // browser reported it detected speech
  lastError: string | null; // SpeechRecognition error code: not-allowed, network, audio-capture, no-speech…
  finalResults: number; // how many finalised phrases were captured
  wordCount: number;
  restarts: number;
  // true once browser transcription is known to be unusable for this
  // session (unsupported browser, or a fatal speech-service error) — the
  // room page uses it to warn the student that no feedback will be made.
  failed: boolean;
  // Which engine is producing the transcript right now.
  engine: "webspeech" | "whisper";
  whisperStatus: CaptureState["status"] | "idle";
  capturedSeconds: number; // seconds of the student's speech collected so far (Whisper engine)
};

const INITIAL_DIAG: TranscriptDiag = {
  supported: true,
  listening: false,
  heardAudio: false,
  heardSpeech: false,
  lastError: null,
  finalResults: 0,
  wordCount: 0,
  restarts: 0,
  failed: false,
  engine: "webspeech",
  whisperStatus: "idle",
  capturedSeconds: 0,
};

// Web Speech that "starts" fine but never yields text (seen on Android, where
// recognition and the call fight over the mic): hand over to Whisper after
// this long. The Whisper path only spends CPU while someone is actually talking.
const SPEECH_SILENT_FALLBACK_MS = 20_000; // heard speech, still no result
const SPEECH_NEVER_FALLBACK_MS = 90_000; // no result and no speech detected at all


// SpeechRecognition errors that mean "this browser can't transcribe here,
// and retrying won't help" — as opposed to transient ones (no-speech,
// aborted) that the onend auto-restart already handles. On these,
// recognition is stopped (so it doesn't loop on the same error) and the
// in-browser Whisper fallback takes over.
// "network" is what Edge/Chromium on Linux reports on EVERY start (the
// browser's cloud speech service is unreachable). On Android,
// "not-allowed"/"audio-capture" appear when recognition's own mic capture
// collides with the WebRTC call's getUserMedia stream — the Android path
// below feeds recognition the call's own track to avoid exactly that.
const FATAL_SPEECH_ERRORS = new Set([
  "network",
  "service-not-allowed",
  "language-not-supported",
  "not-allowed",
  "audio-capture",
]);

// Re-exported so existing imports (Performance page) keep working.
export { readLastSpeakingSubmit };
export type { LastSpeakingSubmit };

type UseSpeakingClubTranscriptOptions = {
  /**
   * Start capturing once true — pass `call.overallState === "connected"`
   * so capture only runs during an actual live call, never while still
   * connecting or after the call has ended.
   */
  enabled: boolean;
  /**
   * Passed by the room page from the dashboard's "Join the Call" link.
   * Same Phase 2 dev-test-identity caveat as the presence heartbeat and
   * turn-stats reporting elsewhere in this feature: undefined shiftId
   * means the non-production `?as=` identity override, which never runs
   * in production — nothing real to submit feedback against there.
   */
  shiftId?: string;
  /**
   * Returns the call's own live mic track. On Android, Chrome's speech
   * recognition can't open the mic while the WebRTC call already holds it
   * (it fails with "not-allowed"/"audio-capture"), so there recognition is
   * fed THIS track instead (SpeechRecognition.start(track)) — no second mic
   * capture. Browsers that don't support that overload ignore the argument
   * and behave exactly as before.
   */
  getAudioTrack?: () => MediaStreamTrack | null;
  studentUsername: string;
};

export function useSpeakingClubTranscript({
  enabled,
  shiftId,
  studentUsername,
  getAudioTrack,
}: UseSpeakingClubTranscriptOptions) {
  const getAudioTrackRef = useRef(getAudioTrack);
  getAudioTrackRef.current = getAudioTrack;
  // Latest identity, read lazily by the Whisper capture (it outlives the render
  // it was created in, and shiftId / the username can arrive after it started).
  const identityRef = useRef({ shiftId, studentUsername });
  identityRef.current = { shiftId, studentUsername };
  // The throwaway clone currently handed to recognition (stopped when the
  // next one replaces it, or on cleanup) — the call's own track is never
  // given away, so recognition can't ever end the call's mic.
  const recognitionTrackRef = useRef<MediaStreamTrack | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [diag, setDiag] = useState<TranscriptDiag>(INITIAL_DIAG);
  const diagRef = useRef<TranscriptDiag>(INITIAL_DIAG);
  diagRef.current = diag;
  const patchDiag = useCallback(
    (patch: Partial<TranscriptDiag>) =>
      setDiag((prev) => ({ ...prev, ...patch })),
    [],
  );
  const transcriptRef = useRef<string>("");
  const finalCountRef = useRef(0);
  // Gap-fix: the room page loads the admin-set "Topic of the day" +
  // cue-card pool for its own rotating-card UI (see
  // app/speaking-club/room/[code]/page.tsx) via a separate fetch that
  // resolves after this hook is first called, so it's threaded through
  // via setTopicContext (below) rather than as a hook option — read only
  // at the moment of actually submitting, exactly like transcriptRef
  // above. Left empty if that fetch hasn't resolved yet, or on a day
  // with no topic configured; either way submitTranscript below just
  // sends nothing for these fields, same as previously.
  const topicRef = useRef<{ topicTitle?: string; cueCardQuestions?: string[] }>(
    {},
  );
  const setTopicContext = useCallback(
    (ctx: { topicTitle?: string; cueCardQuestions?: string[] }) => {
      topicRef.current = ctx;
    },
    [],
  );
  // Guards the onend auto-restart below: recognition can end on its own
  // (silence timeout, browser quirks) even in continuous mode — this flag
  // is what tells onend "keep going" vs "this was an intentional stop,
  // don't restart."
  const shouldBeRunningRef = useRef(false);
  // Guards against submitting twice for the same room visit: clicking
  // "Leave call" calls submitTranscript directly, and the pagehide
  // listener below (added so an unexpected tab close/crash — not just a
  // clean Leave click — still submits) can ALSO fire right afterward, as
  // the browser actually navigates away following that same click. Without
  // this, that ordinary case would create two speaking_feedback rows with
  // the identical transcript — two feedback entries on the dashboard for
  // one real session.
  const hasSubmittedRef = useRef(false);

  // ---- In-browser Whisper capture (see lib/speaking-whisper-client.ts) ----
  const whisperRef = useRef<SpeakingAudioCapture | null>(null);

  /**
   * Switches this session to the Whisper engine (collects the student's speech
   * on-device; transcription happens after the call). Idempotent. Stops Web
   * Speech first so the same words are never captured twice. Anything Web
   * Speech already transcribed stays in transcriptRef and is sent along.
   */
  const startWhisperFallback = useCallback(() => {
    if (whisperRef.current) return;
    shouldBeRunningRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      // already stopped
    }
    const w = new SpeakingAudioCapture({
      getTrack: () => getAudioTrackRef.current?.() ?? null,
      getInfo: () => {
        const { shiftId: sid, studentUsername: user } = identityRef.current;
        return sid && user
          ? {
              shiftId: sid,
              studentUsername: user,
              topicTitle: topicRef.current.topicTitle,
              cueCardQuestions: topicRef.current.cueCardQuestions,
            }
          : null;
      },
      getPrior: () => transcriptRef.current.trim(),
      onState: (st) => {
        patchDiag({
          engine: "whisper",
          whisperStatus: st.status,
          capturedSeconds: st.seconds,
          failed: st.status === "error" || st.status === "too-weak",
          ...(st.status === "error" || st.status === "too-weak"
            ? { lastError: `whisper:${st.error ?? st.status}` }
            : {}),
        });
      },
    });
    whisperRef.current = w;
    patchDiag({ engine: "whisper", whisperStatus: "starting", failed: false });
    void w.start();
  }, [patchDiag]);

  // The room page going away while a capture is running (e.g. the student used
  // the navbar instead of "Leave call") ends the call too, so treat it as
  // leaving: hand what was captured to the post-call engine right away rather
  // than waiting for a later visit to find it in IndexedDB. Guarded on a live
  // capture so React's dev-mode mount/unmount/mount never submits early.
  const submitRef = useRef<() => void>(() => {});
  useEffect(() => {
    return () => {
      if (whisperRef.current && !hasSubmittedRef.current) {
        submitRef.current();
      }
      whisperRef.current?.dispose();
      whisperRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Feature-detect only — never assume support from anything else about
    // the browser. Missing entirely on Firefox by default; present but
    // unreliable in Facebook's in-app WebView (can't detect that case
    // directly, so the try/catch below plus onerror is the real safety
    // net for it).
    const SpeechRecognitionCtor =
      typeof window !== "undefined"
        ? (window as any).webkitSpeechRecognition ||
          (window as any).SpeechRecognition
        : undefined;
    if (!SpeechRecognitionCtor) {
      patchDiag({ supported: false, lastError: "unsupported-browser" }); // e.g. Firefox
      startWhisperFallback();
      return;
    }

    // Model already downloaded (one-time setup done): EVERY browser uses
    // Whisper on the call's own mic track. Web Speech would fight the call for
    // the mic or be unreliable, so it only runs as an emergency backup — when
    // the device can't run the model or the setup requirement is switched off.
    if (shouldPreferWhisper()) {
      startWhisperFallback();
      return;
    }

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new SpeechRecognitionCtor();
    } catch {
      patchDiag({ supported: false, lastError: "construct-failed" }); // e.g. WebView reporting support but failing to construct
      startWhisperFallback();
      return;
    }

    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = result[0]?.transcript?.trim();
          if (text) {
            transcriptRef.current = transcriptRef.current
              ? `${transcriptRef.current} ${text}`
              : text;
            patchDiag({
              finalResults: ++finalCountRef.current,
              wordCount: transcriptRef.current.split(/\s+/).filter(Boolean)
                .length,
            });
          }
        }
      }
    };

    recognition.onaudiostart = () => patchDiag({ heardAudio: true });
    recognition.onspeechstart = () => patchDiag({ heardSpeech: true });

    recognition.onerror = (event: any) => {
      // Record the code for the diagnostics chip (not-allowed = mic
      // permission denied to the Speech API, network = the browser's
      // speech service unreachable, audio-capture = mic busy/unavailable).
      // "no-speech" is normal silence, so it isn't reported as a problem.
      const code = event?.error as string | undefined;
      if (code && code !== "no-speech" && code !== "aborted")
        patchDiag({ lastError: code });
      if (code && FATAL_SPEECH_ERRORS.has(code)) {
        // Edge/Chromium on Linux lands here on EVERY start ("network": the
        // browser's cloud speech service isn't reachable). Retrying only
        // loops, so hand over to Whisper. Anything already transcribed stays
        // in transcriptRef and is still submitted when the call ends.
        startWhisperFallback();
      }
      // Transient errors (no-speech, network blip, audio-capture busy) —
      // onend's restart below handles recovery. A persistent failure just
      // means less/no transcript for this session (acceptable degrade per
      // plan §6 Phase B), never something to surface to the student
      // mid-call.
    };

    // Android only: feed recognition the call's own mic track (see option
    // doc above). Anywhere else, or if that overload throws, plain start().
    const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
    const startRecognition = () => {
      if (isAndroid) {
        const source = getAudioTrackRef.current?.();
        if (source && source.readyState === "live") {
          recognitionTrackRef.current?.stop();
          const clone = source.clone();
          recognitionTrackRef.current = clone;
          try {
            (recognition as unknown as { start: (track?: MediaStreamTrack) => void }).start(clone);
            return;
          } catch {
            clone.stop();
            recognitionTrackRef.current = null;
          }
        }
      }
      recognition.start();
    };

    recognition.onend = () => {
      // Recognition can stop on its own well before the call ends — many
      // browsers auto-stop after a period of silence even with
      // continuous = true. Restart automatically as long as we still
      // should be capturing; stops once leave()/unmount below sets
      // shouldBeRunningRef to false.
      if (shouldBeRunningRef.current) {
        try {
          startRecognition();
          setDiag((prev) => ({ ...prev, restarts: prev.restarts + 1 }));
        } catch {
          // Already-started or transiently unstartable — the next onend retries.
        }
      }
    };

    recognitionRef.current = recognition;
    shouldBeRunningRef.current = true;
    try {
      startRecognition();
      patchDiag({ listening: true });
    } catch {
      // Couldn't even start (e.g. WebView oddities) — same "no transcript
      // for this session" outcome as the fatal onerror codes above.
      shouldBeRunningRef.current = false;
      patchDiag({ listening: false, lastError: "start-failed" });
      startWhisperFallback();
    }

    // Watchdog: Web Speech can "start" without error yet never deliver text
    // (Android + live call). Hand over to Whisper rather than silently
    // producing an empty transcript for the whole session.
    const watchStartedAt = Date.now();
    let speechSince: number | null = null;
    const watchdog = setInterval(() => {
      if (whisperRef.current) return;
      const d = diagRef.current;
      if (d.finalResults > 0) return;
      const now = Date.now();
      if (d.heardSpeech) {
        if (speechSince === null) speechSince = now;
        if (now - speechSince >= SPEECH_SILENT_FALLBACK_MS) startWhisperFallback();
      } else if (now - watchStartedAt >= SPEECH_NEVER_FALLBACK_MS) {
        startWhisperFallback();
      }
    }, 5000);

    return () => {
      clearInterval(watchdog);
      shouldBeRunningRef.current = false;
      try {
        recognition.stop();
      } catch {
        // Nothing to clean up if it never started.
      }
      recognitionRef.current = null;
      recognitionTrackRef.current?.stop();
      recognitionTrackRef.current = null;
    };
  }, [enabled, patchDiag, startWhisperFallback]);

  /**
   * Call this once, right when the student leaves the call — fire-and-
   * forget by design (plan §6 Phase B): clicking "Leave call" must
   * navigate away immediately, never wait on this network request.
   * sendBeacon survives the tab/navigation actually happening; fetch with
   * keepalive is the fallback where sendBeacon isn't available — same
   * pattern already used for turn-stats reporting in
   * useSpeakingRoomCall. A failed/silent submission just means that
   * session doesn't get feedback (plan §6 Phase B) — this never blocks or
   * throws into the caller.
   *
   * Posts to /api/speaking-club/submit-transcript (Phase C), which
   * validates the caller is actually assigned to this shift and writes a
   * `pending` speaking_feedback row — see that route for the auth shape.
   * studentUsername is included for convenience/logging only; the server
   * derives the real student identity from the signed-in session, never
   * trusts this field.
   *
   * Safe to call more than once (see hasSubmittedRef above) — only the
   * first call that actually has something to send does anything; every
   * call after that is a no-op. This is what lets the room page's Leave
   * button AND the pagehide safety net below both call this without
   * needing to coordinate with each other.
   */
  const submitTranscript = useCallback(() => {
    shouldBeRunningRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }

    if (hasSubmittedRef.current) return; // already sent for this room visit
    // Claimed synchronously so a second near-simultaneous call (Leave
    // button AND the pagehide safety net below can both fire) can never
    // both proceed.
    hasSubmittedRef.current = true;

    // Whisper engine: the call is over, so hand everything collected to the
    // post-call engine. It transcribes on this device and submits the TEXT.
    // The student waits on a full-screen "AI feedback তৈরি হচ্ছে" screen with a
    // running timer until it's done (components/speaking-club/post-call-banner.tsx);
    // if the tab is closed first, the audio is safe in IndexedDB and is
    // finished on a later visit.
    const capture = whisperRef.current;
    if (capture) {
      whisperRef.current = null;
      const result = capture.stop();
      if (result) {
        recordSubmit({
          shiftId: result.meta.shiftId,
          words: 0,
          outcome: "processing_on_device",
          detail: "whisper",
        });
        processSession(result.meta, result.segments, { blocking: true });
        return;
      }
      // No shift known (dev ?as= identity) — fall through; nothing to submit.
    }

    sendNow();

    function sendNow() {
      const transcript = transcriptRef.current.trim();
      if (!transcript || !shiftId) {
        // Nothing captured, or no real shift (e.g. Phase 2 dev ?as= identity) — nothing to submit.
        // Recorded (not silent) so the Performance page can say WHY no feedback appeared.
        recordSubmit({
          shiftId: shiftId ?? null,
          words: 0,
          outcome: !shiftId ? "no_shift_id" : "empty_transcript",
          detail: !shiftId
            ? undefined
            : (diagRef.current.lastError ??
              (diagRef.current.supported ? undefined : "unsupported-browser")),
        });
        return;
      }
      const words = transcript.split(/\s+/).filter(Boolean).length;
      recordSubmit({ shiftId, words, outcome: "sending", detail: diagRef.current.engine });

      const {
        topicTitle: currentTopicTitle,
        cueCardQuestions: currentCueCardQuestions,
      } = topicRef.current;

      // POST that creates the pending speaking_feedback row.
      try {
        // fetch+keepalive (not sendBeacon) so the server's answer can be read
        // and recorded; keepalive still lets it survive the page navigating away.
        fetch("/api/speaking-club/submit-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shiftId,
            studentUsername,
            transcript,
            topicTitle: currentTopicTitle,
            cueCardQuestions: currentCueCardQuestions,
          }),
          keepalive: true,
        })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            const outcome =
              res.ok && data?.ok
                ? data?.skipped
                  ? `skipped:${data.skipped}`
                  : "saved"
                : `rejected:${res.status}${data?.reason ? `:${data.reason}` : ""}`;
            recordSubmit({ shiftId, words, outcome });
          })
          .catch(() => recordSubmit({ shiftId, words, outcome: "network_error" }));
      } catch {
        // Submission must never be able to break the leave-call flow.
        recordSubmit({ shiftId, words, outcome: "send_threw" });
      }
    }
  }, [shiftId, studentUsername]);

  // Safety net for an unexpected end — closing the tab or a crash, neither
  // of which reliably runs the "Leave call" button's onClick or even
  // React's own unmount cleanup. `pagehide` is the standard, most reliable
  // "the page is actually going away" signal (far more so than the older
  // `beforeunload`, which mobile Safari in particular can skip entirely).
  //
  // This used to ALSO submit (and permanently stop recognition — see
  // submitTranscript above) on `visibilitychange` -> "hidden", meant to
  // catch iOS backgrounding cases where pagehide can arrive late. In
  // practice that was actively harmful: "hidden" fires for perfectly
  // ordinary moments in an ongoing call too — the phone's screen timing
  // out while someone talks hands-free, switching to check a message,
  // Android's Recent Apps view — none of which end the call. Because
  // `shouldBeRunningRef.current = false` disabled the onend auto-restart
  // (see above) and nothing ever turned it back on, the FIRST such moment
  // in any call permanently killed capture for the rest of that session —
  // and if it happened before any speech had been recognized yet (very
  // likely near the start of a call), transcriptRef stayed empty forever
  // after, so submitTranscript's own `if (!transcript...) return` guard
  // silently swallowed even the real end-of-call submission too. A full,
  // genuinely spoken session could end with nothing ever saved, and
  // nothing about it looked like an error anywhere.
  //
  // pagehide alone is what's left: it already fires reliably for real
  // navigation, tab close, and (per spec) a page being discarded/bfcached,
  // covering the "the student is genuinely done" case this hook actually
  // needs. The trade-off is the rarer case pagehide might still miss (the
  // OS hard-killing the tab with no events at all) — that session simply
  // gets no feedback, same "acceptable degrade" as the other conditions
  // this hook already tolerates, and far better than silently breaking
  // ordinary calls.
  useEffect(() => {
    if (!enabled) return;

    const handlePageHide = () => submitTranscript();
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [enabled, submitTranscript]);

  submitRef.current = submitTranscript;

  return { submitTranscript, setTopicContext, diag };
}
