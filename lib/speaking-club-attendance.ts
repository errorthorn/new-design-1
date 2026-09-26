// lib/speaking-club-attendance.ts
//
// Server-only. "Did this student actually attend a Speaking Club session?"
// — the definition behind the Speaking Club stats and the Activity streak's
// Speaking Club days (see the speaking_attendance table in sql/schema.sql).
//
// A session counts as ATTENDED when the student was on a call for at least
// MIN_ATTEND_SECONDS (summed across rejoins) with a partner who was really
// there. That's deliberately stricter than "a call report exists": joining
// an empty room, or dropping out after a few seconds, must not keep a
// streak alive — the whole point of the streak is to build the habit of
// actually speaking with someone.
import { supabaseServer } from "@/lib/supabase";
import { dhakaToday } from "@/lib/speaking-club-words";
import { listAllShifts } from "@/lib/speaking-club-db";
import type { SpeakingShiftLookup } from "@/lib/speaking-club-db";

export const MIN_ATTEND_SECONDS = 5 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-09-22" -> the previous/next calendar day, still "YYYY-MM-DD". Pure date math (UTC), no timezone drift. */
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Second server-side check that the partner really was in the room today,
 * from THEIR presence heartbeat (speaking_room_presence, written by their
 * own browser every ~45s) — so a student can't earn credit just by opening
 * a call alone and having their own browser claim a peer connected.
 * Fails OPEN on a lookup error: an outage should cost nothing worse than
 * trusting the client's own report, never a student's streak.
 */
async function partnerSeenToday(shift: SpeakingShiftLookup, username: string): Promise<boolean> {
  const others = [shift.username1, shift.username2, shift.temp_username].filter(
    (e): e is string => !!e && e !== username
  );
  if (others.length === 0) return false;

  const startOfDhakaDay = new Date(`${dhakaToday()}T00:00:00+06:00`).toISOString();
  const { data, error } = await supabaseServer
    .from("speaking_room_presence")
    .select("username")
    .eq("shift_id", shift.shift_id)
    .in("username", others)
    .gte("last_seen_at", startOfDhakaDay)
    .limit(1);
  if (error) {
    console.error("[speaking-club/attendance] presence lookup failed, trusting client report", error);
    return true;
  }
  return (data ?? []).length > 0;
}

export type RecordAttendanceResult = { qualified: boolean; justQualified: boolean };

/**
 * Adds one call report to today's session for this student. Reports for the
 * same session accumulate (rejoining after a drop adds to the total), and a
 * session that has qualified never un-qualifies.
 */
export async function recordAttendance(params: {
  username: string;
  shift: SpeakingShiftLookup;
  callSeconds: number;
  peerCount: number;
}): Promise<RecordAttendanceResult> {
  const sessionDate = dhakaToday();

  const { data: existing, error: readError } = await supabaseServer
    .from("speaking_attendance")
    .select("call_seconds, partner_confirmed, qualified, peer_count")
    .eq("username", params.username)
    .eq("session_date", sessionDate)
    .eq("shift_id", params.shift.shift_id)
    .maybeSingle();
  if (readError) throw readError;

  const partnerConfirmed =
    Boolean(existing?.partner_confirmed) || (params.peerCount >= 2 && (await partnerSeenToday(params.shift, params.username)));
  const callSeconds = Math.max(0, Math.round(params.callSeconds)) + Number(existing?.call_seconds ?? 0);
  const qualified = Boolean(existing?.qualified) || (partnerConfirmed && callSeconds >= MIN_ATTEND_SECONDS);

  const { error } = await supabaseServer.from("speaking_attendance").upsert(
    {
      username: params.username,
      shift_id: params.shift.shift_id,
      room_code: params.shift.room_code ?? null,
      shift_number: params.shift.shift_number ?? null,
      session_date: sessionDate,
      call_seconds: callSeconds,
      peer_count: Math.max(params.peerCount, Number(existing?.peer_count ?? 0)),
      partner_confirmed: partnerConfirmed,
      qualified,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "username,session_date,shift_id" }
  );
  if (error) throw error;

  return { qualified, justQualified: qualified && !existing?.qualified };
}

export type AttendanceStats = {
  /** Consecutive days (ending today, or yesterday if today isn't done yet) with an attended session. */
  currentStreak: number;
  longestStreak: number;
  /** Attended sessions in the last 7 days, today included. */
  last7Days: number;
  totalSessions: number;
  attendedToday: boolean;
};

/** Distinct Asia/Dhaka session dates on which this student attended (newest first). */
async function attendedDates(username: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("speaking_attendance")
    .select("session_date")
    .eq("username", username)
    .eq("qualified", true)
    .order("session_date", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return Array.from(new Set((data ?? []).map((r) => r.session_date as string)));
}

export function computeStats(datesNewestFirst: string[], today: string): AttendanceStats {
  const set = new Set(datesNewestFirst);
  const attendedToday = set.has(today);

  // Like the Activity streak: it survives through today until a whole day
  // passes with nothing — so "not yet today" doesn't zero a live streak.
  let currentStreak = 0;
  let cursor = attendedToday ? today : shiftDate(today, -1);
  while (set.has(cursor)) {
    currentStreak++;
    cursor = shiftDate(cursor, -1);
  }

  let longestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const d of [...set].sort()) {
    run = previous && shiftDate(previous, 1) === d ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = d;
  }

  const weekStart = shiftDate(today, -6);
  return {
    currentStreak,
    longestStreak,
    last7Days: datesNewestFirst.filter((d) => d >= weekStart && d <= today).length,
    totalSessions: set.size,
    attendedToday,
  };
}

export async function getAttendanceStats(username: string): Promise<AttendanceStats> {
  return computeStats(await attendedDates(username), dhakaToday());
}

/**
 * UTC calendar days of this student's attended sessions — the day-key
 * format /api/performance's Activity streak already uses for every other
 * activity, so Speaking Club days slot into that one streak unchanged.
 */
export async function getAttendedUtcDayKeys(username: string): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from("speaking_attendance")
    .select("created_at")
    .eq("username", username)
    .eq("qualified", true)
    .limit(2000);
  if (error) throw error;
  return (data ?? []).map((r) => (r.created_at as string).slice(0, 10));
}

// ---------------------------------------------------------------------------
// Admin roster gap-fix: the admin assigns each room+shift's duo by hand
// (speaking_shifts.username1/username2), but had no way to see who among
// those manually-assigned students has actually stopped showing up — only
// each STUDENT's own streak (getAttendanceStats above). Admin-only (never
// shown to students) — deliberately simple: per student, per day, how many
// minutes did they actually talk, and how many days in the window did they
// talk at all.
//
// CROSS-SLOT MERGE: a student can talk briefly in their original slot, then
// (e.g. a partner drop, room issue — speaking_reassignments) get moved to a
// DIFFERENT slot and talk more there, same day. Each slot writes its own
// speaking_attendance row (unique key is username+session_date+shift_id),
// so that day can be 2+ rows under 2+ different shift_ids. This reads by
// USERNAME ONLY (not shift_id) and sums every row for the same day across
// however many slots the student passed through — so a 3-minute stint in
// slot A plus a 4-minute stint in slot B same day correctly reads as ~7
// minutes that day, not two separate under-the-floor fragments. Whether a
// day counts as "attended" is decided AFTER that per-day sum, against
// MIN_ATTEND_SECONDS — not by each individual row's own `qualified` flag
// (which was computed per-row, before any reassignment-driven merging).
// ---------------------------------------------------------------------------

export type AttendanceRosterEntry = {
  username: string;
  /** The student's CURRENT room/shift assignment — just for display/context; attendance itself is summed across whatever slot(s) they were actually in each day (see file header). */
  roomCode: string;
  shiftNumber: 1 | 2 | 3;
  shiftId: string;
  /** Days in the window with >= MIN_ATTEND_SECONDS talked (summed across any slot that day). */
  attendedInWindow: number;
  lastAttendedDate: string | null;
  /** Total minutes talked across the whole window, summed across every slot on every day — the number admin actually asked for. */
  totalMinutesInWindow: number;
  /** One entry per calendar day in the window, oldest first — minutes talked that day (0 if none), already merged across slots. */
  dailyBreakdown: { date: string; minutes: number }[];
};

export type AttendanceRosterResult = {
  windowDays: number;
  today: string;
  /** Every currently-assigned student (both seats of every active room+shift), for context. */
  roster: AttendanceRosterEntry[];
  /** The subset with ZERO attended days in the window — the "hasn't been showing up" list. */
  flagged: AttendanceRosterEntry[];
};

/**
 * Cross-references the admin's manual room+shift assignments
 * (speaking_shifts.username1/username2, active rooms only) against
 * speaking_attendance to surface who's assigned but not actually
 * attending, and how long the ones who DO show up actually talk — summed
 * per day across any slot they were in that day (see file header). Read-
 * only — takes no action itself, just the numbers an admin needs before
 * deciding who to follow up with or reassign.
 */
export async function getAttendanceRoster(windowDays = 7): Promise<AttendanceRosterResult> {
  const shifts = await listAllShifts();
  const today = dhakaToday();
  const cutoff = shiftDate(today, -(windowDays - 1));

  type Seat = { username: string; roomCode: string; shiftNumber: 1 | 2 | 3; shiftId: string };
  const seats: Seat[] = [];
  for (const s of shifts) {
    if (s.room_status !== "active") continue;
    for (const username of [s.username1, s.username2]) {
      if (username) seats.push({ username, roomCode: s.room_code, shiftNumber: s.shift_number, shiftId: s.shift_id });
    }
  }
  if (seats.length === 0) {
    return { windowDays, today, roster: [], flagged: [] };
  }

  const usernames = Array.from(new Set(seats.map((s) => s.username)));

  // No shift_id or qualified filter here on purpose — see the CROSS-SLOT
  // MERGE note above. Every row for these students in the window, from
  // whichever slot(s) they were actually in.
  const { data: attendanceRows, error } = await supabaseServer
    .from("speaking_attendance")
    .select("username, session_date, call_seconds")
    .in("username", usernames)
    .gte("session_date", cutoff);
  if (error) throw error;

  // username -> session_date -> seconds, SUMMED across every shift_id row
  // for that same day (the actual merge).
  const secondsByUsernameDate = new Map<string, Map<string, number>>();
  for (const row of (attendanceRows ?? []) as { username: string; session_date: string; call_seconds: number }[]) {
    const byDate = secondsByUsernameDate.get(row.username) ?? new Map<string, number>();
    byDate.set(row.session_date, (byDate.get(row.session_date) ?? 0) + row.call_seconds);
    secondsByUsernameDate.set(row.username, byDate);
  }

  const roster: AttendanceRosterEntry[] = seats.map((seat) => {
    const byDate = secondsByUsernameDate.get(seat.username) ?? new Map<string, number>();

    let lastAttendedDate: string | null = null;
    let attendedInWindow = 0;
    let totalSeconds = 0;
    const dailyBreakdown: { date: string; minutes: number }[] = [];
    for (let d = cutoff; d <= today; d = shiftDate(d, 1)) {
      const seconds = byDate.get(d) ?? 0;
      totalSeconds += seconds;
      dailyBreakdown.push({ date: d, minutes: Math.round(seconds / 60) });
      if (seconds >= MIN_ATTEND_SECONDS) {
        attendedInWindow++;
        if (!lastAttendedDate || d > lastAttendedDate) lastAttendedDate = d;
      }
    }

    return {
      username: seat.username,
      roomCode: seat.roomCode,
      shiftNumber: seat.shiftNumber,
      shiftId: seat.shiftId,
      attendedInWindow,
      lastAttendedDate,
      totalMinutesInWindow: Math.round(totalSeconds / 60),
      dailyBreakdown,
    };
  });

  // Worst first: zero attendance ranks above low-but-nonzero, then (within
  // the same attendance count) less total talk time ranks worse.
  roster.sort((a, b) => a.attendedInWindow - b.attendedInWindow || a.totalMinutesInWindow - b.totalMinutesInWindow);
  const flagged = roster.filter((r) => r.attendedInWindow === 0);

  return { windowDays, today, roster, flagged };
}
