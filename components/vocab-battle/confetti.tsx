"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";

// One-shot celebration burst (new hi-score, battle victory). Pure CSS-ish:
// a handful of framer-motion pieces falling once, no library, and
// pointer-events-none so it never blocks a button underneath.

const COLORS = ["#22c55e", "#16a34a", "#f59e0b", "#f97316", "#38bdf8", "#e879f9"];

export function Confetti({ pieces = 42 }: { pieces?: number }) {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        duration: 1.8 + Math.random() * 1.4,
        rotate: (Math.random() - 0.5) * 900,
        drift: (Math.random() - 0.5) * 120,
        size: 6 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
      })),
    [pieces]
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
      {items.map((p) => (
        <motion.span
          key={p.id}
          initial={{ y: -20, x: 0, opacity: 1, rotate: 0 }}
          animate={{ y: "105vh", x: p.drift, opacity: [1, 1, 0], rotate: p.rotate }}
          transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
          style={{ left: `${p.left}%`, width: p.size, height: p.size * 0.6, backgroundColor: p.color }}
          className="absolute top-0 rounded-[2px]"
        />
      ))}
    </div>
  );
}
