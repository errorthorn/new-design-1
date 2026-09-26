import type { LucideIcon } from "lucide-react";
import {
  Home,
  Trophy,
  LineChart,
  Users,
  CalendarRange,
  Target,
  Zap,
  FileCheck2,
  ListX,
  GraduationCap,
  NotebookText,
  Languages,
  Swords,
  UserCircle2,
  Gift,
  Bug,
} from "lucide-react";

export type DashboardNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** External / already-built page outside the dashboard shell (own layout). */
  external?: boolean;
  /** Shows a small "Pro" tag next to the label — for features Starter
   * doesn't include (see hasProAccess() in lib/plans.ts). Doesn't hide or
   * block the link; the page itself still does the real access check. */
  proOnly?: boolean;
};

export type DashboardNavGroup = {
  label: string;
  items: DashboardNavItem[];
};

// This is the single source of truth for the sidebar. Add/rename/reorder
// sections here and both the sidebar and the "coming soon" stub pages
// stay in sync (see app/dashboard/**/page.tsx).
export const DASHBOARD_NAV: DashboardNavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Home", href: "/dashboard", icon: Home },
      { label: "Leaderboard", href: "/dashboard/leaderboard", icon: Trophy },
      { label: "Performance", href: "/dashboard/performance", icon: LineChart },
      { label: "Community", href: "/dashboard/community", icon: Users },
    ],
  },
  {
    label: "Practice",
    items: [
      { label: "Study Planner", href: "/dashboard/study-planner", icon: CalendarRange },
      { label: "Practice", href: "/speaking-club", icon: Target, external: true },
      { label: "Quiz", href: "/dashboard/quiz", icon: Zap },
      { label: "Mock Test", href: "/mock-test", icon: FileCheck2, external: true },
      { label: "Mistake Log", href: "/dashboard/mistake-log", icon: ListX },
    ],
  },
  {
    label: "Learning",
    items: [
      { label: "Problem Solving Classes", href: "/dashboard/classes", icon: GraduationCap, proOnly: true },
      { label: "Class Notes", href: "/dashboard/class-notes", icon: NotebookText, proOnly: true },
    ],
  },
  {
    label: "Vocabulary",
    items: [
      { label: "Vocab", href: "/dashboard/vocab", icon: Languages },
      { label: "Vocab Battle", href: "/dashboard/vocab-battle", icon: Swords },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Profile", href: "/dashboard/profile", icon: UserCircle2 },
      { label: "Refer & Earn", href: "/dashboard/refer", icon: Gift },
      { label: "Report Bug", href: "/dashboard/report-bug", icon: Bug },
    ],
  },
];
