"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// End-of-session quick rating (Feature #5) — two taps:
//   1. "How was your session?"  1-5 faces
//   2. "Practice with <partner> again?"  Yes / Maybe / No
// The second tap saves everything. Both steps have a Skip, and nothing here
// is required: by the time this card shows, the call has already been left
// (see the room page), so a slow or failed save can never hold anyone in
// the call — worst case the rating is simply lost, which is fine for
// optional feedback. Data goes to POST /api/speaking-club/rating.

type PairAgain = "yes" | "maybe" | "no";

const FACES: { value: number; emoji: string; label: string }[] = [
  { value: 1, emoji: "😞", label: "Poor" },
  { value: 2, emoji: "🙁", label: "Meh" },
  { value: 3, emoji: "😐", label: "Okay" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "🤩", label: "Great" },
];

const PAIR_OPTIONS: { value: PairAgain; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
];

type Props = {
  shiftId: string;
  /** Partner's first name if we know it, for the second question. */
  partnerName?: string | null;
  /** Called when the student is finished (answered, or skipped) — the page navigates away. */
  onDone: () => void;
};

export function SessionRatingCard({ shiftId, partnerName, onDone }: Props) {
  const [rating, setRating] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(wouldPairAgain: PairAgain | null) {
    if (rating === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/speaking-club/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId, rating, wouldPairAgain }),
      });
      if (!res.ok) throw new Error();
      setSaved(true);
    } catch {
      setError("Couldn't save that — tap again, or skip.");
    } finally {
      setSaving(false);
    }
  }

  // Brief "thanks" beat, then hand control back to the page.
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(onDone, 1200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  if (saved) {
    return (
      <p className="mt-5 font-body text-sm font-medium text-leaf-700" role="status">
        Thanks for the feedback! 🙌
      </p>
    );
  }

  const partnerLabel = partnerName ? partnerName : "your partner";

  return (
    <div className="mt-5 border-t border-leaf-300/60 pt-4 dark:border-night-border">
      {rating === null ? (
        <>
          <p className="font-display text-sm font-semibold text-ink dark:text-cream">How was your session?</p>
          <div className="mt-3 flex justify-center gap-1.5">
            {FACES.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setRating(f.value)}
                aria-label={`${f.value} out of 5 — ${f.label}`}
                className="hover-lift flex w-12 flex-col items-center gap-0.5 rounded-xl border-2 border-transparent px-1 py-1.5 transition-colors hover:border-leaf-600 hover:bg-leaf-50 dark:hover:bg-night-soft"
              >
                <span className="text-2xl leading-none">{f.emoji}</span>
                <span className="font-body text-[10px] text-ink-soft dark:text-cream/60">{f.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-3 font-body text-xs text-ink-soft underline underline-offset-2 dark:text-cream/60"
          >
            Skip
          </button>
        </>
      ) : (
        <>
          <p className="font-display text-sm font-semibold text-ink dark:text-cream">
            Practice with {partnerLabel} again?
          </p>
          <div className="mt-3 flex justify-center gap-2">
            {PAIR_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                disabled={saving}
                onClick={() => submit(o.value)}
                className={cn(
                  "hover-lift min-w-[76px] rounded-pill border-2 border-leaf-300 bg-white px-4 py-2 font-body text-sm font-semibold text-ink",
                  "transition-colors hover:border-leaf-600 hover:bg-leaf-50 disabled:opacity-60",
                  "dark:border-night-border dark:bg-night-soft dark:text-cream"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          {saving && (
            <p className="mt-2 flex items-center justify-center gap-1.5 font-body text-xs text-ink-soft dark:text-cream/60">
              <Loader2 size={12} className="animate-spin" /> Saving…
            </p>
          )}
          {error && (
            <p className="mt-2 font-body text-xs text-red-600">
              {error}{" "}
              <button type="button" onClick={onDone} className="underline underline-offset-2">
                Leave without saving
              </button>
            </p>
          )}
          <button
            type="button"
            disabled={saving}
            onClick={() => submit(null)} // saves just the 1-5 rating
            className="mt-3 font-body text-xs text-ink-soft underline underline-offset-2 disabled:opacity-60 dark:text-cream/60"
          >
            Skip this question
          </button>
        </>
      )}
    </div>
  );
}
