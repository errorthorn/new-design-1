"use client";

import { Check, Target, Clock, Activity, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "goal", label: "Your goal", icon: Target },
  { id: "schedule", label: "Your schedule", icon: Clock },
  { id: "strengths", label: "Your strengths", icon: Activity },
  { id: "customize", label: "Your week", icon: CalendarClock },
] as const;

export function StepHeader({ step }: { step: 0 | 1 | 2 | 3 }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-3">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < step;
        const current = i === step;
        return (
          <div key={s.id} className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors",
                  done
                    ? "border-leaf-600 bg-leaf-600 text-cream"
                    : current
                    ? "border-ink bg-ink text-cream dark:border-cream dark:bg-cream dark:text-ink"
                    : "border-ink/15 text-ink-soft/60 dark:border-cream/15 dark:text-cream/40"
                )}
              >
                {done ? <Check size={16} /> : <Icon size={16} />}
              </span>
              <span
                className={cn(
                  "hidden font-body text-sm font-medium sm:inline",
                  current
                    ? "text-ink dark:text-cream"
                    : "text-ink-soft/70 dark:text-cream/50"
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span className="h-px w-10 bg-ink/10 dark:bg-cream/10 sm:w-16" />
            )}
          </div>
        );
      })}
    </div>
  );
}
