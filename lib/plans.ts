// Single source of truth for LingoCraft's membership plans — used by the
// pricing page (components/mastery-pricing.tsx), the checkout page
// (app/payment/page.tsx), and the backend (app/api/payment/submit/route.ts)
// so all three always agree on a plan's name, price, and what it includes.
//
// Only `purchasable` plans can actually be bought right now — "Dedicated"
// is shown on /pricing as "Coming Soon" (see mastery-pricing.tsx) and isn't
// wired up to checkout yet.

export type PlanSlug = "starter" | "pro" | "dedicated";

export type Plan = {
  slug: PlanSlug;
  name: string;
  /** ৳ per month. */
  price: number;
  originalPrice?: number;
  tagline: string;
  features: string[];
  purchasable: boolean;
};

export const PLANS: Record<PlanSlug, Plan> = {
  starter: {
    slug: "starter",
    name: "Starter",
    price: 349,
    tagline: "Everything you need to start practicing daily.",
    features: [
      "Leaderboard",
      "Performance Tracking",
      "Community",
      "Study Planner",
      "Daily Practice Sessions",
      "Vocab & Vocab Battle",
      "Monthly 2 Mock Tests",
      "Access of All Quizzes",
      "Mistake Log",
    ],
    purchasable: true,
  },
  pro: {
    slug: "pro",
    name: "Pro",
    price: 549,
    originalPrice: 1000,
    tagline: "Everything unlocked, no separate tiers.",
    features: [
      "Everything in Starter",
      "Daily Practice Sessions with AI Feedback",
      "Daily Vocabulary Sets for Practice Sessions",
      "Weekly Mock Test",
      "Personalized Expert Mentor Feedback",
      "Weekly Live Classes with Expert Mentors",
      "Recorded Classes and Slide PDFs",
      "Speaking Contest",
      "Priority Support",
    ],
    purchasable: true,
  },
  dedicated: {
    slug: "dedicated",
    name: "Dedicated",
    price: 1990,
    tagline: "For students who want unlimited, 1-on-1 support.",
    features: [
      "Everything in Starter",
      "Everything in Pro",
      "Archive Classes",
      "Unlimited Mock Attempts",
      "Unlimited Quiz Sessions",
      "Unlimited Practice Sessions",
      "1-on-1 Mentor Feedback",
      "Early Access to New Features",
    ],
    // Not sold yet — locked behind "Coming Soon" on /pricing.
    purchasable: false,
  },
};

export const DEFAULT_PLAN: PlanSlug = "pro";

/** Looks up a plan by slug, falling back to the default (Pro) for a
 * missing/unknown/unpurchasable value — e.g. an old "Activate membership"
 * link that doesn't specify a plan, or a bad query string. */
export function getPlan(slug?: string | null): Plan {
  const plan = slug ? PLANS[slug as PlanSlug] : undefined;
  if (plan && plan.purchasable) return plan;
  return PLANS[DEFAULT_PLAN];
}

/** True if this account's plan tier includes Pro-only features (Weekly
 * Live Classes, Class Notes/recordings, weekly — not just 2x/month — mock
 * tests, etc). Dedicated is a superset of Pro ("Everything in Pro" per its
 * feature list above), so it counts too. Always false if the subscription
 * itself isn't currently active — an expired Pro account shouldn't keep
 * Pro-only access any more than it keeps base access. */
export function hasProAccess(user: { subscriptionActive?: boolean; plan?: string | null }): boolean {
  if (!user.subscriptionActive) return false;
  return user.plan === "pro" || user.plan === "dedicated";
}

/** How many months of access a single approved payment for this plan
 * actually grants. Pro is running a "Buy 1 Get 1 Free" promo (see
 * PLANS.pro.offer / offerNote above, and the same line on /pricing) —
 * paying for 1 month grants 2 months of real access. Bump this back to 1
 * for 'pro' (or replace with a real start/end-date-driven promo) once
 * that offer ends. Only applies to the actual checkout flow
 * (/api/admin/payments approve) — a manual grant on /admin/members is a
 * deliberate custom override and stays exactly what the admin types. */
export function monthsGrantedForPlan(planSlug?: string | null): number {
  return planSlug === "pro" ? 2 : 1;
}

/** How many mock-test slots a month should include for a given plan —
 * Starter is billed as "2 a month", Pro/Dedicated as weekly (~4 a month).
 * Used to auto-set users.subscription_weeks when a payment is approved or
 * an admin grants access by hand, so the actual test cadence matches what
 * the plan promises without an admin having to compute it themselves. */
export function mockTestsPerMonth(planSlug?: string | null): number {
  return planSlug === "starter" ? 2 : 4;
}
