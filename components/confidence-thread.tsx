"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Step = {
  who: "you" | "coach";
  text: string;
};

const steps: Step[] = [
  { who: "you", text: "···" },
  { who: "you", text: "Umm... how do I even say this?" },
  { who: "coach", text: "Just start. I've got you." },
  { who: "you", text: "I think... I can say this now." },
  { who: "coach", text: "That's it. Say it like you mean it." },
  { who: "you", text: "I can speak English. For real." },
];

export function ConfidenceThread() {
  const [visible, setVisible] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible((v) => (v >= steps.length ? 1 : v + 1));
    }, 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="relative flex h-[420px] w-full max-w-sm flex-col justify-end gap-3 overflow-hidden rounded-2xl border border-ink/10 bg-cream-soft p-6 shadow-xl shadow-ink/5"
      aria-live="off"
    >
      <span className="absolute left-6 top-5 font-display text-xs font-semibold uppercase tracking-wider text-ink-soft/60">
        Live speaking room
      </span>

      <AnimatePresence initial={false}>
        {steps.slice(0, visible).map((step, i) => (
          <motion.div
            key={`${i}-${step.text}`}
            initial={{ opacity: 0, filter: "blur(8px)", y: 14, scale: 0.96 }}
            animate={{ opacity: 1, filter: "blur(0px)", y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className={
              step.who === "you"
                ? "self-start rounded-2xl rounded-bl-sm bg-white px-4 py-2.5 font-body text-sm text-ink shadow-sm"
                : "self-end rounded-2xl rounded-br-sm bg-leaf-500 px-4 py-2.5 font-body text-sm font-medium text-ink shadow-sm"
            }
          >
            {step.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
