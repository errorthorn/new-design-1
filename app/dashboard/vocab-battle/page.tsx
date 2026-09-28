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
} from "lucide-react";

type HistoryEntry = {
  id: number;
  mode: string;
  score: number;
  correctCount: number;
  totalWords: number;
  bestStreak: number;
  createdAt: string;
};

function timeAgo(iso: string) {
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const diffMs = Date.now() - then;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function VocabBattlePage() {
  const [highScore, setHighScore] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/vocab-battle/summary")
      .then((res) => res.json())
      .then((data) => {
        setHighScore(data.highScore ?? 0);
        setHistory(data.history ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

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
        </div>

        {/* Battle history */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.15 }}
          className="rounded-2xl border border-ink/10 bg-cream-soft dark:border-night-border dark:bg-night-soft"
        >
          <div className="flex items-center gap-2 border-b border-ink/10 px-5 py-4 dark:border-night-border">
            <Swords size={16} className="text-leaf-600 dark:text-leaf-500" />
            <h3 className="font-display text-base font-semibold">Battle History</h3>
          </div>

          {loading ? (
            <p className="px-5 py-10 text-center font-body text-sm text-ink-soft dark:text-cream/50">
              Loading…
            </p>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
              <Swords size={24} className="text-ink-soft/30 dark:text-cream/20" />
              <p className="font-body text-sm text-ink-soft dark:text-cream/50">
                No battles recorded yet.
              </p>
              <p className="font-body text-xs text-ink-soft/70 dark:text-cream/30">
                Play a game to see your history!
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-ink/10 dark:divide-night-border">
              {history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="font-body text-sm font-medium">
                      {h.mode === "live" ? "Live Multiplayer" : "Solo Challenge"}
                    </p>
                    <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/40">
                      {h.correctCount}/{h.totalWords} correct · {timeAgo(h.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-pill border border-leaf-600 bg-white px-3 py-1 font-body text-sm font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
                    {h.score}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </div>
    </div>
  );
}
