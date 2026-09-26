"use client";

import { useCallback, useEffect, useRef } from "react";

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
// Degrade silently in every one of those cases: feature-detect
// `'webkitSpeechRecognition' in window`, and if it's missing (or errors
// out completely), this hook simply never produces a transcript for that
// session. The call itself must keep working normally either way — this
// hook must never throw, block, or interrupt the practice session; only
// the automatic feedback is skipped for that one session if unsupported.
// ---------------------------------------------------------------------------

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

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
  studentUsername: string;
};

export function useSpeakingClubTranscript({ enabled, shiftId, studentUsername }: UseSpeakingClubTranscriptOptions) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef<string>("");
  // Gap-fix: the room page loads the admin-set "Topic of the day" +
  // cue-card pool for its own rotating-card UI (see
  // app/speaking-club/room/[code]/page.tsx) via a separate fetch that
  // resolves after this hook is first called, so it's threaded through
  // via setTopicContext (below) rather than as a hook option — read only
  // at the moment of actually submitting, exactly like transcriptRef
  // above. Left empty if that fetch hasn't resolved yet, or on a day
  // with no topic configured; either way submitTranscript below just
  // sends nothing for these fields, same as previously.
  const topicRef = useRef<{ topicTitle?: string; cueCardQuestions?: string[] }>({});
  const setTopicContext = useCallback((ctx: { topicTitle?: string; cueCardQuestions?: string[] }) => {
    topicRef.current = ctx;
  }, []);
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

  useEffect(() => {
    if (!enabled) return;

    // Feature-detect only — never assume support from anything else about
    // the browser. Missing entirely on Firefox by default; present but
    // unreliable in Facebook's in-app WebView (can't detect that case
    // directly, so the try/catch below plus onerror is the real safety
    // net for it).
    const SpeechRecognitionCtor =
      typeof window !== "undefined" ? (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition : undefined;
    if (!SpeechRecognitionCtor) return; // silently unsupported — call proceeds normally, just no transcript this session

    let recognition: SpeechRecognitionLike;
    try {
      recognition = new SpeechRecognitionCtor();
    } catch {
      return; // e.g. WebView reporting support but failing to construct — degrade silently
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
            transcriptRef.current = transcriptRef.current ? `${transcriptRef.current} ${text}` : text;
          }
        }
      }
    };

    recognition.onerror = () => {
      // Transient errors (no-speech, network blip, audio-capture busy) —
      // onend's restart below handles recovery. A persistent failure just
      // means less/no transcript for this session (acceptable degrade per
      // plan §6 Phase B), never something to surface to the student
      // mid-call.
    };

    recognition.onend = () => {
      // Recognition can stop on its own well before the call ends — many
      // browsers auto-stop after a period of silence even with
      // continuous = true. Restart automatically as long as we still
      // should be capturing; stops once leave()/unmount below sets
      // shouldBeRunningRef to false.
      if (shouldBeRunningRef.current) {
        try {
          recognition.start();
        } catch {
          // Already-started or transiently unstartable — the next onend retries.
        }
      }
    };

    recognitionRef.current = recognition;
    shouldBeRunningRef.current = true;
    try {
      recognition.start();
    } catch {
      shouldBeRunningRef.current = false;
    }

    return () => {
      shouldBeRunningRef.current = false;
      try {
        recognition.stop();
      } catch {
        // Nothing to clean up if it never started.
      }
      recognitionRef.current = null;
    };
  }, [enabled]);

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
    const transcript = transcriptRef.current.trim();
    if (!transcript || !shiftId) return; // nothing captured, or no real shift (e.g. Phase 2 dev ?as= identity) — nothing to submit
    hasSubmittedRef.current = true;

    const { topicTitle: currentTopicTitle, cueCardQuestions: currentCueCardQuestions } = topicRef.current;
    const body = JSON.stringify({
      shiftId,
      studentUsername,
      transcript,
      topicTitle: currentTopicTitle,
      cueCardQuestions: currentCueCardQuestions,
    });
    try {
      const sent =
        typeof navigator !== "undefined" && "sendBeacon" in navigator
          ? navigator.sendBeacon("/api/speaking-club/submit-transcript", new Blob([body], { type: "application/json" }))
          : false;
      if (!sent) {
        fetch("/api/speaking-club/submit-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Submission must never be able to break the leave-call flow.
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

  return { submitTranscript, setTopicContext };
}
