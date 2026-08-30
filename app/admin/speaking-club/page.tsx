"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Users,
  UserPlus2,
  Table2,
  Mail,
  Upload,
  Wand2,
  X,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  Pencil,
  Activity,
  Clock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// PHASE 4 — Admin Panel: Assignment (plan §9 Phase 4 / §5 items 1-3).
// "Rooms & Shifts" and "Assign Students" are wired to the real Phase 1
// schema via /api/admin/speaking-club/*.
//
// PHASE 5 — Partner-Absent Handling (plan §9 Phase 5 / §4). "Alerts" is
// now wired to live detection (/api/admin/speaking-club/alerts,
// .../alerts/resolve) instead of Phase 0's mock data, plus a standalone
// proactive-reassignment form (.../reassign-proactive) for §4.5's
// planned-conflict flow.
//
// PHASE 7 — Monitoring & Hardening (plan §9 Phase 7 / §7). New
// "Monitoring" tab, reading /api/admin/speaking-club/monitoring: real TURN
// relay usage (getStats()-based, logged by hooks/use-speaking-room-call.ts
// since this pass) against Cloudflare's 1000 GB/month free quota, and real
// reassignment frequency (from Phase 5's existing speaking_reassignments
// audit log) — the two things plan §9 Phase 7 says to watch post-launch.
// ---------------------------------------------------------------------------

type ShiftRow = {
  shift_id: string;
  room_id: string;
  room_code: string;
  room_status: "active" | "inactive";
  shift_number: 1 | 2 | 3;
  passkey: string;
  start_time: string;
  end_time: string;
  username1: string | null;
  username2: string | null;
  temp_username: string | null;
  username1_name: string | null;
  username2_name: string | null;
  temp_username_name: string | null;
};

type ClubUser = { email: string; name: string | null; subscription_active: boolean };

// Real shape returned by GET /api/admin/speaking-club/alerts — see that
// route for how these get built (Phase 5, plan §4.1/§4.2).
type ReassignTarget = { shiftId: string; roomCode: string; shiftNumber: 1 | 2 | 3 };

type AlertRow = {
  id: string;
  shiftId: string;
  roomCode: string;
  shiftNumber: 1 | 2 | 3;
  presentUsername: string;
  presentName: string;
  absentUsername: string | null;
  absentName: string | null;
  detectedAt: string;
  emptyRoomTargets: ReassignTarget[];
  thirdPersonTargets: ReassignTarget[];
};

function waitedMinutes(detectedAt: string): number {
  const mins = Math.floor((Date.now() - new Date(detectedAt).getTime()) / 60000);
  return mins > 0 ? mins : 0;
}

type Tab = "alerts" | "rooms" | "assign" | "monitoring" | "shift-times";

// Real shape returned by GET /api/admin/speaking-club/monitoring (Phase 7).
type TurnUsageDailySummary = { date: string; callCount: number; relayedCallCount: number; relayGb: number };
type MonitoringData = {
  turnUsage: {
    daily: TurnUsageDailySummary[];
    totalCalls: number;
    totalRelayedCalls: number;
    totalRelayGb: number;
    relayRatePercent: number;
    monthRelayGb: number;
    quotaGb: number;
  };
  reassignmentFrequency: {
    totalLast30Days: number;
    partnerAbsentLast30Days: number;
    proactiveLast30Days: number;
    openAlertsRightNow: number;
  };
};

function shiftLabel(s: Pick<ShiftRow, "room_code" | "shift_number" | "start_time" | "end_time">) {
  return `${s.room_code} · Shift ${s.shift_number} (${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)})`;
}

export default function AdminSpeakingClubPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<Tab>("rooms");
  const [reassigning, setReassigning] = useState<AlertRow | null>(null);

  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  const [shiftsError, setShiftsError] = useState<string | null>(null);

  const [editingShift, setEditingShift] = useState<ShiftRow | null>(null);

  const [monitoring, setMonitoring] = useState<MonitoringData | null>(null);
  const [monitoringLoading, setMonitoringLoading] = useState(false);
  const [monitoringError, setMonitoringError] = useState<string | null>(null);

  // Phase 7 — loaded lazily the first time the Monitoring tab is opened,
  // same lazy-load-on-first-view pattern as loadShifts/loadAlerts above.
  async function loadMonitoring() {
    setMonitoringLoading(true);
    setMonitoringError(null);
    try {
      const res = await fetch("/api/admin/speaking-club/monitoring", { headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem loading monitoring data");
      setMonitoring(data as MonitoringData);
    } catch (e: any) {
      setMonitoringError(e.message ?? "There was a problem loading monitoring data");
    } finally {
      setMonitoringLoading(false);
    }
  }

  async function loadShifts() {
    setShiftsLoading(true);
    setShiftsError(null);
    try {
      const res = await fetch("/api/admin/speaking-club/shifts", { headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem loading shifts");
      setShifts(data.shifts as ShiftRow[]);
    } catch (e: any) {
      setShiftsError(e.message ?? "There was a problem loading shifts");
    } finally {
      setShiftsLoading(false);
    }
  }

  // Phase 5 (plan §9 / §4.1) — GET /alerts runs detection inline, so this
  // is always a fresh read even without a cron/scheduler configured yet
  // (see app/api/cron/speaking-club-alerts/route.ts for the background
  // version of the same detection pass).
  async function loadAlerts() {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const res = await fetch("/api/admin/speaking-club/alerts", { headers: { "x-admin-secret": secret } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem loading alerts");
      setAlerts(data.alerts as AlertRow[]);
    } catch (e: any) {
      setAlertsError(e.message ?? "There was a problem loading alerts");
    } finally {
      setAlertsLoading(false);
    }
  }

  useEffect(() => {
    if (unlocked && shifts === null) {
      loadShifts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  useEffect(() => {
    if (unlocked && alerts === null) {
      loadAlerts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  // Phase 7 — loads once, the first time the admin opens the Monitoring
  // tab (not on unlock, unlike shifts/alerts — this data changes slowly,
  // no need to fetch it before it's ever looked at).
  useEffect(() => {
    if (unlocked && tab === "monitoring" && monitoring === null && !monitoringLoading) {
      loadMonitoring();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, tab]);

  // Poll while the Alerts tab is open, so a lonely-student alert appears
  // within a minute or two without the admin needing to click around —
  // stops as soon as they leave the tab (no point polling in the
  // background here; the cron route is what covers "nobody has the panel
  // open at all").
  useEffect(() => {
    if (!unlocked || tab !== "alerts") return;
    const id = setInterval(loadAlerts, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, tab]);

  const rooms = useMemo(() => {
    if (!shifts) return [];
    const byRoom = new Map<string, { room_code: string; status: string; shifts: (ShiftRow | undefined)[] }>();
    for (const s of shifts) {
      if (!byRoom.has(s.room_code)) {
        byRoom.set(s.room_code, { room_code: s.room_code, status: s.room_status, shifts: [undefined, undefined, undefined] });
      }
      byRoom.get(s.room_code)!.shifts[s.shift_number - 1] = s;
    }
    return Array.from(byRoom.values()).sort((a, b) => a.room_code.localeCompare(b.room_code));
  }, [shifts]);

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

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-12 flex justify-center">
      <div className="w-full max-w-4xl">
        <div className="flex items-center gap-4 text-sm mb-4 flex-wrap">
          <a href="/admin/questions" className="underline text-black/50">Questions</a>
          <a href="/admin/members" className="underline text-black/50">Members</a>
          <a href="/admin/scoring" className="underline text-black/50">Scoring</a>
          <a href="/admin/payments" className="underline text-black/50">Payments</a>
          <a href="/admin/referrals" className="underline text-black/50">Referrals</a>
          <a href="/admin/bug-reports" className="underline text-black/50">Bug Reports</a>
          <a href="/admin/study-materials" className="underline text-black/50">Study Materials</a>
          <a href="/admin/testimonials" className="underline text-black/50">Testimonials</a>
          <span className="font-semibold">Speaking Club</span>
          <a href="/admin/mock-test" className="underline text-black/50">Mock Test</a>
          <a href="/admin/quiz" className="underline text-black/50">Quiz</a>
          <a href="/admin/classes" className="underline text-black/50">Classes</a>
        </div>

        <h1 className="text-2xl font-bold mb-1">Speaking Club — Rooms &amp; Shifts</h1>
        <p className="text-sm text-black/60 mb-6">
          50 rooms, 3 shifts a day. Manage assignments from here — if a partner is absent, a live
          alert will show up in the Alerts tab, which you can review and reassign or dismiss.
        </p>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <TabButton active={tab === "rooms"} onClick={() => setTab("rooms")} icon={<Table2 size={14} />}>
            Rooms &amp; Shifts
          </TabButton>
          <TabButton active={tab === "assign"} onClick={() => setTab("assign")} icon={<Users size={14} />}>
            Assign Students
          </TabButton>
          <TabButton active={tab === "alerts"} onClick={() => setTab("alerts")} icon={<AlertTriangle size={14} />}>
            Alerts {alerts && alerts.length > 0 && (
              <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[11px] text-white">{alerts.length}</span>
            )}
          </TabButton>
          <TabButton active={tab === "monitoring"} onClick={() => setTab("monitoring")} icon={<Activity size={14} />}>
            Monitoring
          </TabButton>
          <TabButton active={tab === "shift-times"} onClick={() => setTab("shift-times")} icon={<Clock size={14} />}>
            Shift Times
          </TabButton>
        </div>

        {tab === "rooms" && (
          <RoomsTab
            rooms={rooms}
            loading={shiftsLoading}
            error={shiftsError}
            secret={secret}
            onEdit={(s) => setEditingShift(s)}
            onRetry={loadShifts}
          />
        )}

        {tab === "assign" && (
          <AssignTab secret={secret} shifts={shifts} shiftsLoading={shiftsLoading} onShiftsChanged={loadShifts} />
        )}

        {tab === "alerts" && (
          <div className="space-y-6">
            <div className="space-y-3">
              <p className="text-xs text-black/40 -mt-1 mb-2">
                If only one person is present in a room 10+ minutes after the shift starts, an automatic alert
                shows up here (plan §4.1). This tab refreshes every minute.
              </p>

              {alertsLoading && alerts === null && (
                <div className="bg-white rounded-xl border border-black/10 p-10 flex items-center justify-center gap-2 text-sm text-black/50">
                  <Loader2 size={16} className="animate-spin" /> Loading…
                </div>
              )}

              {alertsError && (
                <div className="bg-white rounded-xl border border-red-200 bg-red-50/60 p-6 text-center text-sm">
                  <p className="text-red-600 mb-3">{alertsError}</p>
                  <button onClick={loadAlerts} className="rounded-full bg-black text-white text-xs font-semibold px-4 py-2">
                    Try again
                  </button>
                </div>
              )}

              {alerts && alerts.length === 0 && !alertsError && (
                <div className="bg-white rounded-xl border border-black/10 p-6 text-center text-sm text-black/50">
                  There are no partner-absent alerts right now.
                </div>
              )}

              {alerts?.map((a) => (
                <div
                  key={a.id}
                  className="bg-white rounded-xl border border-amber-300 bg-amber-50/60 p-4 flex items-center justify-between gap-4 flex-wrap"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-sm">
                        {a.roomCode} (Shift {a.shiftNumber}) — only {a.presentName} has joined ({waitedMinutes(a.detectedAt)}+ minutes)
                      </p>
                      <p className="text-xs text-black/50 mt-0.5">
                        {a.absentName ?? "Partner"} hasn&apos;t joined yet — reassign or dismiss.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setReassigning(a)}
                    className="flex items-center gap-1.5 rounded-full bg-black text-white text-xs font-semibold px-4 py-2 shrink-0"
                  >
                    <UserPlus2 size={13} />
                    Reassign
                  </button>
                </div>
              ))}
            </div>

            <ProactiveReassignForm secret={secret} shifts={shifts} />
          </div>
        )}

        {tab === "monitoring" && (
          <MonitoringTab data={monitoring} loading={monitoringLoading} error={monitoringError} onRetry={loadMonitoring} />
        )}

        {tab === "shift-times" && (
          <ShiftTimesTab secret={secret} shifts={shifts} onSaved={loadShifts} />
        )}
      </div>

      {reassigning && (
        <ReassignModal
          secret={secret}
          alert={reassigning}
          onClose={() => setReassigning(null)}
          onDone={() => {
            setReassigning(null);
            loadAlerts();
          }}
        />
      )}

      {editingShift && (
        <ShiftAssignModal
          secret={secret}
          shift={editingShift}
          onClose={() => setEditingShift(null)}
          onSaved={() => {
            setEditingShift(null);
            loadShifts();
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-black text-white" : "bg-white text-black/60 border border-black/10"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shift Times tab — fix for a reported gap: admin had no way to set/change
// WHEN each shift (1, 2, 3) actually runs. Times were only ever set once,
// via the seed data in sql/schema.sql (17:00–18:00 / 18:00–19:00 /
// 19:00–20:00), with no UI to change them afterward.
//
// One row per shift number (not per room) — saving updates all 50 rooms'
// matching shift at once, since a "shift" is meant to be the same
// real-world time slot across every room. See updateShiftTimesForAll() in
// lib/speaking-club-db.ts for the DB side of this.
// ---------------------------------------------------------------------------
function ShiftTimesTab({
  secret,
  shifts,
  onSaved,
}: {
  secret: string;
  shifts: ShiftRow[] | null;
  onSaved: () => void;
}) {
  const shiftNumbers: (1 | 2 | 3)[] = [1, 2, 3];

  // Current times, read from any one row per shift_number (they should all
  // match within a shift_number, since this tab is the only writer for them).
  const currentTimes = useMemo(() => {
    const map: Record<number, { start: string; end: string }> = {};
    for (const n of shiftNumbers) {
      const row = shifts?.find((s) => s.shift_number === n);
      map[n] = { start: row?.start_time?.slice(0, 5) ?? "", end: row?.end_time?.slice(0, 5) ?? "" };
    }
    return map;
  }, [shifts]);

  const [drafts, setDrafts] = useState<Record<number, { start: string; end: string }>>({});
  const [savingShift, setSavingShift] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [savedFlash, setSavedFlash] = useState<number | null>(null);

  function draftFor(n: number) {
    return drafts[n] ?? currentTimes[n] ?? { start: "", end: "" };
  }

  async function save(n: 1 | 2 | 3) {
    const d = draftFor(n);
    setSavingShift(n);
    setErrors((prev) => ({ ...prev, [n]: "" }));
    try {
      const res = await fetch("/api/admin/speaking-club/shift-times", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ shiftNumber: n, startTime: d.start, endTime: d.end }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSavedFlash(n);
      setTimeout(() => setSavedFlash((cur) => (cur === n ? null : cur)), 2000);
      onSaved();
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, [n]: e.message ?? "Failed to save" }));
    } finally {
      setSavingShift(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-6">
      <p className="text-xs text-black/50 mb-5">
        Changing a shift&apos;s time here updates it for all 50 rooms at once — every room&apos;s Shift 1
        (for example) always runs at the same real-world time. Passkeys and student assignments
        aren&apos;t affected, only the time window during which that passkey is valid.
      </p>

      <div className="space-y-4">
        {shiftNumbers.map((n) => {
          const d = draftFor(n);
          return (
            <div key={n} className="flex flex-wrap items-end gap-3 border-b border-black/5 pb-4 last:border-0 last:pb-0">
              <div className="font-semibold text-sm w-20 shrink-0">Shift {n}</div>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-black/40">Start time</span>
                <input
                  type="time"
                  value={d.start}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [n]: { ...draftFor(n), start: e.target.value } }))}
                  className="rounded-lg border border-black/10 px-3 py-2 text-sm"
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-black/40">End time</span>
                <input
                  type="time"
                  value={d.end}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [n]: { ...draftFor(n), end: e.target.value } }))}
                  className="rounded-lg border border-black/10 px-3 py-2 text-sm"
                />
              </label>

              <button
                onClick={() => save(n)}
                disabled={savingShift === n || !d.start || !d.end}
                className="flex items-center gap-1.5 rounded-full bg-black text-white text-xs font-semibold px-4 py-2.5 disabled:opacity-50"
              >
                {savingShift === n && <Loader2 size={13} className="animate-spin" />}
                Save Shift {n}
              </button>

              {savedFlash === n && (
                <span className="flex items-center gap-1 text-xs text-green-700">
                  <CheckCircle2 size={13} /> সেভ হয়েছে
                </span>
              )}
              {errors[n] && <span className="text-xs text-red-600">{errors[n]}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monitoring tab — Phase 7 (plan §9 Phase 7 / §7). Two things the plan asks
// the admin to watch post-launch: real TURN relay usage vs Cloudflare's
// free quota, and real partner-absent/reassignment frequency vs Phase 5's
// manual process.
// ---------------------------------------------------------------------------
function MonitoringTab({
  data,
  loading,
  error,
  onRetry,
}: {
  data: MonitoringData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading && !data) {
    return (
      <div className="bg-white rounded-xl border border-black/10 p-10 flex items-center justify-center gap-2 text-sm text-black/50">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-red-200 bg-red-50/60 p-6 text-center text-sm">
        <p className="text-red-600 mb-3">{error}</p>
        <button onClick={onRetry} className="rounded-full bg-black text-white text-xs font-semibold px-4 py-2">
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const { turnUsage, reassignmentFrequency } = data;
  const quotaUsedPercent = turnUsage.quotaGb > 0 ? Math.min(100, (turnUsage.monthRelayGb / turnUsage.quotaGb) * 100) : 0;

  return (
    <div className="space-y-6">
      <p className="text-xs text-black/40 -mt-1">
        This is where the Plan §7 estimate (worst-case ~202 GB/month, realistic ~40–60 GB/month) gets
        verified against real data — the browser self-reports via <code>getStats()</code> when a call ends.
        Data from the last 14 days.
      </p>

      {/* TURN usage summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="This month's TURN relay" value={`${turnUsage.monthRelayGb} GB`} sub={`within ${turnUsage.quotaGb} GB free quota`} />
        <StatCard label="TURN was needed" value={`${turnUsage.relayRatePercent}%`} sub={`${turnUsage.totalRelayedCalls} / ${turnUsage.totalCalls} calls`} />
        <StatCard label="Total relay, last 14 days" value={`${turnUsage.totalRelayGb} GB`} />
        <StatCard label="Reassignments (30 days)" value={String(reassignmentFrequency.totalLast30Days)} sub={`Partner-absent ${reassignmentFrequency.partnerAbsentLast30Days} · Proactive ${reassignmentFrequency.proactiveLast30Days}`} />
      </div>

      {/* Quota bar */}
      <div className="bg-white rounded-xl border border-black/10 p-4">
        <div className="flex items-center justify-between text-xs font-semibold mb-2">
          <span>Cloudflare free TURN quota (this month)</span>
          <span>{turnUsage.monthRelayGb} / {turnUsage.quotaGb} GB</span>
        </div>
        <div className="h-2 rounded-full bg-black/10 overflow-hidden">
          <div
            className={`h-full rounded-full ${quotaUsedPercent > 80 ? "bg-red-500" : quotaUsedPercent > 50 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${quotaUsedPercent}%` }}
          />
        </div>
      </div>

      {reassignmentFrequency.openAlertsRightNow > 0 && (
        <div className="bg-amber-50/60 border border-amber-300 rounded-xl p-3 text-xs text-amber-700">
          There {reassignmentFrequency.openAlertsRightNow === 1 ? "is" : "are"} {reassignmentFrequency.openAlertsRightNow} alert(s) open right now — go to the Alerts tab to resolve them.
        </div>
      )}

      {/* Daily breakdown table */}
      <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-black/10 text-sm font-semibold">Daily TURN usage</div>
        {turnUsage.daily.length === 0 ? (
          <div className="p-6 text-center text-sm text-black/50">
            No call usage has been reported yet — this will show up once someone finishes a call.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-black/5 text-xs text-black/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-right px-4 py-2 font-medium">Total calls</th>
                <th className="text-right px-4 py-2 font-medium">TURN needed</th>
                <th className="text-right px-4 py-2 font-medium">Relay GB</th>
              </tr>
            </thead>
            <tbody>
              {turnUsage.daily.map((d) => (
                <tr key={d.date} className="border-t border-black/5">
                  <td className="px-4 py-2">{d.date}</td>
                  <td className="px-4 py-2 text-right">{d.callCount}</td>
                  <td className="px-4 py-2 text-right">{d.relayedCallCount}</td>
                  <td className="px-4 py-2 text-right">{d.relayGb}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-black/10 p-4">
      <p className="text-[11px] text-black/50 mb-1">{label}</p>
      <p className="text-xl font-bold">{value}</p>
      {sub && <p className="text-[11px] text-black/40 mt-0.5">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rooms & Shifts tab — plan §5.3 "table of all 50 rooms × 3 shifts, who's
// assigned, status." Click any shift cell to open the assign modal for it.
// ---------------------------------------------------------------------------
function RoomsTab({
  rooms,
  loading,
  error,
  secret,
  onEdit,
  onRetry,
}: {
  rooms: { room_code: string; status: string; shifts: (ShiftRow | undefined)[] }[];
  loading: boolean;
  error: string | null;
  secret: string;
  onEdit: (s: ShiftRow) => void;
  onRetry: () => void;
}) {
  // Fix for plan §9 Phase 4's known gap: "no room-inactive toggle in the
  // UI". Optimistic local override so the badge flips instantly on click,
  // reconciled with real data on the next onRetry()/loadShifts() refresh.
  const [statusOverride, setStatusOverride] = useState<Record<string, "active" | "inactive">>({});
  const [togglingRoom, setTogglingRoom] = useState<string | null>(null);

  async function handleToggleStatus(roomCode: string, current: string) {
    const next = current === "active" ? "inactive" : "active";
    setTogglingRoom(roomCode);
    setStatusOverride((prev) => ({ ...prev, [roomCode]: next }));
    try {
      const res = await fetch("/api/admin/speaking-club/room-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ roomCode, status: next }),
      });
      if (!res.ok) {
        // Revert the optimistic flip if the server rejected it.
        setStatusOverride((prev) => ({ ...prev, [roomCode]: current as "active" | "inactive" }));
      } else {
        onRetry();
      }
    } catch {
      setStatusOverride((prev) => ({ ...prev, [roomCode]: current as "active" | "inactive" }));
    } finally {
      setTogglingRoom(null);
    }
  }

  if (loading && rooms.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-black/10 p-10 flex items-center justify-center gap-2 text-sm text-black/50">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-red-200 bg-red-50/60 p-6 text-center text-sm">
        <p className="text-red-600 mb-3">{error}</p>
        <button onClick={onRetry} className="rounded-full bg-black text-white text-xs font-semibold px-4 py-2">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/10 text-left text-black/50">
            <th className="px-4 py-3 font-medium">Room</th>
            <th className="px-4 py-3 font-medium">Shift 1</th>
            <th className="px-4 py-3 font-medium">Shift 2</th>
            <th className="px-4 py-3 font-medium">Shift 3</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((r) => (
            <tr key={r.room_code} className="border-b border-black/5 last:border-0">
              <td className="px-4 py-3 font-semibold whitespace-nowrap">{r.room_code}</td>
              {r.shifts.map((s, idx) => (
                <td key={idx} className="px-4 py-3 text-black/70 align-top">
                  {s ? (
                    <button
                      onClick={() => onEdit(s)}
                      className="group flex items-start gap-1.5 text-left hover:text-black"
                      title="Click to assign"
                    >
                      <span>
                        {s.username1_name ?? "—"} / {s.username2_name ?? "—"}
                        {s.temp_username_name && (
                          <span className="block text-[11px] text-amber-600">+ {s.temp_username_name} (3rd)</span>
                        )}
                      </span>
                      <Pencil size={11} className="mt-0.5 opacity-0 group-hover:opacity-60 shrink-0" />
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              ))}
              <td className="px-4 py-3">
                <button
                  onClick={() => handleToggleStatus(r.room_code, statusOverride[r.room_code] ?? r.status)}
                  disabled={togglingRoom === r.room_code}
                  title="Click to toggle Active/Inactive"
                  className={`rounded-full text-xs font-semibold px-2.5 py-1 transition-opacity hover:opacity-70 disabled:opacity-50 ${
                    (statusOverride[r.room_code] ?? r.status) === "active"
                      ? "bg-[#6FC24A]/15 text-[#2E6B2A]"
                      : "bg-black/10 text-black/50"
                  }`}
                >
                  {togglingRoom === r.room_code
                    ? "…"
                    : (statusOverride[r.room_code] ?? r.status) === "active"
                      ? "Active"
                      : "Inactive"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-3 text-xs text-black/40">
        Showing {rooms.length} rooms. Click any shift cell to assign directly, and click the Status badge to toggle a room Active/Inactive.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User search/select — plan §5.1. Debounced lookup against
// /api/admin/speaking-club/users (Turso accounts).
// ---------------------------------------------------------------------------
function UserPicker({
  secret,
  label,
  value,
  onChange,
}: {
  secret: string;
  label: string;
  value: ClubUser | null;
  onChange: (u: ClubUser | null) => void;
}) {
  const [query, setQuery] = useState(value?.email ?? "");
  const [results, setResults] = useState<ClubUser[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (value) {
      setQuery(value.email);
      return;
    }
  }, [value]);

  function handleQueryChange(v: string) {
    setQuery(v);
    onChange(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/speaking-club/users?q=${encodeURIComponent(v.trim())}`, {
          headers: { "x-admin-secret": secret },
        });
        const data = await res.json();
        setResults(data.users ?? []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  return (
    <div className="relative">
      <label className="block text-xs font-medium text-black/50 mb-1">{label}</label>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-black/30" />
        <input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Type a name or email…"
          className="w-full rounded-lg border border-black/10 pl-8 pr-8 py-2.5 text-sm"
        />
        {loading && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-black/30" />}
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-black/30 hover:text-black"
          >
            <X size={14} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-black/10 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {results.map((u) => (
            <button
              key={u.email}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(u);
                setQuery(u.email);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-black/5 flex items-center justify-between gap-2"
            >
              <span>
                <span className="font-medium">{u.name || "(no name)"}</span>
                <span className="block text-xs text-black/50">{u.email}</span>
              </span>
              {!u.subscription_active && (
                <span className="text-[10px] rounded-full bg-black/10 px-1.5 py-0.5 shrink-0">inactive</span>
              )}
            </button>
          ))}
        </div>
      )}
      {open && !loading && results.length === 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-black/10 rounded-lg shadow-lg px-3 py-2 text-xs text-black/40">
          No accounts found
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-shift assign modal — opened from a Rooms & Shifts table cell.
// ---------------------------------------------------------------------------
function ShiftAssignModal({
  secret,
  shift,
  onClose,
  onSaved,
}: {
  secret: string;
  shift: ShiftRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [u1, setU1] = useState<ClubUser | null>(
    shift.username1 ? { email: shift.username1, name: shift.username1_name, subscription_active: true } : null
  );
  const [u2, setU2] = useState<ClubUser | null>(
    shift.username2 ? { email: shift.username2, name: shift.username2_name, subscription_active: true } : null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(overrideU1?: ClubUser | null, overrideU2?: ClubUser | null) {
    const finalU1 = overrideU1 !== undefined ? overrideU1 : u1;
    const finalU2 = overrideU2 !== undefined ? overrideU2 : u2;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/speaking-club/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ shiftId: shift.shift_id, username1: finalU1?.email ?? null, username2: finalU2?.email ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem saving");
      onSaved();
    } catch (e: any) {
      setError(e.message ?? "There was a problem saving");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg">{shiftLabel(shift)}</h3>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-black/50 mb-4">Passkey: {shift.passkey}</p>

        <div className="space-y-3 mb-5">
          <UserPicker secret={secret} label="Student 1" value={u1} onChange={setU1} />
          <UserPicker secret={secret} label="Student 2" value={u2} onChange={setU2} />
        </div>

        {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

        <button
          onClick={() => save()}
          disabled={saving}
          className="w-full rounded-full bg-black text-white py-3 text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save assignment
        </button>

        {/* Fix for plan §9 Phase 4's known gap: "no dedicated un-assign
            button (clear via the picker's × then save works)". Clears
            both seats in one click + saves immediately, instead of
            needing two manual × clicks followed by a separate save. */}
        {(u1 || u2) && (
          <button
            onClick={() => {
              setU1(null);
              setU2(null);
              save(null, null);
            }}
            disabled={saving}
            className="mt-2 w-full rounded-full border border-red-200 text-red-600 py-2.5 text-sm font-semibold disabled:opacity-60 hover:bg-red-50"
          >
            Unassign both (clear seats)
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign Students tab — plan §5.1 (single assign, reuses UserPicker/modal
// pattern inline), §5.2 (bulk CSV upload + auto-pair).
// ---------------------------------------------------------------------------
function AssignTab({
  secret,
  shifts,
  shiftsLoading,
  onShiftsChanged,
}: {
  secret: string;
  shifts: ShiftRow[] | null;
  shiftsLoading: boolean;
  onShiftsChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      <QuickAssignCard secret={secret} shifts={shifts} shiftsLoading={shiftsLoading} onShiftsChanged={onShiftsChanged} />
      <div className="grid gap-4 sm:grid-cols-2">
        <BulkCsvCard secret={secret} onShiftsChanged={onShiftsChanged} />
        <AutoPairCard secret={secret} onShiftsChanged={onShiftsChanged} />
      </div>
    </div>
  );
}

function QuickAssignCard({
  secret,
  shifts,
  shiftsLoading,
  onShiftsChanged,
}: {
  secret: string;
  shifts: ShiftRow[] | null;
  shiftsLoading: boolean;
  onShiftsChanged: () => void;
}) {
  const [shiftId, setShiftId] = useState("");
  const [u1, setU1] = useState<ClubUser | null>(null);
  const [u2, setU2] = useState<ClubUser | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selectedShift = shifts?.find((s) => s.shift_id === shiftId) ?? null;

  async function save() {
    if (!shiftId) {
      setError("Select a room + shift first");
      return;
    }
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/admin/speaking-club/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ shiftId, username1: u1?.email ?? null, username2: u2?.email ?? null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem saving");
      setDone(true);
      setU1(null);
      setU2(null);
      onShiftsChanged();
    } catch (e: any) {
      setError(e.message ?? "There was a problem saving");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5">
      <div className="flex items-center gap-2 mb-3">
        <UserPlus2 size={16} />
        <h3 className="font-semibold text-sm">Assign a room + shift</h3>
      </div>

      <label className="block text-xs font-medium text-black/50 mb-1">Room + Shift</label>
      <select
        value={shiftId}
        onChange={(e) => {
          setShiftId(e.target.value);
          setDone(false);
        }}
        disabled={shiftsLoading || !shifts}
        className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm mb-3 bg-white disabled:opacity-60"
      >
        <option value="">{shiftsLoading ? "Loading…" : "Select…"}</option>
        {shifts?.map((s) => (
          <option key={s.shift_id} value={s.shift_id}>
            {shiftLabel(s)}
            {s.username1 || s.username2 ? " (assigned)" : ""}
          </option>
        ))}
      </select>

      <div className="space-y-3 mb-4">
        <UserPicker secret={secret} label="Student 1" value={u1} onChange={setU1} />
        <UserPicker secret={secret} label="Student 2" value={u2} onChange={setU2} />
      </div>

      {selectedShift && (
        <p className="text-[11px] text-black/40 mb-3">Passkey: {selectedShift.passkey}</p>
      )}

      {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
      {done && (
        <p className="text-[#2E6B2A] text-xs mb-3 flex items-center gap-1">
          <CheckCircle2 size={13} /> Saved
        </p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-xl bg-black text-white py-2.5 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {saving && <Loader2 size={14} className="animate-spin" />}
        Assign
      </button>
    </div>
  );
}

type CsvRow = { room_code: string; shift_number: string; username1: string; username2: string };
type CsvResult = { room_code: string; shift_number: string | number; ok: boolean; error?: string };

// Deliberately hand-rolled instead of a library: rows only ever contain
// room codes/emails (no embedded commas or quoted fields expected), so a
// plain split keeps this dependency-free at this project's scale.
function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = {
    room_code: header.indexOf("room_code"),
    shift_number: header.indexOf("shift_number"),
    username1: header.indexOf("username1"),
    username2: header.indexOf("username2"),
  };
  const dataLines = idx.room_code === -1 ? lines : lines.slice(1);
  return dataLines.map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    if (idx.room_code === -1) {
      // No header row detected — assume fixed column order.
      return { room_code: cells[0] ?? "", shift_number: cells[1] ?? "", username1: cells[2] ?? "", username2: cells[3] ?? "" };
    }
    return {
      room_code: cells[idx.room_code] ?? "",
      shift_number: idx.shift_number >= 0 ? cells[idx.shift_number] ?? "" : "",
      username1: idx.username1 >= 0 ? cells[idx.username1] ?? "" : "",
      username2: idx.username2 >= 0 ? cells[idx.username2] ?? "" : "",
    };
  });
}

function BulkCsvCard({ secret, onShiftsChanged }: { secret: string; onShiftsChanged: () => void }) {
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CsvResult[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResults(null);
    setError(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      setError("No rows found in the CSV");
      setRows([]);
      return;
    }
    setRows(parsed);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/speaking-club/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({
          rows: rows.map((r) => ({
            room_code: r.room_code,
            shift_number: Number(r.shift_number),
            username1: r.username1,
            username2: r.username2,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setResults(data.results);
      onShiftsChanged();
    } catch (e: any) {
      setError(e.message ?? "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  function downloadTemplate() {
    const csv = "room_code,shift_number,username1,username2\nroom-01,1,student1@example.com,student2@example.com\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "speaking-club-assignments-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Upload size={16} />
        <h3 className="font-semibold text-sm">Bulk assignment (CSV)</h3>
      </div>
      <p className="text-xs text-black/50 mb-3">
        Placing 300 students into 50 rooms × 3 shifts one by one isn&apos;t practical — upload a CSV.{" "}
        <button onClick={downloadTemplate} className="underline">
          Download Template
        </button>
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        className="w-full text-xs mb-3"
      />

      {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

      {rows.length > 0 && !results && (
        <>
          <p className="text-xs text-black/50 mb-2">{fileName} — found {rows.length} rows (preview):</p>
          <div className="max-h-32 overflow-y-auto border border-black/10 rounded-lg mb-3">
            <table className="w-full text-[11px]">
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-2 py-1 whitespace-nowrap">{r.room_code}</td>
                    <td className="px-2 py-1">S{r.shift_number}</td>
                    <td className="px-2 py-1 truncate max-w-[100px]">{r.username1 || "—"}</td>
                    <td className="px-2 py-1 truncate max-w-[100px]">{r.username2 || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 8 && <p className="px-2 py-1 text-black/40">…{rows.length - 8} more rows</p>}
          </div>
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full rounded-xl border border-black/10 py-2.5 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Upload {rows.length} rows
          </button>
        </>
      )}

      {results && (
        <div className="space-y-1 max-h-40 overflow-y-auto">
          <p className="text-xs font-semibold mb-1">
            {results.filter((r) => r.ok).length}/{results.length} succeeded
          </p>
          {results
            .filter((r) => !r.ok)
            .map((r, i) => (
              <p key={i} className="text-[11px] text-red-600 flex items-center gap-1">
                <XCircle size={11} className="shrink-0" /> {r.room_code} S{r.shift_number}: {r.error}
              </p>
            ))}
          <button
            onClick={() => {
              setRows([]);
              setResults(null);
              setFileName("");
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="text-xs underline text-black/50 mt-2"
          >
            Upload another CSV
          </button>
        </div>
      )}
    </div>
  );
}

type ProposedPair = {
  shiftId: string;
  room_code: string;
  shift_number: number;
  field: "username1" | "username2" | "both";
  username1?: string;
  username2?: string;
  name1?: string | null;
  name2?: string | null;
};

function AutoPairCard({ secret, onShiftsChanged }: { secret: string; onShiftsChanged: () => void }) {
  const [loading, setLoading] = useState(false);
  const [proposal, setProposal] = useState<ProposedPair[] | null>(null);
  const [meta, setMeta] = useState<{ subscribedUnassignedCount: number; matchedCount: number; leftoverUnassignedCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applied, setApplied] = useState<number | null>(null);

  async function preview() {
    setLoading(true);
    setError(null);
    setApplied(null);
    try {
      const res = await fetch("/api/admin/speaking-club/auto-pair", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem generating the proposal");
      setProposal(data.proposal);
      setMeta({
        subscribedUnassignedCount: data.subscribedUnassignedCount,
        matchedCount: data.matchedCount,
        leftoverUnassignedCount: data.leftoverUnassignedCount,
      });
    } catch (e: any) {
      setError(e.message ?? "There was a problem generating the proposal");
    } finally {
      setLoading(false);
    }
  }

  async function confirm() {
    if (!proposal) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/speaking-club/auto-pair", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ confirm: true, pairs: proposal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem confirming");
      setApplied(data.applied);
      setProposal(null);
      onShiftsChanged();
    } catch (e: any) {
      setError(e.message ?? "There was a problem confirming");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5">
      <div className="flex items-center gap-2 mb-2">
        <Wand2 size={16} />
        <h3 className="font-semibold text-sm">Auto-pair unassigned</h3>
      </div>
      <p className="text-xs text-black/50 mb-4">
        Auto-pairs anyone who hasn&apos;t been placed in a room yet — you can review before assigning.
      </p>

      {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
      {applied !== null && (
        <p className="text-[#2E6B2A] text-xs mb-3 flex items-center gap-1">
          <CheckCircle2 size={13} /> {applied} assignments done
        </p>
      )}

      {!proposal && (
        <button
          onClick={preview}
          disabled={loading}
          className="w-full rounded-xl bg-[#6FC24A] text-white py-2.5 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          Run Auto-pair
        </button>
      )}

      {proposal && meta && (
        <>
          <p className="text-xs text-black/50 mb-2">
            Found {meta.subscribedUnassignedCount} unassigned members, gave seats to {meta.matchedCount}.
            {meta.leftoverUnassignedCount > 0 && ` No seats left for ${meta.leftoverUnassignedCount} member(s).`}
          </p>
          <div className="max-h-40 overflow-y-auto border border-black/10 rounded-lg mb-3">
            <table className="w-full text-[11px]">
              <tbody>
                {proposal.map((p, i) => (
                  <tr key={i} className="border-b border-black/5 last:border-0">
                    <td className="px-2 py-1 whitespace-nowrap">
                      {p.room_code} S{p.shift_number}
                    </td>
                    <td className="px-2 py-1 truncate max-w-[110px]">{p.name1 ?? p.username1 ?? ""}</td>
                    <td className="px-2 py-1 truncate max-w-[110px]">{p.name2 ?? p.username2 ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setProposal(null);
                setMeta(null);
              }}
              className="flex-1 rounded-xl border border-black/10 py-2.5 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={confirming}
              className="flex-1 rounded-xl bg-black text-white py-2.5 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {confirming && <Loader2 size={14} className="animate-spin" />}
              Confirm
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ReassignModal({
  secret,
  alert,
  onClose,
  onDone,
}: {
  secret: string;
  alert: AlertRow;
  onClose: () => void;
  onDone: () => void;
}) {
  // A single flat list of selectable targets, tagged with which kind of
  // move they are — the resolve route needs to know both the target
  // shiftId and whether it's an empty-seat move or a 3rd-person add.
  const options = [
    ...alert.emptyRoomTargets.map((t) => ({ ...t, kind: "move_empty" as const })),
    ...alert.thirdPersonTargets.map((t) => ({ ...t, kind: "add_third" as const })),
  ];

  const [selected, setSelected] = useState<string>(options[0]?.shiftId ?? "");
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedOption = options.find((o) => o.shiftId === selected) ?? null;

  async function resolve(action: "move_empty" | "add_third" | "dismiss") {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/speaking-club/alerts/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({
          alertId: alert.id,
          action,
          targetShiftId: action === "dismiss" ? undefined : selectedOption?.shiftId,
          notify,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem reassigning");
      onDone();
    } catch (e: any) {
      setError(e.message ?? "There was a problem reassigning");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-lg">Reassign {alert.presentName}</h3>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-black/50 mb-4">
          {alert.roomCode} (Shift {alert.shiftNumber}) — {alert.absentName ?? "partner"} absent for {waitedMinutes(alert.detectedAt)}+ minutes
        </p>

        {options.length === 0 ? (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
            No empty or active room was found in the same shift right now. Try again later, or just dismiss for now.
          </p>
        ) : (
          <div className="space-y-2 mb-4 max-h-52 overflow-y-auto">
            {alert.emptyRoomTargets.length > 0 && (
              <p className="text-[11px] font-semibold text-black/40 uppercase tracking-wide">Move to an empty room</p>
            )}
            {alert.emptyRoomTargets.map((t) => (
              <label key={t.shiftId} className="flex items-center gap-2 rounded-xl border border-black/10 p-3 text-sm cursor-pointer">
                <input type="radio" name="target" checked={selected === t.shiftId} onChange={() => setSelected(t.shiftId)} />
                {t.roomCode} — Shift {t.shiftNumber}
              </label>
            ))}
            {alert.thirdPersonTargets.length > 0 && (
              <p className="text-[11px] font-semibold text-black/40 uppercase tracking-wide mt-2">Add as 3rd person</p>
            )}
            {alert.thirdPersonTargets.map((t) => (
              <label key={t.shiftId} className="flex items-center gap-2 rounded-xl border border-black/10 p-3 text-sm cursor-pointer">
                <input type="radio" name="target" checked={selected === t.shiftId} onChange={() => setSelected(t.shiftId)} />
                {t.roomCode} — Shift {t.shiftNumber} (active room)
              </label>
            ))}
          </div>
        )}

        <label className="flex items-center gap-2 text-sm mb-5">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <Mail size={14} className="text-black/40" />
          Email the new room/passkey
        </label>

        {error && <p className="text-red-600 text-xs mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => resolve("dismiss")}
            disabled={submitting}
            className="flex-1 rounded-full border border-black/10 py-3 text-sm font-semibold disabled:opacity-60"
          >
            Dismiss
          </button>
          <button
            onClick={() => selectedOption && resolve(selectedOption.kind)}
            disabled={submitting || !selectedOption}
            className="flex-1 rounded-full bg-black text-white py-3 text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Confirm reassignment
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proactive reassignment (plan §4.5/§5.6) — a student reports a known
// conflict in advance; admin moves them to a different shift/room ahead of
// time. Separate, simpler flow from the reactive ReassignModal above (no
// alert row involved — just pick a student and a target room+shift).
// ---------------------------------------------------------------------------
function ProactiveReassignForm({ secret, shifts }: { secret: string; shifts: ShiftRow[] | null }) {
  const [student, setStudent] = useState<ClubUser | null>(null);
  const [targetShiftId, setTargetShiftId] = useState("");
  const [asThirdPerson, setAsThirdPerson] = useState(false);
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const targetShift = shifts?.find((s) => s.shift_id === targetShiftId) ?? null;

  async function submit() {
    if (!student) {
      setError("Select a student first");
      return;
    }
    if (!targetShiftId) {
      setError("Select a target room + shift first");
      return;
    }
    setSubmitting(true);
    setError(null);
    setDone(false);
    try {
      const res = await fetch("/api/admin/speaking-club/reassign-proactive", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ studentUsername: student.email, targetShiftId, asThirdPerson, notify }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "There was a problem reassigning");
      setDone(true);
      setStudent(null);
      setTargetShiftId("");
      setAsThirdPerson(false);
    } catch (e: any) {
      setError(e.message ?? "There was a problem reassigning");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-black/10 p-5">
      <div className="flex items-center gap-2 mb-1">
        <UserPlus2 size={16} />
        <h3 className="font-semibold text-sm">Proactive reassignment</h3>
      </div>
      <p className="text-xs text-black/50 mb-4">
        If a student lets you know in advance they can&apos;t make their shift, move them to another room/shift from here — without waiting for a same-day emergency.
      </p>

      <div className="space-y-3 mb-3">
        <UserPicker secret={secret} label="Student" value={student} onChange={setStudent} />

        <div>
          <label className="block text-xs font-medium text-black/50 mb-1">Target room + shift</label>
          <select
            value={targetShiftId}
            onChange={(e) => setTargetShiftId(e.target.value)}
            disabled={!shifts}
            className="w-full rounded-lg border border-black/10 px-3 py-2.5 text-sm bg-white disabled:opacity-60"
          >
            <option value="">{shifts ? "Select…" : "Loading…"}</option>
            {shifts?.map((s) => (
              <option key={s.shift_id} value={s.shift_id}>
                {shiftLabel(s)}
                {s.username1 || s.username2 ? " (assigned)" : " (empty)"}
              </option>
            ))}
          </select>
        </div>

        {targetShift && (
          <p className="text-[11px] text-black/40">Passkey: {targetShift.passkey}</p>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={asThirdPerson} onChange={(e) => setAsThirdPerson(e.target.checked)} />
          Add as 3rd person instead of an empty seat
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <Mail size={14} className="text-black/40" />
          Email the new room/passkey
        </label>
      </div>

      {error && <p className="text-red-600 text-xs mb-3">{error}</p>}
      {done && (
        <p className="text-[#2E6B2A] text-xs mb-3 flex items-center gap-1">
          <CheckCircle2 size={13} /> Reassigned
        </p>
      )}

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full rounded-xl bg-black text-white py-2.5 text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {submitting && <Loader2 size={14} className="animate-spin" />}
        Reassign
      </button>
    </div>
  );
}
