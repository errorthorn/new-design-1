"use client";

import { AdminShell } from "@/components/admin/admin-shell";
import { SearchBox, matchesSearch } from "@/components/admin/ui";
import { AdminChecking } from "@/components/admin/admin-nav";
import { useAdminSession } from "@/hooks/use-admin-access";
import { useEffect, useState } from "react";

type ScheduleRow = { week_number: number; unlock_date: string | null };

type SlotSettings = {
  capacity_per_slot: number;
  slot_minutes: number;
  window_start_hour: number;
  window_duration_hours: number;
  expected_student_count: number;
  booking_opens_on: string | null;
  timezone: string;
};

const INITIAL_WEEK_COUNT = 12; // rows shown by default; "+ Add week" extends this

// YYYY-MM-DD <-> the ISO-ish string we store/receive. The schedule API
// stores whatever string it's given, so this just keeps the <input
// type="date"> control fed a value it understands.
function toDateInputValue(v: string | null): string {
  if (!v) return "";
  return v.slice(0, 10);
}

// UI-only preview mirroring compute_testing_days_needed() in
// sql/schema.sql — the SQL function (and lib/mock-test-slots.ts's copy of
// it, used server-side) is the actual source of truth; this just lets the
// admin see the effect of a change before saving.
function computeTestingDaysPreview(
  expectedCount: number,
  capacityPerSlot: number,
  slotMinutes: number,
  windowDurationHours: number
): number {
  const slotsPerDay = Math.max(1, Math.floor((windowDurationHours * 60) / slotMinutes));
  const dailyCapacity = Math.max(1, capacityPerSlot * slotsPerDay);
  const days = Math.ceil(expectedCount / dailyCapacity);
  return Math.min(7, Math.max(1, days));
}

export default function AdminMockTestPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  // An account the owner linked on /admin/staff opens this page without pasting a key:
  // the server checks the signed-in account on every request (see lib/admin-auth.ts).
  const adminSession = useAdminSession("mock-test");
  useEffect(() => {
    if (adminSession.allowed) setUnlocked(true);
  }, [adminSession.allowed]);

  const [dates, setDates] = useState<Record<number, string>>({}); // week_number -> "" | "YYYY-MM-DD"
  const [weekCount, setWeekCount] = useState(INITIAL_WEEK_COUNT);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Free-tier slot-booking settings (see sql/schema.sql,
  // mock_test_slot_settings) — how many students can test at once, how
  // long each slot is, and the daily window slots are handed out in.
  const [slotSettings, setSlotSettings] = useState<SlotSettings | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [slotNotice, setSlotNotice] = useState<string | null>(null);
  const [slotSaving, setSlotSaving] = useState(false);

  async function loadSlotSettings(currentSecret: string) {
    setSlotError(null);
    try {
      const res = await fetch("/api/admin/mock-test-slot-settings", {
        headers: { "x-admin-secret": currentSecret },
      });
      const data = await res.json();
      if (!res.ok) {
        setSlotError(data.error ?? "Could not load slot settings.");
        return;
      }
      setSlotSettings(data.settings);
    } catch {
      setSlotError("There was a problem loading slot settings.");
    }
  }

  async function saveSlotSettings() {
    if (!slotSettings) return;
    setSlotSaving(true);
    setSlotError(null);
    setSlotNotice(null);
    try {
      const res = await fetch("/api/admin/mock-test-slot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({
          capacityPerSlot: slotSettings.capacity_per_slot,
          slotMinutes: slotSettings.slot_minutes,
          windowStartHour: slotSettings.window_start_hour,
          windowDurationHours: slotSettings.window_duration_hours,
          expectedStudentCount: slotSettings.expected_student_count,
          bookingOpensOn: slotSettings.booking_opens_on,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSlotError(data.error ?? "Could not save slot settings.");
        return;
      }
      setSlotSettings(data.settings);
      setSlotNotice("Saved — new bookings will use these settings right away.");
    } finally {
      setSlotSaving(false);
    }
  }

  async function load(currentSecret: string) {
    setError(null);
    try {
      const res = await fetch("/api/admin/mock-test-schedule", {
        headers: { "x-admin-secret": currentSecret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      const rows: ScheduleRow[] = data.schedule ?? [];
      const next: Record<number, string> = {};
      let maxWeek = INITIAL_WEEK_COUNT;
      for (const row of rows) {
        next[row.week_number] = toDateInputValue(row.unlock_date);
        if (row.week_number > maxWeek) maxWeek = row.week_number;
      }
      setDates(next);
      setWeekCount(maxWeek);
      setLoaded(true);
    } catch {
      setError("There was a problem loading.");
    }
  }

  useEffect(() => {
    if (unlocked) {
      load(secret);
      loadSlotSettings(secret);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function saveAll() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const entries = Array.from({ length: weekCount }, (_, i) => i + 1).map((weekNumber) => ({
        week_number: weekNumber,
        unlock_date: dates[weekNumber] ? dates[weekNumber] : null,
      }));
      const res = await fetch("/api/admin/mock-test-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ entries }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setNotice("Saved — the dashboard will show these dates on locked/upcoming weeks.");
    } finally {
      setSaving(false);
    }
  }

  if (!unlocked && adminSession.checking) return <AdminChecking />;

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setUnlocked(true);
          }}
          className="bg-white rounded-2xl p-6 border border-leaf-300 w-full max-w-sm"
        >
          <label className="block text-sm font-medium mb-1">Access key</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-xl border border-leaf-300 px-4 py-3 mb-4"
            placeholder="Access key"
          />
          <button className="w-full rounded-full py-3 font-bold text-white bg-leaf-600">Enter</button>
        </form>
      </div>
    );
  }

  const weekNumbers = Array.from({ length: weekCount }, (_, i) => i + 1);

  return (
    <AdminShell current="mock-test" title="Mock Test" width="max-w-4xl">

        <div className="bg-white rounded-2xl border border-leaf-300 p-5 mb-8">
          <h2 className="font-display text-base font-semibold mb-4">Test slots</h2>

          {slotError && <p className="text-red-600 text-sm mb-3">{slotError}</p>}
          {slotNotice && <p className="text-leaf-700 text-sm mb-3">{slotNotice}</p>}

          {!slotSettings ? (
            <p className="text-sm text-black/50">Loading…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Students per slot</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={slotSettings.capacity_per_slot}
                    onChange={(e) =>
                      setSlotSettings((s) => (s ? { ...s, capacity_per_slot: Number(e.target.value) } : s))
                    }
                    className="w-full rounded-xl border border-leaf-300 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Slot length (minutes)</span>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={slotSettings.slot_minutes}
                    onChange={(e) =>
                      setSlotSettings((s) => (s ? { ...s, slot_minutes: Number(e.target.value) } : s))
                    }
                    className="w-full rounded-xl border border-leaf-300 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Window opens (hour, 0-23)</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={slotSettings.window_start_hour}
                    onChange={(e) =>
                      setSlotSettings((s) => (s ? { ...s, window_start_hour: Number(e.target.value) } : s))
                    }
                    className="w-full rounded-xl border border-leaf-300 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Window length (hours)</span>
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={slotSettings.window_duration_hours}
                    onChange={(e) =>
                      setSlotSettings((s) => (s ? { ...s, window_duration_hours: Number(e.target.value) } : s))
                    }
                    className="w-full rounded-xl border border-leaf-300 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="block text-sm font-medium mb-1">Expected students per week</span>
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    value={slotSettings.expected_student_count}
                    onChange={(e) =>
                      setSlotSettings((s) => (s ? { ...s, expected_student_count: Number(e.target.value) } : s))
                    }
                    className="w-full rounded-xl border border-leaf-300 px-3 py-2"
                  />
                </label>
                <label className="block col-span-2">
                  <span className="block text-sm font-medium mb-1">
                    Slot booking opens on (optional — leave blank to open right away)
                  </span>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={slotSettings.booking_opens_on ?? ""}
                      onChange={(e) =>
                        setSlotSettings((s) => (s ? { ...s, booking_opens_on: e.target.value || null } : s))
                      }
                      className="w-full rounded-xl border border-leaf-300 px-3 py-2"
                    />
                    {slotSettings.booking_opens_on && (
                      <button
                        type="button"
                        onClick={() => setSlotSettings((s) => (s ? { ...s, booking_opens_on: null } : s))}
                        className="shrink-0 rounded-xl border border-leaf-300 px-3 py-2 text-sm"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </label>
              </div>
              <button
                onClick={saveSlotSettings}
                disabled={slotSaving}
                className="rounded-full px-6 py-3 font-bold text-white bg-leaf-600 disabled:opacity-60"
              >
                {slotSaving ? "Saving…" : "Save slot settings"}
              </button>
            </>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-base font-semibold">Weeks</h2>
          <SearchBox value={query} onChange={setQuery} placeholder="Search week or date" className="max-w-xs" />
        </div>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {notice && <p className="text-leaf-700 text-sm mb-4">{notice}</p>}

        {!loaded ? (
          <p className="text-sm text-black/50">Loading…</p>
        ) : (
          <div className="bg-white rounded-2xl border border-leaf-300 p-5">
            <div className="space-y-2 mb-4">
              {weekNumbers.filter((n) => matchesSearch(query, `week ${n}`, dates[n])).map((weekNumber) => (
                <div key={weekNumber} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-sm font-semibold">Week {weekNumber}</span>
                  <input
                    type="date"
                    value={dates[weekNumber] ?? ""}
                    onChange={(e) =>
                      setDates((prev) => ({ ...prev, [weekNumber]: e.target.value }))
                    }
                    className="flex-1 rounded-xl border border-leaf-300 px-3 py-2"
                  />
                  {dates[weekNumber] && (
                    <button
                      type="button"
                      onClick={() => setDates((prev) => ({ ...prev, [weekNumber]: "" }))}
                      className="text-xs text-black/40 underline shrink-0"
                    >
                      Clear
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setWeekCount((n) => n + 1)}
                className="text-sm underline text-black/60"
              >
                + Add week {weekCount + 1}
              </button>
              <button
                onClick={saveAll}
                disabled={saving}
                className="rounded-full px-6 py-3 font-bold text-white bg-leaf-600 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save all"}
              </button>
            </div>
          </div>
        )}
    </AdminShell>
  );
}
