"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, X, LogIn, LogOut, LayoutDashboard } from "lucide-react";

const links = [
  { label: "Pricing", href: "/pricing" },
  { label: "Speaking Club", href: "/speaking-club" },
  { label: "Mock Test", href: "/mock-test" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  type NavUser = { name?: string | null; email: string; avatarUrl?: string | null };
  const [user, setUser] = useState<NavUser | null | undefined>(undefined); // undefined = still checking

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

  return (
    <header className="sticky top-0 z-50 px-4 py-4 md:px-6">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-pill border border-ink/5 bg-white/90 px-6 py-3.5 shadow-sm backdrop-blur">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="relative block h-9 w-9 overflow-hidden rounded-full ring-1 ring-ink/10">
            <Image
              src="/logo.svg"
              alt="LingoCraft"
              fill
              className="object-cover"
            />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">
            LingoCraft
          </span>
        </Link>

        <div className="hidden items-center gap-7 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group relative font-body text-sm font-medium text-ink-soft transition-colors hover:text-ink"
            >
              {link.label}
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-leaf-600 transition-all duration-200 group-hover:w-full" />
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 lg:flex">
          {user === undefined ? null : user ? (
            <ProfileMenu user={user} />
          ) : (
            <Link
              href="/login"
              className="group flex items-center gap-1.5 font-body text-sm font-medium text-ink-soft transition-colors hover:text-ink"
            >
              <LogIn size={16} className="transition-transform duration-200 group-hover:-translate-y-0.5" />
              Login
            </Link>
          )}
        </div>

        <button
          aria-label="Toggle menu"
          className="focus-ring rounded-lg p-2 transition-colors hover:bg-leaf-100 lg:hidden"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {open && (
        <div className="mx-auto mt-2 flex max-w-6xl flex-col gap-1 rounded-2xl border border-ink/5 bg-white/95 px-4 py-4 shadow-sm backdrop-blur lg:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-3 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100"
            >
              {link.label}
            </Link>
          ))}

          {user === undefined ? null : user ? (
            <div className="mt-2 border-t border-ink/5 pt-3">
              <div className="flex items-center gap-3 rounded-xl bg-cream px-3 py-2.5">
                <Avatar user={user} />
                <div className="min-w-0">
                  <p className="truncate font-body text-sm font-semibold text-ink">
                    {user.name || "Account"}
                  </p>
                  <p className="truncate font-body text-xs text-ink-soft/80">
                    {user.email}
                  </p>
                </div>
              </div>

              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="mt-3 flex items-center gap-2.5 rounded-xl bg-leaf-100 px-3 py-3 font-body text-sm font-semibold text-leaf-700 transition-colors hover:bg-leaf-300/60"
              >
                <LayoutDashboard size={17} />
                Dashboard
              </Link>

              <LogoutAction className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-3 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100" />
            </div>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-3 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100"
            >
              <LogIn size={16} />
              Login
            </Link>
          )}
        </div>
      )}
    </header>
  );
}

// Avatar with a dropdown (Profile / Log out) — click the avatar to toggle,
// click outside or pick an item to close it.
function ProfileMenu({ user }: { user: { name?: string | null; email: string; avatarUrl?: string | null } }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        aria-label="Open profile menu"
        onClick={() => setMenuOpen((v) => !v)}
        className="focus-ring flex items-center rounded-full transition-opacity hover:opacity-80"
      >
        <Avatar user={user} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-44 overflow-hidden rounded-xl border border-ink/5 bg-white shadow-sm">
          <Link
            href="/dashboard"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-2 px-4 py-2.5 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink"
          >
            <LayoutDashboard size={15} />
            Dashboard
          </Link>
          <LogoutAction className="flex w-full items-center gap-2 px-4 py-2.5 font-body text-sm font-medium text-ink-soft transition-colors hover:bg-leaf-100 hover:text-ink" />
        </div>
      )}
    </div>
  );
}

// Small logout action used inside the profile dropdown / mobile menu.
// Kept local to the navbar so its compact styling doesn't affect the
// larger standalone <LogoutButton /> used on the profile page.
function LogoutAction({ className }: { className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleLogout} disabled={loading} className={className}>
      <LogOut size={15} />
      {loading ? "Logging out…" : "Log out"}
    </button>
  );
}

// Shows the person's Google profile picture when they signed in with
// Google (kept in sync on every Google login — see
// lib/next-auth-options.js). Falls back to a generic placeholder avatar
// for email/password accounts, or if the image fails to load.
function Avatar({ user }: { user: { name?: string | null; email: string; avatarUrl?: string | null } }) {
  const [failed, setFailed] = useState(false);

  if (user.avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external Google-hosted URL, not a local asset
      <img
        src={user.avatarUrl}
        alt=""
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 rounded-full object-cover ring-1 ring-ink/10"
      />
    );
  }

  return (
    <img
      src="/default-avatar.svg"
      alt=""
      width={40}
      height={40}
      className="h-10 w-10 shrink-0 rounded-full object-cover"
    />
  );
}
