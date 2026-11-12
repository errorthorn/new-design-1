"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Swords,
  User,
  Users,
  Trophy,
  Timer,
  Sparkles,
  BookmarkCheck,
  Crown,
} from "lucide-react";

type Period = "weekly" | "monthly" | "all";

type RankRow = {
  userId: number;
  name: string;
  avatarUrl: string | null;
  isMember: boolean;
  points: number;
  games: number;
  accuracy: number;
  rank: number;
};

const PERIODS: { key: Period; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "all", label: "All time" },
];

// Gold / silver / bronze for the podium, plain number after that.
const MEDAL_CLS = [
  "border-amber-400 bg-amber-50 text-amber-700",
  "border-slate-300 bg-slate-50 text-slate-600",
  "border-orange-300 bg-orange-50 text-orange-700",
];

function RankBadge({ rank }: { rank: number }) {
  const medal = rank <= 3 ? MEDAL_CLS[rank - 1] : null;
  return (
    <span
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border font-display text-xs font-semibold tabular-nums ${
        medal ?? "border-ink/10 bg-white text-ink-soft dark:border-night-border dark:bg-night dark:text-cream/60"
      }`}
    >
      {rank === 1 ? <Crown size={14} /> : rank}
    </span>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border border-leaf-300 bg-white font-display text-sm font-semibold text-leaf-700 dark:border-night-border dark:bg-night dark:text-leaf-500">
      {initial}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
    </span>
  );
}

function RankRowItem({ row, isMe }: { row: RankRow; isMe: boolean }) {
  return (
    <li
      className={`flex items-center gap-3 px-5 py-3 ${
        isMe ? "bg-leaf-50 dark:bg-night" : ""
      }`}
    >
      <RankBadge rank={row.rank} />
      <Avatar name={row.name} url={row.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-sm font-medium">
          {row.name}
          {isMe && (
            <span className="ml-1.5 rounded-pill bg-leaf-600 px-2 py-0.5 align-middle font-body text-[10px] font-semibold uppercase tracking-wide text-cream">
              You
            </span>
          )}
        </p>
        <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/40">
          {row.games} {row.games === 1 ? "game" : "games"} · {row.accuracy}% accuracy
        </p>
      </div>
      <span className="shrink-0 rounded-pill border border-leaf-600 bg-white px-3 py-1 font-body text-sm font-semibold tabular-nums text-leaf-700 dark:bg-night dark:text-leaf-500">
        {row.points}
      </span>
    </li>
  );
}

export default function VocabBattlePage() {
  const [highScore, setHighScore] = useState(0);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<Period>("weekly");
  const [rankings, setRankings] = useState<RankRow[]>([]);
  const [me, setMe] = useState<RankRow | null>(null);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [rankLoading, setRankLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vocab-battle/summary")
      .then((res) => res.json())
      .then((data) => setHighScore(data.highScore ?? 0))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRankLoading(true);
    fetch(`/api/vocab-battle/leaderboard?period=${period}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setRankings(data.rankings ?? []);
        setMe(data.me ?? null);
        setTotalPlayers(data.totalPlayers ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setRankings([]);
        setMe(null);
        setTotalPlayers(0);
      })
      .finally(() => {
        if (!cancelled) setRankLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  return (
    <div>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="font-display text-2xl font-semibold italic tracking-tight text-leaf-700 dark:text-leaf-500 md:text-3xl"
      >
        Vocab Battle Arena
      </motion.h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Challenge your limits. Compete for glory. Master the dictionary.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        {/* Game mode cards */}
        <div className="flex flex-col gap-5">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
            className="rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
                <User size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-semibold">Solo Challenge</h2>
                <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                  Race against the clock to set new personal records.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-body text-xs text-ink-soft dark:text-cream/50">
                  <span className="flex items-center gap-1.5">
                    <Timer size={13} />
                    10s Timer
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Trophy size={13} />
                    Hi-Score{loading ? "" : `: ${highScore}`}
                  </span>
                </div>
                <Link
                  href="/dashboard/vocab-battle/solo"
                  className="mt-4 inline-flex items-center gap-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700"
                >
                  <Swords size={15} />
                  Enter Arena
                </Link>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft"
          >
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
                <Users size={22} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-semibold">Live Multiplayer</h2>
                <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
                  Real-time battles against other students. Random matchmaking or invite a friend by code.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-body text-xs text-ink-soft dark:text-cream/50">
                  <span className="flex items-center gap-1.5">
                    <Users size={13} />
                    PvP
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Sparkles size={13} />
                    Membership perk
                  </span>
                </div>
                <Link
                  href="/dashboard/vocab-battle/live"
                  className="mt-4 inline-flex items-center gap-2 rounded-pill bg-leaf-600 px-5 py-2.5 font-body text-sm font-semibold text-cream transition-colors hover:bg-leaf-700"
                >
                  <Swords size={15} />
                  Find Match
                </Link>
              </div>
            </div>
          </motion.div>

          <Link
            href="/dashboard/vocab-battle/saved"
            className="flex items-center gap-3 rounded-2xl border border-ink/10 bg-cream-soft p-5 transition-colors hover:border-leaf-600 dark:border-night-border dark:bg-night-soft"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
              <BookmarkCheck size={18} />
            </span>
            <span className="min-w-0">
              <span className="block font-display text-base font-semibold">Saved Words</span>
              <span className="block font-body text-xs text-ink-soft dark:text-cream/50">
                Words you saved after a battle, ready to revise.
              </span>
            </span>
          </Link>
        </div>

        {/* Ranking */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
          className="self-start rounded-2xl border border-ink/10 bg-cream-soft dark:border-night-border dark:bg-night-soft"
        >
          <div className="flex items-center justify-between gap-2 border-b border-ink/10 px-5 py-4 dark:border-night-border">
            <div className="flex items-center gap-2">
              <Trophy size={16} className="text-leaf-600 dark:text-leaf-500" />
              <h3 className="font-display text-base font-semibold">Leaderboard</h3>
            </div>
            {!rankLoading && totalPlayers > 0 && (
              <span className="font-body text-xs text-ink-soft dark:text-cream/40">
                {totalPlayers} {totalPlayers === 1 ? "player" : "players"}
              </span>
            )}
          </div>

          <div className="flex gap-1.5 border-b border-ink/10 px-4 py-3 dark:border-night-border">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`flex-1 rounded-pill border px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
                  period === p.key
                    ? "border-leaf-600 bg-leaf-600 text-cream"
                    : "border-leaf-300 bg-white text-ink-soft hover:bg-leaf-50 dark:border-night-border dark:bg-night dark:text-cream/60"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {rankLoading ? (
            <p className="px-5 py-10 text-center font-body text-sm text-ink-soft dark:text-cream/50">
              Loading…
            </p>
          ) : rankings.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
              <Trophy size={24} className="text-ink-soft/30 dark:text-cream/20" />
              <p className="font-body text-sm text-ink-soft dark:text-cream/50">
                No one is on the board yet.
              </p>
              <p className="font-body text-xs text-ink-soft/70 dark:text-cream/30">
                Play a round and take the #1 spot!
              </p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-ink/10 dark:divide-night-border">
                {rankings.map((r) => (
                  <RankRowItem key={r.userId} row={r} isMe={me?.userId === r.userId} />
                ))}
              </ul>

              {/* Student's own spot when it's outside the top list, or a nudge if they haven't played in this period */}
              {me && !rankings.some((r) => r.userId === me.userId) ? (
                <ul className="border-t-2 border-dashed border-ink/10 dark:border-night-border">
                  <RankRowItem row={me} isMe />
                </ul>
              ) : !me ? (
                <p className="border-t border-ink/10 px-5 py-3 text-center font-body text-xs text-ink-soft dark:border-night-border dark:text-cream/50">
                  Play a round to get on the board.
                </p>
              ) : null}
            </>
          )}

          <p className="border-t border-ink/10 px-5 py-3 font-body text-[11px] text-ink-soft/80 dark:border-night-border dark:text-cream/40">
            Ranked by total points from Solo and Live rounds.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
