"use client";

import { useEffect, useState } from "react";
import { StepHeader } from "@/components/dashboard/study-planner/step-header";
import { GoalStep } from "@/components/dashboard/study-planner/goal-step";
import { ScheduleStep } from "@/components/dashboard/study-planner/schedule-step";
import { StrengthsStep } from "@/components/dashboard/study-planner/strengths-step";
import { CustomizeStep } from "@/components/dashboard/study-planner/customize-step";
import { PlanView } from "@/components/dashboard/study-planner/plan-view";
import {
  allTopicsAtLevel,
  defaultTopicDurations,
  makeSessionId,
  type PlanGoal,
  type PlanSchedule,
  type Strengths,
  type StudyPlan,
  type TopicDurations,
} from "@/lib/study-planner/generate";

const STORAGE_KEY = "sb-study-plan";

const DEFAULT_GOAL: PlanGoal = { targetBand: 7, durationDays: 30 };
// One evening session on weekdays by default — fully editable per day, and
// users can add more sessions (their own time + their own length) or remove
// days entirely.
const DEFAULT_SCHEDULE: PlanSchedule = {
  days: [0, 1, 2, 3, 4].map((day) => ({
    day,
    sessions: [{ id: makeSessionId(), time: "18:00", minutesBudget: 45 }],
  })),
};
// Every topic across every category starts selected at "Okay" so a
// first-time user already sees a full, proper curriculum — they can then
// deselect anything they don't want or adjust individual strength levels.
const DEFAULT_STRENGTHS: Strengths = allTopicsAtLevel(2);
const DEFAULT_DURATIONS: TopicDurations = defaultTopicDurations(
  Object.keys(DEFAULT_STRENGTHS)
);

export default function StudyPlannerPage() {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [goal, setGoal] = useState<PlanGoal>(DEFAULT_GOAL);
  const [schedule, setSchedule] = useState<PlanSchedule>(DEFAULT_SCHEDULE);
  const [strengths, setStrengths] = useState<Strengths>(DEFAULT_STRENGTHS);
  const [topicDurations, setTopicDurations] = useState<TopicDurations>(DEFAULT_DURATIONS);
  const [membershipDaysLeft, setMembershipDaysLeft] = useState<number | null>(null);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Restore a previously generated plan, if any.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setPlan(JSON.parse(saved));
    } catch {
      // ignore malformed storage
    } finally {
      setLoaded(true);
    }
  }, []);

  // Pull the membership expiry so plan length can be capped to it.
  useEffect(() => {
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const expiresAt = data?.profile?.subscriptionExpiresAt;
        const active = data?.profile?.subscriptionActive;
        if (active && expiresAt) {
          const days = Math.ceil(
            (new Date(expiresAt).getTime() - Date.now()) / 86_400_000
          );
          setMembershipDaysLeft(days > 0 ? days : null);
        }
      })
      .catch(() => {
        /* not logged in / no membership — GoalStep handles the null case */
      });
  }, []);

  function handleGenerate(generated: StudyPlan) {
    setPlan(generated);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(generated));
    } catch {
      // best-effort only
    }
  }

  function handlePlanChange(updated: StudyPlan) {
    setPlan(updated);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // best-effort only
    }
  }

  function handleStartOver() {
    setPlan(null);
    setStep(0);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // best-effort only
    }
  }

  if (!loaded) return null;

  if (plan) {
    return <PlanView plan={plan} onStartOver={handleStartOver} onChange={handlePlanChange} />;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <StepHeader step={step} />

      {step === 0 && (
        <GoalStep
          goal={goal}
          onChange={setGoal}
          membershipDaysLeft={membershipDaysLeft}
          onContinue={() => setStep(1)}
        />
      )}
      {step === 1 && (
        <ScheduleStep
          schedule={schedule}
          onChange={setSchedule}
          durationDays={goal.durationDays}
          onBack={() => setStep(0)}
          onContinue={() => setStep(2)}
        />
      )}
      {step === 2 && (
        <StrengthsStep
          strengths={strengths}
          onChange={setStrengths}
          topicDurations={topicDurations}
          onDurationsChange={setTopicDurations}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      )}
      {step === 3 && (
        <CustomizeStep
          goal={goal}
          schedule={schedule}
          strengths={strengths}
          topicDurations={topicDurations}
          onBack={() => setStep(2)}
          onGenerate={handleGenerate}
        />
      )}
    </div>
  );
}
