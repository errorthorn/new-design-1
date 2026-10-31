"use client";

import Link from "next/link";
import { useAdminAccess } from "@/hooks/use-admin-access";
import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS } from "@/lib/admin-sections";

// Owner-only pages (they need the owner key; never offered to account-linked staff).
export const OWNER_PAGES: { href: string; label: string }[] = [
  { href: "/admin/members", label: "Members" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/referrals", label: "Referrals" },
  { href: "/admin/bug-reports", label: "Bug Reports" },
  { href: "/admin/study-materials", label: "Study Materials" },
  { href: "/admin/testimonials", label: "Testimonials" },
  { href: "/admin/classes", label: "Classes" },
  { href: "/admin/class-notes", label: "Class Notes" },
  { href: "/admin/vocab-words", label: "Vocab Words" },
  { href: "/admin/staff", label: "Staff" },
];

/**
 * The link row at the top of every admin page. An account-linked staff member only sees
 * the sections they were given; the owner (key) sees everything. `current` is the page
 * you are on (its slug, e.g. "scoring") and is shown as plain bold text.
 */
export function AdminNav({ current }: { current: string }) {
  const access = useAdminAccess();
  const staffOnly = access?.admin === true;

  const links: { href: string; label: string; slug: string }[] = staffOnly
    ? ADMIN_SECTIONS.filter((s) => access!.sections.includes(s)).map((s) => ({
        href: `/admin/${s}`,
        label: ADMIN_SECTION_LABELS[s],
        slug: s,
      }))
    : [
        ...ADMIN_SECTIONS.map((s) => ({ href: `/admin/${s}`, label: ADMIN_SECTION_LABELS[s], slug: s })),
        ...OWNER_PAGES.map((p) => ({ ...p, slug: p.href.replace("/admin/", "") })),
      ];

  return (
    <nav className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-label="Admin sections">
      <Link href="/admin" className="font-semibold text-leaf-700 underline">
        Admin home
      </Link>
      {links.map((l) =>
        l.slug === current ? (
          <span key={l.slug} className="font-semibold">
            {l.label}
          </span>
        ) : (
          <Link key={l.slug} href={l.href} className="text-black/50 underline">
            {l.label}
          </Link>
        )
      )}
    </nav>
  );
}

/** Shown for a moment while we ask the server whether the signed-in account is staff. */
export function AdminChecking() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] px-4">
      <p className="text-sm text-black/50">Checking your access…</p>
    </div>
  );
}
