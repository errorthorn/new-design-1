"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  Bell,
  Sun,
  Moon,
  Menu,
  X,
  Home,
  LogOut,
  User as UserIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DASHBOARD_NAV } from "@/lib/dashboard-nav";

type NavUser = { name?: string | null; email: string; avatarUrl?: string | null };
type NotificationRow = {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean | number;
  created_at: string;
};

// Short "2h ago" / "3d ago" style label — good enough for a notification
// feed without pulling in a date-formatting library for just this.
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const THEME_KEY = "sb-dashboard-theme";

function useDashboardTheme() {
  const [dark, setDark] = useState(false);

  // Read the saved preference once on mount (no SSR mismatch: we default
  // to light and flip right after hydration).
  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "dark") setDark(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}

// Sidebar width — user can drag the right edge to resize; width persists
// across reloads so long labels (e.g. "Problem Solving Classes") stay
// fully readable without needing a shortened label.
const SIDEBAR_WIDTH_KEY = "sb-dashboard-sidebar-width";
const DEFAULT_SIDEBAR_WIDTH = 248;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;

function useSidebarWidth() {
  const [width, setWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
    const parsed = saved ? Number(saved) : NaN;
    if (!Number.isNaN(parsed)) {
      setWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed)));
    }
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const onMouseMove = (e: MouseEvent) => {
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX));
      setWidth(next);
    };
    const stop = () => setIsResizing(false);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stop);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stop);
    };
  }, [isResizing]);

  // Persist once a drag ends (not on every pixel while dragging).
  useEffect(() => {
    if (isResizing) return;
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  }, [width, isResizing]);

  return { width, isResizing, startResizing: () => setIsResizing(true) };
}

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

// Which nav groups are expanded — all open by default, persisted so a
// collapsed group stays collapsed across navigation/reloads.
const GROUPS_KEY = "sb-dashboard-groups";

function useOpenGroups() {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(DASHBOARD_NAV.map((g) => [g.label, true]))
  );

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GROUPS_KEY);
      if (saved) setOpenGroups((prev) => ({ ...prev, ...JSON.parse(saved) }));
    } catch {
      // ignore malformed/missing storage
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify(openGroups));
  }, [openGroups]);

  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));

  return { openGroups, toggleGroup };
}

function NavGroups({
  pathname,
  collapsed,
  openGroups,
  toggleGroup,
  onNavigate,
}: {
  pathname: string;
  collapsed: boolean;
  openGroups: Record<string, boolean>;
  toggleGroup: (label: string) => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      {DASHBOARD_NAV.map((group) => {
        const open = collapsed ? true : openGroups[group.label] !== false;
        return (
          <div key={group.label} className="mb-2">
            {!collapsed && (
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className="flex w-full items-center justify-between px-3 py-1.5 font-body text-[11px] font-semibold uppercase tracking-wider text-ink-soft/60 transition-colors hover:text-ink dark:text-cream/40 dark:hover:text-cream/80"
              >
                {group.label}
                <ChevronDown
                  size={13}
                  className={cn("transition-transform duration-200", !open && "-rotate-90")}
                />
              </button>
            )}
            <ul
              className={cn(
                "space-y-0.5 overflow-hidden transition-all duration-200",
                !collapsed && (open ? "mt-1 max-h-[600px] opacity-100" : "max-h-0 opacity-0")
              )}
            >
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      title={item.label}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-sm font-medium transition-colors",
                        active
                          ? "bg-ink text-cream dark:bg-leaf-600 dark:text-cream"
                          : "text-ink-soft hover:bg-leaf-100 hover:text-ink dark:text-cream/70 dark:hover:bg-night dark:hover:text-cream",
                        collapsed && "justify-center px-0"
                      )}
                    >
                      <Icon size={18} className="shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}

                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { dark, toggle } = useDashboardTheme();
  const { openGroups, toggleGroup } = useOpenGroups();
  const { width: sidebarWidth, isResizing, startResizing } = useSidebarWidth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [user, setUser] = useState<NavUser | null | undefined>(undefined);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setUser(data.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadNotifications = () => {
    setNotifLoading(true);
    fetch("/api/notifications")
      .then((res) => res.json())
      .then((data) => {
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => {
        // Silently leave whatever was already loaded — the bell just
        // won't refresh this time, no need to interrupt the dashboard.
      })
      .finally(() => setNotifLoading(false));
  };

  // Load once on mount so the unread badge is right from the first paint,
  // then again every time the panel is opened so it's never stale from a
  // long-open tab.
  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Close the mobile drawer and the avatar/notification menus on route change.
  useEffect(() => {
    setMobileOpen(false);
    setAvatarMenuOpen(false);
    setNotifOpen(false);
  }, [pathname]);

  async function handleLogout() {
    setAvatarMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  async function handleOpenNotifications() {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) loadNotifications();
  }

  async function handleNotificationClick(n: NotificationRow) {
    setNotifOpen(false);
    if (!n.read) {
      setUnreadCount((c) => Math.max(0, c - 1));
      fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
    }
    if (n.link) router.push(n.link);
  }

  async function handleMarkAllRead() {
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    fetch("/api/notifications/read", { method: "POST" }).catch(() => {});
  }

  const firstName = (user?.name || user?.email || "there").split(" ")[0].split("@")[0];

  return (
    <div className={cn(dark && "dark")}>
      <div className="flex h-screen overflow-hidden bg-cream text-ink dark:bg-night dark:text-cream">
        {/* Sidebar — desktop.
            Deliberately NOT `sticky` — a sticky sidebar shares one scroll
            timeline with the page, and this dashboard's own <nav> also
            scrolls internally (overflow-y-auto, since the nav list can be
            taller than the viewport). Two nested scrollers on one timeline
            is what let a page-level scroll (e.g. scrolling down the
            Community list) drag the sidebar's internal scroll position
            along with it, so it no longer matched what was actually
            visible on screen.
            Fixed instead: the whole app shell is capped at h-screen with
            overflow-hidden below, and ONLY <main> (the page content pane)
            scrolls. The sidebar's own height never changes and is never on
            the same scroll timeline as the page, so it structurally can't
            drift again — on this page or any other dashboard page, since
            this file is the shared layout for all of them. */}
        <aside
          style={{ width: collapsed ? 76 : sidebarWidth }}
          className={cn(
            "relative hidden h-full shrink-0 flex-col border-r border-ink/10 bg-cream-soft dark:border-night-border dark:bg-night-soft lg:flex",
            !isResizing && "transition-[width] duration-200"
          )}
        >
          <div
            className={cn(
              "flex items-center border-b border-ink/10 px-4 dark:border-night-border",
              collapsed ? "flex-col gap-2 py-3" : "h-16 justify-between gap-2"
            )}
          >
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-ink/10 dark:ring-cream/10">
                <Image src="/logo.svg" alt="LingoCraft" fill className="object-cover" />
              </span>
              {!collapsed && (
                <span className="truncate font-display text-base font-semibold tracking-tight">
                  LingoCraft
                </span>
              )}
            </Link>
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-ink/10 text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/60 dark:hover:bg-night dark:hover:text-cream"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-4">
            <NavGroups
              pathname={pathname}
              collapsed={collapsed}
              openGroups={openGroups}
              toggleGroup={toggleGroup}
            />
          </nav>

          {!collapsed && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                startResizing();
              }}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              className="group absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize select-none touch-none"
            >
              <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-leaf-400 group-active:bg-leaf-500" />
            </div>
          )}
        </aside>

        {/* Sidebar — mobile drawer */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-ink/40"
              onClick={() => setMobileOpen(false)}
            />
            <aside className="absolute left-0 top-0 flex h-full w-[260px] flex-col bg-cream-soft dark:bg-night-soft">
              <div className="flex h-16 items-center justify-between border-b border-ink/10 px-4 dark:border-night-border">
                <Link href="/" className="flex items-center gap-2.5">
                  <span className="relative block h-8 w-8 overflow-hidden rounded-full ring-1 ring-ink/10 dark:ring-cream/10">
                    <Image src="/logo.svg" alt="LingoCraft" fill className="object-cover" />
                  </span>
                  <span className="font-display text-base font-semibold tracking-tight">
                    LingoCraft
                  </span>
                </Link>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="grid h-7 w-7 place-items-center rounded-full border border-ink/10 dark:border-night-border"
                  aria-label="Close menu"
                >
                  <X size={14} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-3 py-4">
                <NavGroups
                  pathname={pathname}
                  collapsed={false}
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                  onNavigate={() => setMobileOpen(false)}
                />
              </nav>
            </aside>
          </div>
        )}

        {/* Main column */}
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="z-30 flex h-16 shrink-0 items-center gap-3 border-b border-ink/10 bg-cream/90 px-4 backdrop-blur dark:border-night-border dark:bg-night/90 md:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-ink/10 text-ink-soft dark:border-night-border dark:text-cream/70 lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={16} />
            </button>

            <div className="relative hidden min-w-0 flex-1 max-w-sm md:block">
              <Search
                size={16}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft/50 dark:text-cream/40"
              />
              <input
                type="text"
                placeholder="Search"
                className="h-10 w-full rounded-pill border border-ink/10 bg-cream-soft pl-10 pr-4 font-body text-sm text-ink placeholder:text-ink-soft/50 focus-ring dark:border-night-border dark:bg-night-soft dark:text-cream dark:placeholder:text-cream/30"
              />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button
                onClick={toggle}
                className="grid h-9 w-9 place-items-center rounded-full border border-ink/10 text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night-soft dark:hover:text-cream"
                aria-label="Toggle theme"
              >
                {dark ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={handleOpenNotifications}
                  aria-haspopup="menu"
                  aria-expanded={notifOpen}
                  aria-label="Notifications"
                  className="relative grid h-9 w-9 place-items-center rounded-full border border-ink/10 text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink dark:border-night-border dark:text-cream/70 dark:hover:bg-night-soft dark:hover:text-cream"
                >
                  <Bell size={16} />
                  {unreadCount > 0 && (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-cream dark:ring-night" />
                  )}
                </button>

                {notifOpen && (
                  <>
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      onClick={() => setNotifOpen(false)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-xl dark:border-night-border dark:bg-night-soft"
                    >
                      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3 dark:border-night-border">
                        <span className="font-display text-sm font-bold text-ink dark:text-cream">
                          Notifications
                        </span>
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={handleMarkAllRead}
                            className="font-body text-xs font-semibold text-leaf-600 hover:underline"
                          >
                            Mark all as read
                          </button>
                        )}
                      </div>

                      <div className="max-h-80 overflow-y-auto">
                        {notifLoading && notifications.length === 0 ? (
                          <div className="px-4 py-10 text-center font-body text-sm text-ink-soft dark:text-cream/60">
                            Loading…
                          </div>
                        ) : notifications.length === 0 ? (
                          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                            <span className="grid h-10 w-10 place-items-center rounded-full border border-leaf-500 bg-white text-leaf-600">
                              <Bell size={18} />
                            </span>
                            <p className="font-body text-sm font-semibold text-ink dark:text-cream">
                              All caught up!
                            </p>
                            <p className="font-body text-xs text-ink-soft dark:text-cream/50">
                              No new notifications at the moment. Check back later for updates.
                            </p>
                          </div>
                        ) : (
                          notifications.map((n) => (
                            <button
                              key={n.id}
                              type="button"
                              role="menuitem"
                              onClick={() => handleNotificationClick(n)}
                              className={`flex w-full flex-col items-start gap-0.5 border-b border-ink/5 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-leaf-100 dark:border-night-border/60 dark:hover:bg-night ${
                                !n.read ? "bg-leaf-50/60 dark:bg-leaf-950/10" : ""
                              }`}
                            >
                              <span className="flex w-full items-center gap-2 font-body text-sm font-semibold text-ink dark:text-cream">
                                {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-leaf-500" />}
                                {n.title}
                              </span>
                              {n.body && (
                                <span className="font-body text-xs text-ink-soft dark:text-cream/60">
                                  {n.body}
                                </span>
                              )}
                              <span className="font-body text-[11px] text-ink-soft/70 dark:text-cream/40">
                                {timeAgo(n.created_at)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              {/* Desktop/tablet (lg+): straight link to the profile page,
                  unchanged from before. */}
              <Link
                href="/dashboard/profile"
                className="hidden items-center gap-2 rounded-pill border border-ink/10 py-1 pl-1 pr-3 transition-colors hover:bg-leaf-100 dark:border-night-border dark:hover:bg-night-soft lg:flex"
              >
                <span className="relative block h-7 w-7 overflow-hidden rounded-full border border-leaf-600 bg-white">
                  <HeaderAvatar avatarUrl={user?.avatarUrl} fallbackLetter={firstName.charAt(0).toUpperCase()} />
                </span>
                <span className="hidden font-body text-sm font-medium sm:inline">
                  {firstName}
                </span>
              </Link>

              {/* Mobile/tablet (below lg): tapping the avatar opens a small
                  menu (Profile / Home / Log out) instead of navigating
                  straight to the profile page — the sidebar with Home is
                  hidden at this width, so this is the quickest way to get
                  back to the dashboard or sign out without hunting for a
                  separate Log out button elsewhere on the page. */}
              <div className="relative lg:hidden">
                <button
                  type="button"
                  onClick={() => setAvatarMenuOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={avatarMenuOpen}
                  className="flex items-center gap-2 rounded-pill border border-ink/10 py-1 pl-1 pr-3 transition-colors hover:bg-leaf-100 dark:border-night-border dark:hover:bg-night-soft"
                >
                  <span className="relative block h-7 w-7 overflow-hidden rounded-full border border-leaf-600 bg-white">
                    <HeaderAvatar avatarUrl={user?.avatarUrl} fallbackLetter={firstName.charAt(0).toUpperCase()} />
                  </span>
                  <span className="hidden font-body text-sm font-medium sm:inline">
                    {firstName}
                  </span>
                </button>

                {avatarMenuOpen && (
                  <>
                    {/* backdrop to catch outside taps and close the menu */}
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      onClick={() => setAvatarMenuOpen(false)}
                      className="fixed inset-0 z-40 cursor-default"
                    />
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-ink/10 bg-white py-1.5 shadow-xl dark:border-night-border dark:bg-night-soft"
                    >
                      <Link
                        href="/dashboard/profile"
                        role="menuitem"
                        onClick={() => setAvatarMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 font-body text-sm font-medium text-ink transition-colors hover:bg-leaf-100 dark:text-cream dark:hover:bg-night"
                      >
                        <UserIcon size={15} />
                        Profile
                      </Link>
                      <Link
                        href="/dashboard"
                        role="menuitem"
                        onClick={() => setAvatarMenuOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2.5 font-body text-sm font-medium text-ink transition-colors hover:bg-leaf-100 dark:text-cream dark:hover:bg-night"
                      >
                        <Home size={15} />
                        Home
                      </Link>
                      <div className="my-1 h-px bg-ink/10 dark:bg-night-border" />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 font-body text-sm font-medium text-ink transition-colors hover:bg-leaf-100 dark:text-cream dark:hover:bg-night"
                      >
                        <LogOut size={15} />
                        Log out
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

// Google avatar URLs are external (lh3.googleusercontent.com etc.), and
// next/image only loads external images from domains explicitly whitelisted
// in next.config.mjs — none are, so <Image> silently failed to render here.
// A plain <img> with an onError fallback has no such restriction; this
// mirrors the same working approach already used in components/navbar.tsx.
function HeaderAvatar({
  avatarUrl,
  fallbackLetter,
}: {
  avatarUrl?: string | null;
  fallbackLetter: string;
}) {
  const [failed, setFailed] = useState(false);

  if (avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Google-hosted URL, not a local asset
      <img
        src={avatarUrl}
        alt=""
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <span className="grid h-full w-full place-items-center font-display text-xs font-semibold text-ink">
      {fallbackLetter}
    </span>
  );
}
