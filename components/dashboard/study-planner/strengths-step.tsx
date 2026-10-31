"use client";

import { useState } from "react";
import { Check, ChevronDown, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  LEVEL_LABELS,
  SKILL_AREAS,
  type Strengths,
  type TopicDurations,
} from "@/lib/study-planner/generate";

export function StrengthsStep({
  strengths,
  onChange,
  topicDurations,
  onDurationsChange,
  onBack,
  onContinue,
}: {
  strengths: Strengths;
  onChange: (strengths: Strengths) => void;
  topicDurations: TopicDurations;
  onDurationsChange: (durations: TopicDurations) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [openCategory, setOpenCategory] = useState<string | null>(SKILL_AREAS[0]?.id ?? null);

  const totalSelected = Object.keys(strengths).length;

  function toggleTopic(topicId: string) {
    const next = { ...strengths };
    if (next[topicId] != null) {
      delete next[topicId];
    } else {
      next[topicId] = 2; // default new picks to "Okay"
      if (topicDurations[topicId] == null) {
        onDurationsChange({ ...topicDurations, [topicId]: 20 });
      }
    }
    onChange(next);
  }

  function setLevel(topicId: string, level: number) {
    onChange({ ...strengths, [topicId]: level });
  }

  function setDuration(topicId: string, minutes: number) {
    onDurationsChange({ ...topicDurations, [topicId]: minutes });
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft md:p-8">
      <h2 className="font-display text-2xl font-semibold tracking-tight">
        Build your curriculum
      </h2>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Pick every area you want covered, then rate how strong you already are — weaker picks get more practice time in your plan.
      </p>

      <div className="mt-7 space-y-3">
        {SKILL_AREAS.map((area) => {
          const isOpen = openCategory === area.id;
          const selectedInArea = area.topics.filter((t) => strengths[t.id] != null).length;

          return (
            <div
              key={area.id}
              className="overflow-hidden rounded-xl border border-ink/10 dark:border-night-border"
            >
              <button
                type="button"
                onClick={() => setOpenCategory(isOpen ? null : area.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
              >
                <div>
                  <p className="font-body text-sm font-semibold">{area.label}</p>
                  <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/50">
                    {area.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {selectedInArea > 0 && (
                    <span className="rounded-pill border border-leaf-600 bg-white px-2 py-0.5 font-body text-[11px] font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
                      {selectedInArea} selected
                    </span>
                  )}
                  <ChevronDown
                    size={16}
                    className={cn(
                      "text-ink-soft transition-transform dark:text-cream/50",
                      isOpen && "rotate-180"
                    )}
                  />
                </div>
              </button>

              {isOpen && (
                <div className="space-y-2 border-t border-ink/10 px-4 py-3.5 dark:border-night-border">
                  {area.topics.map((topic) => {
                    const level = strengths[topic.id];
                    const selected = level != null;
                    return (
                      <div
                        key={topic.id}
                        className={cn(
                          "rounded-lg border px-3 py-2.5 transition-colors",
                          selected
                            ? "border-ink/15 bg-cream dark:border-cream/15 dark:bg-night"
                            : "border-ink/5 dark:border-night-border/60"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleTopic(topic.id)}
                          className="flex w-full items-center gap-2.5 text-left"
                        >
                          <span
                            className={cn(
                              "grid h-4 w-4 shrink-0 place-items-center rounded border",
                              selected
                                ? "border-ink bg-ink text-cream dark:border-cream dark:bg-cream dark:text-ink"
                                : "border-ink/25 dark:border-cream/25"
                            )}
                          >
                            {selected && <Check size={11} strokeWidth={3} />}
                          </span>
                          <span className="font-body text-sm">{topic.label}</span>
                        </button>

                        {selected && (
                          <div className="mt-2.5 pl-[26px]">
                            <div className="flex items-center justify-between font-body text-[11px] text-ink-soft dark:text-cream/50">
                              <span>Current level</span>
                              <span className="font-medium text-ink dark:text-cream">
                                {LEVEL_LABELS[level - 1]}
                              </span>
                            </div>
                            <div className="mt-1.5 flex gap-1.5">
                              {[1, 2, 3, 4].map((segment) => (
                                <button
                                  key={segment}
                                  type="button"
                                  aria-label={`${topic.label}: ${LEVEL_LABELS[segment - 1]}`}
                                  onClick={() => setLevel(topic.id, segment)}
                                  className={cn(
                                    "h-1.5 flex-1 rounded-pill transition-colors",
                                    segment <= level
                                      ? "bg-ink dark:bg-cream"
                                      : "bg-ink/10 hover:bg-ink/20 dark:bg-cream/10 dark:hover:bg-cream/20"
                                  )}
                                />
                              ))}
                            </div>

                            <div className="mt-3 flex items-center justify-between font-body text-[11px] text-ink-soft dark:text-cream/50">
                              <span>Time on this topic</span>
                              <span className="font-medium text-ink dark:text-cream">
                                {topicDurations[topic.id] ?? 20} min
                              </span>
                            </div>
                            <input
                              type="range"
                              min={5}
                              max={60}
                              step={5}
                              value={topicDurations[topic.id] ?? 20}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                setDuration(topic.id, parseInt(e.target.value, 10))
                              }
                              className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-pill bg-ink/10 accent-leaf-600 dark:bg-cream/15"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-5 font-body text-xs text-ink-soft dark:text-cream/50">
        {totalSelected} topic{totalSelected === 1 ? "" : "s"} selected across all areas.
      </p>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 font-body text-sm font-medium text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={totalSelected === 0}
          className={cn(
            "inline-flex items-center gap-2 rounded-pill bg-ink px-6 py-3 font-body text-sm font-semibold text-cream transition-transform dark:bg-cream dark:text-ink",
            totalSelected === 0
              ? "cursor-not-allowed opacity-40"
              : "hover:-translate-y-0.5"
          )}
        >
          Continue
          <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
