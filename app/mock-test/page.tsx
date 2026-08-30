"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Mic,
  CheckCircle2,
  Radio,
  Lock,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { AuthModal } from "@/components/auth-modal";
import "./dashboard.css";

type Attempt = {
  id: string;
  started_at: string;
  completed_at: string | null;
  score: number | null;
  transcript: string | null;
  feedback: string | null;
  audio_path: string | null;
};

type AuthStage = "checking" | "needsLogin" | "noSubscription" | "ready";
type FilterTab = "all" | "completed" | "upcoming";

const MAX_BAND = 9; // IELTS-style band scale, used only to size the score ring
const DEFAULT_TOTAL_WEEKS = 4; // used only until the server tells us the real, subscription-based number

type RingTone = "high" | "mid" | "low" | "none";

// A band score is a judgment, not just a percentage — 6.0 and 8.5 shouldn't
// paint the same green ring. Thresholds follow how IELTS bands are read in
// practice: 7+ is a strong result, 5.5–6.9 is developing, below that needs
// focused work. No score yet gets a neutral idle ring, not a green one.
function bandTone(score: number | null): RingTone {
  if (score == null) return "none";
  if (score >= 7) return "high";
  if (score >= 5.5) return "mid";
  return "low";
}

function RingChart({
  pct,
  small = false,
  tone = "high",
}: {
  pct: number;
  small?: boolean;
  tone?: RingTone;
}) {
  const r = small ? 18.5 : 30;
  const size = small ? 44 : 70;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className={`mt-ringwrap mt-ring-${tone}${small ? " mt-small" : ""}`}>
      <svg viewBox={`0 0 ${size} ${size}`}>
        <circle className="mt-ring-bg" cx={size / 2} cy={size / 2} r={r} />
        <circle
          className="mt-ring-fg"
          cx={size / 2}
          cy={size / 2}
          r={r}
          style={{ strokeDasharray: c, strokeDashoffset: offset }}
        />
      </svg>
    </div>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Fetches a short-lived signed URL only when the student actually asks to
// listen — the recording is private, so no URL is ever loaded up front.
function RecordingPlayer({ attemptId }: { attemptId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mock-test/attempts/audio?attemptId=${attemptId}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not load recording.");
        return;
      }
      setUrl(data.url);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginBottom: "12px" }}>
      {!url && (
        <button className="mt-btn mt-ghost bn" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "▶ Listen to my recording"}
        </button>
      )}
      {error && <p className="text-red-600 text-sm mt-1">{error}</p>}
      {url && <audio controls src={url} style={{ width: "100%" }} />}
    </div>
  );
}

// Replaces the old linear band-scale ruler with a small cluster of floating
// bubbles — one per score band (Needs Work / On Track / Strong), colored
// with the brand green plus the orange + purple accent pair. Whichever
// band the student's current average falls into is drawn larger and lit
// up with the actual score; the other two stay small, quiet range labels
// in the background. Each bubble bobs on its own delay, same float
// animation the hero's orbit cards already use, so this reads as part of
// the same design language rather than a bolted-on chart.
const scoreBands = [
  { key: "low", range: "0–5.5", label: "Needs Work", color: "var(--mt-rust)", soft: "var(--mt-rust-soft)", shadow: "var(--mt-rust-shadow)", top: 58, left: 0 },
  { key: "high", range: "7–9", label: "Strong", color: "var(--mt-green-deep)", soft: "var(--mt-green-soft)", shadow: "var(--mt-green-shadow)", top: 0, left: 88 },
  { key: "mid", range: "5.5–7", label: "On Track", color: "var(--mt-amber)", soft: "var(--mt-amber-soft)", shadow: "var(--mt-amber-shadow)", top: 70, left: 162 },
] as const;

function BandScale({ avgScore }: { avgScore: number | null }) {
  const zone = avgScore == null ? null : avgScore >= 7 ? "high" : avgScore >= 5.5 ? "mid" : "low";

  return (
    <div className="mt-scale">
      <div className="mt-scale-label">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-leaf-500 ring-4 ring-leaf-100" />
          Your Band
        </span>
        {avgScore != null && <span>Average: <b>{avgScore.toFixed(1)}</b></span>}
      </div>
      <div className="relative h-[192px] w-full">
        {scoreBands.map((band, i) => {
          const active = band.key === zone;
          const size = active ? 118 : 78;
          return (
            <div
              key={band.key}
              className="absolute animate-float-slow"
              style={{ top: band.top, left: band.left, animationDelay: `${i * 1.1}s`, zIndex: active ? 10 : 1 }}
            >
              <div
                className="flex flex-col items-center justify-center rounded-full text-center transition-all duration-500"
                style={{
                  width: size,
                  height: size,
                  border: `2px solid ${band.color}`,
                  background: band.soft,
                  boxShadow: active ? `0 18px 40px -12px ${band.shadow}` : "none",
                  opacity: active ? 1 : 0.65,
                }}
              >
                {active && avgScore != null ? (
                  <>
                    <span className="font-display text-2xl font-extrabold" style={{ color: band.color }}>
                      {avgScore.toFixed(1)}
                    </span>
                    <span className="mt-0.5 font-body text-[9px] font-semibold uppercase tracking-wide text-ink/50">
                      {band.label}
                    </span>
                  </>
                ) : (
                  <span className="font-display text-xs font-bold" style={{ color: band.color }}>
                    {band.range}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MockTestDashboard() {
  const [authStage, setAuthStage] = useState<AuthStage>("checking");
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [eligible, setEligible] = useState(true);
  const [nextEligibleAt, setNextEligibleAt] = useState<string | null>(null);
  const [inProgressAttemptId, setInProgressAttemptId] = useState<string | null>(null);
  const [totalWeeks, setTotalWeeks] = useState(DEFAULT_TOTAL_WEEKS);
  const [weekSchedule, setWeekSchedule] = useState<Record<number, string>>({}); // week_number -> admin-set date
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("all");
  const [openResult, setOpenResult] = useState<Attempt | null>(null);

  // Pulled out of the effect so the AuthModal's onSuccess (after a login/
  // signup right here on the page) can re-run the exact same check instead
  // of a full page reload.
  const checkAuth = useCallback(async () => {
    setAuthStage("checking");
    try {
      const meRes = await fetch("/api/auth/me");
      const me = await meRes.json();

      if (!me.user) {
        setAuthStage("needsLogin");
        return;
      }
      if (!me.user.subscriptionActive) {
        setAuthStage("noSubscription");
        return;
      }

      const res = await fetch("/api/mock-test/attempts");
      const data = await res.json();

      if (!res.ok) {
        setLoadError(data.error ?? "Could not load.");
        setAuthStage("ready");
        return;
      }

      setAttempts(data.attempts ?? []);
      setEligible(data.eligible);
      setNextEligibleAt(data.nextEligibleAt);
      setInProgressAttemptId(data.inProgressAttemptId ?? null);
      setTotalWeeks(data.totalWeeks > 0 ? data.totalWeeks : DEFAULT_TOTAL_WEEKS);
      const scheduleMap: Record<number, string> = {};
      for (const row of data.weekSchedule ?? []) {
        if (row.unlockDate) scheduleMap[row.weekNumber] = row.unlockDate;
      }
      setWeekSchedule(scheduleMap);
      setAuthStage("ready");
    } catch {
      setLoadError("Could not reach the server. Please try again.");
      setAuthStage("ready");
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const completed = useMemo(() => attempts.filter((a) => a.completed_at), [attempts]);
  // Only the attempt the server has confirmed is genuinely live (recent
  // enough to plausibly still be an open tab) counts as "in progress" —
  // an old abandoned attempt just quietly stops being anyone's "next" slot
  // instead of showing as a permanent, un-continuable ghost card.
  const inProgress = inProgressAttemptId
    ? attempts.find((a) => a.id === inProgressAttemptId)
    : undefined;

  const stats = useMemo(() => {
    const scored = completed.filter((a) => a.score != null);
    const avg = scored.length
      ? scored.reduce((sum, a) => sum + (a.score as number), 0) / scored.length
      : null;

    // Streak: count back from the most recent completed attempt as long as
    // consecutive attempts land within ~8 days of each other (a week apart,
    // with a little slack).
    let streak = 0;
    for (let i = completed.length - 1; i >= 0; i--) {
      if (i === completed.length - 1) {
        streak = 1;
        continue;
      }
      const gap =
        new Date(completed[i + 1].started_at).getTime() - new Date(completed[i].started_at).getTime();
      if (gap <= 8 * 24 * 60 * 60 * 1000) {
        streak++;
      } else {
        break;
      }
    }

    return { totalCompleted: completed.length, avgScore: avg, streak };
  }, [completed]);

  // The "next" card is either an actionable "Take Now" slot or a "locked
  // until <date>" notice — eligible/nextEligibleAt now come from the
  // admin's per-week schedule (see lib/mock-test.ts), not a rolling
  // 7-day timer.
  const nextCardStatus: "take-now" | "locked" | "in-progress" = inProgress
    ? "in-progress"
    : eligible
    ? "take-now"
    : "locked";

  const programComplete = completed.length >= totalWeeks && !inProgress;

  const showCompletedCards = tab !== "upcoming";
  const showNextCard = tab !== "completed" && !programComplete;

  // Weeks after the "next" card, up through this account's subscription
  // length, that the student hasn't reached yet — shown as locked
  // placeholders (with a real date if an admin has set one for that week)
  // so the whole paid-for program is always visible, not just what's
  // happened so far.
  const futureWeekNumbers = useMemo(() => {
    const nextWeek = completed.length + 1; // the week already covered by the "next" card
    const weeks: number[] = [];
    for (let w = nextWeek + 1; w <= totalWeeks; w++) weeks.push(w);
    return weeks;
  }, [completed.length, totalWeeks]);

  return (
    <>
      <Navbar />

      <AuthModal
        open={authStage === "needsLogin"}
        onClose={() => (window.location.href = "/")}
        onSuccess={checkAuth}
        title="Sign in for Mock Test"
        subtitle="Log in or create an account to check your Speaking Club membership."
      />

      <div className="mt-page">
        {(authStage === "checking" || authStage === "needsLogin") && (
          <div className="mt-skeleton-wrap" aria-hidden="true">
            <div className="mt-skel mt-skel-eyebrow" />
            <div className="mt-skel mt-skel-title" />
            <div className="mt-skel mt-skel-sub" />
            <div className="mt-skel-stats">
              <div className="mt-skel mt-skel-stat" />
              <div className="mt-skel mt-skel-stat" />
              <div className="mt-skel mt-skel-stat" />
            </div>
            <div className="mt-skel-grid">
              <div className="mt-skel mt-skel-card" />
              <div className="mt-skel mt-skel-card" />
              <div className="mt-skel mt-skel-card" />
            </div>
          </div>
        )}

        {authStage === "noSubscription" && (
          <div className="flex items-center justify-center px-4 py-24">
            <div className="w-full max-w-md rounded-2xl bg-white p-8 border border-black/10 text-center">
              <p className="font-semibold mb-2 text-lg">Mock Test is only for Speaking Club members.</p>
              <p className="text-sm text-black/60 mb-6">
                You haven&apos;t subscribed yet, or your membership has expired. Join to unlock the weekly mock test.
              </p>
              <Link
                href="/payment"
                className="inline-block rounded-full px-6 py-3 font-bold text-white"
                style={{ background: "#6FC24A" }}
              >
                Join Speaking Club
              </Link>
            </div>
          </div>
        )}

        {authStage === "ready" && (
          <>
            <motion.section
              className="mt-page-head"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <div>
                <div className="mt-eyebrow">
                  <span className="mt-levels" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  Band-scored practice, every week
                </div>
                <h1>Practice like it&apos;s exam day.</h1>
              </div>
              <BandScale avgScore={stats.avgScore} />
            </motion.section>

            {loadError && <p className="text-red-600 text-sm px-10 -mt-4 mb-6">{loadError}</p>}

            <section className="mt-stats">
              <div className="mt-stat-card mt-fade-up" style={{ animationDelay: "0.05s" }}>
                <RingChart pct={totalWeeks > 0 ? (completed.length / totalWeeks) * 100 : 0} />
                <div>
                  <div className="mt-stat-num">
                    {stats.totalCompleted}
                    <span className="mt-stat-unit">/ {totalWeeks}</span>
                  </div>
                  <div className="mt-stat-label bn">Tests Completed</div>
                </div>
              </div>
              <div className="mt-stat-card mt-fade-up" style={{ animationDelay: "0.12s" }}>
                <RingChart
                  pct={stats.avgScore != null ? (stats.avgScore / MAX_BAND) * 100 : 0}
                  tone={bandTone(stats.avgScore)}
                />
                <div>
                  <div className={`mt-stat-num mt-tone-${bandTone(stats.avgScore)}`}>
                    {stats.avgScore != null ? stats.avgScore.toFixed(1) : "—"}
                  </div>
                  <div className="mt-stat-label bn">Average Band Score</div>
                </div>
              </div>
              <div className="mt-stat-card mt-fade-up" style={{ animationDelay: "0.19s" }}>
                <RingChart pct={totalWeeks > 0 ? (stats.streak / totalWeeks) * 100 : 0} />
                <div>
                  <div className="mt-stat-num">
                    {stats.streak}
                    <span className="mt-stat-unit">/ {totalWeeks} wk</span>
                  </div>
                  <div className="mt-stat-label bn">Practice Streak</div>
                </div>
              </div>
            </section>

            <section className="mt-filters">
              <button className={`mt-tab${tab === "all" ? " mt-active" : ""}`} onClick={() => setTab("all")}>
                All Weeks
              </button>
              <button
                className={`mt-tab${tab === "completed" ? " mt-active" : ""}`}
                onClick={() => setTab("completed")}
              >
                Completed
              </button>
              <button
                className={`mt-tab${tab === "upcoming" ? " mt-active" : ""}`}
                onClick={() => setTab("upcoming")}
              >
                Upcoming
              </button>
            </section>

            {tab === "completed" && completed.length === 0 ? (
              <div className="mt-empty mt-fade-up">
                <Mic className="mt-empty-icon" strokeWidth={1.4} aria-hidden="true" />
                <p className="bn">No tests completed yet — your first result will show up here.</p>
                {nextCardStatus === "take-now" && (
                  <Link href="/mock-test/session" className="mt-btn mt-primary bn">
                    Take Your First Test
                  </Link>
                )}
                {nextCardStatus === "in-progress" && (
                  <Link href="/mock-test/session" className="mt-btn mt-primary bn">
                    Continue Your Test
                  </Link>
                )}
                {nextCardStatus === "locked" && nextEligibleAt && (
                  <p className="bn" style={{ fontSize: "13px", color: "var(--mt-gray)" }}>
                    Unlocks{" "}
                    {new Date(nextEligibleAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </p>
                )}
              </div>
            ) : (
              <section className="mt-grid">
                {showCompletedCards &&
                  completed.map((a, i) => (
                    <div
                      className="mt-card mt-fade-up"
                      style={{ animationDelay: `${Math.min(i, 8) * 0.06}s` }}
                      key={a.id}
                    >
                      <div className="mt-card-top">
                        <span className="mt-week-badge">WEEK {i + 1}</span>
                        <span className="mt-status mt-done bn">
                          <CheckCircle2 strokeWidth={2.5} aria-hidden="true" />
                          Completed
                        </span>
                      </div>
                      <h3>Full Speaking Simulation</h3>
                      <div className="mt-date bn">{formatDate(a.started_at)}</div>
                      <div className="mt-card-bottom">
                        <div className="mt-best">
                          <RingChart
                            pct={a.score != null ? (a.score / MAX_BAND) * 100 : 0}
                            tone={bandTone(a.score)}
                            small
                          />
                          <div className="mt-best-txt bn">
                            {a.score != null ? (
                              <>
                                Score
                                <b className={`mt-tone-${bandTone(a.score)}`}>{a.score.toFixed(1)}</b>
                              </>
                            ) : (
                              <>
                                Score
                                <b>Pending</b>
                              </>
                            )}
                          </div>
                        </div>
                        <button className="mt-btn mt-ghost bn" onClick={() => setOpenResult(a)}>
                          View Result
                        </button>
                      </div>
                    </div>
                  ))}

                {showNextCard && nextCardStatus === "in-progress" && inProgress && (
                  <div className="mt-card mt-featured mt-fade-up">
                    <div className="mt-card-top">
                      <span className="mt-week-badge">WEEK {completed.length + 1}</span>
                      <span className="mt-status mt-live bn">
                        <Radio strokeWidth={2.5} aria-hidden="true" />
                        In progress
                      </span>
                    </div>
                    <h3>Full Speaking Simulation</h3>
                    <div className="mt-date bn">{formatDate(inProgress.started_at)}</div>
                    <div className="mt-card-bottom">
                      <div className="mt-best">
                        <RingChart pct={0} tone="none" small />
                        <div className="mt-best-txt bn">
                          Score
                          <b>—</b>
                        </div>
                      </div>
                      <Link href="/mock-test/session" className="mt-btn mt-primary bn">
                        Continue
                      </Link>
                    </div>
                  </div>
                )}

                {showNextCard && nextCardStatus === "take-now" && (
                  <div className="mt-card mt-featured mt-fade-up">
                    <div className="mt-card-top">
                      <span className="mt-week-badge">WEEK {completed.length + 1}</span>
                      <span className="mt-status mt-live bn">
                        <Radio strokeWidth={2.5} aria-hidden="true" />
                        Available
                      </span>
                    </div>
                    <h3>Full Speaking Simulation</h3>
                    <div className="mt-date bn">Ready now</div>
                    <div className="mt-card-bottom">
                      <div className="mt-best">
                        <RingChart pct={0} tone="none" small />
                        <div className="mt-best-txt bn">
                          Score
                          <b>—</b>
                        </div>
                      </div>
                      <Link href="/mock-test/session" className="mt-btn mt-primary bn">
                        Take Now
                      </Link>
                    </div>
                  </div>
                )}

                {showNextCard && nextCardStatus === "locked" && (
                  <div className="mt-card mt-fade-up">
                    <div className="mt-card-top">
                      <span className="mt-week-badge">WEEK {completed.length + 1}</span>
                      <span className="mt-status mt-locked bn">
                        <Lock strokeWidth={2} aria-hidden="true" />
                        Locked
                      </span>
                    </div>
                    <h3>Full Speaking Simulation</h3>
                    <div className="mt-date bn">
                      {nextEligibleAt
                        ? `Unlocks ${new Date(nextEligibleAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}`
                        : "—"}
                    </div>
                    <div className="mt-card-bottom">
                      <div className="mt-best">
                        <RingChart pct={0} tone="none" small />
                        <div className="mt-best-txt bn">
                          Score
                          <b>—</b>
                        </div>
                      </div>
                      <button className="mt-btn mt-disabled bn">Locked</button>
                    </div>
                  </div>
                )}

                {showNextCard &&
                  futureWeekNumbers.map((weekNum, i) => (
                    <div
                      className="mt-card mt-fade-up"
                      style={{ animationDelay: `${Math.min(i, 8) * 0.06}s` }}
                      key={`future-week-${weekNum}`}
                    >
                      <div className="mt-card-top">
                        <span className="mt-week-badge">WEEK {weekNum}</span>
                        <span className="mt-status mt-locked bn">
                          <Lock strokeWidth={2} aria-hidden="true" />
                          Locked
                        </span>
                      </div>
                      <h3>Full Speaking Simulation</h3>
                      <div className="mt-date bn">
                        {weekSchedule[weekNum]
                          ? `Unlocks ${formatDate(weekSchedule[weekNum])}`
                          : `Unlocks after Week ${weekNum - 1}`}
                      </div>
                      <div className="mt-card-bottom">
                        <div className="mt-best">
                          <RingChart pct={0} tone="none" small />
                          <div className="mt-best-txt bn">
                            Score
                            <b>—</b>
                          </div>
                        </div>
                        <button className="mt-btn mt-disabled bn">Locked</button>
                      </div>
                    </div>
                  ))}
              </section>
            )}

            <p className="mt-footer-note">Each week unlocks on the date your teacher schedules for it — check back or watch for an announcement.</p>
          </>
        )}
      </div>

      {openResult && (
        <div className="mt-modal-backdrop" onClick={() => setOpenResult(null)}>
          <div className="mt-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Test Result</h3>
            <p className="mt-modal-sub bn">
              {formatDate(openResult.started_at)}
              {openResult.score != null ? ` · Score ${openResult.score.toFixed(1)}` : " · Score pending review"}
            </p>

            {openResult.audio_path && <RecordingPlayer attemptId={openResult.id} />}

            {openResult.feedback?.trim() && (
              <div className="mt-transcript bn" style={{ marginBottom: "12px" }}>
                <strong>Teacher feedback:</strong>
                <br />
                {openResult.feedback}
              </div>
            )}

            <div className="mt-transcript bn">
              {openResult.transcript?.trim() ? openResult.transcript : "No transcript saved."}
            </div>
            <button className="mt-btn mt-ghost mt-modal-close bn" onClick={() => setOpenResult(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
