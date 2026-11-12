import { supabaseServer } from "@/lib/supabase";

// Free-tier Live API concurrency control — see the big comment block above
// the `mock_test_slot_bookings` table in sql/schema.sql for the full
// rationale. This file is the only place that talks to those tables.
//
// Students pick their own slot (book_specific_mock_test_slot /
// bookChosenSlot below) rather than being auto-assigned one — getSlotOptions
// is what builds the list of pickable times for that UI.

export type SlotSettings = {
  capacityPerSlot: number;
  slotMinutes: number;
  windowStartHour: number;
  windowDurationHours: number;
  // Roughly how many students need a slot each week — drives
  // computeTestingDaysNeeded below (how many trailing days of the
  // Saturday-Friday week get opened up for testing).
  expectedStudentCount: number;
  // First calendar day (YYYY-MM-DD, in `timezone`) slots are offered from
  // at all — null means no extra gate beyond normal weekly eligibility.
  bookingOpensOn: string | null;
  timezone: string;
};

const DEFAULT_SETTINGS: SlotSettings = {
  capacityPerSlot: 3,
  slotMinutes: 25,
  windowStartHour: 8,
  windowDurationHours: 16,
  expectedStudentCount: 300,
  bookingOpensOn: null,
  timezone: "Asia/Dhaka",
};

export async function getSlotSettings(): Promise<SlotSettings> {
  const { data } = await supabaseServer
    .from("mock_test_slot_settings")
    .select(
      "capacity_per_slot, slot_minutes, window_start_hour, window_duration_hours, expected_student_count, booking_opens_on, timezone"
    )
    .eq("id", 1)
    .maybeSingle();

  if (!data) return DEFAULT_SETTINGS;

  return {
    capacityPerSlot: data.capacity_per_slot ?? DEFAULT_SETTINGS.capacityPerSlot,
    slotMinutes: data.slot_minutes ?? DEFAULT_SETTINGS.slotMinutes,
    windowStartHour: data.window_start_hour ?? DEFAULT_SETTINGS.windowStartHour,
    windowDurationHours: data.window_duration_hours ?? DEFAULT_SETTINGS.windowDurationHours,
    expectedStudentCount: data.expected_student_count ?? DEFAULT_SETTINGS.expectedStudentCount,
    bookingOpensOn: data.booking_opens_on ?? null,
    timezone: data.timezone || DEFAULT_SETTINGS.timezone,
  };
}

export async function updateSlotSettings(input: {
  capacityPerSlot: number;
  slotMinutes: number;
  windowStartHour: number;
  windowDurationHours: number;
  expectedStudentCount: number;
  // Pass null (or omit) to clear the gate and open booking immediately.
  bookingOpensOn?: string | null;
}): Promise<void> {
  const { error } = await supabaseServer
    .from("mock_test_slot_settings")
    .update({
      capacity_per_slot: input.capacityPerSlot,
      slot_minutes: input.slotMinutes,
      window_start_hour: input.windowStartHour,
      window_duration_hours: input.windowDurationHours,
      expected_student_count: input.expectedStudentCount,
      booking_opens_on: input.bookingOpensOn ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) throw new Error(error.message);
}

// Mirrors compute_testing_days_needed() in sql/schema.sql exactly — kept in
// sync by hand since one lives in Postgres (used inside
// book_specific_mock_test_slot's own validation) and this one drives what
// getSlotOptions lists. If you change the formula, change it in both places.
export function computeTestingDaysNeeded(settings: SlotSettings): number {
  const slotsPerDay = Math.max(1, Math.floor((settings.windowDurationHours * 60) / settings.slotMinutes));
  const dailyCapacity = Math.max(1, settings.capacityPerSlot * slotsPerDay);
  const days = Math.ceil(settings.expectedStudentCount / dailyCapacity);
  return Math.min(7, Math.max(1, days));
}

export type SlotBooking = {
  slotStart: string;
  slotEnd: string;
  status: "booked" | "in_progress";
};

type RawBookingRow = { id: string; slot_start: string; slot_end: string; status: string };

// Shared lookup used by both the read-only status check (GET
// /api/mock-test/slot) and the real start-of-test gate (checkSlotWindow) —
// there's only ever at most one 'booked' or 'in_progress' row per student
// by construction (the booking functions never create a second one while
// an active one exists).
async function findActiveBooking(studentId: string): Promise<RawBookingRow | null> {
  const { data } = await supabaseServer
    .from("mock_test_slot_bookings")
    .select("id, slot_start, slot_end, status")
    .eq("student_id", studentId)
    .in("status", ["booked", "in_progress"])
    .order("slot_start", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // A 'booked' slot whose window has fully passed without the student ever
  // starting is no longer active — flip it to no_show right here so it
  // stops being reported as bookable/joinable. Without this, a student who
  // simply never showed up would see the same "your slot expired" error
  // forever (checkSlotWindow below would keep finding this same stale row).
  // An 'in_progress' row is left alone regardless of the clock — see
  // checkSlotWindow's comment on why a resuming student is always let back in.
  if (data.status === "booked" && new Date(data.slot_end).getTime() < Date.now()) {
    await supabaseServer.from("mock_test_slot_bookings").update({ status: "no_show" }).eq("id", data.id);
    return null;
  }

  return data;
}

export async function getActiveBooking(studentId: string): Promise<SlotBooking | null> {
  const row = await findActiveBooking(studentId);
  if (!row) return null;
  return { slotStart: row.slot_start, slotEnd: row.slot_end, status: row.status as "booked" | "in_progress" };
}

// --- timezone-aware slot boundary math -------------------------------------
// No date library in this project, and Asia/Dhaka (the default) has a fixed
// UTC+6 offset with no DST, so the standard "format in target zone, diff
// against UTC" trick via Intl.DateTimeFormat is all that's needed here —
// accurate for any IANA zone at the instant it's computed, which is all
// this needs (a multi-day DST transition mid-window would introduce at most
// an hour of drift, moot for a fixed-offset zone).

function getTzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtcMs - date.getTime()) / 60000);
}

export type SlotOption = {
  slotStart: string;
  slotEnd: string;
  bookedCount: number;
  capacity: number;
  full: boolean;
};

// Builds the list of pickable slots for the next `daysAhead` days for the
// student-facing picker UI. This only *lists* slots and their current
// occupancy — actually reserving one is always done by
// book_specific_mock_test_slot (via bookChosenSlot), which re-validates and
// re-counts under a lock, so a stale count here (e.g. someone else booked
// the same slot a second ago) can never actually over-book anything; it
// just means an occasional "that slot just filled up" on submit.
//
// daysAhead defaults to 8 rather than the smaller value used before the
// weekly cadence existed — with only the trailing days of each week open
// for testing, a shorter lookahead could land entirely inside a
// booking-only stretch and show nothing, even though real slots are only
// a day or two away. 8 days guarantees at least one full week's cycle is
// always visible regardless of which day "now" falls on.
export async function getSlotOptions(daysAhead = 8, studentId?: string): Promise<SlotOption[]> {
  const settings = await getSlotSettings();
  const now = new Date();
  const offsetMin = getTzOffsetMinutes(now, settings.timezone);
  let localNowMs = now.getTime() + offsetMin * 60000;

  const slotMs = settings.slotMinutes * 60000;
  const windowStartMinOfDay = settings.windowStartHour * 60;
  const windowDurMin = settings.windowDurationHours * 60;
  const testingDaysNeeded = computeTestingDaysNeeded(settings);

  // One mock per student per week — a missed (no_show) slot uses up that
  // whole week's turn, so this student shouldn't even see a pickable day
  // in a week they already missed (mirrors the same rule enforced for
  // real in book_specific_mock_test_slot / sql/schema.sql; this is purely
  // the picker not wasting the student's time on a day that would just
  // get rejected). Keyed by each blocked week's Saturday, in the same
  // "local-as-UTC" ms space as dayStart below so the two line up exactly.
  const blockedWeekStarts = new Set<number>();
  if (studentId) {
    const { data: noShows } = await supabaseServer
      .from("mock_test_slot_bookings")
      .select("slot_start")
      .eq("student_id", studentId)
      .eq("status", "no_show")
      .gte("slot_start", new Date(Date.now() - 21 * 86400000).toISOString());
    for (const row of noShows ?? []) {
      const rowLocalMs = new Date(row.slot_start).getTime() + offsetMin * 60000;
      const rowDayStart = Math.floor(rowLocalMs / 86400000) * 86400000;
      const rowSatIndex = (new Date(rowDayStart).getUTCDay() + 1) % 7;
      blockedWeekStarts.add(rowDayStart - rowSatIndex * 86400000);
    }
  }

  // If admin has set a rollout date, nothing before that date's window
  // open is ever offered — "today" for the purposes of this listing
  // effectively starts there instead of the real current moment, whenever
  // that gate is still in the future.
  if (settings.bookingOpensOn) {
    const [oy, om, od] = settings.bookingOpensOn.split("-").map(Number);
    const openLocalMs = Date.UTC(oy, om - 1, od, 0, 0, 0) + windowStartMinOfDay * 60000;
    localNowMs = Math.max(localNowMs, openLocalMs);
  }

  const localDayStartMs = Math.floor(localNowMs / 86400000) * 86400000;

  const localBoundaries: number[] = [];
  for (let day = 0; day <= daysAhead; day++) {
    const dayStart = localDayStartMs + day * 86400000;

    // Only the week's trailing testingDaysNeeded days are open for
    // testing (Saturday=0 .. Friday=6, via getUTCDay() on the shifted
    // "local-as-UTC" value — see the getTzOffsetMinutes comment above for
    // why this trick is valid here).
    const satIndex = (new Date(dayStart).getUTCDay() + 1) % 7;
    if (satIndex < 7 - testingDaysNeeded) continue;

    const weekStart = dayStart - satIndex * 86400000;
    if (blockedWeekStarts.has(weekStart)) continue;

    const winStart = dayStart + windowStartMinOfDay * 60000;
    const winEnd = winStart + windowDurMin * 60000;
    for (let t = winStart; t + slotMs <= winEnd; t += slotMs) {
      localBoundaries.push(t);
    }
  }

  // Same "current slot needs enough time left" rule as the booking
  // functions (15 min) — no point listing a slot the student couldn't
  // actually get a fair test out of.
  const MIN_REMAINING_MS = 15 * 60000;
  const usableLocal = localBoundaries.filter((t) => {
    const endT = t + slotMs;
    if (endT <= localNowMs) return false;
    if (t <= localNowMs && endT - localNowMs < MIN_REMAINING_MS) return false;
    return true;
  });

  if (usableLocal.length === 0) return [];

  const slotStartDates = usableLocal.map((t) => new Date(t - offsetMin * 60000));
  const rangeStartIso = slotStartDates[0].toISOString();
  const rangeEndIso = new Date(slotStartDates[slotStartDates.length - 1].getTime() + slotMs + 1000).toISOString();

  const { data: bookings } = await supabaseServer
    .from("mock_test_slot_bookings")
    .select("slot_start")
    .in("status", ["booked", "in_progress"])
    .gte("slot_start", rangeStartIso)
    .lt("slot_start", rangeEndIso);

  const counts = new Map<string, number>();
  for (const b of bookings ?? []) {
    const key = new Date(b.slot_start).toISOString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return slotStartDates.map((d) => {
    const key = d.toISOString();
    const bookedCount = counts.get(key) ?? 0;
    return {
      slotStart: key,
      slotEnd: new Date(d.getTime() + slotMs).toISOString(),
      bookedCount,
      capacity: settings.capacityPerSlot,
      full: bookedCount >= settings.capacityPerSlot,
    };
  });
}

// The student's actual "pick this time" action. Delegates the real
// validation + race-safe capacity check to book_specific_mock_test_slot
// (sql/schema.sql) — this function just calls it and turns its result into
// either a SlotBooking or a thrown Error with the DB's own message.
export async function bookChosenSlot(studentId: string, slotStartIso: string): Promise<SlotBooking> {
  const { data, error } = await supabaseServer.rpc("book_specific_mock_test_slot", {
    p_student_id: studentId,
    p_slot_start: slotStartIso,
  });

  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Could not book that slot — please try again.");
  if (row.error) throw new Error(row.error);

  return { slotStart: row.slot_start, slotEnd: row.slot_end, status: row.status };
}

// How early a student is allowed to actually connect before their booked
// slot_start — small on purpose (just enough to smooth over clock/network
// skew between the student's browser and this check), not a real head
// start. Mirrored on the client (app/mock-test/session/page.tsx) purely so
// the "Start Test" button doesn't appear enabled a little before the server
// would actually accept it — the client value is cosmetic, this one is
// what's actually enforced.
export const SLOT_JOIN_GRACE_MS = 2 * 60 * 1000;

export type SlotCheckResult =
  | { ok: true; bookingId: string }
  | {
      ok: false;
      reason: "no_booking" | "too_early" | "expired";
      message: string;
      slotStart?: string;
    };

// The actual gate — called from /api/mock-test/gemini-session right before
// it would spend a Gemini token, so this can't be bypassed by a client that
// skips the booking screen. Deliberately read-only: never creates or
// changes a booking, so a mistimed request gets a clear "not yet" / "come
// back" answer instead of silently being rebooked to a different slot as a
// side effect of trying to start early.
export async function checkSlotWindow(studentId: string): Promise<SlotCheckResult> {
  const booking = await findActiveBooking(studentId);

  if (!booking) {
    return {
      ok: false,
      reason: "no_booking",
      message: "You haven't picked a test slot yet — please go back and choose one.",
    };
  }

  const now = Date.now();
  const startMs = new Date(booking.slot_start).getTime();
  const endMs = new Date(booking.slot_end).getTime();

  // A resuming ('in_progress') student is always let back in regardless of
  // the clock — they already started; a dropped connection shouldn't stop
  // them reconnecting just because the slot window has technically passed.
  if (booking.status === "booked") {
    if (now < startMs - SLOT_JOIN_GRACE_MS) {
      return {
        ok: false,
        reason: "too_early",
        message: `Your test slot hasn't started yet — it begins at ${new Date(
          booking.slot_start
        ).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.`,
        slotStart: booking.slot_start,
      };
    }
    if (now > endMs) {
      return {
        ok: false,
        reason: "expired",
        message: "Your test slot has ended — please go back and pick a new one.",
      };
    }
  }

  return { ok: true, bookingId: booking.id };
}

export async function markBookingInProgress(bookingId: string): Promise<void> {
  await supabaseServer
    .from("mock_test_slot_bookings")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", bookingId);
}

// Called from /api/mock-test/complete. Matches on student_id + status
// rather than a specific booking id, since /complete only has the
// mock_test_attempts row on hand — there's only ever at most one
// 'in_progress' slot booking per student by construction, so this is
// unambiguous.
export async function markBookingCompletedForStudent(studentId: string): Promise<void> {
  await supabaseServer
    .from("mock_test_slot_bookings")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .eq("status", "in_progress");
}

// A real test session runs ~25 minutes max (see the slot length setting
// and the gemini-session route's token expiry) — 45 minutes gives a
// generous buffer for a slow connection without letting a session count
// as "live" indefinitely. This is deliberately much shorter than
// ORPHAN_GRACE_MS in lib/mock-test.ts (2 hours): that longer window exists
// to be fair to a genuine student who had connectivity trouble, but a
// stale row sitting there for 2 hours would falsely occupy a capacity seat
// for that whole time — which is exactly the bug this constant fixes.
const LIVE_SESSION_MAX_AGE_MS = 45 * 60 * 1000;

// Independent, hard safety net: counts actually-live Gemini sessions
// (mock_test_attempts rows with no completed_at, not abandoned, started
// recently) rather than trusting the slot schedule above to have kept
// things under the limit. Reuses capacityPerSlot as the overall
// concurrency ceiling too, since on this app's Free-tier setup "how many
// can test in one slot" and "how many can be connected to Gemini at once"
// are the same number by design.
export async function isAtLiveCapacity(): Promise<boolean> {
  const settings = await getSlotSettings();
  const cutoffIso = new Date(Date.now() - LIVE_SESSION_MAX_AGE_MS).toISOString();

  // Self-heal first: a session older than the cutoff is almost certainly
  // dead (crashed tab, network drop, an old test run) rather than still
  // genuinely connected — clear it so it stops occupying a seat. Without
  // this, a single stale row from testing could block every future
  // attempt indefinitely, since nothing else here would ever touch it
  // again (computeEligibility's own cleanup in lib/mock-test.ts only runs
  // when that SAME student re-checks eligibility, which may never happen).
  await supabaseServer
    .from("mock_test_attempts")
    .update({ abandoned: true })
    .is("completed_at", null)
    .eq("abandoned", false)
    .lt("started_at", cutoffIso);

  const { count } = await supabaseServer
    .from("mock_test_attempts")
    .select("id", { count: "exact", head: true })
    .is("completed_at", null)
    .eq("abandoned", false)
    .gte("started_at", cutoffIso);

  return (count ?? 0) >= settings.capacityPerSlot;
}
