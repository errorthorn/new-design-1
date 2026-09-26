"use client";

import { motion } from "framer-motion";
import { Mic, ClipboardList, TrendingUp } from "lucide-react";

const steps = [
  {
    title: "AI scores your practice",
    body: "Every practice session gets scored as you speak — fluency, grammar, pronunciation — so nothing slips by unnoticed.",
    icon: Mic,
  },
  {
    title: "Your mentor scores the mock test",
    body: "A real expert mentor scores your weekly mock test, and that week's live class is built around what's actually holding you back — not a fixed curriculum.",
    icon: ClipboardList,
  },
  {
    title: "You watch the score move",
    body: "Track your band score climb week over week on your performance page — real proof, not a feeling.",
    icon: TrendingUp,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative overflow-hidden bg-ink px-6 py-20 md:py-28">
      {/* two soft green blooms, pulled further to the edges and toned down
          so they read as ambient light, not a wash over everything */}
      <div className="pointer-events-none absolute -left-32 top-0 h-72 w-72 rounded-full bg-leaf-500/[0.07] blur-[110px]" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-72 w-72 rounded-full bg-leaf-500/[0.07] blur-[110px]" />

      <div className="relative mx-auto max-w-6xl">
        <div className="max-w-xl">
          <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-500">
            The method
          </span>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-cream md:text-4xl">
            How you actually improve.
          </h2>
        </div>

        <div className="relative mt-16 grid gap-x-8 gap-y-14 md:grid-cols-3">
          {/* dashed connector line — desktop only, sits behind the circles */}
          <div className="pointer-events-none absolute left-[16.5%] right-[16.5%] top-16 hidden border-t border-dashed border-leaf-500/25 md:block" />

          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, filter: "blur(8px)", y: 20 }}
              whileInView={{ opacity: 1, filter: "blur(0px)", y: 0 }}
              viewport={{ once: false, margin: "-60px" }}
              transition={{ duration: 0.4, delay: i * 0.12, ease: "easeOut" }}
              className="relative flex flex-col items-center text-center"
            >
              <div className="relative flex h-32 w-32 shrink-0 items-center justify-center rounded-full bg-black/25 ring-1 ring-leaf-500/30 shadow-[0_0_45px_-10px_rgba(107,203,63,0.45)]">
                <step.icon size={40} className="text-leaf-500" strokeWidth={1.75} />
              </div>

              <h3 className="mt-6 font-display text-lg font-semibold text-cream">
                {step.title}
              </h3>
              <p className="mt-2 max-w-xs font-body text-sm leading-relaxed text-cream/60">
                {step.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

