"use client";

import { useEffect, useState } from "react";

type ScheduleRow = { week_number: number; unlock_date: string | null };

const INITIAL_WEEK_COUNT = 12; // rows shown by default; "+ Add week" extends this

// YYYY-MM-DD <-> the ISO-ish string we store/receive. The schedule API
// stores whatever string it's given, so this just keeps the <input
// type="date"> control fed a value it understands.
function toDateInputValue(v: string | null): string {
  if (!v) return "";
  return v.slice(0, 10);
}

export default function AdminMockTestPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [dates, setDates] = useState<Record<number, string>>({}); // week_number -> "" | "YYYY-MM-DD"
  const [weekCount, setWeekCount] = useState(INITIAL_WEEK_COUNT);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    if (unlocked) load(secret);
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

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setUnlocked(true);
          }}
          className="bg-white rounded-2xl p-6 border border-black/10 w-full max-w-sm"
        >
          <label className="block text-sm font-medium mb-1">Admin secret</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-xl border border-black/10 px-4 py-3 mb-4"
            placeholder="ADMIN_SECRET"
          />
          <button className="w-full rounded-full py-3 font-bold text-white bg-black">Enter</button>
        </form>
      </div>
    );
  }

  const weekNumbers = Array.from({ length: weekCount }, (_, i) => i + 1);

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-12 flex justify-center">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-4 text-sm mb-4 flex-wrap">
          <a href="/admin/questions" className="underline text-black/50">
            Questions
          </a>
          <a href="/admin/members" className="underline text-black/50">
            Members
          </a>
          <a href="/admin/scoring" className="underline text-black/50">
            Scoring
          </a>
          <a href="/admin/payments" className="underline text-black/50">
            Payments
          </a>
          <a href="/admin/referrals" className="underline text-black/50">
            Referrals
          </a>
          <a href="/admin/bug-reports" className="underline text-black/50">
            Bug Reports
          </a>
          <a href="/admin/study-materials" className="underline text-black/50">
            Study Materials
          </a>
          <a href="/admin/testimonials" className="underline text-black/50">
            Testimonials
          </a>
          <a href="/admin/speaking-club" className="underline text-black/50">
            Speaking Club
          </a>
          <span className="font-semibold">Mock Test</span>
          <a href="/admin/quiz" className="underline text-black/50">
            Quiz
          </a>
          <a href="/admin/classes" className="underline text-black/50">
            Classes
          </a>
        </div>

        <h1 className="text-2xl font-bold mb-2">Mock Test Weeks</h1>
        <p className="text-sm text-black/60 mb-1">
          Set a real date for each week — once that date arrives, the week actually unlocks for students (it
          shows as &ldquo;Unlocks &lt;date&gt;&rdquo; until then). A student can take any week that has already unlocked
          and that they haven&apos;t completed yet, in any order — so skipping Week 2 and then reaching Week 3&apos;s
          date leaves both open at once.
        </p>
        <p className="text-sm text-black/60 mb-6">
          How many of these weeks a student can ever reach depends on their subscription: set it per-student
          from{" "}
          <a href="/admin/members" className="underline font-medium">
            Members
          </a>{" "}
          (1 month ≈ 4 weeks, 2 months ≈ 8 weeks, editable there). A week beyond that count never unlocks for
          them even if you schedule a date for it.
        </p>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {notice && <p className="text-[#2E6B2A] text-sm mb-4">{notice}</p>}

        {!loaded ? (
          <p className="text-sm text-black/50">Loading…</p>
        ) : (
          <div className="bg-white rounded-xl border border-black/10 p-5">
            <div className="space-y-2 mb-4">
              {weekNumbers.map((weekNumber) => (
                <div key={weekNumber} className="flex items-center gap-3">
                  <span className="w-20 shrink-0 text-sm font-semibold">Week {weekNumber}</span>
                  <input
                    type="date"
                    value={dates[weekNumber] ?? ""}
                    onChange={(e) =>
                      setDates((prev) => ({ ...prev, [weekNumber]: e.target.value }))
                    }
                    className="flex-1 rounded-lg border border-black/10 px-3 py-2"
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
                className="rounded-full px-6 py-3 font-bold text-white bg-[#6FC24A] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save all"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
