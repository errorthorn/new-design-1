"use client";

// The frame around every admin page: sidebar on desktop, top bar + drawer on phones, a search
// box that jumps to a section, and one content column. Visually matches the member dashboard.
// Staff (account access) see only the sections they were given; the owner sees everything.

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardCheck,
  FileQuestion,
  Mic2,
  Timer,
  ListChecks,
  Users,
  CreditCard,
  Gift,
  Bug,
  Library,
  Quote,
  CalendarDays,
  NotebookText,
  Languages,
  ShieldCheck,
  LayoutGrid,
  Menu,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS, type AdminSection } from "@/lib/admin-sections";
import { OWNER_PAGES } from "@/components/admin/admin-nav";
import { SearchBox, matchesSearch } from "@/components/admin/ui";

const ICONS: Record<string, LucideIcon> = {
  scoring: ClipboardCheck,
  questions: FileQuestion,
  "speaking-club": Mic2,
  "mock-test": Timer,
  quiz: ListChecks,
  members: Users,
  payments: CreditCard,
  referrals: Gift,
  "bug-reports": Bug,
  "study-materials": Library,
  testimonials: Quote,
  classes: CalendarDays,
  "class-notes": NotebookText,
  "vocab-words": Languages,
  staff: ShieldCheck,
};

type Item = { slug: string; href: string; label: string; owner?: boolean };

function useNavItems(): { items: Item[]; isStaff: boolean } {
  const access = useAdminAccess();
  const isStaff = access?.admin === true;
  const items = useMemo<Item[]>(() => {
    const sections: Item[] = ADMIN_SECTIONS.filter((s: AdminSection) => !isStaff || access!.sections.includes(s)).map((s) => ({
      slug: s,
      href: `/admin/${s}`,
      label: ADMIN_SECTION_LABELS[s],
    }));
    if (isStaff) return sections;
    return [
      ...sections,
      ...OWNER_PAGES.map((p) => ({ slug: p.href.replace("/admin/", ""), href: p.href, label: p.label, owner: true })),
    ];
  }, [access, isStaff]);
  return { items, isStaff };
}

function NavLinks({ items, current, onNavigate }: { items: Item[]; current: string; onNavigate?: () => void }) {
  const sections = items.filter((i) => !i.owner);
  const owner = items.filter((i) => i.owner);
  const row = (i: Item) => {
    const Icon = ICONS[i.slug] ?? LayoutGrid;
    const active = i.slug === current;
    return (
      <li key={i.slug}>
        <Link
          href={i.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-sm font-medium transition-colors ${
            active ? "bg-ink text-cream" : "text-ink-soft hover:bg-leaf-100 hover:text-ink"
          }`}
        >
          <Icon size={18} className="shrink-0" />
          <span className="truncate">{i.label}</span>
        </Link>
      </li>
    );
  };
  return (
    <>
      <ul className="space-y-1">
        <li>
          <Link
            href="/admin"
            onClick={onNavigate}
            aria-current={current === "home" ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-sm font-medium transition-colors ${
              current === "home" ? "bg-ink text-cream" : "text-ink-soft hover:bg-leaf-100 hover:text-ink"
            }`}
          >
            <LayoutGrid size={18} className="shrink-0" />
            Overview
          </Link>
        </li>
        {sections.map(row)}
      </ul>
      {owner.length > 0 && (
        <>
          <p className="mb-1 mt-5 px-3 font-body text-[11px] font-semibold uppercase tracking-wide text-ink-soft/50">Manage</p>
          <ul className="space-y-1">{owner.map(row)}</ul>
        </>
      )}
    </>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-ink/10">
        <Image src="/logo.svg" alt="LingoCraft" fill className="object-cover" />
      </span>
      <span className="truncate font-display text-base font-semibold tracking-tight">LingoCraft</span>
    </Link>
  );
}

export function AdminShell({
  current,
  title,
  actions,
  width = "max-w-5xl",
  children,
}: {
  /** slug of the page: "scoring", "quiz", "members", … or "home" for the overview */
  current: string;
  title: string;
  /** optional buttons shown on the right of the page title */
  actions?: React.ReactNode;
  width?: string;
  children: React.ReactNode;
}) {
  const { items } = useNavItems();
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState("");

  const results = useMemo(
    () => (q.trim() ? items.filter((i) => matchesSearch(q, i.label, i.slug)) : []),
    [q, items]
  );

  return (
    <div className="flex h-screen overflow-hidden bg-cream font-body text-ink">
      {/* Sidebar — desktop */}
      <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-ink/10 bg-white lg:flex">
        <div className="flex h-16 shrink-0 items-center border-b border-ink/10 px-4">
          <Brand />
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Admin">
          <NavLinks items={items} current={current} />
        </nav>
        <div className="border-t border-ink/10 p-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink"
          >
            <ArrowLeft size={16} />
            Back to site
          </Link>
        </div>
      </aside>

      {/* Sidebar — mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute left-0 top-0 flex h-full w-[260px] flex-col bg-white">
            <div className="flex h-16 items-center justify-between border-b border-ink/10 px-4">
              <Brand />
              <button
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
                className="grid h-8 w-8 place-items-center rounded-full border border-ink/10"
              >
                <X size={15} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Admin">
              <NavLinks items={items} current={current} onNavigate={() => setDrawer(false)} />
            </nav>
            <div className="border-t border-ink/10 p-3">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-soft hover:bg-leaf-100"
              >
                <ArrowLeft size={16} />
                Back to site
              </Link>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-16 shrink-0 items-center gap-3 border-b border-ink/10 bg-cream/90 px-4 backdrop-blur md:px-6">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 place-items-center rounded-full border border-ink/10 text-ink-soft lg:hidden"
          >
            <Menu size={18} />
          </button>
          <h1 className="min-w-0 truncate font-display text-lg font-semibold tracking-tight md:text-xl">{title}</h1>

          <div className="relative ml-auto hidden w-full max-w-xs md:block">
            <SearchBox value={q} onChange={setQ} placeholder="Go to…" />
            {results.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-leaf-300 bg-white py-1.5 shadow-lg">
                {results.map((r) => (
                  <li key={r.slug}>
                    <Link
                      href={r.href}
                      onClick={() => setQ("")}
                      className="block px-4 py-2 font-body text-sm text-ink hover:bg-leaf-100"
                    >
                      {r.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2 md:ml-0">{actions}</div>}
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          <div className={`mx-auto w-full ${width}`}>{children}</div>
        </main>
      </div>
    </div>
  );
}
