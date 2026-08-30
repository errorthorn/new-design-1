"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Clock,
  Mic,
  MessageSquare,
  ListChecks,
  ShieldCheck,
  X,
  Lock,
  CheckCircle2,
  Wifi,
  Loader2,
  UserRound,
  Sun,
  Moon,
} from "lucide-react";
import { GeminiLiveSession } from "@/lib/gemini-live-client";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Navbar } from "@/components/navbar";
import { AuthModal } from "@/components/auth-modal";
import "../dashboard.css";
import "./session.css";

type Stage =
  | "authChecking"
  | "needsLogin"
  | "noSubscription"
  | "form"
  | "checking"
  | "blocked"
  | "ready"
  | "connecting"
  | "live"
  | "saving"
  | "done";
type TranscriptEntry = { role: "student" | "examiner"; text: string };

function formatElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MockTestSessionPage() {
  const [stage, setStage] = useState<Stage>("authChecking");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [nextEligibleAt, setNextEligibleAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  // Light view for the exam room — off (dark) by default; toggled by the
  // student via the header button. Uses the same cream palette as the
  // mock-test dashboard so it feels consistent with the rest of the app.
  const [lightMode, setLightMode] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [part, setPart] = useState<1 | 2 | 3>(1);
  const [partPopup, setPartPopup] = useState<2 | 3 | null>(null);
  // This week's Part 1 topic, set by the admin — purely informational for
  // the student (see the mts-part1-guide card below), doesn't affect what
  // the examiner actually asks.
  const [part1Topic, setPart1Topic] = useState<string | null>(null);
  // Real client-enforced Part 2 prep countdown (seconds remaining), null
  // when no prep window is active. This is what actually gates the
  // student's mic from Gemini — see startPrepCountdown() below — not just
  // a prompt instruction, since Gemini's own VAD can't be trusted to sit
  // through a full silent minute on its own.
  const [prepSecondsLeft, setPrepSecondsLeft] = useState<number | null>(null);
  // The Part 2 cue card — the same teacher-authored question the examiner
  // is instructed to read out (see /admin/questions, Part 2), fetched
  // alongside part1Topic below. Shown on the mts-part1-guide card for the
  // whole of Part 2, like the physical card a real IELTS candidate holds.
  const [part2CueCard, setPart2CueCard] = useState<string | null>(null);
  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const liveStartRef = useRef<number | null>(null);
  const partPopupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // True from the moment advance_part(2) fires until the examiner's cue-card
  // turn actually finishes playing — the real 60s prep window only starts
  // once this flips back to false, not at advance_part itself (that's
  // called before the cue card audio has even been spoken).
  const awaitingCueCardEndRef = useRef(false);

  const startPrepCountdown = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (prepIntervalRef.current) clearInterval(prepIntervalRef.current);
    setPrepSecondsLeft(60);
    prepIntervalRef.current = setInterval(() => {
      setPrepSecondsLeft((s) => {
        if (s === null) return null;
        if (s <= 1) {
          if (prepIntervalRef.current) clearInterval(prepIntervalRef.current);
          prepIntervalRef.current = null;
          session.setMicSuppressed(false);
          session.sendTextTurn(
            "[System note: the student's one-minute preparation time has ended and their microphone is live again. Invite them to begin now — say 'please begin' — then listen.]"
          );
          return null;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  // The mock test is only for signed-in, subscribed students — it's tied
  // to their LingoCraft account so eligibility/attempt history follows the
  // account, not just a phone number typed into a form. This route is also
  // reachable directly (not only via the /mock-test dashboard), so both
  // checks are repeated here rather than assumed from the referring page.
  // Pulled out of the effect so the AuthModal's onSuccess (after a login/
  // signup right here on the page) can re-run the exact same check instead
  // of a full page reload/redirect.
  const checkAuth = useCallback(async () => {
    setStage("authChecking");
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();

      if (!data.user) {
        setStage("needsLogin");
        return;
      }
      if (!data.user.subscriptionActive) {
        setStage("noSubscription");
        return;
      }

      setName(data.user.name || "");
      setEmail(data.user.email || null);

      // This week's Part 1 topic + the Part 2 cue card — both informational,
      // shown on the mts-part1-guide card during their respective parts. A
      // failed/empty fetch just means that part's card doesn't show a topic
      // (see the stage === "live" block).
      fetch("/api/mock-test/topic")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          setPart1Topic(d?.topic?.trim() || null);
          setPart2CueCard(d?.part2CueCard?.trim() || null);
        })
        .catch(() => setPart1Topic(null));

      // Returning student? Skip the name+phone form entirely — we
      // already have their profile from a previous check-in.
      try {
        const elRes = await fetch("/api/mock-test/eligibility");
        const el = await elRes.json();

        if (elRes.ok && el.hasProfile) {
          setName(el.name || data.user.name || "");
          setPhone(el.phone || "");
          setStudentId(el.studentId);
          if (!el.eligible) {
            setNextEligibleAt(el.nextEligibleAt);
            setStage("blocked");
          } else {
            setStage("ready");
          }
          return;
        }
      } catch {
        // Fall through to the first-time form below.
      }

      setStage("form");
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
      setStage("form");
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // If the student navigates away (or the component otherwise unmounts)
  // while a test is live, close the session instead of leaving the mic,
  // WebSocket, and audio contexts running silently in the background —
  // this was previously only cleaned up by an explicit "Finish Test"
  // click, so an in-app navigation away mid-test never released the mic
  // or ended the Gemini session.
  useEffect(() => {
    return () => {
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  // Elapsed-time readout for the live stage — purely presentational, ticks
  // once a second while "live" and resets the moment the stage changes.
  useEffect(() => {
    if (stage !== "live") {
      liveStartRef.current = null;
      setElapsed(0);
      return;
    }
    liveStartRef.current = Date.now();
    const id = setInterval(() => {
      if (liveStartRef.current) {
        setElapsed(Math.floor((Date.now() - liveStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [stage]);

  // Clear any pending part-popup auto-dismiss timer, and the prep
  // countdown interval, on unmount.
  useEffect(() => {
    return () => {
      if (partPopupTimerRef.current) clearTimeout(partPopupTimerRef.current);
      if (prepIntervalRef.current) clearInterval(prepIntervalRef.current);
    };
  }, []);

  async function handleCheckIn(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStage("checking");

    try {
      const res = await fetch("/api/mock-test/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? "Something went wrong.");
        setStage("form");
        return;
      }

      setStudentId(data.studentId);

      if (!data.eligible) {
        setNextEligibleAt(data.nextEligibleAt);
        setStage("blocked");
      } else {
        setStage("ready");
      }
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
      setStage("form");
    }
  }

  async function startTest() {
    if (!studentId) return;
    setErrorMsg(null);
    setTranscript([]);
    setPart(1);
    setPartPopup(null);
    setPrepSecondsLeft(null);
    awaitingCueCardEndRef.current = false;
    if (prepIntervalRef.current) {
      clearInterval(prepIntervalRef.current);
      prepIntervalRef.current = null;
    }
    setStage("connecting");

    try {
      // 1. Ask the browser for mic permission + get a session token from our server.
      const res = await fetch("/api/mock-test/gemini-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error ?? "Could not start the test.");
        setStage("ready");
        return;
      }

      setAttemptId(data.attemptId);

      const session = new GeminiLiveSession();
      session.onTranscriptUpdate = (t) => setTranscript(t);
      session.onOpen = () => setStage("live");
      session.onError = (msg) => {
        setErrorMsg(msg);
      };
      session.onClose = () => {
        // If the connection drops unexpectedly while still "live", surface it.
      };
      session.onReconnecting = () => setReconnecting(true);
      session.onReconnected = () => setReconnecting(false);
      // The examiner calls advance_part right before starting Part 2 /
      // Part 3 — surface that as a popup so the student knows the section
      // just changed, without ever showing a running transcript.
      session.onPartChange = (p) => {
        setPart(p);
        setPartPopup(p);
        if (partPopupTimerRef.current) clearTimeout(partPopupTimerRef.current);
        partPopupTimerRef.current = setTimeout(() => setPartPopup(null), 9000);

        if (p === 2) {
          // Suppress the mic the instant Part 2 starts (before the cue
          // card is even fully read) so a stray sound can't cut the
          // examiner off mid-topic. The actual 60s prep countdown only
          // starts once the cue-card turn finishes — see
          // onExaminerTurnComplete below.
          session.setMicSuppressed(true);
          awaitingCueCardEndRef.current = true;
        } else {
          // Safety net: Part 3 starting means prep is definitely over.
          if (prepIntervalRef.current) {
            clearInterval(prepIntervalRef.current);
            prepIntervalRef.current = null;
          }
          awaitingCueCardEndRef.current = false;
          setPrepSecondsLeft(null);
          session.setMicSuppressed(false);
        }
      };
      session.onExaminerTurnComplete = () => {
        if (awaitingCueCardEndRef.current) {
          awaitingCueCardEndRef.current = false;
          startPrepCountdown();
        }
      };

      sessionRef.current = session;
      await session.connect(data.token, data.model);
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        setErrorMsg("You need to grant microphone permission — tap Allow in the browser's permission popup.");
      } else {
        setErrorMsg("Could not start the test. Please try again.");
      }
      setStage("ready");
    }
  }

  async function endTest() {
    const session = sessionRef.current;
    const fullTranscript = session?.getTranscriptText() ?? "";
    // Must grab the recording BEFORE close() — close() tears down the
    // audio contexts the recorder depends on.
    const audioBlob = await session?.stopRecording().catch(() => null);
    session?.close();
    sessionRef.current = null;

    setStage("saving");

    if (attemptId) {
      try {
        await fetch("/api/mock-test/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId, transcript: fullTranscript }),
        });
      } catch {
        // Non-fatal for the student's experience — attempt is already logged.
      }

      if (audioBlob && audioBlob.size > 0) {
        try {
          const contentType = audioBlob.type || "audio/webm";
          // Step 1: ask our server for a short-lived signed upload URL.
          const urlRes = await fetch(
            `/api/mock-test/upload-audio?attemptId=${attemptId}&contentType=${encodeURIComponent(
              contentType
            )}`
          );
          const urlData = await urlRes.json();
          if (!urlRes.ok) throw new Error(urlData.error ?? "Upload URL failed");

          // Step 2: browser PUTs the recording straight to Supabase Storage —
          // this bytes-heavy request never touches our Next.js function, so
          // its body-size limit is a non-issue even for a 25-minute file.
          const { error: uploadError } = await supabaseBrowser.storage
            .from("mock-test-audio")
            .uploadToSignedUrl(urlData.path, urlData.token, audioBlob, {
              contentType,
            });
          if (uploadError) throw uploadError;

          // Step 3: tell our server the upload succeeded so it can record
          // the path on the attempt row.
          await fetch("/api/mock-test/upload-audio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              attemptId,
              path: urlData.path,
              sizeBytes: audioBlob.size,
            }),
          });
        } catch {
          // Non-fatal — the teacher can still grade from the transcript
          // alone if the recording upload failed (e.g. flaky connection).
        }
      }
    }

    setStage("done");
  }

  const lastSpeaker = transcript.length ? transcript[transcript.length - 1].role : "student";

  return (
    <>
      <Navbar />

      <div className="mt-page">
        <AuthModal
          open={stage === "needsLogin"}
          onClose={() => (window.location.href = "/")}
          onSuccess={checkAuth}
          title="Sign in for Mock Test"
          subtitle="Log in or create an account to check your Speaking Club membership."
        />

        {/* Pre-test instructions — shown once the student taps "Start Test"
            from the ready stage, before the mic/session actually connects.
            This is a real IELTS Speaking simulation (3 parts, examiner-style
            questioning), so students should know the format and rules going
            in rather than discovering them mid-test. */}
        {showInstructions && (
          <div className="mt-modal-backdrop" onClick={() => setShowInstructions(false)}>
            <div className="mt-modal mts-modal" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowInstructions(false)}
                aria-label="Close"
                className="mts-modal-close"
              >
                <X size={17} />
              </button>

              <span className="mt-eyebrow">
                <ShieldCheck size={13} />
                IELTS Speaking Simulation
              </span>

              <h3 style={{ marginTop: 14 }}>Know these rules before you start</h3>
              <p className="mt-modal-sub bn">
                This is set up just like a real IELTS Speaking test — there are 3 parts, and an AI examiner will talk with you.
              </p>

              <div className="mts-rule">
                <ListChecks size={18} />
                <div>
                  <strong>There will be 3 parts</strong>
                  <span className="bn">
                    Part 1: Introductory questions · Part 2: One minute prep + speak on a cue card for two
                    minutes · Part 3: A deeper discussion on that topic.
                  </span>
                </div>
              </div>

              <div className="mts-rule">
                <Clock size={18} />
                <div>
                  <strong>It will take 11–14 minutes</strong>
                  <span className="bn">Once started, it can&apos;t be paused or restarted — you&apos;ll need to finish it in one go.</span>
                </div>
              </div>

              <div className="mts-rule">
                <Mic size={18} />
                <div>
                  <strong>Sit somewhere quiet, with a good microphone</strong>
                  <span className="bn">
                    The browser will ask for microphone permission — you&apos;ll need to allow it. Speak clearly and
                    naturally — don&apos;t read from a script.
                  </span>
                </div>
              </div>

              <div className="mts-rule">
                <MessageSquare size={18} />
                <div>
                  <strong>It will be recorded and reviewed by a teacher</strong>
                  <span className="bn">
                    The full conversation is saved as a transcript and audio, and you&apos;ll see the band score and
                    feedback later on your dashboard.
                  </span>
                </div>
              </div>

              <div className="mts-modal-actions">
                <button
                  onClick={() => setShowInstructions(false)}
                  className="mt-btn mt-ghost"
                >
                  Maybe later
                </button>
                <button
                  onClick={() => {
                    setShowInstructions(false);
                    startTest();
                  }}
                  className="mt-btn mt-primary"
                >
                  <Mic size={15} />
                  Got it, start
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Exam room — a full-screen takeover for connecting/live/saving.
            Real IELTS speaking tests happen in a proctored room, not a
            product page, so the moment the mic actually connects the
            marketing chrome (navbar, hero, cream/blobs) disappears and
            this dark, quiet, exam-software-style shell takes over. */}
        {(stage === "connecting" || stage === "live" || stage === "saving") && (
          <div className={`mts-exam-shell${lightMode ? " mts-light" : ""}`}>
            <div className="mts-exam-header">
              <div className="mts-exam-id">
                <span className="mts-exam-name">{name || "Candidate"}</span>
                <span className="mts-exam-type">IELTS Speaking Simulation · LingoCraft</span>
              </div>
              <div className="mts-exam-status">
                <span className="mts-part-badge">Part {part} / 3</span>
                {prepSecondsLeft !== null && (
                  <span className="mts-prep-badge" title="Preparation time — the mic is not yet sending to Gemini">
                    <Clock size={13} />
                    Prepare · {formatElapsed(prepSecondsLeft)}
                  </span>
                )}
                {stage === "live" && (
                  <span className="mts-rec">
                    <span className="mts-rec-dot" />
                    REC
                  </span>
                )}
                {stage === "live" && <span className="mts-exam-clock">{formatElapsed(elapsed)}</span>}
                <button
                  type="button"
                  onClick={() => setLightMode((v) => !v)}
                  className="mts-theme-toggle"
                  title={lightMode ? "Switch to dark view" : "Switch to light view"}
                  aria-label={lightMode ? "Switch to dark view" : "Switch to light view"}
                >
                  {lightMode ? <Moon size={15} /> : <Sun size={15} />}
                </button>
              </div>
            </div>

            <div className="mts-exam-body">
              {stage === "connecting" && (
                <>
                  <div className="mts-orb-wrap mts-connecting">
                    <div className="mts-orb-ring" />
                    <div className="mts-orb-core">
                      <Mic size={28} strokeWidth={2} />
                    </div>
                  </div>
                  <p className="mts-panel-title mts-exam-body-title">
                    Entering the exam room...
                  </p>
                  <div className="mts-exam-checklist">
                    <div className="mts-exam-check mts-check-done">
                      <CheckCircle2 size={16} />
                      Microphone permission
                    </div>
                    <div className="mts-exam-check mts-check-active">
                      <Loader2 size={16} className="animate-spin" />
                      Connecting to examiner
                    </div>
                    <div className="mts-exam-check">
                      <Wifi size={16} />
                      Test will start once connected
                    </div>
                  </div>
                  {errorMsg && <p className="mts-error bn" style={{ marginTop: 16 }}>{errorMsg}</p>}
                </>
              )}

              {stage === "live" && (
                <>
                  {/* Live guide card — floating white card explaining what
                      to expect and how to answer for whichever part is
                      currently running. Sits at the very top of the live
                      view, with extra breathing room below it so it reads
                      as clearly separate from the rest of the panel. */}
                  {part === 1 && (
                    <div className="mts-part1-guide">
                      {part1Topic && (
                        <div className="mts-part1-guide-topic">
                          <span className="mts-part1-guide-label bn">Today&apos;s Part 1 topic</span>
                          <strong>{part1Topic}</strong>
                        </div>
                      )}
                      <div className="mts-part1-guide-row">
                        <ListChecks size={16} strokeWidth={2} />
                        <div>
                          <strong>What to expect</strong>
                          <span className="bn">
                            Short, familiar questions about you — your studies, work, hometown, hobbies, or daily
                            routine. One question at a time.
                          </span>
                        </div>
                      </div>
                      <div className="mts-part1-guide-row">
                        <MessageSquare size={16} strokeWidth={2} />
                        <div>
                          <strong>How to answer</strong>
                          <span className="bn">
                            Answer in 2–3 natural sentences — enough to show you understood, not a memorized
                            speech. It&apos;s fine to add a small reason or example.
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Part 2 — the same teacher-authored cue card the
                      examiner is instructed to read out (see
                      /admin/questions), fetched once up front and shown
                      here for the full 1-minute prep + 1-2 minute answer,
                      just like the physical card a real IELTS candidate
                      gets to hold. */}
                  {part === 2 && (
                    <div className="mts-part1-guide">
                      <div className="mts-part1-guide-topic">
                        <span className="mts-part1-guide-label bn">Your cue card</span>
                        {part2CueCard ? (
                          <strong>{part2CueCard}</strong>
                        ) : (
                          <span className="mts-cue-card-waiting bn">
                            Listen carefully — the examiner will read out your topic.
                          </span>
                        )}
                      </div>
                      <div className="mts-part1-guide-row">
                        <Clock size={16} strokeWidth={2} />
                        <div>
                          <strong>1 minute to prepare</strong>
                          <span className="bn">
                            Use this time to think — jot down a few points mentally. You don&apos;t need to speak
                            yet.
                          </span>
                        </div>
                      </div>
                      <div className="mts-part1-guide-row">
                        <Mic size={16} strokeWidth={2} />
                        <div>
                          <strong>Speak for 1–2 minutes</strong>
                          <span className="bn">
                            Once invited to begin, cover all the points on the card and keep talking without
                            stopping until the examiner cuts in.
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Part 3 — real IELTS Part 3 is a deeper two-way
                      discussion built on the Part 2 topic, so the guidance
                      mirrors that: longer, opinion-backed answers rather
                      than the short Part 1 responses. */}
                  {part === 3 && (
                    <div className="mts-part1-guide">
                      <div className="mts-part1-guide-row">
                        <ListChecks size={16} strokeWidth={2} />
                        <div>
                          <strong>What to expect</strong>
                          <span className="bn">
                            More abstract, opinion-based questions that dig deeper into your Part 2 topic — the
                            examiner may follow up on what you just said.
                          </span>
                        </div>
                      </div>
                      <div className="mts-part1-guide-row">
                        <MessageSquare size={16} strokeWidth={2} />
                        <div>
                          <strong>How to answer</strong>
                          <span className="bn">
                            Give a full, developed answer — state your opinion, explain why, and add an example
                            or comparison. This is where you show your range of language.
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mts-live-label bn">
                    <span className="mts-dot" />
                    Live — speak now, your mic is being heard
                  </div>

                  <div
                    className={`mts-orb-wrap mts-live mts-turn-${
                      lastSpeaker === "examiner" ? "examiner" : "student"
                    }`}
                  >
                    <div className="mts-orb-ring" />
                    <div className="mts-orb-core">
                      <Mic size={28} strokeWidth={2} />
                    </div>
                  </div>

                  {reconnecting && (
                    <p className="mts-reconnect-note bn">
                      Reconnecting... please wait a moment and keep talking.
                    </p>
                  )}

                  {/* No visible transcript during the test — instead a live
                      "examiner presence" strip: an avatar + waveform that
                      animates when the examiner is talking, and goes quiet
                      when it's the student's turn, so it reads like someone
                      is actually in the room rather than a call log. */}
                  <div className={`mts-examiner-presence mts-turn-${lastSpeaker === "examiner" ? "examiner" : "student"}`}>
                    <div className="mts-examiner-avatar">
                      <UserRound size={18} strokeWidth={2} />
                    </div>
                    <div className="mts-examiner-info">
                      <span className="mts-examiner-name">AI Examiner</span>
                      <span className="mts-examiner-state bn">
                        {lastSpeaker === "examiner" ? "Speaking..." : "Listening..."}
                      </span>
                    </div>
                    <div className="mts-waveform" aria-hidden="true">
                      <span /><span /><span /><span /><span />
                    </div>
                  </div>
                </>
              )}

              {stage === "saving" && (
                <>
                  <div className="mts-orb-wrap mts-connecting">
                    <div className="mts-orb-ring" />
                    <div className="mts-orb-core">
                      <Loader2 size={26} strokeWidth={2} className="animate-spin" />
                    </div>
                  </div>
                  <p className="mts-panel-title mts-exam-body-title">
                    Saving your test and recording...
                  </p>
                  <p className="mts-panel-sub bn mts-exam-body-sub">
                    Don&apos;t close this window.
                  </p>
                </>
              )}
            </div>

            {stage === "live" && (
              <div className="mts-exam-footer">
                <button onClick={endTest} className="mt-btn mt-ghost">
                  Finish Test
                </button>
                <p className="mts-exam-hint bn">Don&apos;t close the tab or window while the test is running</p>
              </div>
            )}
          </div>
        )}

        {/* Part 2 / Part 3 transition popup — the examiner (Gemini) calls
            the advance_part tool right before it starts a new part, and
            that's the only thing that triggers this. It floats on top of
            the exam shell without pausing the live audio/mic. */}
        {partPopup && (
          <div
            className="mt-modal-backdrop"
            onClick={() => {
              setPartPopup(null);
              if (partPopupTimerRef.current) clearTimeout(partPopupTimerRef.current);
            }}
          >
            <div className="mt-modal mts-modal" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  setPartPopup(null);
                  if (partPopupTimerRef.current) clearTimeout(partPopupTimerRef.current);
                }}
                aria-label="Close"
                className="mts-modal-close"
              >
                <X size={17} />
              </button>

              <span className="mt-eyebrow">
                <ShieldCheck size={13} />
                Part {partPopup} starting
              </span>

              {partPopup === 2 ? (
                <>
                  <h3 style={{ marginTop: 14 }}>Part 2 — Cue Card</h3>
                  <p className="mt-modal-sub bn">Part 1 is done. Now the examiner will give you a topic (cue card).</p>
                  <div className="mts-rule">
                    <Clock size={18} />
                    <div>
                      <strong>1 minute to prepare</strong>
                      <span className="bn">After hearing the topic, you&apos;ll get 1 minute to think — you don&apos;t need to say anything during this time.</span>
                    </div>
                  </div>
                  <div className="mts-rule">
                    <Mic size={18} />
                    <div>
                      <strong>Speak for 1–2 minutes straight</strong>
                      <span className="bn">Once you hear &quot;Please begin&quot;, start speaking about the topic without stopping.</span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <h3 style={{ marginTop: 14 }}>Part 3 — Discussion</h3>
                  <p className="mt-modal-sub bn">Part 2 is done. Now there&apos;ll be a deeper discussion on the Part 2 topic.</p>
                  <div className="mts-rule">
                    <MessageSquare size={18} />
                    <div>
                      <strong>Follow-up questions will come</strong>
                      <span className="bn">
                        The examiner will ask one question after another — answer with a bit of detail and your own opinion.
                      </span>
                    </div>
                  </div>
                </>
              )}

              <div className="mts-modal-actions">
                <button
                  onClick={() => {
                    setPartPopup(null);
                    if (partPopupTimerRef.current) clearTimeout(partPopupTimerRef.current);
                  }}
                  className="mt-btn mt-primary"
                  style={{ flex: 1 }}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mts-hero">
          <span className="mt-eyebrow">
            <span className="mt-dot" />
            Speaking Club
          </span>
          <h1>Weekly Mock Test</h1>
          <p className="bn">Take a speaking test once a week and track your progress.</p>
        </div>

        <div className="mts-stage">
          {(stage === "authChecking" || stage === "needsLogin") && (
            <div className="mts-panel mts-tinted mt-fade-up">
              <p className="mts-panel-sub bn">Checking your account...</p>
            </div>
          )}

          {stage === "noSubscription" && (
            <div className="mts-panel mt-fade-up">
              <p className="mts-panel-title">Mock Test is only for Speaking Club members.</p>
              <p className="mts-panel-sub bn">You haven&apos;t subscribed yet, or your membership has expired.</p>
              <Link href="/payment" className="mt-btn mt-primary" style={{ marginTop: 18 }}>
                Join Speaking Club
              </Link>
            </div>
          )}

          {(stage === "form" || stage === "checking") && (
            <form onSubmit={handleCheckIn} className="mts-panel mt-fade-up" style={{ textAlign: "left" }}>
              {email && (
                <p className="mts-note bn">
                  Signed in as: <strong>{email}</strong> &middot;{" "}
                  <Link href="/mock-test" className="mts-link">
                    Dashboard
                  </Link>
                </p>
              )}
              <p className="mts-note bn">
                This is your first time — just enter your name and phone once, we won&apos;t ask again for future tests.
              </p>

              <div className="mts-field">
                <label className="bn">Your name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rafi Ahmed"
                />
              </div>
              <div className="mts-field">
                <label className="bn">Phone number</label>
                <input
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                />
              </div>

              {errorMsg && <p className="mts-error bn">{errorMsg}</p>}

              <button
                type="submit"
                disabled={stage === "checking"}
                className="mt-btn mt-primary"
                style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
              >
                {stage === "checking" ? "Checking..." : "Check in"}
              </button>
            </form>
          )}

          {stage === "blocked" && (
            <div className="mts-panel mt-fade-up">
              <span className="mt-status mt-locked bn" style={{ margin: "0 auto 12px", width: "fit-content" }}>
                <Lock strokeWidth={2} size={12} />
                Locked
              </span>
              <p className="mts-panel-title">No mock test week is unlocked for you right now.</p>
              {nextEligibleAt && (
                <p className="mts-panel-sub bn">
                  Next week unlocks:{" "}
                  {new Date(nextEligibleAt).toLocaleString("en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              )}
              <button onClick={() => setStage("form")} className="mt-btn mt-ghost" style={{ marginTop: 18 }}>
                Go back
              </button>
            </div>
          )}

          {stage === "ready" && (
            <div className="mts-panel mts-tinted mt-fade-up">
              <div className="mts-orb-wrap mts-ready">
                <div className="mts-orb-ring" />
                <div className="mts-orb-core">
                  <Mic size={28} strokeWidth={2} />
                </div>
              </div>
              <p className="mts-panel-title">You&apos;re ready for this week&apos;s test!</p>
              <p className="mts-panel-sub bn">Don&apos;t forget to allow microphone access.</p>
              {errorMsg && <p className="mts-error bn">{errorMsg}</p>}
              <button
                onClick={() => setShowInstructions(true)}
                className="mt-btn mt-primary"
                style={{ marginTop: 20 }}
              >
                <Mic size={15} />
                Start Test
              </button>
            </div>
          )}

          {stage === "done" && (
            <div className="mts-panel mt-fade-up">
              <span className="mt-status mt-done bn" style={{ margin: "0 auto 12px", width: "fit-content" }}>
                🎉
              </span>
              <p className="mts-panel-title">Great! You&apos;ve completed this week&apos;s test.</p>
              <p className="mts-panel-sub bn">See you again next week.</p>
              <Link href="/mock-test" className="mt-btn mt-primary" style={{ marginTop: 18 }}>
                Back to Dashboard
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
