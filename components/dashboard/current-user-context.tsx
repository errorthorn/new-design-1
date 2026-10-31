"use client";

import { createContext, useContext, type ReactNode } from "react";

// Single source of truth for the signed-in user's /api/auth/me payload
// across one dashboard page render. DashboardShell already fetches this
// once (for the sidebar name/avatar); before this context existed, every
// page that also needed the user — HomeView chief among them — fetched
// its own copy, meaning /api/auth/me ran twice per dashboard load for no
// reason. DashboardShell now provides the row it already has; everything
// else just reads it.
//
// Shape matches whatever /api/auth/me's `user` field returns (see
// withSubscriptionStatus in lib/auth.ts) — kept as `any` here rather than
// re-declaring that type, since this context is purely a pass-through and
// each consumer already declares the narrower shape it actually reads.
export type CurrentUser = Record<string, any> | null;

const CurrentUserContext = createContext<{ user: CurrentUser | undefined } | null>(null);

export function CurrentUserProvider({
  user,
  children,
}: {
  user: CurrentUser | undefined; // undefined = still loading
  children: ReactNode;
}) {
  return (
    <CurrentUserContext.Provider value={{ user }}>{children}</CurrentUserContext.Provider>
  );
}

/**
 * Reads the user DashboardShell already fetched. Returns undefined while
 * loading, null if signed out/empty, otherwise the user row. Falls back to
 * "undefined" (loading) if called outside a DashboardShell, so a stray
 * usage degrades to a permanent loading state rather than crashing.
 */
export function useCurrentUser(): CurrentUser | undefined {
  const ctx = useContext(CurrentUserContext);
  return ctx ? ctx.user : undefined;
}
