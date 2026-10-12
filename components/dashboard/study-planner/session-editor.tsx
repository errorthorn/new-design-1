"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SKILL_AREAS, MIN_TOPIC_MINUTES } from "@/lib/study-planner/generate";

export function skillOf(id: string) {
  return SKILL_AREAS.find((a) => a.id === id)!;
}

export function formatTime(time: string) {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function TopicSelect({
  value,
  onChange,
  topicIds,
  className,
}: {
  value: string;
  onChange: (topicId: string) => void;
  /** Restrict the dropdown to these topic ids (e.g. only what was picked in
   * the curriculum step) instead of every topic that exists. */
  topicIds: string[];
  className?: string;
}) {
  const allowed = new Set(topicIds);
  allowed.add(value); // always keep the current selection choosable, even if it fell outside the allowed set
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "rounded-lg border border-ink/15 bg-white px-2 py-1 font-body text-xs text-ink dark:border-night-border dark:bg-night dark:text-cream",
        className
      )}
    >
      {SKILL_AREAS.map((area) => {
        const topics = area.topics.filter((t) => allowed.has(t.id));
        if (topics.length === 0) return null;
        return (
          <optgroup key={area.id} label={area.label}>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

export type EditableItem = {
  index: number;
  skillId: string;
  topicId: string;
  topic: string;
  minutes: number;
};

/** One session's worth of topic slots (a specific weekday/date + clock
 * time), editable in place: swap a slot's topic/duration, remove it, or add
 * a new topic while there's still room in the session's minute budget.
 * Used both for the recurring weekly template (curriculum step) and the
 * dated plan view (post-generation touch-ups), which is why items are keyed
 * by a generic `index` rather than a date. */
export function SessionGroup({
  label,
  minutesBudget,
  items,
  topicIds,
  editMode,
  canAdd,
  compact,
  onUpdate,
  onRemove,
  onAdd,
}: {
  label: string;
  minutesBudget: number;
  items: EditableItem[];
  /** Which topics are selectable — restricted to what was picked in the
   * curriculum step, so this dropdown isn't a second, disconnected topic
   * picker. */
  topicIds: string[];
  editMode: boolean;
  canAdd: boolean;
  compact?: boolean;
  onUpdate: (index: number, topicId: string, minutes: number) => void;
  onRemove: (index: number) => void;
  onAdd: (topicId: string, minutes: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTopicId, setNewTopicId] = useState(topicIds[0] ?? "");
  const [newMinutes, setNewMinutes] = useState(20);

  const used = items.reduce((sum, it) => sum + it.minutes, 0);
  const remaining = Math.max(0, minutesBudget - used);
  const canFitMore = remaining >= MIN_TOPIC_MINUTES;

  function submitAdd() {
    const minutes = Math.min(Math.max(MIN_TOPIC_MINUTES, newMinutes), remaining);
    onAdd(newTopicId, minutes);
    setAdding(false);
    setNewMinutes(20);
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-ink/10 dark:border-night-border",
        compact ? "px-3 py-2.5" : "px-3.5 py-3"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-body text-xs font-semibold text-ink-soft dark:text-cream/60">
          {label}
        </span>
        {editMode && (
          <span className="font-body text-[11px] text-ink-soft/70 dark:text-cream/40">
            {used}/{minutesBudget} min used
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="mt-2 font-body text-xs text-ink-soft/70 dark:text-cream/40">
          Nothing in this session yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items
            .slice()
            .sort((a, b) => a.topic.localeCompare(b.topic))
            .map((item) => {
              const area = skillOf(item.skillId);
              return (
                <li key={item.index} className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-block shrink-0 rounded-md px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide",
                      area.colorClass
                    )}
                  >
                    {area.short}
                  </span>
                  {editMode ? (
                    <>
                      <TopicSelect
                        value={item.topicId}
                        onChange={(topicId) => onUpdate(item.index, topicId, item.minutes)}
                        topicIds={topicIds}
                        className="min-w-0 flex-1"
                      />
                      <input
                        type="number"
                        min={MIN_TOPIC_MINUTES}
                        value={item.minutes}
                        onChange={(e) =>
                          onUpdate(item.index, item.topicId, parseInt(e.target.value, 10) || MIN_TOPIC_MINUTES)
                        }
                        className="w-16 rounded-lg border border-ink/15 bg-white px-2 py-1 font-body text-xs text-ink dark:border-night-border dark:bg-night dark:text-cream"
                      />
                      <button
                        type="button"
                        onClick={() => onRemove(item.index)}
                        aria-label="Remove topic"
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-soft/60 transition-colors hover:bg-rose-500/10 hover:text-rose-600 dark:text-cream/40"
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : (
                    <span className="font-body text-sm">
                      {item.topic}{" "}
                      <span className="text-ink-soft/70 dark:text-cream/40">· {item.minutes} min</span>
                    </span>
                  )}
                </li>
              );
            })}
        </ul>
      )}

      {editMode && canAdd && (
        <div className="mt-2.5">
          {adding ? (
            <div className="flex flex-wrap items-center gap-2">
              <TopicSelect value={newTopicId} onChange={setNewTopicId} topicIds={topicIds} className="min-w-0 flex-1" />
              <input
                type="number"
                min={MIN_TOPIC_MINUTES}
                max={remaining}
                value={newMinutes}
                onChange={(e) => setNewMinutes(parseInt(e.target.value, 10) || MIN_TOPIC_MINUTES)}
                className="w-16 rounded-lg border border-ink/15 bg-white px-2 py-1 font-body text-xs text-ink dark:border-night-border dark:bg-night dark:text-cream"
              />
              <button
                type="button"
                onClick={submitAdd}
                className="rounded-lg bg-ink px-2.5 py-1 font-body text-xs font-semibold text-cream dark:bg-cream dark:text-ink"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="font-body text-xs text-ink-soft dark:text-cream/50"
              >
                Cancel
              </button>
            </div>
          ) : canFitMore ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 font-body text-xs font-medium text-leaf-700 dark:text-leaf-500"
            >
              <Plus size={13} /> Add topic ({remaining} min free)
            </button>
          ) : (
            <p className="font-body text-[11px] text-ink-soft/60 dark:text-cream/40">Session full</p>
          )}
        </div>
      )}
    </div>
  );
}
