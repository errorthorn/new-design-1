"use client";

import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Calendar as CalendarIcon,
  ListChecks,
  Pencil,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  totalWeeklyMinutes,
  weekdayOfIso,
  sessionsForWeekday,
  applyPlanEdit,
  type StudyPlan,
} from "@/lib/study-planner/generate";
import { SessionGroup, formatTime, skillOf } from "@/components/dashboard/study-planner/session-editor";

const WEEKDAY_HEADERS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function PlanView({
  plan,
  onStartOver,
  onChange,
}: {
  plan: StudyPlan;
  onStartOver: () => void;
  onChange: (updated: StudyPlan) => void;
}) {
  const [view, setView] = useState<"calendar" | "agenda">("calendar");
  const [editMode, setEditMode] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const todayIso = toIso(new Date());
  const [selectedDate, setSelectedDate] = useState(todayIso);

  const blocksByDate = useMemo(() => {
    const map = new Map<string, typeof plan.blocks>();
    for (const b of plan.blocks) {
      if (!map.has(b.date)) map.set(b.date, []);
      map.get(b.date)!.push(b);
    }
    for (const list of map.values()) list.sort((a, b) => a.time.localeCompare(b.time));
    return map;
  }, [plan.blocks]);

  const startDate = plan.blocks[0]?.date ?? todayIso;
  const endDate = new Date(startDate);
  endDate.setDate(new Date(startDate).getDate() + plan.goal.durationDays);

  const daysLeft = Math.max(
    0,
    Math.ceil((endDate.getTime() - Date.now()) / 86_400_000)
  );
  const totalMinutes = plan.blocks.reduce((sum, b) => sum + b.minutes, 0);
  const totalHours = Math.round(totalMinutes / 60);
  const studyDayCount = plan.schedule.days.filter((d) => d.sessions.length > 0).length;
  const weeklyMinutes = totalWeeklyMinutes(plan.schedule);
  const topicIds = useMemo(() => Object.keys(plan.strengths), [plan.strengths]);

  // Original index of each block within plan.blocks, so edits can target
  // the exact block even after grouping/sorting for display.
  const indexedBlocks = useMemo(
    () => plan.blocks.map((b, i) => ({ block: b, index: i })),
    [plan.blocks]
  );

  function blocksForDate(iso: string) {
    return indexedBlocks.filter((ib) => ib.block.date === iso);
  }

  function handleUpdateBlock(blockIndex: number, topicId: string, minutes: number) {
    onChange(applyPlanEdit(plan, { kind: "update", blockIndex, topicId, minutes }));
  }

  function handleRemoveBlock(blockIndex: number) {
    onChange(applyPlanEdit(plan, { kind: "remove", blockIndex }));
  }

  function handleAddBlock(date: string, sessionId: string, time: string, topicId: string, minutes: number) {
    onChange(
      applyPlanEdit(plan, {
        kind: "add",
        date,
        sessionId,
        time,
        topicId,
        minutes,
      })
    );
  }

  // Build the visible month grid (Monday-first), including the leading/
  // trailing days from adjacent months so every row has 7 cells.
  const monthCells = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const startOffset = (first.getDay() + 6) % 7; // 0 = Monday
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startOffset);

    const cells: { date: Date; inMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push({ date: d, inMonth: d.getMonth() === cursor.getMonth() });
    }
    // Trim trailing all-outside-month rows so short months don't show 6 empty rows.
    while (cells.length > 35 && !cells.slice(-7).some((c) => c.inMonth)) {
      cells.splice(cells.length - 7, 7);
    }
    return cells;
  }, [cursor]);

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const agendaDates = Array.from(blocksByDate.keys()).sort();

  // Every date in the plan's window that actually has a session configured
  // (i.e. not a rest day), used so edit mode can show/add topics to a
  // session even on a day whose blocks were all removed.
  const planDates = useMemo(() => {
    const out: string[] = [];
    const start = new Date(`${startDate}T00:00:00`);
    for (let i = 0; i < plan.goal.durationDays; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = toIso(d);
      if (sessionsForWeekday(plan.schedule, weekdayOfIso(iso)).length > 0) out.push(iso);
    }
    return out;
  }, [startDate, plan.goal.durationDays, plan.schedule]);
  const planDateSet = useMemo(() => new Set(planDates), [planDates]);
  const displayDates = editMode ? planDates : agendaDates;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            Your study plan
          </h1>
          <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
            Targeting <span className="font-semibold text-ink dark:text-cream">band {plan.goal.targetBand.toFixed(1)}</span> over{" "}
            {plan.goal.durationDays} days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            className={cn(
              "inline-flex items-center gap-2 rounded-pill border px-4 py-2 font-body text-sm font-medium transition-colors",
              editMode
                ? "border-ink bg-ink text-cream dark:border-cream dark:bg-cream dark:text-ink"
                : "border-ink/15 text-ink-soft hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night-soft dark:hover:text-cream"
            )}
          >
            {editMode ? <Check size={14} /> : <Pencil size={14} />}
            {editMode ? "Done editing" : "Edit plan"}
          </button>
          <button
            type="button"
            onClick={onStartOver}
            className="inline-flex items-center gap-2 rounded-pill border border-ink/15 px-4 py-2 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night-soft dark:hover:text-cream"
          >
            <RotateCcw size={14} />
            Start over
          </button>
        </div>
      </div>
      {editMode && (
        <p className="-mt-3 mb-4 rounded-xl border border-leaf-600/30 bg-leaf-500/10 px-3.5 py-2 font-body text-xs text-ink-soft dark:text-cream/70">
          Edit mode: pick a different topic for any slot, add a topic to any
          session with free time, or remove one. Changes save automatically.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Days left" value={String(daysLeft)} sub={`${plan.goal.durationDays} day plan`} />
        <StatCard
          label="Study blocks"
          value={String(plan.blocks.length)}
          sub={`across ${studyDayCount} days/week`}
        />
        <StatCard label="Planned time" value={`${totalHours}h`} sub="over the full plan" />
        <StatCard
          label="Weekly target"
          value={formatMinutesShort(weeklyMinutes)}
          sub={`${Math.round((weeklyMinutes / 60) * 10) / 10}h a week`}
        />
      </div>

      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={() => setView("calendar")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-1.5 font-body text-sm font-medium transition-colors",
            view === "calendar"
              ? "border-ink bg-ink text-cream dark:border-cream dark:bg-cream dark:text-ink"
              : "border-ink/15 text-ink-soft dark:border-night-border dark:text-cream/60"
          )}
        >
          <CalendarIcon size={14} /> Calendar
        </button>
        <button
          type="button"
          onClick={() => setView("agenda")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-1.5 font-body text-sm font-medium transition-colors",
            view === "agenda"
              ? "border-ink bg-ink text-cream dark:border-cream dark:bg-cream dark:text-ink"
              : "border-ink/15 text-ink-soft dark:border-night-border dark:text-cream/60"
          )}
        >
          <ListChecks size={14} /> Agenda
        </button>
      </div>

      {view === "calendar" ? (
        <div className="mt-4 grid gap-5 xl:grid-cols-[1fr_320px]">
          <div className="rounded-2xl border border-ink/10 bg-cream-soft p-4 dark:border-night-border dark:bg-night-soft md:p-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-lg font-semibold">{monthLabel}</p>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))
                  }
                  className="grid h-8 w-8 place-items-center rounded-full border border-ink/10 text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/60 dark:hover:bg-night"
                  aria-label="Previous month"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => {
                    const d = new Date();
                    d.setDate(1);
                    setCursor(d);
                  }}
                  className="rounded-pill border border-ink/10 px-3 py-1.5 font-body text-xs font-medium text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/60 dark:hover:bg-night"
                >
                  Today
                </button>
                <button
                  onClick={() =>
                    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))
                  }
                  className="grid h-8 w-8 place-items-center rounded-full border border-ink/10 text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/60 dark:hover:bg-night"
                  aria-label="Next month"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-ink/10 dark:bg-night-border">
              {WEEKDAY_HEADERS.map((d) => (
                <div
                  key={d}
                  className="bg-cream-soft py-2 text-center font-body text-[11px] font-semibold text-ink-soft/60 dark:bg-night-soft dark:text-cream/40"
                >
                  {d}
                </div>
              ))}
              {monthCells.map(({ date, inMonth }) => {
                const iso = toIso(date);
                const dayBlocks = blocksByDate.get(iso) ?? [];
                const isToday = iso === todayIso;
                const isSelected = iso === selectedDate;
                return (
                  <button
                    key={iso}
                    onClick={() => setSelectedDate(iso)}
                    className={cn(
                      "min-h-[84px] bg-cream-soft p-1.5 text-left transition-colors dark:bg-night-soft",
                      !inMonth && "opacity-30",
                      isSelected && "ring-2 ring-inset ring-leaf-600"
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-6 w-6 place-items-center rounded-full font-body text-xs",
                        isToday
                          ? "bg-ink text-cream dark:bg-cream dark:text-ink"
                          : "text-ink-soft dark:text-cream/60"
                      )}
                    >
                      {date.getDate()}
                    </span>
                    <div className="mt-1 space-y-1">
                      {dayBlocks.slice(0, 2).map((b, i) => (
                        <span
                          key={i}
                          className={cn(
                            "block truncate rounded-md px-1.5 py-0.5 font-body text-[10px] font-medium",
                            skillOf(b.skillId).colorClass
                          )}
                        >
                          {formatTime(b.time)} · {b.topic}
                        </span>
                      ))}
                      {dayBlocks.length > 2 && (
                        <span className="block px-1.5 font-body text-[10px] text-ink-soft/60 dark:text-cream/40">
                          +{dayBlocks.length - 2} more
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft">
            <p className="font-display text-base font-semibold">
              {new Date(selectedDate).toLocaleDateString("en-US", {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
              {selectedDate === todayIso && (
                <span className="ml-2 rounded-pill border border-leaf-600 bg-white px-2 py-0.5 align-middle font-body text-[10px] font-semibold uppercase tracking-wide text-leaf-700 dark:bg-night dark:text-leaf-500">
                  Today
                </span>
              )}
            </p>
            {(() => {
              const daySessions = sessionsForWeekday(plan.schedule, weekdayOfIso(selectedDate));
              if (daySessions.length === 0) {
                return (
                  <p className="mt-4 font-body text-sm text-ink-soft dark:text-cream/50">
                    A rest day — nothing scheduled.
                  </p>
                );
              }
              const dayBlocksIdx = blocksForDate(selectedDate);
              const canAdd = planDateSet.has(selectedDate);
              return (
                <div className="mt-4 space-y-4">
                  {daySessions.map((session) => (
                    <SessionGroup
                      key={session.id}
                      label={formatTime(session.time)}
                      minutesBudget={session.minutesBudget}
                      items={dayBlocksIdx
                        .filter((ib) => ib.block.sessionId === session.id)
                        .map((ib) => ({
                          index: ib.index,
                          skillId: ib.block.skillId,
                          topicId: ib.block.topicId,
                          topic: ib.block.topic,
                          minutes: ib.block.minutes,
                        }))}
                      topicIds={topicIds}
                      editMode={editMode}
                      canAdd={canAdd}
                      onUpdate={handleUpdateBlock}
                      onRemove={handleRemoveBlock}
                      onAdd={(topicId, minutes) =>
                        handleAddBlock(selectedDate, session.id, session.time, topicId, minutes)
                      }
                    />
                  ))}
                  {!canAdd && editMode && (
                    <p className="font-body text-xs text-ink-soft/70 dark:text-cream/40">
                      This date is outside the plan&apos;s {plan.goal.durationDays}-day window, so
                      it&apos;s view-only.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {displayDates.map((iso) => {
            const daySessions = sessionsForWeekday(plan.schedule, weekdayOfIso(iso));
            const dayBlocksIdx = blocksForDate(iso);
            return (
              <div
                key={iso}
                className="rounded-xl border border-ink/10 bg-cream-soft p-4 dark:border-night-border dark:bg-night-soft"
              >
                <p className="font-body text-sm font-semibold">
                  {new Date(iso).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </p>
                <div className="mt-2 space-y-3">
                  {daySessions.map((session) => (
                    <SessionGroup
                      key={session.id}
                      label={formatTime(session.time)}
                      minutesBudget={session.minutesBudget}
                      items={dayBlocksIdx
                        .filter((ib) => ib.block.sessionId === session.id)
                        .map((ib) => ({
                          index: ib.index,
                          skillId: ib.block.skillId,
                          topicId: ib.block.topicId,
                          topic: ib.block.topic,
                          minutes: ib.block.minutes,
                        }))}
                      topicIds={topicIds}
                      editMode={editMode}
                      canAdd
                      compact
                      onUpdate={handleUpdateBlock}
                      onRemove={handleRemoveBlock}
                      onAdd={(topicId, minutes) => handleAddBlock(iso, session.id, session.time, topicId, minutes)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatMinutesShort(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-cream-soft p-4 dark:border-night-border dark:bg-night-soft">
      <p className="font-body text-xs font-medium text-ink-soft dark:text-cream/50">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold">{value}</p>
      <p className="font-body text-xs text-ink-soft/70 dark:text-cream/40">{sub}</p>
    </div>
  );
}
