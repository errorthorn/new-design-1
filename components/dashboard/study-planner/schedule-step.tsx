"use client";

import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  makeSessionId,
  totalWeeklyMinutes,
  totalWeeklySessions,
  type DaySchedule,
  type PlanSchedule,
  type Session,
} from "@/lib/study-planner/generate";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function formatMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function newSession(time = "18:00", minutesBudget = 30): Session {
  return { id: makeSessionId(), time, minutesBudget };
}

export function ScheduleStep({
  schedule,
  onChange,
  durationDays,
  onBack,
  onContinue,
}: {
  schedule: PlanSchedule;
  onChange: (schedule: PlanSchedule) => void;
  durationDays: number;
  onBack: () => void;
  onContinue: () => void;
}) {
  const weeklyMinutes = totalWeeklyMinutes(schedule);
  const weeklySessions = totalWeeklySessions(schedule);
  const activeDayCount = schedule.days.filter((d) => d.sessions.length > 0).length;
  const totalHoursBeforeEnd = Math.round(
    ((activeDayCount / 7) * durationDays * (weeklyMinutes / Math.max(1, activeDayCount))) / 60
  );

  function dayOf(idx: number): DaySchedule {
    return schedule.days.find((d) => d.day === idx) ?? { day: idx, sessions: [] };
  }

  function setDay(idx: number, sessions: Session[]) {
    const others = schedule.days.filter((d) => d.day !== idx);
    const next = [...others, { day: idx, sessions }].sort((a, b) => a.day - b.day);
    onChange({ ...schedule, days: next });
  }

  function toggleDay(idx: number) {
    const day = dayOf(idx);
    if (day.sessions.length > 0) {
      setDay(idx, []);
    } else {
      setDay(idx, [newSession()]);
    }
  }

  function addSession(idx: number) {
    const day = dayOf(idx);
    setDay(idx, [...day.sessions, newSession()]);
  }

  function updateSession(idx: number, sessionId: string, patch: Partial<Session>) {
    const day = dayOf(idx);
    setDay(
      idx,
      day.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s))
    );
  }

  function removeSession(idx: number, sessionId: string) {
    const day = dayOf(idx);
    setDay(idx, day.sessions.filter((s) => s.id !== sessionId));
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft md:p-8">
      <h2 className="font-display text-2xl font-semibold tracking-tight">
        When can you study?
      </h2>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Pick your days, then add one or more sessions to each — your own time
        and your own length for every session.
      </p>

      <div className="mt-7">
        <p className="font-body text-sm font-medium text-ink-soft dark:text-cream/70">
          Study days
        </p>
        <div className="mt-3 flex gap-2">
          {DAY_LABELS.map((label, idx) => {
            const active = dayOf(idx).sessions.length > 0;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                className={cn(
                  "grid h-11 w-11 place-items-center rounded-xl font-body text-sm font-semibold transition-colors",
                  active
                    ? "bg-ink text-cream dark:bg-cream dark:text-ink"
                    : "bg-ink/5 text-ink-soft hover:bg-leaf-100 dark:bg-cream/5 dark:text-cream/50 dark:hover:bg-night"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-7 space-y-3 border-t border-ink/10 pt-7 dark:border-night-border">
        {DAY_NAMES.map((name, idx) => {
          const day = dayOf(idx);
          if (day.sessions.length === 0) return null;

          return (
            <div
              key={idx}
              className="rounded-xl border border-ink/10 p-4 dark:border-night-border"
            >
              <div className="flex items-center justify-between">
                <p className="font-body text-sm font-semibold">{name}</p>
                <button
                  type="button"
                  onClick={() => addSession(idx)}
                  className="inline-flex items-center gap-1 rounded-pill border border-ink/15 px-2.5 py-1 font-body text-xs font-medium text-ink-soft hover:bg-leaf-100 dark:border-night-border dark:text-cream/60 dark:hover:bg-night"
                >
                  <Plus size={12} /> Add session
                </button>
              </div>

              <div className="mt-3 space-y-2">
                {day.sessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex flex-wrap items-center gap-2.5 rounded-lg bg-ink/5 px-3 py-2.5 dark:bg-cream/5"
                  >
                    <input
                      type="time"
                      value={session.time}
                      onChange={(e) =>
                        updateSession(idx, session.id, { time: e.target.value })
                      }
                      className="rounded-lg border border-ink/15 bg-cream-soft px-2 py-1.5 font-body text-sm dark:border-night-border dark:bg-night"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={10}
                        max={180}
                        step={5}
                        value={session.minutesBudget}
                        onChange={(e) =>
                          updateSession(idx, session.id, {
                            minutesBudget: parseInt(e.target.value, 10),
                          })
                        }
                        className="h-1.5 w-28 cursor-pointer appearance-none rounded-pill bg-ink/10 accent-leaf-600 dark:bg-cream/15"
                      />
                      <span className="w-12 font-body text-sm font-medium">
                        {formatMinutes(session.minutesBudget)}
                      </span>
                    </div>
                    {day.sessions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSession(idx, session.id)}
                        className="ml-auto grid h-7 w-7 place-items-center rounded-full text-ink-soft/60 hover:bg-ink/10 hover:text-ink dark:text-cream/40 dark:hover:bg-cream/10 dark:hover:text-cream"
                        aria-label="Remove session"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {activeDayCount === 0 && (
          <p className="font-body text-sm text-ink-soft dark:text-cream/50">
            Pick at least one day above to add sessions.
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <div className="rounded-xl bg-ink/5 px-4 py-3.5 dark:bg-cream/5">
          <p className="font-display text-xl font-bold">{formatMinutes(weeklyMinutes)}</p>
          <p className="font-body text-xs text-ink-soft dark:text-cream/50">per week</p>
        </div>
        <div className="rounded-xl bg-ink/5 px-4 py-3.5 dark:bg-cream/5">
          <p className="font-display text-xl font-bold">{weeklySessions}</p>
          <p className="font-body text-xs text-ink-soft dark:text-cream/50">
            sessions/week
          </p>
        </div>
        <div className="rounded-xl bg-ink/5 px-4 py-3.5 dark:bg-cream/5">
          <p className="font-display text-xl font-bold">~{totalHoursBeforeEnd}h</p>
          <p className="font-body text-xs text-ink-soft dark:text-cream/50">
            over the plan
          </p>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 font-body text-sm font-medium text-ink-soft hover:text-ink dark:text-cream/60 dark:hover:text-cream"
        >
          ← Back
        </button>
        <button
          type="button"
          disabled={activeDayCount === 0}
          onClick={onContinue}
          className="inline-flex items-center gap-2 rounded-pill bg-ink px-6 py-3 font-body text-sm font-semibold text-cream transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-cream dark:text-ink"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
