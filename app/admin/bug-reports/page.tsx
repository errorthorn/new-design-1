"use client";

import { useEffect, useState } from "react";

type Report = {
  id: number;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  page_url: string | null;
  status: "open" | "in_progress" | "resolved" | "wont_fix";
  developer_notes: string | null;
  created_at: string;
  updated_at: string;
  reporter_name: string | null;
  reporter_email: string;
};

const STATUS_OPTIONS: Report["status"][] = ["open", "in_progress", "resolved", "wont_fix"];
const STATUS_LABEL: Record<Report["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  wont_fix: "Won't Fix",
};
const STATUS_COLOR: Record<Report["status"], string> = {
  open: "bg-yellow-100 text-yellow-700",
  in_progress: "bg-blue-100 text-blue-700",
  resolved: "bg-[#E4F4DD] text-[#2E6B2A]",
  wont_fix: "bg-black/10 text-black/50",
};

export default function AdminBugReportsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [notesDraft, setNotesDraft] = useState<Record<number, string>>({});

  async function load(currentSecret: string) {
    setError(null);
    try {
      const res = await fetch("/api/admin/bug-reports", {
        headers: { "x-admin-secret": currentSecret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setReports(data.reports);
    } catch {
      setError("There was a problem loading.");
    }
  }

  useEffect(() => {
    if (unlocked) load(secret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function updateReport(id: number, patch: { status?: string; developerNotes?: string }) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/bug-reports/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setReports((prev) =>
        prev
          ? prev.map((r) =>
              r.id === id
                ? {
                    ...r,
                    ...(patch.status ? { status: patch.status as Report["status"] } : {}),
                    ...(patch.developerNotes !== undefined ? { developer_notes: patch.developerNotes } : {}),
                  }
                : r
            )
          : prev
      );
    } finally {
      setBusyId(null);
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

  const visible =
    reports?.filter((r) => (filter === "open" ? r.status === "open" || r.status === "in_progress" : true)) ?? [];

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-12 flex justify-center">
      <div className="w-full max-w-3xl">
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
          <a href="/admin/study-materials" className="underline text-black/50">
            Study Materials
          </a>
          <a href="/admin/testimonials" className="underline text-black/50">
            Testimonials
          </a>
          <a href="/admin/speaking-club" className="underline text-black/50">
            Speaking Club
          </a>
          <a href="/admin/mock-test" className="underline text-black/50">
            Mock Test
          </a>
          <a href="/admin/quiz" className="underline text-black/50">
            Quiz
          </a>
          <a href="/admin/classes" className="underline text-black/50">
            Classes
          </a>
          <a href="/admin/payments" className="underline text-black/50">
            Payments
          </a>
          <a href="/admin/referrals" className="underline text-black/50">
            Referrals
          </a>
          <span className="font-semibold">Bug Reports</span>
        </div>

        <h1 className="text-2xl font-bold mb-2">Bug Reports</h1>
        <p className="text-sm text-black/60 mb-6">
          Bugs students report from /dashboard/report-bug show up here. Update the status and leave
          developer notes — students see the notes and status on their own report page.
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setFilter("open")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              filter === "open" ? "bg-black text-white" : "bg-white border border-black/10 text-black/60"
            }`}
          >
            Open
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              filter === "all" ? "bg-black text-white" : "bg-white border border-black/10 text-black/60"
            }`}
          >
            All
          </button>
        </div>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {reports === null && !error && <p className="text-sm text-black/50">Loading...</p>}

        {reports !== null && visible.length === 0 && (
          <p className="text-sm text-black/50">
            {filter === "open" ? "No open bugs right now." : "No bug reports have been submitted yet."}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {visible.map((r) => (
            <div key={r.id} className="bg-white rounded-xl border border-black/10 p-5">
              <div className="flex items-center justify-between mb-2 gap-3">
                <p className="font-semibold">{r.title}</p>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${STATUS_COLOR[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>

              <p className="text-xs text-black/40 mb-3">
                {r.reporter_name || r.reporter_email} · {r.reporter_email} ·{" "}
                <span className="capitalize">{r.severity}</span> severity ·{" "}
                {new Date(r.created_at).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" })}
              </p>

              <p className="text-sm text-black/70 whitespace-pre-wrap mb-3">{r.description}</p>

              {r.page_url && (
                <p className="text-xs text-black/40 mb-3 truncate">Reported on: {r.page_url}</p>
              )}

              <div className="flex flex-wrap gap-2 mb-3">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateReport(r.id, { status: s })}
                    disabled={busyId === r.id || r.status === s}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                      r.status === s ? STATUS_COLOR[s] : "bg-white border border-black/10 text-black/60"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>

              <label className="block">
                <span className="text-xs font-medium text-black/50">Developer notes (visible to student)</span>
                <textarea
                  value={notesDraft[r.id] ?? r.developer_notes ?? ""}
                  onChange={(e) => setNotesDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-black/10 px-3 py-2 text-sm"
                  placeholder="e.g. Fixed in the latest deploy — let us know if it happens again."
                />
              </label>
              <button
                onClick={() => updateReport(r.id, { developerNotes: notesDraft[r.id] ?? r.developer_notes ?? "" })}
                disabled={busyId === r.id}
                className="mt-2 rounded-full bg-black text-white px-4 py-1.5 text-xs font-semibold disabled:opacity-60"
              >
                Save Notes
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
