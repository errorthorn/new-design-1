"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, ArrowRight, Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PLANS as PLAN_DATA, type PlanSlug } from "@/lib/plans";

type Period = "monthly" | "quarterly" | "half-yearly";

const PERIODS: { key: Period; label: string; discount?: number; months: number }[] = [
  { key: "monthly", label: "Monthly", months: 1 },
  { key: "quarterly", label: "Quarterly", discount: 15, months: 3 },
  { key: "half-yearly", label: "6 Months", discount: 25, months: 6 },
];

type Feature = { label: string; included: boolean };

type Plan = {
  slug: PlanSlug;
  name: string;
  basePrice: number;
  originalPrice?: number;
  features: Feature[];
  cta: string;
  popular?: boolean;
  offer?: string;
  offerNote?: string;
};

// Presentation-only wrapper around lib/plans' shared plan data — the name,
// price, and feature list all come from there (so /pricing and /payment
// can't drift apart again); cta/popular/offer copy is specific to this card
// layout and stays here.
const PLANS: Plan[] = [
  {
    slug: "starter",
    name: PLAN_DATA.starter.name,
    basePrice: PLAN_DATA.starter.price,
    cta: "Get Starter",
    features: PLAN_DATA.starter.features.map((label) => ({ label, included: true })),
  },
  {
    slug: "pro",
    name: PLAN_DATA.pro.name,
    basePrice: PLAN_DATA.pro.price,
    originalPrice: PLAN_DATA.pro.originalPrice,
    cta: "Get Pro",
    popular: true,
    offer: "Buy 1 Get 1 Free",
    offerNote: "Pay for 1 month, get 2 months of Pro",
    features: PLAN_DATA.pro.features.map((label) => ({ label, included: true })),
  },
  {
    slug: "dedicated",
    name: PLAN_DATA.dedicated.name,
    basePrice: PLAN_DATA.dedicated.price,
    cta: "Get Dedicated",
    features: PLAN_DATA.dedicated.features.map((label) => ({ label, included: true })),
  },
];

function priceForPeriod(base: number, period: Period) {
  const meta = PERIODS.find((p) => p.key === period)!;
  const discount = meta.discount ?? 0;
  const monthly = base * (1 - discount / 100);
  return Math.round(monthly);
}

export function MasteryPricing() {
  const [period, setPeriod] = useState<Period>("monthly");

  return (
    <section className="relative overflow-hidden px-4 pb-24 pt-16 md:px-6">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: "#0A0C08" }}
      />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-96 w-[36rem] -translate-x-1/2 rounded-full bg-leaf-500/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-3xl text-center">
        <span className="font-display text-xs font-bold uppercase tracking-wider text-leaf-500">
          Membership
        </span>
        <h1 className="mt-3 font-display text-3xl font-extrabold tracking-tight text-cream md:text-5xl">
          Choose your Mastery Plan
        </h1>
        <p className="mx-auto mt-3 max-w-md font-body text-cream/60">
          Pick the plan that matches how fast you want to move — upgrade or
          switch any time.
        </p>

        <div className="mx-auto mt-8 inline-flex items-center gap-1 rounded-pill border border-cream/10 bg-white/5 p-1">
          {PERIODS.map((p) => {
            const isLocked = p.key !== "monthly";
            return (
              <button
                key={p.key}
                onClick={() => {
                  if (isLocked) return;
                  setPeriod(p.key);
                }}
                disabled={isLocked}
                aria-disabled={isLocked}
                title={isLocked ? "Coming soon" : undefined}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-pill px-4 py-2 font-display text-sm font-semibold transition-colors",
                  isLocked
                    ? "cursor-not-allowed text-cream/30"
                    : period === p.key
                    ? "bg-cream text-ink"
                    : "text-cream/60 hover:text-cream"
                )}
              >
                {p.label}
                {isLocked ? (
                  <Lock size={11} className="text-cream/30" />
                ) : p.discount ? (
                  <span
                    className={cn(
                      "rounded-pill px-1.5 py-0.5 text-[10px] font-bold",
                      period === p.key
                        ? "bg-leaf-500/15 text-leaf-700"
                        : "bg-leaf-500/15 text-leaf-500"
                    )}
                  >
                    -{p.discount}%
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative mx-auto mt-14 grid max-w-6xl gap-6 lg:grid-cols-3 lg:items-start">
        {PLANS.map((plan, i) => {
          const isLocked = plan.name === "Dedicated";
          return (
          <motion.div
            key={plan.name}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            className={cn(
              "relative flex flex-col rounded-[1.75rem] border px-7 py-9",
              plan.popular
                ? "border-leaf-500/40 bg-white/[0.06] shadow-[0_30px_60px_-25px_rgba(107,203,63,0.35)] lg:-translate-y-3"
                : "border-cream/10 bg-white/[0.03]"
            )}
          >
            {isLocked && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 overflow-hidden rounded-[1.75rem] bg-[#0A0C08]/70 backdrop-blur-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 ring-1 ring-inset ring-cream/20">
                  <Lock size={18} className="text-cream/70" />
                </span>
                <span className="font-display text-sm font-bold uppercase tracking-wide text-cream/70">
                  Coming Soon
                </span>
              </div>
            )}
            {plan.offer && !isLocked && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.75rem]">
                <div className="absolute -right-11 top-6 w-40 rotate-45 bg-amber-500 py-1 text-center shadow-[0_4px_10px_-2px_rgba(0,0,0,0.35)]">
                  <span className="block font-display text-[10px] font-extrabold uppercase leading-tight tracking-wider text-ink">
                    Buy 1
                  </span>
                  <span className="block font-display text-[10px] font-extrabold uppercase leading-tight tracking-wider text-ink">
                    Get 1 Free
                  </span>
                </div>
              </div>
            )}
            {isLocked && (
              <div aria-hidden className="pointer-events-none select-none overflow-hidden rounded-[1.75rem] blur-sm">
                <PlanCardContent plan={plan} period={period} />
              </div>
            )}
            {!isLocked && <PlanCardContent plan={plan} period={period} />}
          </motion.div>
          );
        })}
      </div>
    </section>
  );
}

function PlanCardContent({ plan, period }: { plan: Plan; period: Period }) {
  return (
    <>
      {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-pill bg-leaf-500 px-4 py-1 font-display text-xs font-bold uppercase tracking-wide text-ink">
                Most Popular
              </span>
            )}

            <h3 className="text-center font-display text-lg font-bold uppercase tracking-wide text-cream">
              {plan.name}
            </h3>

            {plan.originalPrice && (
              <div className="mx-auto mt-4 flex items-center justify-center gap-2">
                <span className="font-display text-sm font-semibold text-cream/40 line-through">
                  ৳{plan.originalPrice}
                </span>
                <span className="rounded-pill bg-leaf-600 px-2 py-0.5 font-display text-[10px] font-bold text-white">
                  {Math.round(((plan.originalPrice - plan.basePrice) / plan.originalPrice) * 100)}% OFF
                </span>
              </div>
            )}

            <div className="mx-auto mt-3 flex items-end justify-center gap-1.5 rounded-2xl bg-white/5 px-6 py-4">
              <span className="font-display text-2xl font-bold text-cream/70">৳</span>
              <span className="font-display text-4xl font-extrabold leading-none tracking-tight text-cream">
                {priceForPeriod(plan.basePrice, period)}
              </span>
              <span className="pb-1 font-body text-sm text-cream/50">/mo</span>
            </div>

            {plan.offerNote && (
              <p className="mx-auto mt-3 text-center font-body text-xs text-cream/50">
                {plan.offerNote}
              </p>
            )}

            <ul className="mt-8 flex flex-col gap-3">
              {plan.features.map((f) => (
                <li key={f.label} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                      f.included ? "bg-leaf-500/15" : "bg-cream/5"
                    )}
                  >
                    {f.included ? (
                      <Check size={12} className="text-leaf-500" strokeWidth={3} />
                    ) : (
                      <X size={12} className="text-cream/30" strokeWidth={3} />
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-body text-sm",
                      f.included ? "text-cream/85" : "text-cream/30 line-through"
                    )}
                  >
                    {f.label}
                  </span>
                </li>
              ))}
            </ul>

            <a
              href={`/payment?plan=${plan.slug}`}
              className={cn(
                buttonVariants({
                  variant: plan.popular ? "accent" : "outline",
                  size: "lg",
                }),
                "mt-9 w-full gap-2",
                !plan.popular && "border-cream/25 text-cream hover:border-transparent"
              )}
            >
              {plan.cta}
              <ArrowRight size={16} />
            </a>
    </>
  );
}
