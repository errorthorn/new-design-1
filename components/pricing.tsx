"use client";

import { motion } from "framer-motion";
import { Check, Crown, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

const features = [
  "Daily Practice with a Partner",
  "Topic-wise Vocabulary",
  "Weekly Mock Tests",
  "Personalized Mentor Feedback",
  "Problem-Solving Classes",
  "Speaking Contest",
];

const PLAN_AMOUNT = 399;
const PLAN_STRIKETHROUGH = 1000;
const DISCOUNT_PERCENT = Math.round(((PLAN_STRIKETHROUGH - PLAN_AMOUNT) / PLAN_STRIKETHROUGH) * 100);

export function Pricing() {
  return (
    <section id="pricing" className="relative overflow-hidden px-6 pb-24">
      <div className="relative mx-auto max-w-6xl text-center">
        <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-600">
          Membership
        </span>
        <h2 className="mx-auto mt-3 max-w-xl font-display text-3xl font-extrabold tracking-tight text-ink md:text-4xl">
          One plan. Everything included.
        </h2>
        <p className="mx-auto mt-3 max-w-md font-body text-ink-soft">
          No tiers to compare, no features locked away — Pro Plus gets you
          the whole club.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, filter: "blur(8px)", scale: 0.85 }}
        whileInView={{ opacity: 1, filter: "blur(0px)", scale: 1 }}
        viewport={{ once: false }}
        transition={{ duration: 0.5, ease: "backOut" }}
        className="relative mx-auto mt-12 max-w-md overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#223318] to-[#15170F] px-8 py-12 text-center shadow-[0_40px_80px_-20px_rgba(21,23,15,0.55)]"
      >
        {/* two soft green blooms living inside the card itself, same
            treatment as the site's other premium dark cards */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-[#7ED856]/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-[#7ED856]/10 blur-3xl" />

        {/* faint dot grid for texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: "radial-gradient(circle, #FCFAF1 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />

        <div className="relative flex flex-col items-center gap-5">
          <span className="inline-flex items-center gap-2 rounded-pill bg-cream/10 px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wider text-leaf-500 ring-1 ring-inset ring-leaf-500/30">
            <Crown size={13} />
            Pro Plus
          </span>

          <div className="flex items-end gap-2.5">
            <span className="font-display text-lg font-semibold text-cream/40 line-through">
              ৳{PLAN_STRIKETHROUGH}
            </span>
            <span className="rounded-pill bg-leaf-600 px-2.5 py-1 font-display text-xs font-bold text-white">
              {DISCOUNT_PERCENT}% OFF
            </span>
          </div>

          <div className="-mt-2 flex items-end gap-1.5">
            <span className="font-display text-2xl font-bold text-cream/70">
              ৳
            </span>
            <span className="font-display text-6xl font-extrabold leading-none tracking-tight text-cream">
              {PLAN_AMOUNT}
            </span>
            <span className="pb-1.5 font-body text-sm text-cream/50">
              / 3 months
            </span>
          </div>

          <ul className="mt-2 flex w-full flex-col gap-3 text-left">
            {features.map((feature) => (
              <li key={feature} className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-leaf-500/15">
                  <Check size={12} className="text-leaf-500" strokeWidth={3} />
                </span>
                <span className="font-body text-sm text-cream/85">
                  {feature}
                </span>
              </li>
            ))}
          </ul>

          <a
            href="/payment"
            className={buttonVariants({ variant: "accent", size: "lg" }) + " mt-4 w-full gap-2.5 shadow-lg shadow-black/20"}
          >
            Get started
            <ArrowRight size={16} />
          </a>
        </div>
      </motion.div>
    </section>
  );
}
