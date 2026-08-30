"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Mic,
  FileText,
  Users,
  Flame,
  ChevronRight,
  CalendarClock,
  Trophy,
  ListX,
  CalendarRange,
  Zap,
  Swords,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { SKILL_AREAS, type StudyPlan } from "@/lib/study-planner/generate";

const STUDY_PLAN_STORAGE_KEY = "sb-study-plan";

// ---------------------------------------------------------------------------
// Pulls from the same endpoints the real pages already use — no new API
// route. Week count is subscription-based + admin-scheduled dates
// (getWeekProgram/computeEligibility in lib/mock-test.ts), never a fixed
// "week X of 8"; the mock-test dashboard itself never assumes that number,
// so this view doesn't either.
// ---------------------------------------------------------------------------

type MeUser = {
  name?: string | null;
  email: string;
  subscriptionActive: boolean;
  subscriptionWeeks: number | null;
};

type MockAttempt = {
  id: string;
  started_at: string;
  completed_at: string | null;
  score: number | null;
};

type MockTestData = {
  attempts: MockAttempt[];
  eligible: boolean;
  nextEligibleAt: string | null;
  inProgressAttemptId: string | null;
  totalWeeks: number;
};

type ShiftSummary = {
  shiftId: string;
  roomCode: string;
  startTime: string;
  endTime: string;
  state: "done" | "now" | "upcoming";
  partnerName: string | null;
};

type SpeakingClubStatus = {
  shifts: ShiftSummary[];
  activeShift: ShiftSummary | null;
};

type PerformanceData = {
  avgBand: number | null;
  rank: number | null;
  totalRanked: number;
  currentStreakDays: number;
  trend: { date: string; band: number }[];
};

type MistakesData = {
  mistakes: unknown[];
};

type HomeData = {
  user: MeUser | null | undefined; // undefined = not loaded yet, null = loaded but empty/403
  mockTest: MockTestData | null | undefined;
  speakingClub: SpeakingClubStatus | null | undefined;
  performance: PerformanceData | null | undefined;
  mistakes: MistakesData | null | undefined;
};

function useHomeData() {
  const [data, setData] = useState<HomeData>({
    user: undefined,
    mockTest: undefined,
    speakingClub: undefined,
    performance: undefined,
    mistakes: undefined,
  });

  useEffect(() => {
    let cancelled = false;

    async function safeJson(url: string) {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    }

    // Each card renders as soon as ITS OWN data arrives — no more waiting
    // on the slowest of the five before anything shows up (that used to
    // mean one heavy endpoint blanked the whole page; see the file note
    // on /api/performance's rank computation for why that one in
    // particular could be slow).
    safeJson("/api/auth/me").then((me) => {
      if (!cancelled) setData((d) => ({ ...d, user: me?.user ?? null }));
    });
    safeJson("/api/mock-test/attempts?light=1").then((mockTest) => {
      if (!cancelled) setData((d) => ({ ...d, mockTest: mockTest ?? null }));
    });
    safeJson("/api/speaking-club/my-status").then((speakingClub) => {
      if (!cancelled) setData((d) => ({ ...d, speakingClub: speakingClub ?? null }));
    });
    // ?light=1 skips the quiz/mock/vocab/trend queries this page never
    // reads anyway — see the matching note in app/api/performance/route.ts.
    safeJson("/api/performance?period=weekly&light=1").then((performance) => {
      if (!cancelled) setData((d) => ({ ...d, performance: performance ?? null }));
    });
    safeJson("/api/quiz/mistakes").then((mistakes) => {
      if (!cancelled) setData((d) => ({ ...d, mistakes: mistakes ?? null }));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}

// ---------------------------------------------------------------------------
// Study Planner keeps its generated plan in localStorage only (see
// app/dashboard/study-planner/page.tsx, STORAGE_KEY = "sb-study-plan") —
// there's no server route for it, so this reads the same key client-side
// rather than adding a new API just for the home card.
// ---------------------------------------------------------------------------
function useTodaysStudyBlock() {
  const [plan, setPlan] = useState<StudyPlan | null | undefined>(undefined); // undefined = not checked yet

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STUDY_PLAN_STORAGE_KEY);
      setPlan(saved ? JSON.parse(saved) : null);
    } catch {
      setPlan(null);
    }
  }, []);

  if (plan === undefined) return { loading: true, plan: null, todayBlocks: [], nextBlock: null };
  if (!plan) return { loading: false, plan: null, todayBlocks: [], nextBlock: null };

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const nowHHMM = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const todayBlocks = plan.blocks
    .filter((b) => b.date === todayIso)
    .sort((a, b) => a.time.localeCompare(b.time));
  // Today can have several sessions now — surface whichever hasn't started
  // yet, or the last one if the day's sessions are already done.
  const nextBlock =
    todayBlocks.find((b) => b.time >= nowHHMM) ?? todayBlocks[todayBlocks.length - 1] ?? null;
  return { loading: false, plan, todayBlocks, nextBlock };
}

export function HomeView() {
  const data = useHomeData();
  const firstName = (data.user?.name || data.user?.email || "there").split(" ")[0].split("@")[0];

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
        {data.user === undefined ? "Welcome back" : `Welcome back, ${firstName}`} 👋
      </h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Let&apos;s keep your speaking practice on track.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <MockTestCard loading={data.mockTest === undefined} data={data} />
        </div>
        <SpeakingClubCard loading={data.speakingClub === undefined} data={data} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <NextTestCard loading={data.mockTest === undefined} data={data} />
        <StreakCard loading={data.performance === undefined} data={data} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <RankCard loading={data.performance === undefined} data={data} />
        <MistakeCard loading={data.mistakes === undefined} data={data} />
        <StudyPlanCard />
      </div>

      <div className="mt-4">
        <QuickLaunchCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress + latest score hero — replaces DSAT's "Potential SAT Score /
// 1600" block. Progress is "completed / totalWeeks" (this account's real
// subscription length), not a generic calendar week.
// ---------------------------------------------------------------------------
function MockTestCard({ loading, data }: { loading: boolean; data: HomeData }) {
  if (loading) {
    return <Card className="h-full animate-pulse"><div className="h-40" /></Card>;
  }

  if (!data?.user?.subscriptionActive || !data.mockTest) {
    return (
      <Card className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
          <CalendarClock size={26} />
        </div>
        <p className="font-display text-lg font-semibold">No active subscription</p>
        <p className="max-w-sm font-body text-sm text-ink-soft dark:text-cream/60">
          Subscribe to unlock weekly mock tests and Speaking Club sessions.
        </p>
        <Link href="/#pricing" className={cn(buttonVariants({ size: "sm" }), "mt-1")}>
          See plans
        </Link>
      </Card>
    );
  }

  const { attempts, totalWeeks } = data.mockTest;
  const completed = attempts.filter((a) => a.completed_at);
  const latestScored = [...completed].reverse().find((a) => a.score != null);

  return (
    <Card className="h-full">
      <div className="flex items-center justify-between">
        <span className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">
          Mock Test progress
        </span>
        <span className="rounded-pill border border-leaf-600 bg-white px-3 py-1 font-body text-xs font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
          {completed.length} / {totalWeeks} weeks
        </span>
      </div>

      <div className="mt-4">
        <div className="h-2 w-full overflow-hidden rounded-pill bg-ink/10 dark:bg-night-border">
          <div
            className="h-full rounded-pill bg-leaf-500 transition-all"
            style={{ width: `${totalWeeks > 0 ? (completed.length / totalWeeks) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="mt-6 flex items-end justify-between border-t border-ink/10 pt-5 dark:border-night-border">
        <div>
          <p className="font-body text-sm text-ink-soft dark:text-cream/60">Latest score</p>
          <p className="mt-1 font-display text-3xl font-semibold">
            {latestScored?.score != null ? latestScored.score.toFixed(1) : "—"}
            <span className="ml-1 font-body text-base font-normal text-ink-soft dark:text-cream/50">/ 9</span>
          </p>
        </div>
        <Link
          href="/mock-test"
          className="flex items-center gap-1 font-body text-sm font-medium text-leaf-700 hover:underline dark:text-leaf-500"
        >
          View history <ChevronRight size={15} />
        </Link>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Speaking Club — surfaces today's shift + partner, since shifts are
// same-day (speaking_shift_lookup), not a future date the way a booking
// would be. "state" already distinguishes now / upcoming / done.
// ---------------------------------------------------------------------------
function SpeakingClubCard({ loading, data }: { loading: boolean; data: HomeData }) {
  if (loading) {
    return <Card className="h-full animate-pulse"><div className="h-40" /></Card>;
  }

  const shifts = data?.speakingClub?.shifts ?? [];
  const active = data?.speakingClub?.activeShift ?? null;
  const next = active ?? shifts.find((s) => s.state === "upcoming") ?? null;

  return (
    <Card className="flex h-full flex-col">
      <div className="flex items-center gap-2">
        <Users size={16} className="text-leaf-700 dark:text-leaf-500" />
        <span className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">
          Speaking Club
        </span>
      </div>

      {next ? (
        <div className="mt-4 flex flex-1 flex-col justify-between">
          <div>
            <p className="font-display text-lg font-semibold">
              {next.startTime}–{next.endTime}
            </p>
            <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
              {next.state === "now"
                ? "Live now"
                : `Today · Room ${next.roomCode}`}
              {next.partnerName ? ` · with ${next.partnerName}` : ""}
            </p>
          </div>
          <Link
            href="/speaking-club"
            className="mt-4 flex items-center gap-1 font-body text-sm font-medium text-leaf-700 hover:underline dark:text-leaf-500"
          >
            Go to session <ChevronRight size={15} />
          </Link>
        </div>
      ) : (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="font-body text-sm text-ink-soft dark:text-cream/60">
            No shift assigned for today.
          </p>
          <Link
            href="/speaking-club"
            className={buttonVariants({ size: "sm", variant: "outline" })}
          >
            Open Speaking Club
          </Link>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mock Test CTA — direct resume/start action, using the same eligibility
// signal the /mock-test page itself relies on.
// ---------------------------------------------------------------------------
function NextTestCard({ loading, data }: { loading: boolean; data: HomeData }) {
  if (loading) {
    return <Card className="animate-pulse"><div className="h-24" /></Card>;
  }

  const mt = data?.mockTest;
  const label = !mt
    ? "Subscribe to take a mock test."
    : mt.inProgressAttemptId
    ? "You have a test in progress."
    : mt.eligible
    ? "A new week is unlocked."
    : mt.nextEligibleAt
    ? `Next week unlocks ${new Date(mt.nextEligibleAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}.`
    : "You're caught up for now.";

  const ctaLabel = mt?.inProgressAttemptId
    ? "Resume test"
    : mt?.eligible
    ? "Start this week's test"
    : "Go to Mock Test";

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Mic size={16} className="text-leaf-700 dark:text-leaf-500" />
            <span className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">
              Mock Test
            </span>
          </div>
          <p className="mt-2 font-body text-sm text-ink-soft dark:text-cream/60">{label}</p>
        </div>
        <FileText size={20} className="shrink-0 text-ink-soft/30 dark:text-cream/20" />
      </div>
      <Link
        href="/mock-test"
        className={cn(buttonVariants({ size: "sm" }), "mt-4 w-full")}
      >
        {ctaLabel}
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Streak — reuses /api/performance's currentStreakDays (calendar days with
// any qualifying activity: Mock Test, Quiz, Vocab Battle, or Speaking
// Club), same definition already shown on /dashboard/performance.
// ---------------------------------------------------------------------------
function StreakCard({ loading, data }: { loading: boolean; data: HomeData }) {
  if (loading) {
    return <Card className="animate-pulse"><div className="h-24" /></Card>;
  }

  const streak = data?.performance?.currentStreakDays ?? 0;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Flame size={16} className="text-leaf-700 dark:text-leaf-500" />
        <span className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">
          Activity streak
        </span>
      </div>
      <p className="mt-3 font-display text-3xl font-semibold">
        {streak}
        <span className="ml-1 font-body text-base font-normal text-ink-soft dark:text-cream/50">
          {streak === 1 ? "day" : "days"}
        </span>
      </p>
      <p className="mt-1 font-body text-xs text-ink-soft dark:text-cream/50">
        {streak > 0 ? "Keep it going — do something today." : "Practice today to start a streak."}
      </p>
      <Link
        href="/dashboard/performance"
        className="mt-3 flex items-center gap-1 font-body text-sm font-medium text-leaf-700 hover:underline dark:text-leaf-500"
      >
        View performance <ChevronRight size={15} />
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rank — reuses /api/performance's rank/totalRanked/avgBand (the same
// weekly Mock Test ranking /dashboard/leaderboard shows), so this card adds
// no new request — the data was already being fetched and thrown away.
// ---------------------------------------------------------------------------
function RankCard({ loading, data }: { loading: boolean; data: HomeData }) {
  if (loading) {
    return <Card className="animate-pulse"><div className="h-24" /></Card>;
  }

  const rank = data?.performance?.rank ?? null;
  const totalRanked = data?.performance?.totalRanked ?? 0;
  const avgBand = data?.performance?.avgBand ?? null;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <Trophy size={16} className="text-leaf-700 dark:text-leaf-500" />
        <span className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">
          Leaderboard rank
        </span>
      </div>
      {rank != null ? (
        <>
          <p className="mt-3 font-display text-3xl font-semibold">
            #{rank}
            <span className="ml-1 font-body text-base font-normal text-ink-soft dark:text-cream/50">
              / {totalRanked}
            </span>
          </p>
          <p className="mt-1 font-body text-xs text-ink-soft dark:text-cream/50">
            {avgBand != null ? `Avg band ${avgBand.toFixed(1)} this week` : "This week"}
          </p>
        </>
      ) : (
        <p className="mt-3 font-body text-sm text-ink-soft dark:text-cream/60">
          Take a scored Mock Test this week to get ranked.
        </p>
      )}
      <Link
        href="/dashboard/leaderboard"
        className="mt-3 flex items-center gap-1 font-body text-sm font-medium text-leaf-700 hover:underline dark:text-leaf-500"
      >
        View leaderboard <ChevronRight size={15} />
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mistake Log — reuses /api/quiz/mistakes (same derived-from-quiz_attempts
// source /dashboard/mistake-log uses). Only the count is needed here, so the
// full mistake objects (question/options/explanation) are fetched once and
// just counted — no separate lightweight endpoint exists yet.
// ---------------------------------------------------------------------------
function MistakeCard({ loading, data }: { loading: boolean; data: HomeData }) {
  if (loading) {
    return <Card className="animate-pulse"><div className="h-24" /></Card>;
  }

  const mistakes = data?.mistakes?.mistakes ?? null;
  const count = mistakes?.length ?? 0;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <ListX size={16} className="text-leaf-700 dark:text-leaf-500" />
        <span className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">
          Mistake Log
        </span>
      </div>
      {mistakes === null ? (
        <p className="mt-3 font-body text-sm text-ink-soft dark:text-cream/60">
          Subscribe to start building your mistake log.
        </p>
      ) : count > 0 ? (
        <>
          <p className="mt-3 font-display text-3xl font-semibold">{count}</p>
          <p className="mt-1 font-body text-xs text-ink-soft dark:text-cream/50">
            {count === 1 ? "question" : "questions"} to review
          </p>
        </>
      ) : (
        <p className="mt-3 font-body text-sm text-ink-soft dark:text-cream/60">
          No mistakes right now — nice work!
        </p>
      )}
      <Link
        href="/dashboard/mistake-log"
        className="mt-3 flex items-center gap-1 font-body text-sm font-medium text-leaf-700 hover:underline dark:text-leaf-500"
      >
        {count > 0 ? "Review mistakes" : "Open mistake log"} <ChevronRight size={15} />
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Study Planner — the generated plan only ever lives in localStorage (see
// STORAGE_KEY in app/dashboard/study-planner/page.tsx), so this card reads
// that same key client-side rather than calling an API, and surfaces
// whichever topic today's date lands on in plan.blocks.
// ---------------------------------------------------------------------------
function StudyPlanCard() {
  const { loading, plan, todayBlocks, nextBlock } = useTodaysStudyBlock();

  if (loading) {
    return <Card className="animate-pulse"><div className="h-24" /></Card>;
  }

  const area = nextBlock ? SKILL_AREAS.find((a) => a.id === nextBlock.skillId) : null;
  const remaining = todayBlocks.length;

  return (
    <Card>
      <div className="flex items-center gap-2">
        <CalendarRange size={16} className="text-leaf-700 dark:text-leaf-500" />
        <span className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">
          Today&apos;s study plan
        </span>
      </div>
      {!plan ? (
        <p className="mt-3 font-body text-sm text-ink-soft dark:text-cream/60">
          No study plan yet — build one around your target band.
        </p>
      ) : nextBlock ? (
        <>
          {area && (
            <span
              className={cn(
                "mt-3 inline-block rounded-pill px-2.5 py-1 font-body text-xs font-semibold",
                area.colorClass
              )}
            >
              {area.short}
            </span>
          )}
          <p className="mt-2 font-display text-base font-semibold leading-snug">
            {nextBlock.topic}
          </p>
          <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/50">
            {nextBlock.time} · {nextBlock.minutes} min
            {remaining > 1 ? ` · ${remaining} sessions today` : ""}
          </p>
        </>
      ) : (
        <p className="mt-3 font-body text-sm text-ink-soft dark:text-cream/60">
          No session scheduled today — rest day 🌿
        </p>
      )}
      <Link
        href="/dashboard/study-planner"
        className="mt-3 flex items-center gap-1 font-body text-sm font-medium text-leaf-700 hover:underline dark:text-leaf-500"
      >
        {plan ? "Open study planner" : "Create study plan"} <ChevronRight size={15} />
      </Link>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Quick launch — static shortcuts into Quiz and Vocab Battle. Both already
// have their own dashboard pages; this just saves a trip through the
// sidebar for the two most repeatable daily-practice activities.
// ---------------------------------------------------------------------------
function QuickLaunchCard() {
  return (
    <Card>
      <span className="font-body text-sm font-medium text-ink-soft dark:text-cream/60">
        Quick practice
      </span>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Link
          href="/dashboard/quiz"
          className="flex items-center gap-3 rounded-xl border border-ink/10 p-4 transition-colors hover:border-leaf-300 hover:bg-leaf-100 dark:border-night-border dark:hover:border-leaf-600 dark:hover:bg-night"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
            <Zap size={18} />
          </span>
          <span>
            <span className="block font-display text-sm font-semibold">Quiz</span>
            <span className="block font-body text-xs text-ink-soft dark:text-cream/50">
              Test your grammar &amp; vocab
            </span>
          </span>
        </Link>
        <Link
          href="/dashboard/vocab-battle"
          className="flex items-center gap-3 rounded-xl border border-ink/10 p-4 transition-colors hover:border-leaf-300 hover:bg-leaf-100 dark:border-night-border dark:hover:border-leaf-600 dark:hover:bg-night"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
            <Swords size={18} />
          </span>
          <span>
            <span className="block font-display text-sm font-semibold">Vocab Battle</span>
            <span className="block font-body text-xs text-ink-soft dark:text-cream/50">
              Race against the clock
            </span>
          </span>
        </Link>
      </div>
    </Card>
  );
}
