"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy,
  ListChecks,
  Clock,
  Flame,
  Calendar,
  RefreshCw,
  TrendingUp,
  MessagesSquare,
  ChevronDown,
  Loader2,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

type Period = "weekly" | "monthly" | "all";

const PERIOD_LABEL: Record<Period, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  all: "All Time",
};

type SpeakingClubFeedbackItem = {
  id: string;
  created_at: string;
  status: "pending" | "processing" | "done" | "failed";
  feedback_summary: string | null;
  mistake_count: number;
};

type PerformanceData = {
  rank: number | null;
  totalRanked: number;
  avgBand: number | null;
  totalAttempts: number;
  breakdown: { quiz: number; mockTest: number; vocabBattle: number };
  timeSpentSeconds: number;
  currentStreakDays: number;
  trend: { date: string; band: number }[];
  speakingClubFeedback: SpeakingClubFeedbackItem[];
};

function formatTimeSpent(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0 && minutes === 0) return "0m";
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Trophy;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft">
      <div className="flex items-center gap-2 font-body text-xs font-medium text-ink-soft dark:text-cream/50">
        <Icon size={14} />
        {label}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight">{value}</p>
      {sub && (
        <p className="mt-0.5 font-body text-xs text-ink-soft/70 dark:text-cream/30">{sub}</p>
      )}
    </div>
  );
}

function formatFeedbackDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// AI Feedback plan §6 Phase E.2 — "Recent Speaking Club Feedback" card.
// Own card, matching the trend chart's motion.div + rounded-card style
// above rather than reusing StatCard (this needs an expandable list, not
// a single stat). Deliberately doesn't touch the 4 StatCards or the Mock
// Test trend chart above it.
function SpeakingClubFeedbackCard({ items }: { items: SpeakingClubFeedbackItem[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 }}
      className="mt-5 rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft"
    >
      <div className="flex items-center gap-2">
        <MessagesSquare size={16} className="text-leaf-600 dark:text-leaf-500" />
        <h3 className="font-display text-base font-semibold">Recent Speaking Club Feedback</h3>
      </div>
      <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/50">
        Automatic AI feedback from your last few Speaking Club sessions
      </p>

      {items.length === 0 ? (
        <p className="mt-8 pb-2 text-center font-body text-sm text-ink-soft dark:text-cream/50">
          No Speaking Club feedback yet — it appears here automatically after your next session.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => {
            const isOpen = expandedId === item.id;
            const isReady = item.status === "done";
            return (
              <li key={item.id} className="rounded-xl border border-ink/10 dark:border-night-border">
                <button
                  onClick={() => isReady && setExpandedId(isOpen ? null : item.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  aria-expanded={isOpen}
                  disabled={!isReady}
                >
                  <div className="min-w-0">
                    <p className="font-body text-xs font-medium text-ink-soft dark:text-cream/50">
                      {formatFeedbackDate(item.created_at)}
                    </p>
                    {isReady ? (
                      <p className="mt-0.5 truncate font-body text-sm text-ink dark:text-cream">
                        {item.feedback_summary}
                      </p>
                    ) : item.status === "failed" ? (
                      <p className="mt-0.5 font-body text-sm text-ink-soft dark:text-cream/50">
                        Feedback couldn&apos;t be generated for this session.
                      </p>
                    ) : (
                      <p className="mt-0.5 flex items-center gap-1.5 font-body text-sm text-ink-soft dark:text-cream/50">
                        <Loader2 size={12} className="animate-spin" />
                        Feedback is being prepared — usually ready within 30 minutes.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isReady && (
                      <span className="rounded-pill bg-leaf-100 px-2 py-0.5 font-body text-[11px] font-medium text-leaf-700 dark:bg-night-border dark:text-leaf-500">
                        {item.mistake_count} {item.mistake_count === 1 ? "mistake" : "mistakes"}
                      </span>
                    )}
                    {isReady && (
                      <ChevronDown
                        size={16}
                        className={`text-ink-soft transition-transform dark:text-cream/50 ${isOpen ? "rotate-180" : ""}`}
                      />
                    )}
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="border-t border-ink/10 px-4 py-3 font-body text-sm text-ink-soft dark:border-night-border dark:text-cream/70">
                        {item.feedback_summary}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}

export default function PerformancePage() {
  const [period, setPeriod] = useState<Period>("weekly");
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((p: Period, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    fetch(`/api/performance?period=${p}`)
      .then((res) => res.json())
      .then((d) => setData(d))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  const trendData = (data?.trend ?? []).map((t) => ({ date: t.date.slice(5), band: t.band }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            Performance
          </h1>
          <button
            onClick={() => load(period, true)}
            aria-label="Refresh"
            className="grid h-8 w-8 place-items-center rounded-full text-ink-soft hover:bg-leaf-100 hover:text-ink dark:text-cream/50 dark:hover:bg-night-soft dark:hover:text-cream"
          >
            <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>

        <label className="flex items-center gap-2 font-body text-sm text-ink-soft dark:text-cream/60">
          <Calendar size={15} />
          Time Period:
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="rounded-pill border border-ink/10 bg-cream-soft px-3 py-1.5 font-body text-sm font-medium text-ink dark:border-night-border dark:bg-night-soft dark:text-cream"
          >
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="all">All Time</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p className="mt-10 text-center font-body text-sm text-ink-soft dark:text-cream/50">
          Loading…
        </p>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              icon={Trophy}
              label="Your Rank"
              value={data?.rank ? `#${data.rank}` : "—"}
              sub={
                data?.rank
                  ? `of ${data.totalRanked} · avg band ${data.avgBand?.toFixed(1)}`
                  : "Complete a graded Mock Test to get ranked"
              }
            />
            <StatCard
              icon={ListChecks}
              label="Attempts"
              value={String(data?.totalAttempts ?? 0)}
              sub={`Quiz ${data?.breakdown.quiz ?? 0} · Mock ${data?.breakdown.mockTest ?? 0} · Battle ${data?.breakdown.vocabBattle ?? 0}`}
            />
            <StatCard
              icon={Clock}
              label="Time Spent"
              value={formatTimeSpent(data?.timeSpentSeconds ?? 0)}
              sub={PERIOD_LABEL[period]}
            />
            <StatCard
              icon={Flame}
              label="Active Streak"
              value={`${data?.currentStreakDays ?? 0} ${data?.currentStreakDays === 1 ? "Day" : "Days"}`}
              sub="Any activity, consecutive days"
            />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mt-5 rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft"
          >
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-leaf-600 dark:text-leaf-500" />
              <h3 className="font-display text-base font-semibold">Mock Test Trend</h3>
            </div>
            <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/50">
              Graded speaking band over time
            </p>

            {trendData.length >= 2 ? (
              <div className="mt-4 h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: "#3A3D30" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 9]}
                      tick={{ fontSize: 11, fill: "#3A3D30" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(v: number) => [v.toFixed(1), "Band"]}
                      contentStyle={{ fontSize: 12, borderRadius: 10, borderColor: "#e5e0d0" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="band"
                      stroke="#4C9E2C"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#4C9E2C" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="mt-10 pb-4 text-center font-body text-sm text-ink-soft dark:text-cream/50">
                Complete at least 2 graded Mock Tests to see your trend.
              </p>
            )}
          </motion.div>

          <SpeakingClubFeedbackCard items={data?.speakingClubFeedback ?? []} />

          <p className="mt-4 font-body text-xs text-ink-soft/60 dark:text-cream/30">
            Rank and trend are based on graded Mock Test bands. Attempts and time spent count
            Quiz, Mock Test, and Vocab Battle together; Speaking Club call time is included in
            Time Spent where available.
          </p>
        </>
      )}
    </div>
  );
}
