"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NotebookPen, X, Plus, Loader2, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { joinWordsChannel, type WordsChannel } from "@/lib/speaking-club/words-channel";

// In-call shared "New words I learned" notes (Feature #4).
//
// Renders its own trigger — a small fixed icon button in the top-right
// corner of the screen, out of the way of the mic/leave controls at the
// bottom — plus a bottom-sheet / corner panel, so the room page doesn't
// place it inline among the other call-control buttons at all; just drop
// <LearnedWordsNotes /> anywhere in the tree and it positions itself. The
// list is SHARED with the partner: both people see every word noted in
// this session, each tagged with who wrote it, and each keeps a copy
// afterwards on the /speaking-club dashboard. Only the author can delete
// their own word.
//
// Everything here is independent of the WebRTC call — plain fetch() calls
// to /api/speaking-club/words plus a tiny "list changed" broadcast ping
// (lib/speaking-club/words-channel.ts) so the partner's screen refreshes
// right away — so nothing in this file can touch call audio or signaling.

export type SavedWord = {
  id: string;
  word: string;
  meaning: string | null;
  shiftId: string | null;
  roomCode: string | null;
  shiftNumber: number | null;
  /** Asia/Dhaka calendar day of the session, "YYYY-MM-DD". */
  sessionDate: string;
  createdAt: string;
  /** "You" for your own words, otherwise the partner's display name. */
  authorName: string;
  isMine: boolean;
};

type Props = {
  /** The shift this call belongs to — words are filed under it. Undefined on the dev ?as= path. */
  shiftId?: string;
  /** The room's code — used for the live "list changed" ping, and as the session scope on the dev path. */
  roomCode: string;
  /** Called whenever the number of words YOU saved this session changes (used by the "session ended" message). */
  onCountChange?: (count: number) => void;
};

// Safety net only — the broadcast ping does the real-time work; this just
// heals a missed ping (e.g. a brief network blip) without a manual refresh.
const FALLBACK_POLL_MS = 30_000;

export function LearnedWordsNotes({ shiftId, roomCode, onCountChange }: Props) {
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState<SavedWord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [word, setWord] = useState("");
  const [meaning, setMeaning] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);

  const channelRef = useRef<WordsChannel | null>(null);
  // Ids of partner words the student has already had a chance to see, so
  // the button can show a "new" dot when the partner adds one while the
  // panel is closed. Filled silently on the first load (words from earlier
  // in the call / before a refresh shouldn't count as new).
  const seenPartnerIds = useRef<Set<string>>(new Set());
  const firstLoadDone = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const qs = shiftId ? `shiftId=${encodeURIComponent(shiftId)}` : `roomCode=${encodeURIComponent(roomCode)}`;
      const res = await fetch(`/api/speaking-club/words?${qs}`);
      const data = await res.json();
      if (!res.ok || !Array.isArray(data.words)) return;
      const list: SavedWord[] = data.words;
      if (!firstLoadDone.current) {
        for (const w of list) if (!w.isMine) seenPartnerIds.current.add(w.id);
        firstLoadDone.current = true;
      }
      setWords(list);
    } catch {
      // Keep whatever we already have; the next ping/poll will retry.
    } finally {
      setLoaded(true);
    }
  }, [shiftId, roomCode]);

  // Initial load, the live "partner changed the list" ping, and the slow
  // fallback poll (skipped while the tab is hidden).
  useEffect(() => {
    refresh();
    const channel = joinWordsChannel(roomCode);
    channelRef.current = channel;
    const off = channel.onChanged(() => refresh());
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, FALLBACK_POLL_MS);
    return () => {
      clearInterval(poll);
      off();
      channelRef.current = null;
      channel.leave().catch(() => {});
    };
  }, [refresh, roomCode]);

  const myCount = words.filter((w) => w.isMine).length;
  useEffect(() => {
    if (loaded) onCountChange?.(myCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myCount, loaded]);

  // Opening the panel = the partner's words have been seen.
  useEffect(() => {
    if (open) for (const w of words) if (!w.isMine) seenPartnerIds.current.add(w.id);
  }, [open, words]);
  const hasUnseen = !open && words.some((w) => !w.isMine && !seenPartnerIds.current.has(w.id));

  useEffect(() => {
    if (open) wordInputRef.current?.focus();
  }, [open]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = word.trim();
    if (!trimmed) {
      setMessage({ kind: "error", text: "Type the word or phrase you heard first." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/speaking-club/words", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: trimmed, meaning: meaning.trim() || undefined, shiftId, roomCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save that word.");
      if (data.duplicate) {
        setMessage({ kind: "info", text: "You already saved that one." });
      } else {
        setWords((cur) => [data.word as SavedWord, ...cur]);
        channelRef.current?.sendChanged().catch(() => {});
      }
      setWord("");
      setMeaning("");
      wordInputRef.current?.focus();
    } catch (err: any) {
      setMessage({ kind: "error", text: err?.message ?? "Could not save that word." });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    const previous = words;
    setWords((cur) => cur.filter((w) => w.id !== id));
    try {
      const res = await fetch(`/api/speaking-club/words/${encodeURIComponent(id)}`, { method: "DELETE" });
      // 404 = already gone, which is the state we wanted anyway.
      if (!res.ok && res.status !== 404) throw new Error();
      channelRef.current?.sendChanged().catch(() => {});
    } catch {
      setWords(previous);
      setMessage({ kind: "error", text: "Could not delete that word — please try again." });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="New words you learned"
        title="New words you learned"
        className="hover-lift fixed right-4 top-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border-2 border-leaf-300 bg-white text-ink shadow-lg transition-colors hover:border-leaf-600 hover:bg-leaf-50 dark:border-night-border dark:bg-night-card dark:text-cream"
      >
        <NotebookPen size={20} />
        {words.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-leaf-600 px-1 font-body text-[11px] font-semibold leading-none text-cream">
            {words.length}
          </span>
        )}
        {hasUnseen && (
          <span className="absolute -left-1 -top-1 flex h-3 w-3" aria-label="Your partner added a new word">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="New words you learned"
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 flex max-h-[75vh] flex-col rounded-t-2xl border border-leaf-300 bg-white p-5 shadow-2xl",
            "sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-96 sm:rounded-2xl",
            "dark:border-night-border dark:bg-night-soft"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-ink dark:text-cream">New words &amp; phrases</h3>
              <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/60">
                Heard something new? Note it down. Your partner sees this list too, and you both keep a copy on the Speaking Club page after the call.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close notes"
              className="shrink-0 text-ink-soft/60 hover:text-ink-soft"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleAdd} className="mt-4 space-y-2">
            <input
              ref={wordInputRef}
              value={word}
              onChange={(e) => setWord(e.target.value)}
              maxLength={120}
              placeholder="Word or phrase (e.g. off the top of my head)"
              disabled={saving}
              className="w-full rounded-xl border border-ink/15 bg-cream-soft px-3.5 py-2.5 font-body text-base text-ink placeholder:text-ink-soft/50 focus-ring disabled:opacity-60 sm:text-sm dark:border-night-border dark:bg-night-card dark:text-cream"
            />
            <div className="flex gap-2">
              <input
                value={meaning}
                onChange={(e) => setMeaning(e.target.value)}
                maxLength={300}
                placeholder="Meaning / example (optional)"
                disabled={saving}
                className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-cream-soft px-3.5 py-2.5 font-body text-base text-ink placeholder:text-ink-soft/50 focus-ring disabled:opacity-60 sm:text-sm dark:border-night-border dark:bg-night-card dark:text-cream"
              />
              <button
                type="submit"
                disabled={saving}
                aria-label="Save word"
                className="flex shrink-0 items-center gap-1.5 rounded-xl bg-leaf-600 px-4 py-2.5 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700 disabled:opacity-60"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Add
              </button>
            </div>
            {message && (
              <p
                className={cn(
                  "font-body text-xs",
                  message.kind === "error" ? "text-red-600" : "text-ink-soft dark:text-cream/60"
                )}
              >
                {message.text}
              </p>
            )}
          </form>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
            {words.length === 0 ? (
              <p className="py-3 text-center font-body text-xs text-ink-soft dark:text-cream/50">
                {loaded ? "Nothing noted yet — the first new word you or your partner save will show up here." : "Loading…"}
              </p>
            ) : (
              <ul className="space-y-2">
                {words.map((w) => (
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
            )}
          </div>
        </div>
      )}
    </>
  );
}
