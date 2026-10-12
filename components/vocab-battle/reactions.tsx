"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { REACTION_EMOJIS, type ReactionEmoji } from "@/lib/vocab-battle/rules";

// Quick emoji reactions during a live match — a tap-to-send bar plus the
// floating emoji layer that shows both your own and your opponent's.
// (The sending/receiving itself lives in lib/vocab-battle/live-channel.ts.)

export type FloatingReaction = { id: number; emoji: ReactionEmoji; mine: boolean; left: number };

export function ReactionBar({ onPick }: { onPick: (emoji: ReactionEmoji) => void }) {
  return (
    <div className="mt-6 flex items-center justify-center gap-2" aria-label="Send a reaction">
      {REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          aria-label={`Send ${emoji}`}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/10 bg-white text-lg transition-transform hover:scale-110 active:scale-95 dark:border-night-border dark:bg-night-soft"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export function FloatingReactions({ items, onExpire }: { items: FloatingReaction[]; onExpire: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] h-2/3 overflow-hidden" aria-hidden>
      <AnimatePresence>
        {items.map((r) => (
          <FloatingEmoji key={r.id} item={r} onExpire={onExpire} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function FloatingEmoji({ item, onExpire }: { item: FloatingReaction; onExpire: (id: number) => void }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setGone(true);
      onExpire(item.id);
    }, 2200);
    return () => clearTimeout(t);
  }, [item.id, onExpire]);
  if (gone) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 40, scale: 0.6 }}
      animate={{ opacity: [0, 1, 1, 0], y: -220, scale: 1.3 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 2.2, ease: "easeOut" }}
      style={{ left: `${item.left}%` }}
      className="absolute bottom-0 flex flex-col items-center"
    >
      <span className="text-4xl">{item.emoji}</span>
      <span className="mt-0.5 rounded-pill bg-ink/70 px-1.5 py-0.5 font-body text-[9px] font-semibold text-cream">
        {item.mine ? "you" : "opponent"}
      </span>
    </motion.div>
  );
}
