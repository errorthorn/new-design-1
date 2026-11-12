"use client";

// components/speaking-club/ai-feedback-modal.tsx
//
// The student-facing "View AI Feedback" screen for one Speaking Club session. The Performance page
// no longer prints the feedback text in the list; it only shows a button that opens this.
//
//   - Top: the overall estimated band in a big circle + one tile per criterion (like an IELTS result sheet)
//   - Examiner comments, then a Score Breakdown with a tab per criterion: level bar, what worked, and
//     "You said -> Better" cards for the top errors with the rule behind each fix
//   - Better version, what to practise, a closing message and the transcript on demand
//
// Data comes from /api/speaking-club/feedback/[id] (report_json is built by lib/speaking-ielts-feedback.ts).
// Older rows have no report_json: they open as plain text instead. Pronunciation is never scored;
// only tips that came from the audio notes are shown. Colours follow the site (leaf / cream / ink / night).
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Loader2,
  CheckCircle2,
  Lightbulb,
  Target,
  ChevronDown,
  Mic,
  Volume2,
  MessageSquareText,
  BookOpen,
  PenLine,
  Sparkles,
  Clock,
  AlertCircle,
} from "lucide-react";

type Fix = { example: string; issue: string; better: string; type?: string; how_to_improve?: string };
type Criterion = { band: number; what_worked: string; to_improve: Fix[] };
type PronTip = { word: string; issue: string; how_to_fix: string; correct?: string };
type PlanItem = { skill: string; why_it_matters: string; exercise: string };
type Report = {
  summary: string;
  bands_shown: boolean;
  call_too_short: boolean;
  min_call_minutes: number;
  overall_band: number | null;
  word_count: number;
  call_minutes: number | null;
  fluency_coherence: Criterion;
  lexical_resource: Criterion;
  grammatical_range_accuracy: Criterion;
  better_version: { original: string; improved: string } | null;
  pronunciation_tips: PronTip[];
  pronunciation_notes?: string[];
  pronunciation_band?: number | null;
  pronunciation_basis?: { per100: number | null; rejected: number; listened: boolean } | null;
  pronunciation_groups?: {
    sound: string;
    words: { word: string; heard: string; saidAs: string; correct: string; tip: string; note: string; status: "confirmed" | "plausible" | "unverified" }[];
  }[];
  improvement_plan: PlanItem[];
  final_message: string;
};
type FeedbackRow = {
  id: string;
  created_at: string;
  status: string;
  feedback_summary: string | null;
  mistake_count: number;
  report_json: Report | null;
  transcript: string | null;
};

type TabKey = "fluency" | "lexical" | "grammar" | "pronunciation";

const fmt = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

function levelLabel(band: number): string {
  if (band >= 8) return "Expert";
  if (band >= 7) return "Advanced";
  if (band >= 6) return "Upper intermediate";
  if (band >= 5) return "Intermediate";
  return "Developing";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function BandBar({ band }: { band: number }) {
  const pct = Math.max(4, Math.min(100, (band / 9) * 100));
  return (
    <div className="relative mt-3 h-3 w-full rounded-pill bg-leaf-100 dark:bg-night-border">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="h-3 rounded-pill bg-leaf-600"
      />
      <span
        className="absolute -top-1.5 flex h-6 min-w-[2.25rem] -translate-x-1/2 items-center justify-center rounded-pill bg-ink px-2 font-body text-xs font-semibold text-cream dark:bg-cream dark:text-ink"
        style={{ left: `${pct}%` }}
      >
        {fmt(band)}
      </span>
    </div>
  );
}

/** Says the word aloud with the browser's own English voice (free, no key, nothing is sent anywhere). */
function speakWord(word: string, slow: boolean) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = slow ? 0.55 : 0.9;
    const voices = synth.getVoices();
    const v = voices.find((x) => x.lang === "en-US") ?? voices.find((x) => x.lang.startsWith("en"));
    if (v) u.voice = v;
    synth.cancel();
    synth.speak(u);
  } catch {
    // no speech support: the Listen button just does nothing
  }
}

type TryState = "idle" | "listening" | "ok" | "miss" | "unsupported" | "error";

/**
 * Listen (correct pronunciation) + Try again (say it, the browser's speech recognition checks which word it heard).
 * The recognition is the browser's own (Chrome / Edge / Safari); it is a rough check, not a score.
 */
function WordPractice({ word }: { word: string }) {
  const [state, setState] = useState<TryState>("idle");
  const [heard, setHeard] = useState("");

  function tryIt() {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setState("unsupported");
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.maxAlternatives = 5;
      rec.interimResults = false;
      rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
        const alts = Array.from(e.results[0] ?? []).map((a) => a.transcript.toLowerCase().replace(/[^a-z' ]/g, "").trim());
        const target = word.toLowerCase().replace(/[^a-z' ]/g, "").trim();
        setHeard(alts[0] ?? "");
        setState(alts[0] === target ? "ok" : "miss");
      };
      rec.onerror = () => setState("error");
      rec.onend = () => setState((s) => (s === "listening" ? "error" : s));
      setState("listening");
      setHeard("");
      rec.start();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        onClick={() => speakWord(word, false)}
        className="flex items-center gap-1 rounded-pill border border-leaf-500 px-3 py-1 font-body text-xs font-semibold text-leaf-700 hover:bg-leaf-50 dark:text-leaf-300 dark:hover:bg-leaf-700/20"
      >
        <Volume2 size={13} /> Listen
      </button>
      <button
        onClick={() => speakWord(word, true)}
        className="rounded-pill border border-ink/15 px-3 py-1 font-body text-xs font-semibold text-ink-soft hover:border-leaf-500 dark:border-night-border dark:text-cream/70"
      >
        Slow
      </button>
      <button
        onClick={tryIt}
        disabled={state === "listening"}
        className="flex items-center gap-1 rounded-pill bg-leaf-600 px-3 py-1 font-body text-xs font-semibold text-cream hover:bg-leaf-700 disabled:opacity-60"
      >
        {state === "listening" ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
        {state === "listening" ? "Say it now…" : "Try it"}
      </button>
      {state === "ok" && <span className="font-body text-xs font-semibold text-leaf-700 dark:text-leaf-300">✓ Clear! It heard “{heard}”.</span>}
      {state === "miss" && <span className="font-body text-xs text-red-700 dark:text-red-300">It heard “{heard || "…"}”. Listen again and retry.</span>}
      {state === "unsupported" && <span className="font-body text-xs text-ink-soft dark:text-cream/60">This browser can’t check speech. Try Chrome.</span>}
      {state === "error" && <span className="font-body text-xs text-ink-soft dark:text-cream/60">Couldn’t hear you. Allow the microphone and retry.</span>}
    </div>
  );
}

function FixCard({ fix }: { fix: Fix }) {
  return (
    <li className="rounded-xl border border-ink/10 bg-white p-4 dark:border-night-border dark:bg-night">
      {fix.type && (
        <span className="mb-2 inline-block rounded-pill border border-leaf-500 px-2.5 py-0.5 font-body text-[11px] font-medium text-leaf-700 dark:text-leaf-500">
          {fix.type}
        </span>
      )}
      <div className="rounded-lg bg-red-50 px-3 py-2 font-body text-sm dark:bg-red-950/30">
        <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">You said</span>
        <span className="text-red-700 line-through decoration-red-400 dark:text-red-300">{fix.example}</span>
      </div>
      <div className="mt-2 rounded-lg bg-leaf-100 px-3 py-2 font-body text-sm dark:bg-leaf-700/25">
        <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide text-leaf-700 dark:text-leaf-300">Better</span>
        <span className="text-leaf-700 dark:text-leaf-100">{fix.better}</span>
      </div>
      <p className="mt-2.5 font-body text-sm text-ink-soft dark:text-cream/70">{fix.issue}</p>
      {fix.how_to_improve && (
        <p className="mt-2 flex gap-2 font-body text-sm text-ink dark:text-cream/90">
          <Lightbulb size={15} className="mt-0.5 shrink-0 text-leaf-600 dark:text-leaf-500" />
          <span>{fix.how_to_improve}</span>
        </p>
      )}
    </li>
  );
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Target; children: React.ReactNode }) {
  return (
    <h4 className="flex items-center gap-2 font-display text-base font-semibold text-ink dark:text-cream">
      <Icon size={16} className="text-leaf-600 dark:text-leaf-500" />
      {children}
    </h4>
  );
}

export function AiFeedbackModal({ feedbackId, onClose }: { feedbackId: string; onClose: () => void }) {
  const [row, setRow] = useState<FeedbackRow | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("fluency");
  const [showTranscript, setShowTranscript] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/speaking-club/feedback/${feedbackId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load this feedback.");
        if (!cancelled) setRow(data.feedback);
      })
      .catch((e) => !cancelled && setError(e.message || "Could not load this feedback."));
    return () => {
      cancelled = true;
    };
  }, [feedbackId]);

  // Esc closes; the page behind stops scrolling while the screen is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Rendered into <body> so a transformed parent (the animated card) can't trap the fixed overlay.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const r = row?.report_json ?? null;
  const shown = !!r?.bands_shown;

  const tabs: { key: TabKey; label: string; band: number | null; sub?: string }[] = r
    ? [
        { key: "fluency", label: "Fluency & Coherence", band: shown ? r.fluency_coherence.band : null },
        { key: "lexical", label: "Vocabulary", band: shown ? r.lexical_resource.band : null },
        { key: "grammar", label: "Grammar", band: shown ? r.grammatical_range_accuracy.band : null },
        {
          key: "pronunciation",
          label: "Pronunciation",
          band: shown ? r.pronunciation_band ?? null : null,
          sub: (() => {
            const n = (r.pronunciation_groups ?? []).reduce((sum, g) => sum + g.words.length, 0) || r.pronunciation_tips.length;
            return n > 0 ? `${n} ${n === 1 ? "word" : "words"}` : r.pronunciation_basis?.listened ? "Clear" : "Not scored";
          })(),
        },
      ]
    : [];

  const criterion: Criterion | null = !r
    ? null
    : tab === "fluency"
      ? r.fluency_coherence
      : tab === "lexical"
        ? r.lexical_resource
        : tab === "grammar"
          ? r.grammatical_range_accuracy
          : null;

  if (!mounted) return null;
  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="AI Speaking Feedback"
    >
      <motion.div
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-ink/10 bg-cream shadow-2xl dark:border-night-border dark:bg-night sm:rounded-2xl"
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-ink/10 bg-white px-5 py-3.5 dark:border-night-border dark:bg-night-soft">
          <div>
            <h3 className="font-display text-lg font-semibold text-ink dark:text-cream">AI Speaking Feedback</h3>
            {row && <p className="font-body text-xs text-ink-soft dark:text-cream/50">Speaking Club · {formatDate(row.created_at)}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-ink/10 text-ink-soft transition-colors hover:bg-leaf-50 dark:border-night-border dark:text-cream/70 dark:hover:bg-night-border"
          >
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-6 pt-5">
          {!row && !error && (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="animate-spin text-leaf-600" size={28} />
            </div>
          )}

          {error && (
            <p className="flex items-center justify-center gap-2 py-16 font-body text-sm text-ink-soft dark:text-cream/60">
              <AlertCircle size={16} /> {error}
            </p>
          )}

          {/* Older rows (no structured report): plain text, still readable. */}
          {row && !r && (
            <div className="rounded-2xl border border-ink/10 bg-white p-5 dark:border-night-border dark:bg-night-soft">
              <p className="whitespace-pre-line font-body text-sm leading-relaxed text-ink-soft dark:text-cream/70">
                {row.feedback_summary || "No feedback text for this session."}
              </p>
            </div>
          )}

          {row && r && (
            <>
              {/* overall + criteria tiles */}
              <section className="text-center">
                <p className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">Overall estimated band</p>
                {shown && r.overall_band != null ? (
                  <>
                    <div className="mx-auto mt-3 flex h-32 w-32 items-center justify-center rounded-full border-4 border-leaf-500 bg-leaf-50 dark:bg-leaf-700/20">
                      <span className="font-display text-5xl font-semibold text-leaf-700 dark:text-leaf-300">{fmt(r.overall_band)}</span>
                    </div>
                    <p className="mt-2 font-body text-sm font-semibold text-ink dark:text-cream">{levelLabel(r.overall_band)}</p>
                  </>
                ) : (
                  <p className="mx-auto mt-3 max-w-md rounded-xl border border-dashed border-leaf-500 bg-white px-4 py-3 font-body text-sm text-ink-soft dark:bg-night-soft dark:text-cream/70">
                    {r.call_too_short
                      ? `No band estimate this time: the call lasted under ${r.min_call_minutes} minutes, which is too short for a reliable score.`
                      : "Too little speech in this session for a reliable band estimate."}{" "}
                    Your feedback is below.
                  </p>
                )}

                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`rounded-xl border px-3 py-3 text-center transition-colors ${
                        tab === t.key
                          ? "border-leaf-600 bg-leaf-50 dark:bg-leaf-700/20"
                          : "border-ink/10 bg-white hover:border-leaf-500 dark:border-night-border dark:bg-night-soft"
                      }`}
                    >
                      <p className="font-display text-2xl font-semibold text-ink dark:text-cream">
                        {t.band != null ? fmt(t.band) : <span className="text-base text-ink-soft dark:text-cream/60">{t.sub ?? "–"}</span>}
                      </p>
                      <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/60">{t.label}</p>
                    </button>
                  ))}
                </div>
              </section>

              {/* quick stats */}
              <section className="mt-5 grid grid-cols-3 gap-3">
                {[
                  { icon: MessageSquareText, label: "Words you spoke", value: r.word_count.toLocaleString() },
                  { icon: Clock, label: "Time in call", value: r.call_minutes != null ? `${r.call_minutes} min` : "–" },
                  { icon: PenLine, label: "Mistakes found", value: String(row.mistake_count) },
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="rounded-xl border border-ink/10 bg-white px-3 py-3 text-center dark:border-night-border dark:bg-night-soft">
                    <Icon size={15} className="mx-auto text-leaf-600 dark:text-leaf-500" />
                    <p className="mt-1 font-display text-lg font-semibold text-ink dark:text-cream">{value}</p>
                    <p className="font-body text-[11px] text-ink-soft dark:text-cream/60">{label}</p>
                  </div>
                ))}
              </section>

              {/* examiner comments */}
              <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-5 dark:border-night-border dark:bg-night-soft">
                <SectionTitle icon={Sparkles}>Examiner comments</SectionTitle>
                <p className="mt-2 font-body text-sm leading-relaxed text-ink-soft dark:text-cream/70">{r.summary}</p>
              </section>

              {/* score breakdown */}
              <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-5 dark:border-night-border dark:bg-night-soft">
                <SectionTitle icon={Target}>Score breakdown</SectionTitle>
                <div className="mt-3 flex flex-wrap gap-2">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`rounded-pill border px-3.5 py-1.5 font-body text-xs font-semibold transition-colors ${
                        tab === t.key
                          ? "border-ink bg-ink text-cream dark:border-cream dark:bg-cream dark:text-ink"
                          : "border-ink/15 text-ink-soft hover:border-leaf-500 dark:border-night-border dark:text-cream/70"
                      }`}
                    >
                      {t.label}
                      {t.band != null && <span className="ml-1.5 opacity-80">{fmt(t.band)}</span>}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={tab}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="mt-5"
                  >
                    {criterion && (
                      <>
                        {shown && (
                          <div className="rounded-xl bg-cream px-4 pb-4 pt-3 dark:bg-night">
                            <p className="font-body text-xs font-medium text-ink-soft dark:text-cream/60">
                              Your level: <span className="font-semibold text-ink dark:text-cream">{levelLabel(criterion.band)}</span>
                            </p>
                            <BandBar band={criterion.band} />
                          </div>
                        )}
                        <p className="mt-4 flex gap-2 font-body text-sm text-ink dark:text-cream/90">
                          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-leaf-600 dark:text-leaf-500" />
                          <span>{criterion.what_worked}</span>
                        </p>
                        <p className="mb-2 mt-5 font-body text-sm font-semibold text-ink dark:text-cream">Your top errors and suggestions</p>
                        {criterion.to_improve.length === 0 ? (
                          <p className="rounded-xl border border-dashed border-leaf-500 px-4 py-3 font-body text-sm text-ink-soft dark:text-cream/60">
                            No clear mistakes to fix here. Nice work.
                          </p>
                        ) : (
                          <ul className="space-y-3">
                            {criterion.to_improve.map((f, i) => (
                              <FixCard key={i} fix={f} />
                            ))}
                          </ul>
                        )}
                      </>
                    )}

                    {tab === "pronunciation" && (
                      <>
                        {shown && r.pronunciation_band != null && (
                          <div className="rounded-xl bg-cream px-4 pb-4 pt-3 dark:bg-night">
                            <p className="font-body text-xs font-medium text-ink-soft dark:text-cream/60">
                              Your level (estimate): <span className="font-semibold text-ink dark:text-cream">{levelLabel(r.pronunciation_band)}</span>
                            </p>
                            <BandBar band={r.pronunciation_band} />
                            <p className="mt-3 font-body text-[11px] leading-relaxed text-ink-soft dark:text-cream/60">
                              Estimated from the words you mispronounced, per words you spoke, after each was checked against a pronunciation dictionary. It
                              covers sounds and word stress only (not intonation or rhythm), so it never goes above 7.0. Treat it as a guide.
                            </p>
                          </div>
                        )}
                        <p className="mt-3 font-body text-xs text-ink-soft dark:text-cream/60">
                          Pronunciations are the standard American ones from a dictionary. Press <b>Listen</b> to hear a word, then <b>Try it</b> to say it
                          back.
                        </p>
                        {(r.pronunciation_groups?.length ?? 0) > 0 ? (
                          <div className="mt-4 space-y-4">
                            <div className="rounded-xl bg-cream px-4 py-3 dark:bg-night">
                              <p className="font-body text-xs font-medium text-ink-soft dark:text-cream/60">Sounds to practise (words, by sound)</p>
                              <ul className="mt-2 space-y-2">
                                {r.pronunciation_groups!.map((g) => {
                                  const max = Math.max(...r.pronunciation_groups!.map((x) => x.words.length));
                                  return (
                                    <li key={g.sound} className="flex items-center gap-3 font-body text-xs">
                                      <span className="w-24 shrink-0 font-semibold text-ink dark:text-cream">{g.sound}</span>
                                      <span className="h-2 flex-1 rounded-pill bg-leaf-100 dark:bg-night-border">
                                        <span className="block h-2 rounded-pill bg-leaf-600" style={{ width: `${Math.max(8, (g.words.length / max) * 100)}%` }} />
                                      </span>
                                      <span className="w-14 shrink-0 text-right text-ink-soft dark:text-cream/60">
                                        {g.words.length} {g.words.length === 1 ? "word" : "words"}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                            {r.pronunciation_groups!.map((g) => {
                              const groupTip = g.words.find((w) => w.tip)?.tip ?? "";
                              const weak = g.sound === "Other" || g.sound === "Not verified";
                              return (
                                <div key={g.sound} className="rounded-xl border border-ink/10 bg-white p-4 dark:border-night-border dark:bg-night">
                                  <p className="flex items-center gap-2 font-display text-base font-semibold text-ink dark:text-cream">
                                    <Mic size={15} className="text-leaf-600 dark:text-leaf-500" />
                                    {g.sound === "Other" ? "Other notes" : g.sound === "Not verified" ? "Not verified (word not in the dictionary)" : `Sound: ${g.sound}`}
                                  </p>
                                  {groupTip && !weak && <p className="mt-1.5 flex gap-2 font-body text-sm text-ink dark:text-cream/90"><Lightbulb size={15} className="mt-0.5 shrink-0 text-leaf-600 dark:text-leaf-500" /><span>{groupTip}</span></p>}
                                  <p className="mt-3 font-body text-xs font-medium text-ink-soft dark:text-cream/60">Words with mistakes</p>
                                  <ul className="mt-2 space-y-2">
                                    {g.words.map((w, i) => (
                                      <li key={i} className="rounded-lg bg-cream px-3 py-2.5 font-body text-sm dark:bg-night-soft">
                                        <div className="flex flex-wrap items-baseline gap-x-2">
                                          <span className="font-semibold text-ink dark:text-cream">{w.word}</span>
                                          {w.correct && <span className="text-leaf-700 dark:text-leaf-300">{w.correct}</span>}
                                          {w.status === "plausible" && <span className="rounded-pill border border-ink/15 px-2 text-[10px] text-ink-soft dark:border-night-border dark:text-cream/60">possible</span>}
                                        </div>
                                        {w.heard && (
                                          <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
                                            you said <span className="line-through decoration-red-400">{w.heard}</span>
                                            {w.saidAs && <span> ({w.saidAs} instead)</span>}
                                          </p>
                                        )}
                                        {w.note && w.status !== "confirmed" && <p className="mt-0.5 text-xs text-ink-soft dark:text-cream/60">{w.note}</p>}
                                        {w.status !== "unverified" && <WordPractice word={w.word} />}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })}
                          </div>
                        ) : r.pronunciation_tips.length > 0 ? (
                          <ul className="mt-3 space-y-3">
                            {r.pronunciation_tips.map((t, i) => (
                              <li key={i} className="rounded-xl border border-ink/10 bg-white p-4 dark:border-night-border dark:bg-night">
                                <p className="flex items-center gap-2 font-display text-base font-semibold text-ink dark:text-cream">
                                  <Mic size={15} className="text-leaf-600 dark:text-leaf-500" /> {t.word}
                                </p>
                                <p className="mt-1 font-body text-sm text-red-700 dark:text-red-300">{t.issue}</p>
                                {t.correct && <p className="mt-2 rounded-lg bg-leaf-100 px-3 py-2 font-body text-sm text-leaf-700 dark:bg-leaf-700/25 dark:text-leaf-100"><span className="mr-2 text-[11px] font-semibold uppercase tracking-wide">Say</span>{t.correct}</p>}
                                {t.how_to_fix && <p className="mt-2 flex gap-2 font-body text-sm text-ink dark:text-cream/90"><Lightbulb size={15} className="mt-0.5 shrink-0 text-leaf-600 dark:text-leaf-500" /><span>{t.how_to_fix}</span></p>}
                                <WordPractice word={t.word} />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-3 rounded-xl border border-dashed border-leaf-500 px-4 py-3 font-body text-sm text-ink-soft dark:text-cream/60">
                            {r.pronunciation_basis?.listened
                              ? "No clear pronunciation mistakes were heard in your audio in this session."
                              : "Pronunciation was not checked for this session (it needs the audio check to be on)."}
                          </p>
                        )}
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>
              </section>

              {/* better version */}
              {r.better_version && (
                <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-5 dark:border-night-border dark:bg-night-soft">
                  <SectionTitle icon={BookOpen}>A better version</SectionTitle>
                  <p className="mt-1 font-body text-xs text-ink-soft dark:text-cream/60">One short part of your speech, rewritten naturally.</p>
                  <div className="mt-3 rounded-lg bg-red-50 px-3 py-2.5 font-body text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                    <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide">You said</span>
                    {r.better_version.original}
                  </div>
                  <div className="mt-2 rounded-lg bg-leaf-100 px-3 py-2.5 font-body text-sm text-leaf-700 dark:bg-leaf-700/25 dark:text-leaf-100">
                    <span className="mr-2 text-[11px] font-semibold uppercase tracking-wide">Try</span>
                    {r.better_version.improved}
                  </div>
                </section>
              )}

              {/* what to practise */}
              {r.improvement_plan.length > 0 && (
                <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-5 dark:border-night-border dark:bg-night-soft">
                  <SectionTitle icon={Target}>What to practise next</SectionTitle>
                  <ol className="mt-3 space-y-3">
                    {r.improvement_plan.map((p, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-leaf-600 font-body text-xs font-semibold text-cream">
                          {i + 1}
                        </span>
                        <div className="font-body text-sm">
                          <p className="font-semibold text-ink dark:text-cream">{p.skill}</p>
                          {p.why_it_matters && <p className="mt-0.5 text-ink-soft dark:text-cream/70">{p.why_it_matters}</p>}
                          {p.exercise && <p className="mt-1 text-ink dark:text-cream/90">Practise: {p.exercise}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {r.final_message && (
                <p className="mt-5 rounded-2xl bg-leaf-50 px-5 py-4 font-body text-sm text-leaf-700 dark:bg-leaf-700/20 dark:text-leaf-100">
                  {r.final_message}
                </p>
              )}

              {/* transcript */}
              {row.transcript && (
                <section className="mt-5">
                  <button
                    onClick={() => setShowTranscript((v) => !v)}
                    className="flex items-center gap-1.5 font-body text-sm font-semibold text-leaf-700 hover:underline dark:text-leaf-500"
                    aria-expanded={showTranscript}
                  >
                    <ChevronDown size={16} className={`transition-transform ${showTranscript ? "rotate-180" : ""}`} />
                    {showTranscript ? "Hide transcript" : "View transcript"}
                  </button>
                  {showTranscript && (
                    <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-ink/10 bg-white p-4 font-body text-xs leading-relaxed text-ink-soft dark:border-night-border dark:bg-night-soft dark:text-cream/70">
                      {row.transcript}
                    </pre>
                  )}
                </section>
              )}

              <p className="mt-5 text-center font-body text-[11px] text-ink-soft dark:text-cream/50">
                This is an estimate from a text transcript, not an official IELTS score. Your full list of exact mistakes is in your Mistake Log.
              </p>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}
