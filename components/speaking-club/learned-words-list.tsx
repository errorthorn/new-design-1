"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Loader2, Trash2, Users, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SavedWord } from "@/components/speaking-club/learned-words-notes";

// "Words you've learned" — the post-call takeaway on the /speaking-club
// dashboard (Feature #4). Shows the student's own words AND the words their
// partner noted while they were in the room together, grouped by session
// (day + shift), newest first. Partner words are tagged with the partner's
// name and can't be deleted from here — only an author removes their own.
//
// Same corner-button pattern as the in-call notes (learned-words-notes.tsx):
// a small fixed icon button in the top-right corner, out of the flow of the
// rest of the dashboard, opening a panel with the full history. Renders its
// own trigger — just drop <LearnedWordsList /> anywhere in the tree.

const INITIAL_VISIBLE = 12;

/** Today's date in Asia/Dhaka as "YYYY-MM-DD" — sessions are dated in Dhaka time. */
function dhakaDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
}

function dayLabel(sessionDate: string): string {
  const now = new Date();
  if (sessionDate === dhakaDateKey(now)) return "Today";
  if (sessionDate === dhakaDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return "Yesterday";
  const [y, m, d] = sessionDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function LearnedWordsList() {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<SavedWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/speaking-club/words?limit=300")
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) throw new Error(data?.error);
        setWords(data.words ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load your saved words — please refresh the page.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(id: string) {
    const previous = words;
    setWords((cur) => (cur ? cur.filter((w) => w.id !== id) : cur));
    try {
      const res = await fetch(`/api/speaking-club/words/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error();
    } catch {
      setWords(previous);
    }
  }

  const visible = useMemo(() => (words ? (showAll ? words : words.slice(0, INITIAL_VISIBLE)) : []), [words, showAll]);

  // One group per session (day + shift). A Map keeps first-seen order, i.e.
  // newest session first, even if a session's words aren't perfectly adjacent.
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; items: SavedWord[] }>();
    for (const w of visible) {
      const key = `${w.sessionDate}|${w.roomCode ?? ""}|${w.shiftNumber ?? ""}`;
      let group = map.get(key);
      if (!group) {
        group = {
          label: w.shiftNumber ? `${dayLabel(w.sessionDate)} · Shift ${w.shiftNumber}` : dayLabel(w.sessionDate),
          items: [],
        };
        map.set(key, group);
      }
      group.items.push(w);
    }
    return Array.from(map.entries()).map(([key, g]) => ({ key, ...g }));
  }, [visible]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Words you've learned"
        title="Words you've learned"
        className="hover-lift fixed right-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border-2 border-leaf-300 bg-white text-ink shadow-lg transition-colors hover:border-leaf-600 hover:bg-leaf-50 dark:border-night-border dark:bg-night-card dark:text-cream"
      >
        <BookOpen size={20} />
        {words && words.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-leaf-600 px-1 font-body text-[11px] font-semibold leading-none text-cream">
            {words.length}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Words you've learned"
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 flex max-h-[75vh] flex-col rounded-t-2xl border border-leaf-300 bg-white p-5 shadow-2xl",
            "sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96 sm:rounded-2xl",
            "dark:border-night-border dark:bg-night-soft"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-leaf-300 bg-white dark:border-night-border dark:bg-night-card">
                <BookOpen size={19} className="text-leaf-700" />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-ink dark:text-cream">Words you&apos;ve learned</h3>
                <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/60">
                  From your calls — yours and your partner&apos;s
                  {words && words.length > 0 ? ` · ${words.length} saved` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="shrink-0 text-ink-soft/60 hover:text-ink-soft"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {words === null && !error && (
              <div className="flex items-center justify-center gap-2 py-6 font-body text-sm text-ink-soft">
                <Loader2 size={16} className="animate-spin" />
                Loading your words…
              </div>
            )}

            {error && <p className="py-4 font-body text-sm text-red-600">{error}</p>}

            {words && words.length === 0 && (
              <p className="py-3 text-center font-body text-xs text-ink-soft dark:text-cream/50">
                Nothing here yet. During your next call, tap <span className="font-semibold text-ink dark:text-cream">New words</span>{" "}
                and note down anything new you hear — your partner sees it too, and you&apos;ll both find it here afterwards.
              </p>
            )}

            {groups.map((g) => (
              <div key={g.key} className="mt-4 first:mt-0">
                <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-ink-soft dark:text-cream/50">
                  {g.label}
                </p>
                <ul className="mt-2 space-y-2">
                  {g.items.map((w) => (
                    <li
                      key={w.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-leaf-300/60 bg-leaf-50/60 px-3.5 py-2.5 dark:border-night-border dark:bg-night-card"
                    >
                      <div className="min-w-0">
                        <p className="break-words font-display text-sm font-semibold text-ink dark:text-cream">{w.word}</p>
                        {w.meaning && (
                          <p className="mt-0.5 break-words font-body text-xs text-ink-soft dark:text-cream/60">{w.meaning}</p>
                        )}
                        {!w.isMine && (
                          <p className="mt-1 flex items-center gap-1 font-body text-[11px] font-medium text-leaf-700">
                            <Users size={11} />
                            from {w.authorName}
                          </p>
                        )}
                      </div>
                      {w.isMine && (
                        <button
                          type="button"
                          onClick={() => handleDelete(w.id)}
                          aria-label={`Delete ${w.word}`}
                          className="mt-0.5 shrink-0 text-ink-soft/40 transition-colors hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            {words && words.length > INITIAL_VISIBLE && (
              <button
                type="button"
                onClick={() => setShowAll((s) => !s)}
                className="mt-4 font-body text-sm font-medium text-leaf-700 underline underline-offset-2"
              >
                {showAll ? "Show fewer" : `Show all ${words.length} words`}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
