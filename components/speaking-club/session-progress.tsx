"use client";

import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

// Session progress bar for the Speaking Club room (Feature #3).
//
// Purely presentational: the room page owns the shift window and the 1s
// clock tick, and passes both in. Everything here is derived from
// (startMs, endMs, now), so a throttled/backgrounded tab always shows the
// right time the moment it wakes up — nothing is counted "per tick".

type Props = {
  /** Absolute epoch ms of the shift's start_time. */
  startMs: number;
  /** Absolute epoch ms of the shift's end_time. */
  endMs: number;
  /** Current epoch ms (ticked by the parent, once per second). */
  now: number;
  /** Optional human labels under the bar, e.g. "7:00 PM" / "8:00 PM". */
  startLabel?: string;
  endLabel?: string;
};

/** 3725000 -> "1:02:05", 605000 -> "10:05", 42000 -> "0:42". */
export function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** "19:30:00" -> "7:30 PM". Returns undefined for anything unparseable. */
export function formatClockLabel(hhmmss?: string | null): string | undefined {
  if (!hhmmss) return undefined;
  const [h, m] = hhmmss.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return undefined;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function SessionProgress({ startMs, endMs, now, startLabel, endLabel }: Props) {
  const totalMs = endMs - startMs;
  if (totalMs <= 0) return null;

  const remainingMs = Math.max(0, endMs - now);
  const elapsedMs = Math.min(totalMs, Math.max(0, now - startMs));
  const percent = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  const elapsedMinutes = Math.floor(elapsedMs / 60000);
  const totalMinutes = Math.round(totalMs / 60000);

  // Calm green for most of the session, amber for the last 5 minutes (same
  // moment the "ending soon" banner shows), red for the final minute.
  const tone: "normal" | "soon" | "final" =
    remainingMs <= 60_000 ? "final" : remainingMs <= 5 * 60_000 ? "soon" : "normal";

  return (
    <div
      className="mt-5 rounded-2xl border border-leaf-300 bg-white px-5 py-3.5 dark:border-night-border dark:bg-night-soft"
      role="progressbar"
      aria-label="Session time"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={`${formatRemaining(remainingMs)} remaining`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-body text-[11px] font-semibold uppercase tracking-wide text-ink-soft dark:text-cream/60">
          <Clock3 size={13} />
          Session time
        </span>
        <span
          className={cn(
            "font-display text-lg font-semibold tabular-nums transition-colors",
            tone === "normal" && "text-ink dark:text-cream",
            tone === "soon" && "text-amber-600",
            tone === "final" && "text-red-600"
          )}
        >
          {formatRemaining(remainingMs)}
          <span className="ml-1 font-body text-xs font-medium text-ink-soft dark:text-cream/60">left</span>
        </span>
      </div>

      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-pill bg-leaf-100 dark:bg-night-border">
        <div
          className={cn(
            "h-full rounded-pill transition-[width,background-color] duration-1000 ease-linear",
            tone === "normal" && "bg-leaf-600",
            tone === "soon" && "bg-amber-500",
            tone === "final" && "bg-red-500"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between font-body text-[11px] text-ink-soft dark:text-cream/50">
        <span>{startLabel ?? "Start"}</span>
        <span>
          {elapsedMinutes} of {totalMinutes} min
        </span>
        <span>{endLabel ?? "End"}</span>
      </div>
    </div>
  );
}
