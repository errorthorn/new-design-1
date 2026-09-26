"use client";

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  generateWeeklyTemplate,
  applyTemplateEdit,
  expandTemplateToPlan,
  sessionsForWeekday,
  type Strengths,
  type TopicDurations,
  type PlanSchedule,
  type PlanGoal,
  type WeeklyTemplate,
  type StudyPlan,
} from "@/lib/study-planner/generate";
import { SessionGroup, formatTime } from "@/components/dashboard/study-planner/session-editor";

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function CustomizeStep({
  goal,
  schedule,
  strengths,
  topicDurations,
  onBack,
  onGenerate,
}: {
  goal: PlanGoal;
  schedule: PlanSchedule;
  strengths: Strengths;
  topicDurations: TopicDurations;
  onBack: () => void;
  onGenerate: (plan: StudyPlan) => void;
}) {
  const topicIds = useMemo(() => Object.keys(strengths), [strengths]);

  // Auto-fill for the topics picked in the previous step — recomputed
  // whenever the selection, durations, or weekly schedule change.
  const baseTemplate = useMemo(
    () => generateWeeklyTemplate(schedule, strengths, topicDurations),
    [schedule, strengths, topicDurations]
  );

  // Hand edits layered on top of the current auto-fill. Cleared back to the
  // fresh auto-fill whenever its inputs change, since a different topic
  // selection makes the old placements stale.
  const [edited, setEdited] = useState<{ base: WeeklyTemplate; template: WeeklyTemplate } | null>(null);
  const template = edited && edited.base === baseTemplate ? edited.template : baseTemplate;

  const weekDays = useMemo(
    () => [...schedule.days].filter((d) => d.sessions.length > 0).sort((a, b) => a.day - b.day),
    [schedule]
  );

  const indexedBlocks = useMemo(() => template.blocks.map((b, i) => ({ block: b, index: i })), [template]);

  function applyEdit(edit: Parameters<typeof applyTemplateEdit>[1]) {
    setEdited({ base: baseTemplate, template: applyTemplateEdit(template, edit) });
  }

  function handleGenerate() {
    onGenerate(expandTemplateToPlan(template, goal, schedule, strengths, topicDurations));
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft md:p-8">
      <h2 className="font-display text-2xl font-semibold tracking-tight">Place topics into your week</h2>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        We&apos;ve filled in a starting point — weaker topics get more slots. Swap, remove, or add
        topics in any session below; this week repeats for the length of your plan, and you can
        still fine-tune individual dates later from the calendar.
      </p>

      {weekDays.length === 0 ? (
        <p className="mt-6 font-body text-sm text-ink-soft dark:text-cream/50">
          No study sessions are set up yet — go back and add at least one to your schedule.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {weekDays.map((day) => (
            <div key={day.day}>
              <p className="font-body text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-cream/50">
                {WEEKDAY_LABELS[day.day]}
              </p>
              <div className="mt-2 space-y-2.5">
                {sessionsForWeekday(schedule, day.day).map((session) => (
                  <SessionGroup
                    key={session.id}
                    label={formatTime(session.time)}
                    minutesBudget={session.minutesBudget}
                    items={indexedBlocks
                      .filter((ib) => ib.block.sessionId === session.id)
                      .map((ib) => ({
                        index: ib.index,
                        skillId: ib.block.skillId,
                        topicId: ib.block.topicId,
                        topic: ib.block.topic,
                        minutes: ib.block.minutes,
                      }))}
                    topicIds={topicIds}
                    editMode
                    canAdd
                    compact
                    onUpdate={(index, topicId, minutes) => applyEdit({ kind: "update", blockIndex: index, topicId, minutes })}
                    onRemove={(index) => applyEdit({ kind: "remove", blockIndex: index })}
                    onAdd={(topicId, minutes) =>
                      applyEdit({ kind: "add", day: day.day, sessionId: session.id, time: session.time, topicId, minutes })
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

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
          onClick={handleGenerate}
          disabled={weekDays.length === 0}
          className={cn(
            "inline-flex items-center gap-2 rounded-pill bg-ink px-6 py-3 font-body text-sm font-semibold text-cream transition-transform dark:bg-cream dark:text-ink",
            weekDays.length === 0 ? "cursor-not-allowed opacity-40" : "hover:-translate-y-0.5"
          )}
        >
          <Sparkles size={15} />
          Generate my plan
        </button>
      </div>
    </div>
  );
}
