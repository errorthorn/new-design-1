"use client";

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import type { AttendanceStats } from "@/components/speaking-club/attendance-card";

// "Session counted" confirmation on the room's wrap-up card (Feature #6).
// Attendance is recorded by the call-end report the room already sends
// (sendBeacon, so nothing here can wait on it) — so this just asks the
// server a moment later whether today's session has been counted, once
// more a few seconds after that in case the report landed late, and shows
// a line only if it has. Silent otherwise (e.g. the call was under 5
// minutes): no "you didn't qualify" message at the moment someone leaves.

const CHECK_DELAYS_MS = [1500, 5000];

export function SessionCountedNote() {
  const [stats, setStats] = useState<AttendanceStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timers = CHECK_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        fetch("/api/speaking-club/attendance")
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (!cancelled && data?.attendance?.attendedToday) setStats(data.attendance);
          })
          .catch(() => {});
      }, delay)
    );
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, []);

  if (!stats) return null;

  return (
    <p
      className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-leaf-50 px-3 py-2 font-body text-sm font-medium text-leaf-700 dark:bg-night-soft"
      role="status"
    >
      <Flame size={15} />
      Session counted!
      {stats.currentStreak > 1 ? ` ${stats.currentStreak}-day streak 🔥` : ""}
    </p>
  );
}
