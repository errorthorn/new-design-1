"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bug,
  Plus,
  X,
  Loader2,
  Clock,
  Wrench,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

type ReportSummary = {
  id: number;
  title: string;
  severity: "low" | "medium" | "high";
  status: "open" | "in_progress" | "resolved" | "wont_fix";
  created_at: string;
  updated_at: string;
};

type ReportDetail = ReportSummary & {
  description: string;
  page_url: string | null;
  developer_notes: string | null;
};

const STATUS_META: Record<
  ReportDetail["status"],
  { label: string; icon: typeof Clock; badgeClassName: string; dotClassName: string }
> = {
  open: {
    label: "Open",
    icon: Clock,
    badgeClassName: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
    dotClassName: "text-amber-600 dark:text-amber-400",
  },
  in_progress: {
    label: "In Progress",
    icon: Wrench,
    badgeClassName: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    dotClassName: "text-blue-600 dark:text-blue-400",
  },
  resolved: {
    label: "Resolved",
    icon: CheckCircle2,
    badgeClassName: "bg-leaf-100 text-leaf-700 dark:bg-leaf-600/20 dark:text-leaf-500",
    dotClassName: "text-leaf-700 dark:text-leaf-500",
  },
  wont_fix: {
    label: "Won't Fix",
    icon: XCircle,
    badgeClassName: "bg-ink/10 text-ink-soft dark:bg-white/10 dark:text-cream/50",
    dotClassName: "text-ink-soft dark:text-cream/50",
  },
};

const SEVERITY_META: Record<ReportDetail["severity"], { label: string; className: string }> = {
  low: { label: "Low", className: "text-ink-soft dark:text-cream/50" },
  medium: { label: "Medium", className: "text-amber-600 dark:text-amber-400" },
  high: { label: "High", className: "text-red-600 dark:text-red-400" },
};

function formatDate(iso: string) {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: ReportDetail["status"] }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-body text-xs font-semibold ${meta.badgeClassName}`}>
      <Icon size={12} />
      {meta.label}
    </span>
  );
}

export default function ReportBugPage() {
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high">("medium");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    loadList();
  }, []);

  function loadList() {
    fetch("/api/bug-reports")
      .then((res) => res.json())
      .then((data) => setReports(data.reports ?? []));
  }

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    fetch(`/api/bug-reports/${selectedId}`)
      .then((res) => res.json())
      .then((data) => setDetail(data.report ?? null))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!title.trim() || !description.trim()) {
      setFormError("Please fill in both the title and description.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/bug-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          severity,
          pageUrl: typeof window !== "undefined" ? window.location.href : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error ?? "Something went wrong, please try again.");
        return;
      }
      setModalOpen(false);
      setTitle("");
      setDescription("");
      setSeverity("medium");
      loadList();
      setSelectedId(data.id);
    } catch {
      setFormError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="font-display text-2xl font-semibold tracking-tight md:text-3xl"
      >
        Bug Reports
      </motion.h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Run into something broken? Report it here and track what happens next.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 overflow-hidden rounded-2xl border border-ink/10 dark:border-night-border md:grid-cols-[320px_1fr] md:gap-0">
        {/* List panel */}
        <div className="flex flex-col border-b border-ink/10 bg-cream-soft dark:border-night-border dark:bg-night-soft md:border-b-0 md:border-r">
          <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4 dark:border-night-border">
            <span className="flex items-center gap-2 font-display text-sm font-semibold">
              <Bug size={16} className="text-leaf-700 dark:text-leaf-500" />
              Your Reports
            </span>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="flex items-center gap-1.5 rounded-full bg-leaf-600 px-3.5 py-1.5 font-display text-xs font-semibold text-white transition-transform hover:-translate-y-0.5"
            >
              <Plus size={13} /> Report Bug
            </button>
          </div>

          <div className="max-h-[520px] overflow-y-auto">
            {reports === null ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="animate-spin text-leaf-600" size={22} />
              </div>
            ) : reports.length === 0 ? (
              <p className="px-5 py-10 text-center font-body text-sm text-ink-soft dark:text-cream/50">
                No bug reports yet.
              </p>
            ) : (
              reports.map((r) => {
                const meta = STATUS_META[r.status];
                const Icon = meta.icon;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={`flex w-full flex-col gap-1.5 border-b border-ink/5 px-5 py-3.5 text-left transition-colors dark:border-night-border/60 ${
                      selectedId === r.id
                        ? "bg-leaf-50 dark:bg-night"
                        : "hover:bg-ink/[0.03] dark:hover:bg-white/[0.03]"
                    }`}
                  >
                    <span className="font-body text-sm font-medium leading-snug">{r.title}</span>
                    <span className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 font-body text-[11px] font-semibold ${meta.dotClassName}`}>
                        <Icon size={11} />
                        {meta.label}
                      </span>
                      <span className="font-body text-[11px] text-ink-soft/60 dark:text-cream/40">
                        {formatDate(r.created_at)}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Detail panel */}
        <div className="flex min-h-[420px] flex-col bg-white dark:bg-night">
          {selectedId == null ? (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full bg-ink/5 text-ink-soft dark:bg-white/5 dark:text-cream/40">
                <Bug size={26} />
              </div>
              <p className="mt-5 font-display text-lg font-semibold">Select a Report</p>
              <p className="mt-1.5 max-w-sm font-body text-sm text-ink-soft dark:text-cream/50">
                View details, tracking status, and developer notes for your reported bugs.
              </p>
            </div>
          ) : detailLoading || !detail ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="animate-spin text-leaf-600" size={24} />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-6 md:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold">{detail.title}</h2>
                  <p className="mt-1 font-body text-xs text-ink-soft dark:text-cream/50">
                    Reported {formatDate(detail.created_at)}
                  </p>
                </div>
                <StatusBadge status={detail.status} />
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-4 font-body text-xs">
                <span className={`flex items-center gap-1.5 font-semibold ${SEVERITY_META[detail.severity].className}`}>
                  <AlertTriangle size={13} />
                  {SEVERITY_META[detail.severity].label} severity
                </span>
                {detail.page_url && (
                  <span className="truncate text-ink-soft dark:text-cream/50">
                    on {detail.page_url.replace(/^https?:\/\/[^/]+/, "")}
                  </span>
                )}
              </div>

              <div className="mt-6">
                <p className="font-display text-sm font-semibold">Description</p>
                <p className="mt-1.5 whitespace-pre-wrap font-body text-sm leading-relaxed text-ink-soft dark:text-cream/70">
                  {detail.description}
                </p>
              </div>

              {detail.developer_notes && (
                <div className="mt-6 rounded-xl border border-leaf-600/30 bg-leaf-50 p-4 dark:bg-leaf-600/10">
                  <p className="font-display text-sm font-semibold text-leaf-700 dark:text-leaf-500">
                    Developer notes
                  </p>
                  <p className="mt-1.5 whitespace-pre-wrap font-body text-sm leading-relaxed text-ink-soft dark:text-cream/70">
                    {detail.developer_notes}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Report modal */}
      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onClick={() => setModalOpen(false)}
          >
            <motion.form
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={handleSubmit}
              className="w-full max-w-md rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">Report a Bug</h2>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-full text-ink-soft hover:bg-ink/5 dark:text-cream/50 dark:hover:bg-white/10"
                >
                  <X size={16} />
                </button>
              </div>

              <label className="mt-4 flex flex-col gap-1.5">
                <span className="font-body text-sm font-medium">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="e.g. Leaderboard avatar not loading"
                  className="h-11 rounded-xl border border-ink/15 bg-white px-4 font-body text-sm outline-none focus:border-leaf-600 dark:border-night-border dark:bg-night dark:text-cream"
                />
              </label>

              <label className="mt-4 flex flex-col gap-1.5">
                <span className="font-body text-sm font-medium">What happened?</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={4000}
                  rows={4}
                  placeholder="What did you expect vs. what actually happened?"
                  className="resize-none rounded-xl border border-ink/15 bg-white px-4 py-3 font-body text-sm outline-none focus:border-leaf-600 dark:border-night-border dark:bg-night dark:text-cream"
                />
              </label>

              <div className="mt-4">
                <span className="font-body text-sm font-medium">Severity</span>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {(["low", "medium", "high"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeverity(s)}
                      className={`rounded-xl border-2 py-2 font-body text-sm font-semibold capitalize transition-colors ${
                        severity === s
                          ? "border-leaf-600 bg-leaf-50 text-leaf-700 dark:bg-leaf-600/10 dark:text-leaf-500"
                          : "border-ink/10 text-ink-soft dark:border-night-border dark:text-cream/50"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {formError && (
                <p className="mt-3 font-body text-xs font-medium text-red-600 dark:text-red-400">{formError}</p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-leaf-600 py-3 font-display text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Submitting…
                  </>
                ) : (
                  "Submit Report"
                )}
              </button>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
