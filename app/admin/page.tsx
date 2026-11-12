"use client";

// /admin — admin home. Staff (an account the owner linked on /admin/staff) see only their sections;
// the owner types the owner key once to see everything. Linked from the profile menu
// (components/navbar.tsx, components/dashboard/dashboard-shell.tsx). See docs/ADMIN-ACCESS.md.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { fetchAdminAccess, type AdminAccess } from "@/hooks/use-admin-access";
import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS } from "@/lib/admin-sections";
import { OWNER_PAGES } from "@/components/admin/admin-nav";
import { AdminShell } from "@/components/admin/admin-shell";
import { SearchBox, matchesSearch, EmptyState, adminCard, adminBtn, adminInput } from "@/components/admin/ui";

type Card = { href: string; label: string };

function Cards({ cards }: { cards: Card[] }) {
  if (cards.length === 0) return <EmptyState text="Nothing found." />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          className={`${adminCard} flex items-center justify-between gap-3 px-5 py-4 font-body text-sm font-semibold transition-colors hover:border-leaf-600`}
        >
          {c.label}
          <ChevronRight size={16} className="shrink-0 text-leaf-700" />
        </Link>
      ))}
    </div>
  );
}

export default function AdminHomePage() {
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [ownerKey, setOwnerKey] = useState("");
  const [ownerOk, setOwnerOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchAdminAccess().then((a) => {
      if (!cancelled) setAccess(a);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function unlockOwner(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/staff", { headers: { "x-admin-secret": ownerKey } });
    if (!res.ok) {
      setError("That key didn't work.");
      return;
    }
    setOwnerOk(true);
  }

  const isStaff = access?.admin === true;

  const sections = useMemo<Card[]>(
    () =>
      ADMIN_SECTIONS.filter((s) => !isStaff || access!.sections.includes(s)).map((s) => ({
        href: `/admin/${s}`,
        label: ADMIN_SECTION_LABELS[s],
      })),
    [access, isStaff]
  );
  const ownerCards = OWNER_PAGES.map((p) => ({ href: p.href, label: p.label }));

  if (access === null) {
    return <div className="flex min-h-screen items-center justify-center bg-cream font-body text-sm text-ink-soft/60">Loading…</div>;
  }

  if (!isStaff && !ownerOk) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-4 font-body">
        <form onSubmit={unlockOwner} className={`${adminCard} w-full max-w-sm p-6`}>
          <Link href="/dashboard" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
            <ArrowLeft size={15} />
            Back
          </Link>
          <label className="mb-1.5 block text-sm font-medium">Owner key</label>
          <input type="password" value={ownerKey} onChange={(e) => setOwnerKey(e.target.value)} className={`${adminInput} mb-3`} />
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <button className={`${adminBtn} w-full`}>Enter</button>
        </form>
      </div>
    );
  }

  const filteredSections = sections.filter((c) => matchesSearch(query, c.label));
  const filteredOwner = ownerCards.filter((c) => matchesSearch(query, c.label));

  return (
    <AdminShell current="home" title="Overview" width="max-w-4xl">
      <SearchBox value={query} onChange={setQuery} placeholder="Search" className="mb-5 max-w-sm" />
      <Cards cards={filteredSections} />
      {ownerOk && filteredOwner.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 font-display text-base font-semibold">Manage</h2>
          <Cards cards={filteredOwner} />
        </>
      )}
    </AdminShell>
  );
}
