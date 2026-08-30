"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Mic,
  Clock,
  KeyRound,
  Users,
  ArrowRight,
  Megaphone,
  CalendarClock,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { AuthModal } from "@/components/auth-modal";
import { cn } from "@/lib/utils";

type AuthStage = "checking" | "needsLogin" | "ready";

// ---------------------------------------------------------------------------
// PHASE 3 — this dashboard is now wired to real data:
//   - GET /api/speaking-club/my-status: today's assigned shifts + whether
//     one is active right now (plan §3.4's time-window rule, server-side).
//   - POST /api/speaking-club/join: validates the typed passkey against
//     that same time-window rule and this student's own assignment.
// Phase 0's three visual states (waiting / passkey / room-ready) are
// unchanged in appearance — they're now driven by real status instead of
// the old "Preview state" QA switcher, which is gone.
// ---------------------------------------------------------------------------

type ShiftSummary = {
  shiftId: string;
  shiftNumber: 1 | 2 | 3;
  roomCode: string;
  startTime: string; // "HH:MM:SS"
  endTime: string;
  state: "done" | "now" | "upcoming";
  partnerName: string | null;
  isThirdPerson: boolean;
};

type MyStatus = { shifts: ShiftSummary[]; activeShift: ShiftSummary | null };
type JoinedRoom = {
  shiftId: string;
  roomCode: string;
  shiftNumber: number;
  endTime: string;
  partnerName: string | null;
};

function formatTime12h(hhmmss: string): string {
  const [h, m] = hhmmss.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

// Live countdown to a "HH:MM:SS" end time on today's date. Was flagged as
// a known gap in PHASE3-TESTING.md ("no live countdown timer") — students
// only saw a static "ends at X" label with no sense of time remaining.
// Ticks every second; recomputes the target Date each render off wall-clock
// HH:MM:SS, same assumption formatTime12h already makes (student's local
// browser time, not a timezone conversion — consistent with the rest of
// this page).
function useCountdown(endTimeHHMMSS: string | null): {
  label: string;
  isEndingSoon: boolean;
  isOver: boolean;
} {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!endTimeHHMMSS) return;
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, [endTimeHHMMSS]);

  if (!endTimeHHMMSS) return { label: "", isEndingSoon: false, isOver: false };

  const [h, m, s] = endTimeHHMMSS.split(":").map(Number);
  const target = new Date(now);
  target.setHours(h, m, s || 0, 0);

  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return { label: "Time's up", isEndingSoon: true, isOver: true };

  const totalSeconds = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const label = `${mins}:${String(secs).padStart(2, "0")}`;

  return { label, isEndingSoon: totalSeconds <= 120, isOver: false };
}

export default function SpeakingClubDashboard() {
  const [authStage, setAuthStage] = useState<AuthStage>("checking");
  const [status, setStatus] = useState<MyStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [passkey, setPasskey] = useState("");
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [joinedRoom, setJoinedRoom] = useState<JoinedRoom | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setAuthStage(data.user ? "ready" : "needsLogin");
      })
      .catch(() => {
        if (!cancelled) setAuthStage("needsLogin");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authStage !== "ready") return;
    let cancelled = false;
    setLoadingStatus(true);
    fetch("/api/speaking-club/my-status")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        setStatusError(null);
      })
      .catch(() => {
        if (!cancelled) setStatusError("There was a problem loading your shift details — please refresh the page.");
      })
      .finally(() => {
        if (!cancelled) setLoadingStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authStage]);

  async function handlePasskeySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!passkey.trim()) {
      setPasskeyError("Enter your shift's passkey — it was sent to your email.");
      return;
    }
    setPasskeyError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/speaking-club/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passkey: passkey.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasskeyError(data.error ?? "Something went wrong — please try again.");
        return;
      }
      setJoinedRoom({
        shiftId: data.shiftId,
        roomCode: data.roomCode,
        shiftNumber: data.shiftNumber,
        endTime: data.endTime,
        partnerName: status?.activeShift?.partnerName ?? null,
      });
    } catch {
      setPasskeyError("There was a network problem — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authStage === "checking") {
    return (
      <div className="min-h-screen" style={{ background: "#F8FAFC" }}>
        <Navbar />
        <div className="flex h-[60vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink/15 border-t-leaf-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F8FAFC" }}>
      <Navbar />

      {authStage === "needsLogin" && (
        <AuthModal
          open
          title="Sign in to access Speaking Club"
          subtitle="You need to log in first to see your assigned room and shift."
          onSuccess={() => setAuthStage("ready")}
        />
      )}

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Speaking Club
          </h1>
          <p className="mt-1 font-body text-sm text-ink-soft">
            Your room, shift, and partner for today — all right here.
          </p>
        </div>

        {/* Announcement banner — §4.6 general fallback: encourage advance conflict reporting */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="hover-lift mb-8 flex items-start gap-3 rounded-2xl border border-leaf-300 bg-leaf-50 px-5 py-4 shadow-[0_1px_0_0_rgba(21,23,15,0.04)] hover:border-leaf-600"
        >
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-leaf-300 bg-white shadow-sm">
            <Megaphone size={16} className="text-leaf-700" />
          </span>
          <p className="font-body text-sm text-ink-soft">
            <span className="font-semibold text-ink">Can&apos;t make your assigned shift?</span>{" "}
            Let us know in advance, and we can move you to a different shift/room ahead of time.{" "}
            <Link href="/contact" className="font-medium text-leaf-700 underline underline-offset-2">
              Let us know here
            </Link>
          </p>
        </motion.div>

        {authStage === "ready" && loadingStatus && (
          <Card>
            <div className="flex items-center justify-center gap-2 py-6 font-body text-sm text-ink-soft">
              <Loader2 size={16} className="animate-spin" />
              Loading today&apos;s shift…
            </div>
          </Card>
        )}

        {authStage === "ready" && statusError && (
          <Card>
            <p className="py-4 text-center font-body text-sm text-red-600">{statusError}</p>
          </Card>
        )}

        {authStage === "ready" && status && !loadingStatus && !statusError && (
          <>
            {joinedRoom ? (
              <RoomReadyState room={joinedRoom} />
            ) : status.activeShift ? (
              <PasskeyState
                shift={status.activeShift}
                allShifts={status.shifts}
                passkey={passkey}
                setPasskey={setPasskey}
                error={passkeyError}
                submitting={submitting}
                onSubmit={handlePasskeySubmit}
              />
            ) : (
              <WaitingState shifts={status.shifts} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function ShiftRow({ shifts, activeShiftId }: { shifts: ShiftSummary[]; activeShiftId?: string }) {
  if (shifts.length === 0) {
    return (
      <p className="mt-4 font-body text-sm text-ink-soft">
        No shift has been assigned to you today yet — the admin will place you in a room/shift soon.
      </p>
    );
  }
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-3">
      {shifts.map((s, i) => (
        <motion.div
          key={s.shiftId}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: i * 0.06 }}
          className={cn(
            "hover-lift w-full max-w-[220px] rounded-2xl border p-4 text-left shadow-[0_1px_0_0_rgba(21,23,15,0.04)]",
            s.shiftId === activeShiftId || s.state === "now"
              ? "border-leaf-600 bg-leaf-50 hover:border-leaf-700"
              : "border-ink/10 bg-cream-soft hover:border-leaf-300"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="font-display text-sm font-semibold">Shift {s.shiftNumber}</span>
            {s.state === "done" && (
              <span className="flex items-center gap-1 font-body text-xs font-medium text-ink-soft">
                <CheckCircle2 size={13} /> Done
              </span>
            )}
            {s.state === "now" && (
              <span className="rounded-pill bg-leaf-600 px-2 py-0.5 font-body text-[11px] font-semibold text-cream">
                Ongoing
              </span>
            )}
            {s.state === "upcoming" && (
              <span className="font-body text-xs text-ink-soft">Upcoming</span>
            )}
          </div>
          <p className="mt-1.5 font-body text-xs text-ink-soft">
            {formatTime12h(s.startTime)} – {formatTime12h(s.endTime)}
          </p>
        </motion.div>
      ))}
    </div>
  );
}

function WaitingState({ shifts }: { shifts: ShiftSummary[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
    >
      <Card className="hover-lift border-leaf-300 bg-white p-8 hover:border-leaf-600">
        <div className="flex flex-col items-center py-2 text-center">
          <span className="hover-lift flex h-14 w-14 items-center justify-center rounded-full border border-leaf-300 bg-white shadow-sm">
            <CalendarClock size={26} className="text-leaf-700" />
          </span>
          <h2 className="mt-4 font-display text-lg font-semibold">You don&apos;t have a shift running right now</h2>
          <p className="mt-1.5 max-w-sm font-body text-sm text-ink-soft">
            See today&apos;s shifts below. Your passkey will be sent to your email before the shift starts.
          </p>
          <ShiftRow shifts={shifts} />
        </div>
      </Card>
    </motion.div>
  );
}

function PasskeyState({
  shift,
  allShifts,
  passkey,
  setPasskey,
  error,
  submitting,
  onSubmit,
}: {
  shift: ShiftSummary;
  allShifts: ShiftSummary[];
  passkey: string;
  setPasskey: (v: string) => void;
  error: string | null;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const countdown = useCountdown(shift.endTime);
  return (
    <div className="grid items-stretch gap-6 sm:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-8">
        <div className="flex items-center gap-2.5 text-leaf-700">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-leaf-300 bg-white">
            <KeyRound size={19} />
          </span>
          <span className="rounded-pill bg-leaf-600 px-2.5 py-0.5 font-body text-[11px] font-semibold text-cream">
            Shift {shift.shiftNumber} · ongoing now
          </span>
          {!countdown.isOver && (
            <span
              className={cn(
                "ml-auto font-body text-xs font-medium",
                countdown.isEndingSoon ? "text-red-600" : "text-ink-soft"
              )}
            >
              {countdown.label} left
            </span>
          )}
        </div>
        <h2 className="mt-5 font-display text-lg font-semibold">Enter your passkey</h2>
        <p className="mt-1 font-body text-sm text-ink-soft">
          The passkey for Shift {shift.shiftNumber} ({formatTime12h(shift.startTime)} – {formatTime12h(shift.endTime)})
          has been sent to your email — enter it here.
        </p>

        <form onSubmit={onSubmit} className="mt-6">
          <input
            value={passkey}
            onChange={(e) => setPasskey(e.target.value)}
            placeholder="LC-R07-S2-K9M4"
            disabled={submitting}
            className="w-full rounded-xl border border-ink/15 bg-cream-soft px-4 py-3 font-mono text-sm tracking-wide text-ink placeholder:text-ink-soft/50 focus-ring disabled:opacity-60"
          />
          {error && <p className="mt-2 font-body text-sm text-red-600">{error}</p>}
          <Button type="submit" variant="accent" className="mt-4 w-full gap-2" disabled={submitting}>
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            Enter Room
          </Button>
        </form>
      </Card>

      <Card className="flex h-full flex-col justify-center bg-cream-soft p-8">
        <div className="flex items-center gap-2.5 text-leaf-700">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-leaf-300 bg-white">
            <CalendarClock size={19} />
          </span>
          <h3 className="font-display text-sm font-semibold text-ink">Shift Schedule</h3>
        </div>
        <ShiftRow shifts={allShifts} activeShiftId={shift.shiftId} />
      </Card>
    </div>
  );
}

function RoomReadyState({ room }: { room: JoinedRoom }) {
  const countdown = useCountdown(room.endTime);

  return (
    <div className="grid items-stretch gap-6 sm:grid-cols-[1.1fr_0.9fr]">
      <Card className="p-8 hover:border-leaf-300">
        <div className="flex items-center justify-between">
          <span className="rounded-pill bg-ink px-3 py-1 font-display text-xs font-semibold uppercase text-cream">
            {room.roomCode}
          </span>
          <span
            className={cn(
              "flex items-center gap-1.5 font-body text-xs font-medium",
              countdown.isEndingSoon ? "text-red-600" : "text-ink-soft"
            )}
          >
            <Clock size={13} />
            {countdown.isOver ? "Shift has ended" : `${countdown.label} left`}
          </span>
        </div>

        <div className="mt-6 flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-leaf-300 bg-white font-display text-xl font-bold text-leaf-700">
            {(room.partnerName?.trim()[0] || "?").toUpperCase()}
          </span>
          <div>
            <p className="font-display text-base font-semibold">
              {room.partnerName ?? "Partner joining soon"}
            </p>
            <p className="font-body text-xs text-ink-soft">Your speaking partner for today</p>
          </div>
        </div>

        <Link
          href={`/speaking-club/room/${room.roomCode}?shiftId=${encodeURIComponent(room.shiftId)}`}
          className={cn(buttonVariants({ variant: "accent" }), "mt-7 w-full gap-2")}
        >
          <Mic size={16} />
          Join the Call
        </Link>
      </Card>

      <Card className="flex h-full flex-col justify-center bg-cream-soft p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-leaf-300 bg-white">
            <Users size={16} className="text-leaf-700" />
          </span>
          <h3 className="font-display text-sm font-semibold">Your Shift</h3>
        </div>
        <p className="mt-3 font-body text-sm text-ink-soft">Shift {room.shiftNumber} — passkey validated ✅</p>
      </Card>
    </div>
  );
}
