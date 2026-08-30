"use client";

import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlanGoal } from "@/lib/study-planner/generate";

const PRESETS = [
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "6 weeks", days: 42 },
  { label: "3 months", days: 90 },
];

export function GoalStep({
  goal,
  onChange,
  membershipDaysLeft,
  onContinue,
}: {
  goal: PlanGoal;
  onChange: (goal: PlanGoal) => void;
  membershipDaysLeft: number | null;
  onContinue: () => void;
}) {
  const cap = membershipDaysLeft && membershipDaysLeft > 0 ? membershipDaysLeft : null;
  const maxSlider = cap ?? 120;

  const availablePresets = PRESETS.filter((p) => !cap || p.days <= cap);
  const showMembershipOption = cap !== null && !availablePresets.some((p) => p.days === cap);

  return (
    <div className="rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft md:p-8">
      <h2 className="font-display text-2xl font-semibold tracking-tight">
        What are you aiming for?
      </h2>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Your target band and plan length set the pace of everything else.
      </p>

      {/* Target band */}
      <div className="mt-7">
        <p className="font-body text-sm font-medium text-ink-soft dark:text-cream/70">
          Target band score
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-display text-5xl font-bold">{goal.targetBand.toFixed(1)}</span>
          <span className="font-body text-lg text-ink-soft dark:text-cream/50">/ 9.0</span>
        </div>
        <input
          type="range"
          min={4}
          max={9}
          step={0.5}
          value={goal.targetBand}
          onChange={(e) => onChange({ ...goal, targetBand: parseFloat(e.target.value) })}
          className="mt-4 h-1.5 w-full cursor-pointer appearance-none rounded-pill bg-ink/10 accent-leaf-600 dark:bg-cream/15"
        />
        <div className="mt-1 flex justify-between font-body text-xs text-ink-soft/60 dark:text-cream/40">
          <span>4.0</span>
          <span>9.0</span>
        </div>
      </div>

      {/* Plan length */}
      <div className="mt-8 border-t border-ink/10 pt-7 dark:border-night-border">
        <p className="font-body text-sm font-medium text-ink-soft dark:text-cream/70">
          Plan length
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {availablePresets.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => onChange({ ...goal, durationDays: p.days })}
              className={cn(
                "rounded-pill border px-4 py-2 font-body text-sm font-medium transition-colors",
                goal.durationDays === p.days
                  ? "border-ink bg-ink text-cream dark:border-cream dark:bg-cream dark:text-ink"
                  : "border-ink/15 text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/70 dark:hover:bg-night"
              )}
            >
              {p.label}
            </button>
          ))}
          {showMembershipOption && (
            <button
              type="button"
              onClick={() => onChange({ ...goal, durationDays: cap! })}
              className={cn(
                "rounded-pill border px-4 py-2 font-body text-sm font-medium transition-colors",
                goal.durationDays === cap
                  ? "border-ink bg-ink text-cream dark:border-cream dark:bg-cream dark:text-ink"
                  : "border-ink/15 text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/70 dark:hover:bg-night"
              )}
            >
              Until membership ends ({cap}d)
            </button>
          )}
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between font-body text-sm">
            <span className="text-ink-soft dark:text-cream/60">Or set a custom length</span>
            <span className="font-semibold text-ink dark:text-cream">
              {goal.durationDays} days
            </span>
          </div>
          <input
            type="range"
            min={7}
            max={maxSlider}
            step={1}
            value={Math.min(goal.durationDays, maxSlider)}
            onChange={(e) => onChange({ ...goal, durationDays: parseInt(e.target.value, 10) })}
            className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-pill bg-ink/10 accent-leaf-600 dark:bg-cream/15"
          />
          <div className="mt-1 flex justify-between font-body text-xs text-ink-soft/60 dark:text-cream/40">
            <span>7 days</span>
            <span>{cap ? `${cap} days (membership ends)` : "120 days"}</span>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-xl border border-leaf-600 bg-white px-3.5 py-3 dark:bg-night">
          <Info size={15} className="mt-0.5 shrink-0 text-leaf-700 dark:text-leaf-500" />
          <p className="font-body text-xs text-ink-soft dark:text-cream/60">
            {cap
              ? `Your membership runs for ${cap} more day${cap === 1 ? "" : "s"} — plan length is capped to that so every block fits inside it.`
              : "We couldn't find an active membership period, so pick any length — this will sync to your membership automatically once one is active."}
          </p>
        </div>
      </div>

      <div className="mt-8 flex justify-end">
        <button
          type="button"
          onClick={onContinue}
          className="inline-flex items-center gap-2 rounded-pill bg-ink px-6 py-3 font-body text-sm font-semibold text-cream transition-transform hover:-translate-y-0.5 dark:bg-cream dark:text-ink"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
