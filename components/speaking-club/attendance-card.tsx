"use client";

import { useEffect, useState } from "react";
import { Flame, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";

// "Your attendance" — Speaking Club streak + session counts on the
// /speaking-club dashboard (Feature #6). Read-only view of
// GET /api/speaking-club/attendance; a session counts as attended when the
// student spoke with their partner for 5+ minutes (see
// lib/speaking-club-attendance.ts). These same sessions also feed the
// Activity streak on the main dashboard.

export type AttendanceStats = {
  currentStreak: number;
  longestStreak: number;
  last7Days: number;
  totalSessions: number;
  attendedToday: boolean;
};

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-leaf-300/60 bg-leaf-50/60 px-4 py-3 text-center dark:border-night-border dark:bg-night-card">
      <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 font-body text-[11px] text-ink-soft">{label}</p>
    </div>
  );
}

export function AttendanceCard() {
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/speaking-club/attendance")
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data.attendance) throw new Error();
        setStats(data.attendance);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A failed load just hides the card — attendance is a bonus on this page,
  // not something worth an error banner.
  if (error) return null;

  const message = !stats
    ? ""
    : stats.attendedToday
    ? "Today's session is counted — nice work! 🎉"
    : stats.currentStreak > 0
    ? "Speak with your partner for 5+ minutes today to keep your streak alive."
    : "Speak with your partner for 5+ minutes to start a streak.";

  return (
    <Card className="mt-8 p-8">
      <div className="flex items-center gap-2.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-leaf-300 bg-white">
          <Flame size={19} className="text-leaf-700" />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold">Your attendance</h2>
          <p className="font-body text-xs text-ink-soft">Sessions where you spoke with your partner for 5+ minutes</p>
        </div>
      </div>

      {!stats ? (
        <div className="flex items-center justify-center gap-2 py-6 font-body text-sm text-ink-soft">
          <Loader2 size={16} className="animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={stats.currentStreak} label="day streak" />
            <Stat value={stats.longestStreak} label="best streak" />
            <Stat value={stats.last7Days} label="last 7 days" />
            <Stat value={stats.totalSessions} label="total sessions" />
          </div>
          <p className="mt-4 font-body text-sm text-ink-soft">{message}</p>
        </>
      )}
    </Card>
  );
}
