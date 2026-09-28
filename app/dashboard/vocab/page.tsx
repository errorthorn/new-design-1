"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Swords, Sparkles, Volume2, X, RotateCcw, ThumbsUp, ThumbsDown, History, ChevronDown, CalendarDays } from "lucide-react";

type VocabWordExample = { en: string; bn: string | null };
type VocabWord = {
  id: number;
  word: string;
  pronunciation: string | null;
  partOfSpeech: string | null;
  meaning: string;
  synonyms: string[];
  examples: VocabWordExample[];
  dailyDate: string | null;
  topic: string | null;
  status: "known" | "learning" | null;
};

// One day's published vocab batch — every word tagged with the same
// dailyDate, grouped server-side (see /api/vocab). `topic` is whatever
// label(s) admin gave that day's words, joined if more than one was used.
type VocabSet = { date: string; topic: string | null; words: VocabWord[] };

type Filter = "all" | "known" | "learning";

function speak(word: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = "en-US";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function formatSetDate(iso: string): string {
  // New Date("YYYY-MM-DD") parses as UTC midnight — fine here since we
  // only display the date, never do timezone-sensitive arithmetic on it.
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export default function VocabPage() {
  const [words, setWords] = useState<VocabWord[]>([]);
  const [todaysSet, setTodaysSet] = useState<VocabSet | null>(null);
  const [previousSets, setPreviousSets] = useState<VocabSet[]>([]);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<VocabWord | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    fetch("/api/vocab")
      .then((res) => res.json())
      .then((data) => {
        setWords(data.words ?? []);
        setTodaysSet(data.todaysSet ?? null);
        setPreviousSets(data.previousSets ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  function toggleDate(date: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  const counts = useMemo(
    () => ({
      all: words.length,
      known: words.filter((w) => w.status === "known").length,
      learning: words.filter((w) => w.status === "learning").length,
    }),
    [words]
  );

  const filtered = useMemo(() => {
    return words.filter((w) => {
      if (filter !== "all" && w.status !== filter) return false;
      if (search.trim() && !w.word.toLowerCase().includes(search.trim().toLowerCase()))
        return false;
      return true;
    });
  }, [words, filter, search]);

  async function markProgress(word: VocabWord, status: "known" | "learning") {
    setMarking(true);
    try {
      const res = await fetch(`/api/vocab/${word.id}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        // words / todaysSet / previousSets are three separate copies of
        // the same underlying rows (see /api/vocab) — a status change
        // has to be applied to all three, or a word marked from within a
        // Previous Vocabulary set would show stale status back in the
        // main All/Mastered/Learning list, and vice versa.
        const applyStatus = (w: VocabWord) => (w.id === word.id ? { ...w, status } : w);
        setWords((all) => all.map(applyStatus));
        setTodaysSet((s) => (s ? { ...s, words: s.words.map(applyStatus) } : s));
        setPreviousSets((sets) => sets.map((s) => ({ ...s, words: s.words.map(applyStatus) })));
        setSelected((s) => (s && s.id === word.id ? { ...s, status } : s));
      }
    } finally {
      setMarking(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
        Vocabulary Practice
      </h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Pick a mode and start where you left off.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/vocab/practice"
          className="flex items-center gap-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700"
        >
          <BookOpen size={16} />
          Practice Words
        </Link>
        <Link
          href="/dashboard/vocab-battle"
          className="flex items-center gap-2 rounded-pill border border-ink/10 px-5 py-2.5 font-body text-sm font-semibold text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night-soft dark:hover:text-cream"
        >
          <Swords size={16} />
          Vocab Battle
        </Link>
        <span className="flex items-center gap-1.5 rounded-pill border border-leaf-600 bg-white px-4 py-2 font-body text-sm font-medium text-leaf-700 dark:border-leaf-600/40 dark:bg-night-soft dark:text-leaf-500">
          Mastered words: {counts.known}
        </span>
      </div>

      {todaysSet && (
        <div className="mt-6 rounded-2xl border border-ink/10 bg-white p-6 text-ink shadow-sm dark:border-night-border dark:bg-night-soft">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-1.5 font-body text-xs font-semibold uppercase tracking-wider text-leaf-700 dark:text-leaf-500">
                <Sparkles size={13} />
                Today&apos;s Vocabulary{todaysSet.topic ? ` · ${todaysSet.topic}` : ""}
              </div>
              <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                {todaysSet.words.length} {todaysSet.words.length === 1 ? "word" : "words"} for today — click any to see the full details.
              </p>
            </div>
            <Link
              href="/dashboard/vocab/practice"
              className="shrink-0 rounded-pill bg-leaf-600 px-5 py-2.5 text-center font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700"
            >
              Practice today&apos;s words
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {todaysSet.words.map((w) => (
              <button
                key={w.id}
                onClick={() => setSelected(w)}
                className="rounded-pill border border-leaf-600/40 bg-leaf-50 px-3.5 py-1.5 font-body text-sm font-medium text-leaf-700 transition-colors hover:bg-leaf-100 dark:border-leaf-600/40 dark:bg-night dark:text-leaf-500 dark:hover:bg-night-soft"
              >
                {w.word}
              </button>
            ))}
          </div>
        </div>
      )}

      {previousSets.length > 0 && (
        <div className="mt-6 rounded-2xl border border-ink/10 bg-cream-soft dark:border-night-border dark:bg-night-soft">
          <div className="flex items-center gap-2 px-5 py-4">
            <History size={16} className="text-leaf-600 dark:text-leaf-500" />
            <h2 className="font-display text-base font-semibold">Previous Vocabulary</h2>
            <span className="font-body text-xs text-ink-soft/60 dark:text-cream/30">
              Revise earlier days&apos; words
            </span>
          </div>
          <ul className="divide-y divide-ink/10 dark:divide-night-border">
            {previousSets.map((set) => {
              const isOpen = expandedDates.has(set.date);
              return (
                <li key={set.date}>
                  <button
                    type="button"
                    onClick={() => toggleDate(set.date)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-leaf-100/50 dark:hover:bg-night"
                    aria-expanded={isOpen}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <CalendarDays size={15} className="shrink-0 text-ink-soft/50 dark:text-cream/30" />
                      <div className="min-w-0">
                        <p className="font-body text-sm font-semibold">
                          {formatSetDate(set.date)}
                          {set.topic ? ` — ${set.topic}` : ""}
                        </p>
                        <p className="font-body text-xs text-ink-soft dark:text-cream/50">
                          {set.words.length} {set.words.length === 1 ? "word" : "words"}
                        </p>
                      </div>
                    </div>
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-ink-soft transition-transform dark:text-cream/50 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {isOpen && (
                    <div className="flex flex-wrap gap-2 px-5 pb-4">
                      {set.words.map((w) => (
                        <button
                          key={w.id}
                          onClick={() => setSelected(w)}
                          className="flex items-center gap-1.5 rounded-pill border border-ink/10 bg-white px-3.5 py-1.5 font-body text-sm font-medium text-ink transition-colors hover:border-leaf-500/40 hover:bg-leaf-100/50 dark:border-night-border dark:bg-night dark:text-cream dark:hover:bg-night-soft"
                        >
                          {w.word}
                          {w.status === "known" && (
                            <span className="h-1.5 w-1.5 rounded-full bg-leaf-600" title="Mastered" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 rounded-pill border border-ink/10 p-1 dark:border-night-border">
          {(
            [
              ["all", `All ${counts.all}`],
              ["known", `Mastered ${counts.known}`],
              ["learning", `Learning ${counts.learning}`],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-pill px-4 py-1.5 font-body text-sm font-medium transition-colors ${
                filter === key
                  ? "bg-ink text-cream dark:bg-leaf-600"
                  : "text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search words or definitions"
          className="w-full max-w-xs rounded-pill border border-ink/10 bg-cream-soft px-4 py-2 font-body text-sm placeholder:text-ink-soft/50 dark:border-night-border dark:bg-night-soft dark:placeholder:text-cream/30"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-ink/10 bg-cream-soft dark:border-night-border dark:bg-night-soft">
        {loading ? (
          <p className="p-10 text-center font-body text-sm text-ink-soft dark:text-cream/50">
            Loading…
          </p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <p className="font-display text-lg font-semibold">No words found</p>
            <p className="mt-1 max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">
              {words.length === 0
                ? "New words are added daily — check back soon."
                : "Try a different search or filter."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-ink/10 dark:divide-night-border">
            {filtered.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setSelected(w)}
                  className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-leaf-100/50 dark:hover:bg-night"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-base font-semibold">{w.word}</span>
                      {w.partOfSpeech && (
                        <span className="rounded-full border border-leaf-600 bg-white px-2 py-0.5 font-body text-[11px] font-medium text-leaf-700 dark:bg-night dark:text-leaf-500">
                          {w.partOfSpeech}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate font-body text-sm text-ink-soft dark:text-cream/60">
                      {w.meaning}
                    </p>
                  </div>
                  {w.status && (
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 font-body text-xs font-medium ${
                        w.status === "known"
                          ? "border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500"
                          : "bg-amber-100 text-amber-700 dark:bg-night dark:text-amber-400"
                      }`}
                    >
                      {w.status === "known" ? "Mastered" : "Learning"}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-y-auto rounded-2xl bg-cream-soft p-6 text-left shadow-2xl dark:bg-night-soft sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelected(null)}
              aria-label="Close"
              className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-ink-soft hover:bg-leaf-100 hover:text-ink dark:text-cream/60 dark:hover:bg-night dark:hover:text-cream"
            >
              <X size={16} />
            </button>

            <div className="flex items-start gap-2 pr-8">
              <span className="font-display text-3xl font-bold text-ink dark:text-cream">{selected.word}</span>
              <button
                onClick={() => speak(selected.word)}
                aria-label="Pronounce"
                className="mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-leaf-100 text-leaf-700 hover:bg-leaf-200 dark:bg-night dark:text-leaf-500"
              >
                <Volume2 size={14} />
              </button>
            </div>
            {selected.dailyDate && (
              <span className="mt-1.5 flex items-center gap-1.5 font-body text-xs text-ink-soft/70 dark:text-cream/40">
                <CalendarDays size={12} />
                {formatSetDate(selected.dailyDate)}
                {selected.topic ? ` · ${selected.topic}` : ""}
              </span>
            )}
            {selected.pronunciation && (
              <span className="mt-1.5 inline-flex w-fit items-center gap-2 rounded-pill bg-ink/5 px-3 py-1 font-body text-sm text-ink-soft dark:bg-cream/10 dark:text-cream/70">
                {selected.pronunciation}
              </span>
            )}
            {selected.partOfSpeech && (
              <span className="mt-3 w-fit rounded-pill bg-leaf-100 px-3 py-1 font-body text-xs font-semibold italic text-leaf-700 dark:bg-night dark:text-leaf-500">
                {selected.partOfSpeech}
              </span>
            )}

            <p className="mt-4 font-display text-xl font-bold leading-snug text-ink dark:text-cream">
              {selected.meaning}
            </p>

            {selected.synonyms.length > 0 && (
              <div className="mt-5">
                <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
                  Synonyms
                </span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selected.synonyms.map((s) => (
                    <span
                      key={s}
                      className="rounded-pill border border-leaf-600/30 bg-leaf-50 px-3 py-1 font-body text-xs font-medium text-leaf-700 dark:border-leaf-600/40 dark:bg-night dark:text-leaf-500"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {selected.examples.length > 0 && (
              <div className="mt-5 space-y-2">
                <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft dark:text-cream/50">
                  Examples
                </span>
                {selected.examples.map((ex, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 rounded-xl border border-ink/10 bg-white px-3 py-2.5 shadow-sm dark:border-night-border dark:bg-night"
                  >
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-leaf-600 font-body text-[10px] font-bold text-cream">
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-body text-xs font-medium italic leading-snug text-ink dark:text-cream/90">
                        {ex.en}
                      </p>
                      {ex.bn && (
                        <p className="mt-0.5 font-body text-xs leading-snug text-ink-soft dark:text-cream/60">
                          {ex.bn}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-2 border-t border-ink/10 pt-4 dark:border-night-border">
              <button
                onClick={() => markProgress(selected, "known")}
                disabled={marking}
                className={`flex items-center gap-1.5 rounded-pill px-4 py-2 font-body text-sm font-semibold transition-colors disabled:opacity-60 ${
                  selected.status === "known"
                    ? "bg-leaf-600 text-cream"
                    : "border border-leaf-600 text-leaf-700 hover:bg-leaf-100 dark:text-leaf-500 dark:hover:bg-night"
                }`}
              >
                <ThumbsUp size={14} /> Mastered
              </button>
              <button
                onClick={() => markProgress(selected, "learning")}
                disabled={marking}
                className={`flex items-center gap-1.5 rounded-pill px-4 py-2 font-body text-sm font-semibold transition-colors disabled:opacity-60 ${
                  selected.status === "learning"
                    ? "bg-amber-500 text-white"
                    : "border border-ink/10 text-ink-soft hover:bg-amber-100 dark:border-night-border dark:text-cream/70 dark:hover:bg-night"
                }`}
              >
                <ThumbsDown size={14} /> Still learning
              </button>
            </div>
            <p className="mt-3 flex items-center gap-1.5 font-body text-xs text-ink-soft/70 dark:text-cream/30">
              <RotateCcw size={12} />
              Click outside or the ✕ to close
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
