// lib/speaking-club-db.ts
//
// Server-only query helpers over the Phase 1 schema (sql/schema.sql,
// "SPEAKING CLUB" section). Mirrors the supabaseServer usage pattern
// already used by lib/mock-test.ts — service role key, RLS bypassed,
// so these must only ever be called from API routes / server components,
// never imported into a client component.
//
// This file is the "database is queryable" Phase 1 deliverable (plan
// §9): given a passkey OR a username, find the matching room/shift.
// Phase 3 (student passkey entry) and Phase 4 (admin assignment) both
// build on top of these instead of writing raw queries inline.

import { supabaseServer } from "@/lib/supabase";

export type SpeakingShiftLookup = {
  shift_id: string;
  passkey: string;
  shift_number: 1 | 2 | 3;
  start_time: string; // "HH:MM:SS", Asia/Dhaka local time
  end_time: string;
  username1: string | null;
  username2: string | null;
  temp_username: string | null;
  room_id: string;
  room_code: string;
  room_status: "active" | "inactive";
};

// Asia/Dhaka has no DST and a fixed +06:00 offset, so this doesn't need a
// timezone library — but if that ever changes, update here only.
const DHAKA_OFFSET_HOURS = 6;

/** Current wall-clock time in Asia/Dhaka, as "HH:MM:SS" for comparison against start_time/end_time. */
export function currentDhakaTime(): string {
  const now = new Date(Date.now() + DHAKA_OFFSET_HOURS * 60 * 60 * 1000);
  return now.toISOString().substring(11, 19);
}

function isWithinWindow(shift: Pick<SpeakingShiftLookup, "start_time" | "end_time">, atTime: string): boolean {
  return atTime >= shift.start_time && atTime < shift.end_time;
}

/** "done" | "now" | "upcoming" relative to the given time — used by the Phase 3 dashboard (§9). */
export function shiftTimeState(
  shift: Pick<SpeakingShiftLookup, "start_time" | "end_time">,
  atTime: string
): "done" | "now" | "upcoming" {
  if (atTime >= shift.end_time) return "done";
  if (atTime >= shift.start_time) return "now";
  return "upcoming";
}

/**
 * Core access-control check from plan §3.4:
 *   passkey matches a room+shift AND current_time is within that shift's window
 * Returns the shift row if valid, or a reason string if not — so callers
 * (the passkey-entry API route) can show "wrong passkey" vs "this session
 * isn't active right now" as distinct messages.
 */
export async function validatePasskey(
  passkey: string
): Promise<
  | { ok: true; shift: SpeakingShiftLookup }
  | { ok: false; reason: "not_found" | "inactive_room" | "outside_window" }
> {
  const { data, error } = await supabaseServer
    .from("speaking_shift_lookup")
    .select("*")
    .eq("passkey", passkey.trim())
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, reason: "not_found" };
  if (data.room_status !== "active") return { ok: false, reason: "inactive_room" };
  if (!isWithinWindow(data, currentDhakaTime())) return { ok: false, reason: "outside_window" };

  return { ok: true, shift: data as SpeakingShiftLookup };
}

/** All shifts (any room, any shift number) a given student is assigned to — main or temporary 3rd-person. */
export async function findShiftsByUsername(usernameEmail: string): Promise<SpeakingShiftLookup[]> {
  const { data, error } = await supabaseServer
    .from("speaking_shift_lookup")
    .select("*")
    .or(`username1.eq.${usernameEmail},username2.eq.${usernameEmail},temp_username.eq.${usernameEmail}`);

  if (error) throw error;
  return (data ?? []) as SpeakingShiftLookup[];
}

/** This student's shift for right now, if any (the query the student dashboard needs on load). */
export async function findCurrentShiftForUsername(usernameEmail: string): Promise<SpeakingShiftLookup | null> {
  const shifts = await findShiftsByUsername(usernameEmail);
  const now = currentDhakaTime();
  return shifts.find((s) => isWithinWindow(s, now)) ?? null;
}

/** Full 50-room x 3-shift table for the admin panel's "Rooms & Shifts" view. */
export async function listAllShifts(): Promise<SpeakingShiftLookup[]> {
  const { data, error } = await supabaseServer
    .from("speaking_shift_lookup")
    .select("*")
    .order("room_code", { ascending: true })
    .order("shift_number", { ascending: true });

  if (error) throw error;
  return (data ?? []) as SpeakingShiftLookup[];
}

/** Admin assignment action (Phase 4) — set/replace the two regular participants for a room+shift. */
export async function assignStudents(shiftId: string, username1: string | null, username2: string | null) {
  const { error } = await supabaseServer
    .from("speaking_shifts")
    .update({ username1, username2 })
    .eq("id", shiftId);
  if (error) throw error;
}

/**
 * Admin assignment action (Phase 4) — set/clear just ONE seat (username1 OR
 * username2) on a room+shift without touching the other seat. Used by
 * bulk-assign (a CSV row might only specify one side) and by auto-pair
 * (fills empty seats one at a time). assignStudents() above is for the
 * "replace both at once" case from the per-shift assign modal.
 */
export async function assignSeat(shiftId: string, field: "username1" | "username2", username: string | null) {
  const { error } = await supabaseServer
    .from("speaking_shifts")
    .update({ [field]: username })
    .eq("id", shiftId);
  if (error) throw error;
}

/**
 * Admin action — flip a room's active/inactive status (plan §9 Phase 4
 * known-gap: "no room-inactive toggle in the UI"). Inactive rooms stay in
 * `speaking_rooms` as-is — this doesn't touch their shift assignments — it
 * only marks the room so it can be filtered/flagged elsewhere later (e.g.
 * skipped by auto-pair) if that's ever needed. Matches the existing
 * update-by-id style of assignStudents()/assignSeat() above.
 */
export async function setRoomStatus(roomCode: string, status: "active" | "inactive") {
  const { error } = await supabaseServer
    .from("speaking_rooms")
    .update({ status })
    .eq("room_code", roomCode);
  if (error) throw error;
}

/**
 * Admin action — set the wall-clock start/end time for a given shift number
 * (1, 2, or 3), applied to ALL 50 rooms at once. Was reported missing
 * entirely: shift times were only ever set once via the seed data in
 * sql/schema.sql (17:00–18:00 / 18:00–19:00 / 19:00–20:00), with no admin
 * UI to change them afterward.
 *
 * Deliberately global-per-shift-number rather than per-room: all 50 rooms
 * share the same real-world shift windows (that's the whole point of a
 * "shift" — everyone in Shift 1 is on at the same time), so a single
 * update here is equivalent to editing 50 rows individually.
 */
export async function updateShiftTimesForAll(
  shiftNumber: 1 | 2 | 3,
  startTime: string, // "HH:MM" or "HH:MM:SS"
  endTime: string
) {
  const normalizedStart = startTime.length === 5 ? `${startTime}:00` : startTime;
  const normalizedEnd = endTime.length === 5 ? `${endTime}:00` : endTime;

  if (normalizedEnd <= normalizedStart) {
    throw new Error("End time must be after start time");
  }

  const { error } = await supabaseServer
    .from("speaking_shifts")
    .update({ start_time: normalizedStart, end_time: normalizedEnd })
    .eq("shift_number", shiftNumber);
  if (error) throw error;
}

/** Every email currently occupying a seat (regular or temp) anywhere in the 50x3 grid — used by auto-pair to skip already-assigned students. */
export function getAssignedUsernames(shifts: SpeakingShiftLookup[]): Set<string> {
  const set = new Set<string>();
  for (const s of shifts) {
    if (s.username1) set.add(s.username1);
    if (s.username2) set.add(s.username2);
    if (s.temp_username) set.add(s.temp_username);
  }
  return set;
}

/**
 * Open regular seats across active rooms, split into two buckets so
 * auto-pair (Phase 4, plan §5.2) can prefer filling a shift's BOTH seats
 * with two new students (keeps a room from ending up "one stranger added
 * to someone else's existing pair" when it doesn't have to) before
 * touching shifts that already have one participant.
 */
export function findOpenSeats(shifts: SpeakingShiftLookup[]): {
  emptyShifts: SpeakingShiftLookup[]; // both username1 and username2 are null
  singleSeats: { shift: SpeakingShiftLookup; field: "username1" | "username2" }[]; // exactly one side null
} {
  const emptyShifts: SpeakingShiftLookup[] = [];
  const singleSeats: { shift: SpeakingShiftLookup; field: "username1" | "username2" }[] = [];

  for (const s of shifts) {
    if (s.room_status !== "active") continue;
    if (!s.username1 && !s.username2) {
      emptyShifts.push(s);
    } else if (!s.username1) {
      singleSeats.push({ shift: s, field: "username1" });
    } else if (!s.username2) {
      singleSeats.push({ shift: s, field: "username2" });
    }
  }

  return { emptyShifts, singleSeats };
}

/**
 * Manual reassignment action (Phase 5, plan §4.2/§4.5) — moves a lonely or
 * proactively-conflicted student into a target room+shift, either into an
 * empty seat (username1/2) or as the temporary 3rd person, and logs it to
 * speaking_reassignments for Phase 6 (n8n) to pick up and notify.
 */
export async function reassignStudent(params: {
  studentUsername: string;
  reason: "partner_absent" | "proactive_conflict";
  previousShift?: Pick<SpeakingShiftLookup, "room_code" | "shift_number"> | null;
  targetShiftId: string;
  targetRoomCode: string;
  targetShiftNumber: number;
  asThirdPerson: boolean;
}) {
  const { studentUsername, reason, previousShift, targetShiftId, targetRoomCode, targetShiftNumber, asThirdPerson } =
    params;

  if (asThirdPerson) {
    const { error } = await supabaseServer
      .from("speaking_shifts")
      .update({ temp_username: studentUsername, temp_added_at: new Date().toISOString() })
      .eq("id", targetShiftId);
    if (error) throw error;
  } else {
    // Empty-room consolidation: place into whichever of username1/username2 is free.
    const { data: target, error: fetchError } = await supabaseServer
      .from("speaking_shifts")
      .select("username1, username2")
      .eq("id", targetShiftId)
      .single();
    if (fetchError) throw fetchError;

    const field = !target.username1 ? "username1" : "username2";
    const { error } = await supabaseServer
      .from("speaking_shifts")
      .update({ [field]: studentUsername })
      .eq("id", targetShiftId);
    if (error) throw error;
  }

  const { data: logRow, error: logError } = await supabaseServer
    .from("speaking_reassignments")
    .insert({
      shift_id: targetShiftId,
      student_username: studentUsername,
      reason,
      previous_room_code: previousShift?.room_code ?? null,
      previous_shift_number: previousShift?.shift_number ?? null,
      new_room_code: targetRoomCode,
      new_shift_number: targetShiftNumber,
    })
    .select("id")
    .single();
  if (logError) throw logError;

  // Returned so callers (Phase 5's alert-resolve / proactive-reassign
  // routes) can send the notification email right away and mark this row
  // notified=true immediately — without this id they'd have to guess
  // which reassignment row they just created before flipping that flag.
  return { reassignmentId: logRow.id as string };
}

/** Look up a single shift+room row by shift id — used wherever a route only has a shiftId, not a full list. */
export async function getShiftById(shiftId: string): Promise<SpeakingShiftLookup | null> {
  const { data, error } = await supabaseServer
    .from("speaking_shift_lookup")
    .select("*")
    .eq("shift_id", shiftId)
    .maybeSingle();
  if (error) throw error;
  return (data as SpeakingShiftLookup) ?? null;
}

/**
 * Clears whichever seat (username1 / username2 / temp_username) a given
 * student currently occupies on a shift — used by the proactive
 * reassignment flow (plan §4.5) to vacate their old room+shift when
 * moving them to a new one for the same recurring slot. A no-op (returns
 * false) if the student isn't actually on that shift.
 */
export async function clearSeatForUsername(shiftId: string, username: string): Promise<boolean> {
  const shift = await getShiftById(shiftId);
  if (!shift) return false;

  if (shift.username1 === username) {
    await supabaseServer.from("speaking_shifts").update({ username1: null }).eq("id", shiftId);
    return true;
  }
  if (shift.username2 === username) {
    await supabaseServer.from("speaking_shifts").update({ username2: null }).eq("id", shiftId);
    return true;
  }
  if (shift.temp_username === username) {
    await supabaseServer
      .from("speaking_shifts")
      .update({ temp_username: null, temp_added_at: null })
      .eq("id", shiftId);
    return true;
  }
  return false;
}

/**
 * Marks a speaking_reassignments row as notified (or explicitly
 * not-to-be-notified) — Phase 6 (n8n) will eventually be the thing that
 * flips this on for the *routine* passkey email, but Phase 5's admin
 * "reassign" action already sends the email itself right now (n8n's
 * reassignment-notification workflow doesn't exist yet), so it sets this
 * immediately either way: true after actually sending, or true-with-no-
 * send when the admin unchecks "notify" (so a future Phase 6 build never
 * double-sends an old reassignment it wasn't meant to see).
 */
export async function markReassignmentNotified(reassignmentId: string) {
  const { error } = await supabaseServer
    .from("speaking_reassignments")
    .update({ notified: true, notified_at: new Date().toISOString() })
    .eq("id", reassignmentId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Phase 5 — Partner-Absent Handling (plan §4, §9 Phase 5)
// ---------------------------------------------------------------------------

/** A heartbeat older than this is treated as "not actually here anymore" (tab closed, call dropped, etc). Must be well above the ~45s heartbeat interval the room page uses. */
export const PRESENCE_STALE_SECONDS = 90;

/** How long after a shift starts a still-1-person room counts as a real partner-absent case, not just someone joining a minute early/late (plan §4.1: "Threshold: 10–15 minutes"). */
export const ALERT_THRESHOLD_MINUTES = 10;

/** Records "this student is in this shift's call right now" — called every ~45s by the room page while connected (plan §4.1 needs live presence data; this is what makes it queryable from a stateless server route instead of a live Realtime socket). */
export async function recordPresenceHeartbeat(shiftId: string, username: string) {
  const { error } = await supabaseServer
    .from("speaking_room_presence")
    .upsert({ shift_id: shiftId, username, last_seen_at: new Date().toISOString() }, { onConflict: "shift_id,username" });
  if (error) throw error;
}

/** Usernames with a recent-enough heartbeat on this shift to count as "actually present" right now. */
export async function getPresentUsernamesForShift(shiftId: string): Promise<Set<string>> {
  const cutoff = new Date(Date.now() - PRESENCE_STALE_SECONDS * 1000).toISOString();
  const { data, error } = await supabaseServer
    .from("speaking_room_presence")
    .select("username")
    .eq("shift_id", shiftId)
    .gte("last_seen_at", cutoff);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.username as string));
}

function minutesSince(startTimeHHMMSS: string, atTimeHHMMSS: string): number {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  return toMinutes(atTimeHHMMSS) - toMinutes(startTimeHHMMSS);
}

/**
 * Detection pass (plan §4.1) — for every currently-active, fully-paired
 * shift, checks real presence against the assignment and opens/auto-closes
 * speaking_room_alerts rows accordingly. Idempotent and safe to call from
 * multiple places (the admin panel's GET /alerts call runs it inline so
 * the panel is never stale even without a cron configured yet; a
 * scheduled route — see app/api/cron/speaking-club-alerts — can also call
 * it every 1-2 min per the plan so alerts appear even when no admin has
 * the panel open).
 *
 * Deliberately conservative about what counts as "flaggable": only shifts
 * with BOTH regular seats assigned (a real expected pair) and no
 * temp_username yet (already has a 3rd-person fix in place) are
 * considered — an empty or single-seat shift was never going to have two
 * people show up, so it isn't a "partner absent" situation, just an
 * unfilled slot (Phase 4's job, not Phase 5's).
 */
export async function detectAndFlagPartnerAbsences(): Promise<void> {
  const allShifts = await listAllShifts();
  const now = currentDhakaTime();

  const candidates = allShifts.filter(
    (s) =>
      s.room_status === "active" &&
      s.username1 &&
      s.username2 &&
      !s.temp_username &&
      isWithinWindow(s, now) &&
      minutesSince(s.start_time, now) >= ALERT_THRESHOLD_MINUTES
  );

  const { data: openAlertRows, error: openAlertsError } = await supabaseServer
    .from("speaking_room_alerts")
    .select("id, shift_id")
    .eq("status", "open");
  if (openAlertsError) throw openAlertsError;
  const openAlertByShift = new Map<string, string>((openAlertRows ?? []).map((r) => [r.shift_id as string, r.id as string]));

  for (const shift of candidates) {
    const present = await getPresentUsernamesForShift(shift.shift_id);
    const p1 = shift.username1 ? present.has(shift.username1) : false;
    const p2 = shift.username2 ? present.has(shift.username2) : false;
    const existingAlertId = openAlertByShift.get(shift.shift_id);

    if (p1 !== p2) {
      // Exactly one of the two showed up — a real partner-absent case.
      if (!existingAlertId) {
        await supabaseServer.from("speaking_room_alerts").insert({
          shift_id: shift.shift_id,
          room_code: shift.room_code,
          shift_number: shift.shift_number,
          present_username: p1 ? shift.username1 : shift.username2,
          absent_username: p1 ? shift.username2 : shift.username1,
          status: "open",
        });
      }
      openAlertByShift.delete(shift.shift_id);
    } else if (existingAlertId) {
      // Both present now (partner showed up late) or neither present
      // (both stepped away briefly) — either way the "1 person alone"
      // condition that triggered this alert is no longer true.
      await supabaseServer
        .from("speaking_room_alerts")
        .update({ status: "resolved", resolution: "auto_resolved", resolved_at: new Date().toISOString() })
        .eq("id", existingAlertId);
      openAlertByShift.delete(shift.shift_id);
    }
  }

  // Any remaining open alert belongs to a shift that fell out of the
  // candidate set entirely (shift ended, room went inactive, or a
  // temp_username got added through some other path) — close it too so
  // the admin panel never shows a stale alert for a session that's over.
  for (const staleShiftId of openAlertByShift.values()) {
    await supabaseServer
      .from("speaking_room_alerts")
      .update({ status: "resolved", resolution: "auto_resolved", resolved_at: new Date().toISOString() })
      .eq("id", staleShiftId);
  }
}

export type SpeakingRoomAlert = {
  id: string;
  shift_id: string;
  room_code: string;
  shift_number: 1 | 2 | 3;
  present_username: string;
  absent_username: string | null;
  detected_at: string;
};

/** Every currently-open alert — the Admin panel's Alerts tab, after detectAndFlagPartnerAbsences() has run. */
export async function listOpenAlerts(): Promise<SpeakingRoomAlert[]> {
  const { data, error } = await supabaseServer
    .from("speaking_room_alerts")
    .select("id, shift_id, room_code, shift_number, present_username, absent_username, detected_at")
    .eq("status", "open")
    .order("detected_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as SpeakingRoomAlert[];
}

/**
 * Reassignment targets for one alert (plan §4.2): an empty room+shift at
 * the SAME shift_number (both original occupants absent too — "an
 * existing empty room"), and any already-active rooms at that same
 * shift_number that could take the lonely student as a temporary 3rd
 * person (both regular seats filled, no temp_username yet, excluding the
 * alert's own room).
 */
export async function suggestReassignmentTargets(
  shift: Pick<SpeakingShiftLookup, "shift_id" | "room_code" | "shift_number">
): Promise<{ emptyRoomTargets: SpeakingShiftLookup[]; thirdPersonTargets: SpeakingShiftLookup[] }> {
  const allShifts = await listAllShifts();
  const sameShiftNumber = allShifts.filter(
    (s) => s.shift_number === shift.shift_number && s.shift_id !== shift.shift_id && s.room_status === "active"
  );

  const emptyRoomTargets = sameShiftNumber.filter((s) => !s.username1 && !s.username2 && !s.temp_username);
  const thirdPersonTargets = sameShiftNumber.filter((s) => s.username1 && s.username2 && !s.temp_username);

  return { emptyRoomTargets, thirdPersonTargets };
}

/** Marks an alert resolved without necessarily performing a reassignment (e.g. a false positive the admin wants to clear) — see plan §5 item 5's "manual reassignment action", covers the "just dismiss it" path too. */
export async function resolveAlert(
  alertId: string,
  resolution: "moved_empty_room" | "added_third_person" | "dismissed"
) {
  const { error } = await supabaseServer
    .from("speaking_room_alerts")
    .update({ status: "resolved", resolution, resolved_at: new Date().toISOString() })
    .eq("id", alertId);
  if (error) throw error;
}

/** Fetch one alert by id — used by the resolve route to know which student/room it's acting on. */
export async function getAlertById(alertId: string): Promise<SpeakingRoomAlert | null> {
  const { data, error } = await supabaseServer
    .from("speaking_room_alerts")
    .select("id, shift_id, room_code, shift_number, present_username, absent_username, detected_at")
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw error;
  return (data as SpeakingRoomAlert) ?? null;
}

// ---------------------------------------------------------------------------
// Phase 7 — Monitoring & Hardening (plan §7, §9 Phase 7)
// ---------------------------------------------------------------------------

/** One call-end report from a student's browser (plan §7: "log TURN usage via getStats() for the first 1-2 weeks"). Best-effort, same spirit as recordPresenceHeartbeat — a failed/missing report just means that one call is invisible to the Monitoring tab, nothing in the call itself depends on it. */
export async function recordTurnUsage(params: {
  shiftId: string | null;
  roomCode: string;
  shiftNumber: number | null;
  username: string;
  usedRelay: boolean;
  relayBytesSent: number;
  relayBytesReceived: number;
  callDurationSeconds: number;
  peerCount: number;
}) {
  const { error } = await supabaseServer.from("speaking_turn_usage").insert({
    shift_id: params.shiftId,
    room_code: params.roomCode,
    shift_number: params.shiftNumber,
    username: params.username,
    used_relay: params.usedRelay,
    relay_bytes_sent: Math.max(0, Math.round(params.relayBytesSent)),
    relay_bytes_received: Math.max(0, Math.round(params.relayBytesReceived)),
    call_duration_seconds: Math.max(0, Math.round(params.callDurationSeconds)),
    peer_count: params.peerCount,
  });
  if (error) throw error;
}

export type TurnUsageDailySummary = {
  date: string; // YYYY-MM-DD (Asia/Dhaka)
  callCount: number;
  relayedCallCount: number;
  relayGb: number;
};

export type TurnUsageSummary = {
  daily: TurnUsageDailySummary[];
  totalCalls: number;
  totalRelayedCalls: number;
  totalRelayGb: number;
  relayRatePercent: number; // share of calls that needed TURN at all — plan §7's "20-30%" estimate, for real
  monthRelayGb: number; // rolling current-month total, to compare against Cloudflare's 1000 GB free quota (plan §7)
  quotaGb: number;
};

/**
 * Aggregates speaking_turn_usage into per-day totals for the admin
 * Monitoring tab — the concrete way to check plan §7's estimate
 * (~40-60 GB/month realistic, ~202 GB/month worst case, against a 1000
 * GB free quota) against what's actually happening once real students
 * are using it, instead of trusting the estimate forever.
 */
export async function getTurnUsageSummary(days = 14): Promise<TurnUsageSummary> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseServer
    .from("speaking_turn_usage")
    .select("created_at, used_relay, relay_bytes_sent, relay_bytes_received")
    .gte("created_at", since);
  if (error) throw error;

  const rows = (data ?? []) as {
    created_at: string;
    used_relay: boolean;
    relay_bytes_sent: number;
    relay_bytes_received: number;
  }[];

  const byDay = new Map<string, TurnUsageDailySummary>();
  let totalRelayBytes = 0;
  let totalRelayedCalls = 0;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
  let monthRelayBytes = 0;

  for (const row of rows) {
    // Asia/Dhaka date bucket — consistent with currentDhakaTime() elsewhere in this file.
    const dhakaMs = new Date(row.created_at).getTime() + DHAKA_OFFSET_HOURS * 60 * 60 * 1000;
    const date = new Date(dhakaMs).toISOString().slice(0, 10);
    const bytes = (row.relay_bytes_sent ?? 0) + (row.relay_bytes_received ?? 0);

    if (!byDay.has(date)) byDay.set(date, { date, callCount: 0, relayedCallCount: 0, relayGb: 0 });
    const bucket = byDay.get(date)!;
    bucket.callCount += 1;
    if (row.used_relay) {
      bucket.relayedCallCount += 1;
      bucket.relayGb += bytes / 1e9;
      totalRelayBytes += bytes;
      totalRelayedCalls += 1;
    }

    if (new Date(row.created_at).getTime() >= monthStart) {
      monthRelayBytes += row.used_relay ? bytes : 0;
    }
  }

  const daily = Array.from(byDay.values())
    .map((d) => ({ ...d, relayGb: Math.round(d.relayGb * 1000) / 1000 }))
    .sort((a, b) => (a.date < b.date ? 1 : -1)); // most recent first

  return {
    daily,
    totalCalls: rows.length,
    totalRelayedCalls,
    totalRelayGb: Math.round((totalRelayBytes / 1e9) * 1000) / 1000,
    relayRatePercent: rows.length ? Math.round((totalRelayedCalls / rows.length) * 1000) / 10 : 0,
    monthRelayGb: Math.round((monthRelayBytes / 1e9) * 1000) / 1000,
    quotaGb: 1000, // Cloudflare Calls TURN free tier, plan §3.3/§7
  };
}

export type ReassignmentFrequencySummary = {
  totalLast30Days: number;
  partnerAbsentLast30Days: number;
  proactiveLast30Days: number;
  openAlertsRightNow: number;
};

/**
 * Plan §9 Phase 7: "Watch real partner-absent frequency — decide if
 * Phase 5's manual process needs to evolve toward more automation later."
 * Reads the existing speaking_reassignments audit log (already written by
 * Phase 5, per its own comment: "gives Phase 7 a history to audit real
 * reassignment frequency against") — no new table needed for this half of
 * Phase 7, unlike the TURN usage half above.
 */
export async function getReassignmentFrequencySummary(): Promise<ReassignmentFrequencySummary> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: reassignments, error: reassignError }, { count: openAlertsRightNow, error: alertsError }] =
    await Promise.all([
      supabaseServer.from("speaking_reassignments").select("reason").gte("created_at", since),
      supabaseServer.from("speaking_room_alerts").select("id", { count: "exact", head: true }).eq("status", "open"),
    ]);
  if (reassignError) throw reassignError;
  if (alertsError) throw alertsError;

  const rows = (reassignments ?? []) as { reason: string }[];
  return {
    totalLast30Days: rows.length,
    partnerAbsentLast30Days: rows.filter((r) => r.reason === "partner_absent").length,
    proactiveLast30Days: rows.filter((r) => r.reason === "proactive_conflict").length,
    openAlertsRightNow: openAlertsRightNow ?? 0,
  };
}
