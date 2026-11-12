"use client";

// hooks/use-admin-access.ts
//
// Is the signed-in account a staff member, and which admin sections can it use?
// Backed by GET /api/admin/me (the server decides; this only decides what to SHOW).
//
//   useAdminAccess()          -> for menus. Cached for a few minutes per tab so the
//                                "Admin" option appears instantly on every page.
//   useAdminSession(section)  -> for an admin page. Always asks the server fresh, and
//                                says whether the account may use `section` without a key.
//
// If you are looking for why "Admin" shows (or doesn't) in the profile menu: this file,
// app/api/admin/me/route.ts and lib/admin-auth.ts (findSessionStaff) are the whole chain.
// docs/ADMIN-ACCESS.md explains it, and tests/admin-access.test.ts guards it.

import { useEffect, useState } from "react";
import type { AdminSection } from "@/lib/admin-sections";

export type AdminAccess = { admin: boolean; name?: string | null; sections: AdminSection[] };

const CACHE_KEY = "lc-admin-access";
// A "yes, staff" answer is kept for a few minutes. A "no" is kept only briefly: an account that was
// given admin access a moment ago must see the Admin option almost at once, not after 5 minutes.
const CACHE_MS = 5 * 60_000;
const CACHE_NOT_ADMIN_MS = 20_000;

/** Forget the cached answer (e.g. right after the owner gives access), so the next menu asks the server again. */
export function clearAdminAccessCache() {
  try {
    window.sessionStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing cached, nothing to clear */
  }
}

function readCache(): AdminAccess | null {
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, value } = JSON.parse(raw);
    const maxAge = (value as AdminAccess | undefined)?.admin ? CACHE_MS : CACHE_NOT_ADMIN_MS;
    if (typeof at !== "number" || Date.now() - at > maxAge) return null;
    return value as AdminAccess;
  } catch {
    return null;
  }
}

function writeCache(value: AdminAccess) {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), value }));
  } catch {
    /* private mode etc. — just means one extra request per page */
  }
}

export async function fetchAdminAccess(): Promise<AdminAccess> {
  try {
    const res = await fetch("/api/admin/me", { cache: "no-store" });
    if (!res.ok) return { admin: false, sections: [] };
    const data = await res.json();
    return { admin: Boolean(data.admin), name: data.name ?? null, sections: Array.isArray(data.sections) ? data.sections : [] };
  } catch {
    return { admin: false, sections: [] };
  }
}

/** For menus. `null` while loading; never throws. */
export function useAdminAccess(enabled: boolean = true): AdminAccess | null {
  const [access, setAccess] = useState<AdminAccess | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const cached = readCache();
    if (cached) {
      setAccess(cached);
      return;
    }
    fetchAdminAccess().then((value) => {
      if (cancelled) return;
      writeCache(value);
      setAccess(value);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return access;
}

/** For an admin page: can this signed-in account open `section` without pasting a key? */
export function useAdminSession(section: AdminSection): { checking: boolean; allowed: boolean } {
  const [state, setState] = useState<{ checking: boolean; allowed: boolean }>({ checking: true, allowed: false });
  useEffect(() => {
    let cancelled = false;
    fetchAdminAccess().then((value) => {
      if (cancelled) return;
      writeCache(value);
      setState({ checking: false, allowed: value.admin && value.sections.includes(section) });
    });
    return () => {
      cancelled = true;
    };
  }, [section]);
  return state;
}
