"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "What actually happens in the problem-solving class?",
    a: "Your mentor starts from the mistakes your mock test and practice sessions flagged that week — grammar, pronunciation, fluency, vocabulary, coherence — and builds the whole live class around fixing exactly those. It's not a generic lesson; it's whatever is actually holding your speaking back that week, worked through live with an expert mentor until it's resolved.",
  },
  {
    q: "How does the weekly mock test work?",
    a: "Every week you sit a full speaking mock test, live. It's scored on band-score criteria and reviewed by a mentor, so you get an actual score plus feedback — not just a pass or fail.",
  },
  {
    q: "What happens after a practice session?",
    a: "AI scores your speaking as you talk — fluency, grammar, pronunciation. Anything that comes up repeatedly gets added to your mistake log automatically, so it's ready for your next mentor class.",
  },
  {
    q: "How does the Buy 1 Get 1 offer on Pro work?",
    a: "Pay for one month of Pro and you get two months of access — the extra month is added to your account automatically, no promo code needed.",
  },
  {
    q: "What if I'm a complete beginner?",
    a: "That's fine — there's no fixed syllabus to catch up on. You start with today's topic like everyone else, and your mentor class adjusts to whatever you're actually struggling with.",
  },
  {
    q: "Are the live mentor classes recorded?",
    a: "Yes. Every weekly class comes with a recording and a slide PDF, so you can revisit it anytime — even if you couldn't join live.",
  },
  {
    q: "Can I compete with other members?",
    a: "Yes — the leaderboard ranks you against other members as you practice, and Vocab Battle lets you go head-to-head on vocabulary rounds.",
  },
];

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="relative overflow-hidden bg-ink px-6 py-20 md:py-28">
      {/* ambient blooms, same family as the other dark sections */}
      <div className="pointer-events-none absolute -left-24 top-0 h-96 w-96 rounded-full bg-[#7ED856]/10 blur-[110px]" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-[#7ED856]/10 blur-[110px]" />

      <div className="relative mx-auto max-w-3xl text-center">
        <span className="inline-flex items-center rounded-pill bg-leaf-500 px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wider text-ink">
          FAQ
        </span>
        <h2 className="mx-auto mt-4 font-display text-3xl font-extrabold tracking-tight text-cream md:text-4xl">
          Common questions
        </h2>
      </div>

      <div className="relative mx-auto mt-12 flex max-w-3xl flex-col gap-3">
        {faqs.map((item, i) => {
          const isOpen = openIndex === i;
          return (
            <motion.div
              key={item.q}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: false, margin: "-60px" }}
              transition={{ duration: 0.35, delay: Math.min(i, 6) * 0.05, ease: "easeOut" }}
              className="overflow-hidden rounded-2xl border border-cream/10 bg-white/[0.03]"
            >
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : i)}
                aria-expanded={isOpen}
                className={
                  "flex w-full items-center justify-between gap-4 px-6 py-5 text-left " +
                  (isOpen ? "border-b border-leaf-500/35" : "")
                }
              >
                <span className="font-display text-sm font-bold text-cream md:text-base">
                  {item.q}
                </span>
                <ChevronDown
                  size={18}
                  className={
                    "shrink-0 text-cream/50 transition-transform duration-300 " +
                    (isOpen ? "rotate-180" : "")
                  }
                />
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <p className="px-6 pb-5 pt-4 font-body text-sm leading-relaxed text-cream/60">
                      {item.a}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
