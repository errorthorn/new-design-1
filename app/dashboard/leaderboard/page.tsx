"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Trophy,
  Medal,
  Star,
  Crown,
  RefreshCw,
  Calendar,
  Swords,
} from "lucide-react";

type RankingEntry = {
  id: number;
  rank: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  isMember: boolean;
  attempts: number;
  avgBand: number | null;
  score: number;
};

type Period = "weekly" | "monthly" | "all";

const PERIOD_LABEL: Record<Period, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  all: "All Time",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function PersonAvatar({
  name,
  avatarUrl,
  size = 40,
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- may be an external (Google) URL
      <img
        src={avatarUrl}
        alt=""
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover ring-1 ring-ink/10 dark:ring-cream/10"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="grid shrink-0 place-items-center rounded-full border border-leaf-600 bg-white font-body font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500"
    >
      {initials(name)}
    </div>
  );
}

const RANK_STYLE: Record<number, { icon: typeof Trophy; bg: string; fg: string }> = {
  1: { icon: Trophy, bg: "bg-amber-100 dark:bg-amber-500/15", fg: "text-amber-600 dark:text-amber-400" },
  2: { icon: Medal, bg: "bg-slate-200 dark:bg-slate-400/15", fg: "text-slate-500 dark:text-slate-300" },
  3: { icon: Star, bg: "bg-orange-100 dark:bg-orange-500/15", fg: "text-orange-600 dark:text-orange-400" },
};

// Rank-specific "metal" accents used on the podium — gold / silver / bronze.
// Kept separate from RANK_STYLE (which drives the compact list badges).
const PODIUM_ACCENT: Record<
  1 | 2 | 3,
  {
    ring: string;
    bar: string;
    glowFill: string;
    glow: string;
    badgeBg: string;
    nameText: string;
    pillBg: string;
    pillBorder: string;
    crown: boolean;
  }
> = {
  1: {
    ring: "from-amber-300 via-yellow-400 to-amber-600",
    bar: "from-amber-300 via-amber-500 to-amber-800/90 dark:from-amber-400 dark:via-amber-700 dark:to-[#160b02]",
    glowFill: "bg-amber-400/50",
    glow: "shadow-[0_0_36px_-8px_rgba(245,158,11,0.65)]",
    badgeBg: "bg-gradient-to-br from-amber-400 to-amber-600",
    nameText: "text-amber-700 dark:text-amber-400",
    pillBg: "bg-amber-50 dark:bg-night/70",
    pillBorder: "border-amber-300/80 dark:border-amber-400/40",
    crown: true,
  },
  2: {
    ring: "from-slate-300 via-slate-400 to-slate-500",
    bar: "from-slate-300 via-slate-500 to-slate-800/90 dark:from-slate-400 dark:via-slate-700 dark:to-[#0a0e14]",
    glowFill: "bg-slate-400/40",
    glow: "shadow-[0_0_26px_-8px_rgba(100,116,139,0.45)]",
    badgeBg: "bg-gradient-to-br from-slate-400 to-slate-600",
    nameText: "text-slate-600 dark:text-slate-300",
    pillBg: "bg-slate-50 dark:bg-night/70",
    pillBorder: "border-slate-300/80 dark:border-slate-400/40",
    crown: false,
  },
  3: {
    ring: "from-orange-300 via-orange-400 to-orange-600",
    bar: "from-orange-300 via-orange-500 to-orange-800/90 dark:from-orange-400 dark:via-orange-700 dark:to-[#1a0a02]",
    glowFill: "bg-orange-400/40",
    glow: "shadow-[0_0_26px_-8px_rgba(234,88,12,0.45)]",
    badgeBg: "bg-gradient-to-br from-orange-400 to-orange-600",
    nameText: "text-orange-700 dark:text-orange-400",
    pillBg: "bg-orange-50 dark:bg-night/70",
    pillBorder: "border-orange-300/80 dark:border-orange-400/40",
    crown: false,
  },
};

function RankBadge({ rank }: { rank: number }) {
  const style = RANK_STYLE[rank];
  if (!style) {
    return (
      <span className="grid h-8 w-8 place-items-center font-body text-sm font-semibold text-ink-soft dark:text-cream/50">
        {rank}
      </span>
    );
  }
  const Icon = style.icon;
  return (
    <span className={`grid h-8 w-8 place-items-center rounded-full ${style.bg} ${style.fg}`}>
      <Icon size={16} />
    </span>
  );
}

function PodiumSpot({ entry, place }: { entry: RankingEntry; place: 1 | 2 | 3 }) {
  // Shorter, more proportionate risers — matches a realistic podium rather
  // than tall flat blocks. Difference between 1st/2nd/3rd stays readable
  // without any one bar dominating the card.
  const heights: Record<1 | 2 | 3, string> = {
    1: "h-24 sm:h-28",
    2: "h-20 sm:h-24",
    3: "h-16 sm:h-20",
  };
  const widths: Record<1 | 2 | 3, string> = {
    1: "w-24 sm:w-28",
    2: "w-20 sm:w-24",
    3: "w-20 sm:w-24",
  };
  const avatarSize = place === 1 ? 76 : 56;
  const accent = PODIUM_ACCENT[place];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: place === 1 ? 0 : place === 2 ? 0.08 : 0.16 }}
      className={`flex flex-col items-center ${place === 1 ? "" : "mt-7"}`}
    >
      <div className="relative">
        {accent.crown && (
          <motion.div
            animate={{ y: [0, -5, 0], rotate: [-6, 6, -6] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-7 left-1/2 -translate-x-1/2 drop-shadow-[0_2px_6px_rgba(245,158,11,0.55)]"
          >
            <Crown size={26} className="text-amber-400" fill="currentColor" />
          </motion.div>
        )}
        <div
          className={`relative rounded-full bg-gradient-to-br p-[3px] ${accent.ring} ${accent.glow}`}
        >
          <div className="rounded-full bg-cream-soft p-[2px] dark:bg-night-soft">
            <PersonAvatar name={entry.name} avatarUrl={entry.avatarUrl} size={avatarSize} />
          </div>
        </div>
        <span
          className={`absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold text-white ring-2 ring-cream-soft dark:ring-night-soft ${accent.badgeBg}`}
        >
          {place}
        </span>
      </div>
      <p className="mt-2.5 max-w-[104px] truncate text-center font-body text-sm font-semibold">
        {entry.name}
      </p>
      <span
        className={`mt-1 inline-flex items-center rounded-pill border px-2.5 py-0.5 font-body text-xs font-semibold ${accent.pillBorder} ${accent.pillBg} ${accent.nameText}`}
      >
        Band {entry.avgBand?.toFixed(1)}
      </span>
      <div className={`relative mt-3 ${widths[place]}`}>
        {/* diffuse halo bleeding out from behind the riser — bigger and
            softer than a top-edge strip, so it glows like a light source
            sitting behind the box rather than a stroke along one edge */}
        <div
          className={`pointer-events-none absolute -inset-x-3 -top-6 h-16 rounded-full blur-2xl ${accent.glowFill}`}
        />
        <div
          className={`relative overflow-hidden rounded-t-[28px] bg-gradient-to-b ${heights[place]} ${accent.bar}`}
        >
          {/* inner highlight near the top so the box itself looks lit,
              not just the area around it */}
          <div
            className={`pointer-events-none absolute inset-x-2 -top-3 h-8 rounded-full blur-lg ${accent.glowFill}`}
          />
        </div>
      </div>
    </motion.div>
  );
}

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<Period>("weekly");
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((p: Period, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    fetch(`/api/leaderboard?period=${p}`)
      .then((res) => res.json())
      .then((data) => {
        setRankings(data.rankings ?? []);
        setCurrentUserId(data.currentUserId ?? null);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    load(period);
  }, [period, load]);

  const top3 = rankings.slice(0, 3);
  const first = top3.find((r) => r.rank === 1);
  const second = top3.find((r) => r.rank === 2);
  const third = top3.find((r) => r.rank === 3);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            Leaderboard
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

      <div className="mt-6 grid grid-cols-1 items-start gap-5 lg:grid-cols-[380px_1fr]">
        {/* Hall of Fame */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="relative overflow-hidden rounded-2xl border border-ink/10 bg-cream-soft p-6 shadow-sm dark:border-night-border dark:bg-night-deep"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-amber-400/10 via-transparent to-transparent"
          />
          <div className="relative flex flex-col items-center text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md shadow-amber-500/30">
              <Trophy size={22} />
            </div>
            <h2 className="mt-3 font-display text-lg font-semibold">Hall of Fame</h2>
            <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/50">
              Top performers · {PERIOD_LABEL[period]}
            </p>
          </div>

          {loading ? (
            <p className="mt-10 pb-6 text-center font-body text-sm text-ink-soft dark:text-cream/50">
              Loading…
            </p>
          ) : !first ? (
            <div className="mt-10 flex flex-col items-center gap-2 pb-6 text-center">
              <Swords size={22} className="text-ink-soft/30 dark:text-cream/20" />
              <p className="font-body text-sm text-ink-soft dark:text-cream/50">
                No rankings yet.
              </p>
              <p className="max-w-[220px] font-body text-xs text-ink-soft/70 dark:text-cream/30">
                Complete a graded Mock Test to claim the top spot!
              </p>
            </div>
          ) : (
            <div className="mt-8 flex items-end justify-center gap-3 pb-2">
              {second ? <PodiumSpot entry={second} place={2} /> : <div className="w-16 sm:w-20" />}
              <PodiumSpot entry={first} place={1} />
              {third ? <PodiumSpot entry={third} place={3} /> : <div className="w-16 sm:w-20" />}
            </div>
          )}
        </motion.div>

        {/* Rankings table */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.05 }}
          className="rounded-2xl border border-ink/10 bg-cream-soft dark:border-night-border dark:bg-night-soft"
        >
          <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4 dark:border-night-border">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-leaf-600 dark:text-leaf-500" />
              <h3 className="font-display text-base font-semibold">Rankings</h3>
            </div>
            <span className="rounded-pill bg-ink/5 px-2.5 py-1 font-body text-[11px] font-medium text-ink-soft dark:bg-night dark:text-cream/50">
              Top {rankings.length || 10} students
            </span>
          </div>

          {loading ? (
            <p className="px-5 py-14 text-center font-body text-sm text-ink-soft dark:text-cream/50">
              Loading…
            </p>
          ) : rankings.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <Trophy size={24} className="text-ink-soft/30 dark:text-cream/20" />
              <p className="font-body text-sm text-ink-soft dark:text-cream/50">
                No rankings for this period yet.
              </p>
              <p className="font-body text-xs text-ink-soft/70 dark:text-cream/30">
                Be the first — complete a graded Mock Test!
              </p>
            </div>
          ) : (
            <>
              {/* Column headers — desktop only */}
              <div className="hidden grid-cols-[56px_1fr_110px_120px_100px] items-center gap-3 px-5 pb-2 pt-3 font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft/70 dark:text-cream/40 sm:grid">
                <span>Rank</span>
                <span>Student</span>
                <span>Attempts</span>
                <span>Avg Band</span>
                <span className="text-right">Score</span>
              </div>

              <ul className="divide-y divide-ink/10 dark:divide-night-border">
                {rankings.map((r) => {
                  const isYou = r.id === currentUserId;
                  return (
                    <li
                      key={r.id}
                      className={`grid grid-cols-[56px_1fr_auto] items-center gap-3 border-l-2 px-5 py-3.5 sm:grid-cols-[56px_1fr_110px_120px_100px] ${
                        isYou
                          ? "border-leaf-500 bg-leaf-50 dark:bg-leaf-500/10"
                          : r.rank === 1
                            ? "border-amber-400 bg-amber-500/[0.04]"
                            : r.rank === 2
                              ? "border-slate-400 bg-slate-500/[0.04]"
                              : r.rank === 3
                                ? "border-orange-400 bg-orange-500/[0.04]"
                                : "border-transparent"
                      }`}
                    >
                      <RankBadge rank={r.rank} />

                      <div className="flex min-w-0 items-center gap-2.5">
                        <PersonAvatar name={r.name} avatarUrl={r.avatarUrl} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-body text-sm font-medium">
                              {r.name}
                            </span>
                            {isYou && (
                              <span className="shrink-0 rounded-pill border border-leaf-600 bg-white px-1.5 py-0.5 font-body text-[10px] font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
                                You
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <span className="hidden font-body text-sm text-ink-soft dark:text-cream/60 sm:inline">
                        {r.attempts}
                      </span>
                      <span className="hidden font-body text-sm text-ink-soft dark:text-cream/60 sm:inline">
                        {r.avgBand !== null ? r.avgBand.toFixed(1) : "—"}
                      </span>
                      <span
                        className={`justify-self-end rounded-pill px-3 py-1 text-center font-body text-sm font-semibold sm:text-right ${
                          r.rank === 1
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                            : r.rank === 2
                              ? "bg-slate-200 text-slate-600 dark:bg-slate-400/15 dark:text-slate-300"
                              : r.rank === 3
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400"
                                : "bg-ink/5 text-ink-soft dark:bg-night dark:text-cream/60"
                        }`}
                      >
                        {r.avgBand !== null ? r.avgBand.toFixed(1) : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </motion.div>
      </div>

      <p className="mt-4 font-body text-xs text-ink-soft/60 dark:text-cream/30">
        Ranked by average Mock Test band (IELTS speaking, 0–9), across attempts a
        teacher has graded in the selected period.
      </p>
    </div>
  );
}
