"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, useInView, animate } from "framer-motion";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import {
  Camera,
  Trash2,
  Loader2,
  Check,
  Mail,
  Calendar,
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  Mic,
  Flame,
  Target,
  ListChecks,
  Sparkles,
  BadgeCheck,
  Bell,
  BellOff,
  Award,
  Share2,
  Download,
  AlertTriangle,
  Monitor,
  LogOut,
} from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import LogoutButton from "@/app/logout-button";

type Profile = {
  id: number;
  email: string;
  name: string;
  avatarUrl: string | null;
  subscriptionActive: boolean;
  subscriptionExpiresAt: string | null;
  hasPassword: boolean;
  googleLinked: boolean;
  memberSince: string | null;
  emailRemindersEnabled: boolean;
  seenAchievements: string[];
  achievementsInitialized: boolean;
};

type Attempt = {
  id: string;
  started_at: string;
  completed_at: string | null;
  score: number | null;
};

type DeviceSession = {
  id: string;
  deviceLabel: string;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
};

const MAX_BAND = 9;

const TABS = [
  { id: "profile" as const, label: "Profile", icon: BadgeCheck },
  { id: "security" as const, label: "Security", icon: KeyRound },
  { id: "progress" as const, label: "Progress", icon: Target },
  { id: "settings" as const, label: "Settings", icon: Bell },
];
const AVATAR_SIZE = 320; // px the image is downscaled to before upload

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Resizes/crops any picked image to a small square JPEG in the browser
// before it's ever sent to the server — keeps the request tiny and the
// stored avatar_url column light, no upload endpoint or storage bucket
// needed for this (mirrors how avatar_url already just holds a URL string
// for Google avatars).
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read-failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode-failed"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no-canvas-context"));

        // Cover-crop to a centered square so odd aspect ratios don't squish.
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);

        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function ConfettiBurst({ active }: { active: boolean }) {
  const colors = ["#4C9E2C", "#6BCB3F", "#F5EEDF", "#15170F", "#F0B94E"];
  const particles = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 320,
        rotate: Math.random() * 360,
        delay: Math.random() * 0.15,
        color: colors[i % colors.length],
        size: 6 + Math.random() * 6,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active]
  );

  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-[60] flex justify-center overflow-hidden">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: 220, opacity: 0, rotate: p.rotate }}
          transition={{ duration: 1.6, delay: p.delay, ease: "easeOut" }}
          style={{
            position: "absolute",
            width: p.size,
            height: p.size * 0.6,
            backgroundColor: p.color,
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

function RingStat({
  icon: Icon,
  numericValue,
  decimals = 0,
  suffix = "",
  staticValue,
  label,
  pct,
}: {
  icon: React.ElementType;
  numericValue: number;
  decimals?: number;
  suffix?: string;
  staticValue?: string;
  label: string;
  pct: number;
}) {
  const r = 30;
  const size = 72;
  const c = 2 * Math.PI * r;
  const clampedPct = Math.max(0, Math.min(100, pct));
  const offset = c - (clampedPct / 100) * c;

  const wrapRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(wrapRef, { once: true, margin: "-10% 0px" });

  useEffect(() => {
    if (!isInView || !numberRef.current || staticValue) return;
    const controls = animate(0, numericValue, {
      duration: 1,
      ease: "easeOut",
      onUpdate(v) {
        if (numberRef.current) {
          numberRef.current.textContent = v.toFixed(decimals) + suffix;
        }
      },
    });
    return () => controls.stop();
  }, [isInView, numericValue, decimals, suffix, staticValue]);

  return (
    <div ref={wrapRef} className="flex items-center gap-4">
      <div className="relative shrink-0">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="6" className="stroke-leaf-100 dark:stroke-night-border" />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className="stroke-leaf-500"
            style={{ strokeDasharray: c }}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: isInView ? offset : c }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
        </svg>
        <Icon size={20} className="absolute inset-0 m-auto text-leaf-700 dark:text-leaf-500" />
      </div>
      <div>
        <div ref={numberRef} className="font-display text-2xl font-bold text-ink dark:text-cream">
          {staticValue ?? `0${suffix}`}
        </div>
        <div className="font-body text-sm text-ink-soft dark:text-cream/60">{label}</div>
      </div>
    </div>
  );
}

export default function ProfilePage({ embedded = false }: { embedded?: boolean } = {}) {
  const [stage, setStage] = useState<"checking" | "ready">("checking");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState("");

  const [name, setName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameStatus, setNameStatus] = useState<{ text: string; type: "" | "success" | "error" }>({
    text: "",
    type: "",
  });

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attempts, setAttempts] = useState<Attempt[] | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwStatus, setPwStatus] = useState<{ text: string; type: "" | "success" | "error" }>({
    text: "",
    type: "",
  });

  // Notification preference
  const [emailReminders, setEmailReminders] = useState(true);
  const [reminderSaving, setReminderSaving] = useState(false);

  // Sessions & devices
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState("");

  // Danger zone
  const [exporting, setExporting] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Share
  const [shareStatus, setShareStatus] = useState("");

  // Tab layout
  const [activeTab, setActiveTab] = useState<"profile" | "security" | "progress" | "settings">(
    "profile"
  );

  // Celebration confetti — fires when a badge flips from locked to
  // unlocked since the person's last visit. Compares against a small
  // per-browser localStorage record (no backend "seen" tracking exists
  // for this), and deliberately does NOT fire on someone's very first
  // ever page load even if they already qualify for a badge — only on
  // a genuine new unlock.
  const [celebrate, setCelebrate] = useState(false);

  // The dashboard shell toggles a `.dark` class on a wrapper div (not
  // documentElement), so Tailwind's `dark:` variants handle almost
  // everything automatically. Recharts, however, takes its colors as
  // plain JS values (fill/stroke/contentStyle), which CSS classes can't
  // reach — so we track the ancestor's `.dark` class ourselves and feed
  // it into the chart's inline colors below.
  const mainRef = useRef<HTMLElement>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const syncDark = () => setIsDark(!!el.closest(".dark"));
    syncDark();
    const observer = new MutationObserver(syncDark);
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"], subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/profile");
        if (res.status === 401) {
          window.location.href = "/login?next=/profile";
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error ?? "Could not load profile.");
          setStage("ready");
          return;
        }
        setProfile(data.profile);
        setName(data.profile.name || "");
        setEmailReminders(data.profile.emailRemindersEnabled ?? true);
        setStage("ready");

        if (data.profile.subscriptionActive) {
          const attemptsRes = await fetch("/api/mock-test/attempts");
          const attemptsData = await attemptsRes.json();
          if (!cancelled && attemptsRes.ok) setAttempts(attemptsData.attempts ?? []);
        }

        fetch("/api/profile/sessions")
          .then((r) => r.json())
          .then((d) => {
            if (!cancelled) setSessions(d.sessions ?? []);
          })
          .catch(() => {
            if (!cancelled) setSessionsError("Could not load session data.");
          });
      } catch {
        if (!cancelled) {
          setLoadError("Could not reach the server. Please try again.");
          setStage("ready");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    if (!attempts) return null;
    const completed = attempts.filter((a) => a.completed_at);
    const scored = completed.filter((a) => a.score != null);
    const avg = scored.length
      ? scored.reduce((sum, a) => sum + (a.score as number), 0) / scored.length
      : null;

    let streak = 0;
    for (let i = completed.length - 1; i >= 0; i--) {
      if (i === completed.length - 1) {
        streak = 1;
        continue;
      }
      const gap =
        new Date(completed[i + 1].started_at).getTime() - new Date(completed[i].started_at).getTime();
      if (gap <= 8 * 24 * 60 * 60 * 1000) streak++;
      else break;
    }

    return { totalCompleted: completed.length, avgScore: avg, streak };
  }, [attempts]);

  // Best score so far — used both for the "Band 7+" achievement and to
  // decide whether the trend chart has meaningfully improving data.
  const bestScore = useMemo(() => {
    if (!attempts) return null;
    const scores = attempts.filter((a) => a.score != null).map((a) => a.score as number);
    return scores.length ? Math.max(...scores) : null;
  }, [attempts]);

  // Chronological (oldest → newest) scored attempts, for the trend chart.
  const trendData = useMemo(() => {
    if (!attempts) return [];
    return attempts
      .filter((a) => a.score != null)
      .slice()
      .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
      .map((a) => ({
        date: new Date(a.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        score: a.score as number,
      }));
  }, [attempts]);

  const achievements = useMemo(() => {
    if (!stats) return [];
    return [
      {
        id: "first-test",
        label: "First Test",
        icon: Mic,
        unlocked: stats.totalCompleted >= 1,
      },
      {
        id: "five-tests",
        label: "5 Tests Done",
        icon: ListChecks,
        unlocked: stats.totalCompleted >= 5,
      },
      {
        id: "three-week-streak",
        label: "3-Week Streak",
        icon: Flame,
        unlocked: stats.streak >= 3,
      },
      {
        id: "band-7",
        label: "Band 7+",
        icon: Target,
        unlocked: (bestScore ?? 0) >= 7,
      },
    ];
  }, [stats, bestScore]);

  // Celebration confetti — fires when a badge flips from locked to
  // unlocked since the person's last visit. Compares against a small
  // per-browser localStorage record (no backend "seen" tracking exists
  // for this), and deliberately does NOT fire on someone's very first
  // ever page load even if they already qualify for a badge — only on
  // a genuine new unlock.
  useEffect(() => {
    if (!achievements.length || !profile) return;
    const unlockedIds = achievements.filter((a) => a.unlocked).map((a) => a.id);
    const seen = profile.seenAchievements ?? [];
    const newlyUnlocked = unlockedIds.filter((id) => !seen.includes(id));

    // Nothing changed since we last synced this account's badge state —
    // skip the network round trip entirely.
    const sameSet =
      newlyUnlocked.length === 0 &&
      seen.length === unlockedIds.length &&
      profile.achievementsInitialized;
    if (sameSet) return;

    // Only celebrate once this account has a real baseline to compare
    // against — otherwise everyone would get a confetti burst for badges
    // they already earned the very first time they open /profile.
    if (profile.achievementsInitialized && newlyUnlocked.length) {
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 2200);
    }

    // Persisted server-side (not localStorage) so this is consistent no
    // matter which device/browser the person next opens /profile from.
    fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seenAchievements: unlockedIds }),
    })
      .then((res) => {
        if (!res.ok) return;
        setProfile((p) =>
          p ? { ...p, seenAchievements: unlockedIds, achievementsInitialized: true } : p
        );
      })
      .catch(() => {
        // Best-effort — if this fails, the next time achievements are
        // recomputed (e.g. next visit) it'll simply try again.
      });
  }, [achievements, profile]);

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file) return;

    setAvatarError("");
    if (!file.type.startsWith("image/")) {
      setAvatarError("Only image files can be uploaded.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setAvatarError("This image is too large (must be under 8MB).");
      return;
    }

    setAvatarBusy(true);
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: dataUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAvatarError(data.error ?? "Could not upload image.");
        return;
      }
      setProfile((p) => (p ? { ...p, avatarUrl: dataUrl } : p));
    } catch {
      setAvatarError("Could not process the image. Please try a different one.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleAvatarRemove() {
    setAvatarBusy(true);
    setAvatarError("");
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAvatarError(data.error ?? "Could not remove image.");
        return;
      }
      setProfile((p) => (p ? { ...p, avatarUrl: null } : p));
    } finally {
      setAvatarBusy(false);
    }
  }

  async function handleNameSave(e: React.FormEvent) {
    e.preventDefault();
    setNameStatus({ text: "", type: "" });
    if (!name.trim()) {
      setNameStatus({ text: "Name cannot be left empty.", type: "error" });
      return;
    }
    setNameSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNameStatus({ text: data.error ?? "Could not save.", type: "error" });
        return;
      }
      setProfile((p) => (p ? { ...p, name: name.trim() } : p));
      setNameStatus({ text: "Name updated.", type: "success" });
    } catch {
      setNameStatus({ text: "Could not reach the server.", type: "error" });
    } finally {
      setNameSaving(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwStatus({ text: "", type: "" });

    if (newPassword.length < 6) {
      setPwStatus({ text: "New password must be at least 6 characters.", type: "error" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwStatus({ text: "The two passwords don't match.", type: "error" });
      return;
    }
    if (profile?.hasPassword && !currentPassword) {
      setPwStatus({ text: "Enter your current password.", type: "error" });
      return;
    }

    setPwSaving(true);
    try {
      const res = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPwStatus({ text: data.error ?? "Could not update password.", type: "error" });
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setProfile((p) => (p ? { ...p, hasPassword: true } : p));
      setPwStatus({
        text: data.wasSet ? "Password set. You can now log in with email too." : "Password updated.",
        type: "success",
      });
    } catch {
      setPwStatus({ text: "Could not reach the server.", type: "error" });
    } finally {
      setPwSaving(false);
    }
  }

  async function handleReminderToggle() {
    const next = !emailReminders;
    setEmailReminders(next); // optimistic
    setReminderSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailRemindersEnabled: next }),
      });
      if (!res.ok) setEmailReminders(!next); // revert on failure
    } catch {
      setEmailReminders(!next);
    } finally {
      setReminderSaving(false);
    }
  }

  async function handleRevokeSession(sessionId: string) {
    setRevokingId(sessionId);
    setSessionsError("");
    try {
      const res = await fetch("/api/profile/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSessionsError(data.error ?? "Could not cancel session.");
        return;
      }
      setSessions((s) => (s ? s.filter((x) => x.id !== sessionId) : s));
    } catch {
      setSessionsError("Could not reach the server.");
    } finally {
      setRevokingId(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/profile/export");
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lingocraft-data-${profile?.id ?? "export"}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleteError("");
    if (!profile || deleteConfirmEmail.trim().toLowerCase() !== profile.email.toLowerCase()) {
      setDeleteError("Type the email exactly as shown above.");
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/profile", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: deleteConfirmEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error ?? "Could not delete account.");
        setDeleting(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setDeleteError("Could not reach the server.");
      setDeleting(false);
    }
  }

  async function handleShare() {
    if (!stats?.avgScore) return;
    const text = `I've been practicing with LingoCraft Speaking Club and reached a ${stats.avgScore.toFixed(
      1
    )} band score! 🎙️`;
    const url = typeof window !== "undefined" ? window.location.origin : "";
    try {
      if (navigator.share) {
        await navigator.share({ text, url });
        return;
      }
      await navigator.clipboard.writeText(`${text} ${url}`);
      setShareStatus("Copied!");
      setTimeout(() => setShareStatus(""), 2500);
    } catch {
      // User cancelled the native share sheet — not an error worth surfacing.
    }
  }

  if (stage === "checking") {
    return (
      <>
        {!embedded && <Navbar />}
        <section className="px-6 pb-16 pt-14">
          <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
            <div className="h-6 w-32 animate-pulse rounded-pill bg-cream-deep dark:bg-night-deep" />
            <div className="mt-5 h-28 w-28 animate-pulse rounded-full bg-cream-deep dark:bg-night-deep" />
            <div className="mt-4 h-8 w-48 animate-pulse rounded-lg bg-cream-deep dark:bg-night-deep" />
            <div className="mt-2 h-4 w-56 animate-pulse rounded-lg bg-cream-deep dark:bg-night-deep" />
          </div>
        </section>
        <section className="mx-auto flex max-w-3xl flex-col gap-6 px-6 pb-24">
          <div className="mb-2 h-11 w-72 animate-pulse rounded-xl bg-cream-deep dark:bg-night-deep" />
          <div className="h-52 animate-pulse rounded-2xl bg-cream-soft dark:bg-night-soft" />
          <div className="h-64 animate-pulse rounded-2xl bg-cream-soft dark:bg-night-soft" />
        </section>
      </>
    );
  }

  if (loadError || !profile) {
    return (
      <>
        {!embedded && <Navbar />}
        <div className="flex min-h-[60vh] items-center justify-center px-6">
          <p className="font-body text-ink-soft dark:text-cream/60">{loadError || "Profile not found."}</p>
        </div>
        {!embedded && <Footer />}
      </>
    );
  }

  const initial = (profile.name || profile.email || "?").trim().charAt(0).toUpperCase();

  return (
    <main ref={mainRef}>
      {!embedded && <Navbar />}
      <ConfettiBurst active={celebrate} />

      {/* ===== Header ===== */}
      <section className="relative overflow-hidden px-6 pb-16 pt-14">
        <div className="relative mx-auto flex max-w-4xl flex-col items-center text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-5 inline-flex items-center gap-2 rounded-pill border border-ink/10 dark:border-night-border bg-cream-soft dark:bg-night-soft px-4 py-1.5 font-display text-xs font-semibold uppercase tracking-wide text-leaf-700 dark:text-leaf-500"
          >
            <Sparkles size={14} />
            Your Account
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="group relative"
          >
            {profile.subscriptionActive && (
              <div
                className="absolute -inset-1.5 animate-spin-slow rounded-full"
                style={{
                  background:
                    "conic-gradient(from 0deg, #6BCB3F, #F5EEDF, #6BCB3F, #4C9E2C, #6BCB3F)",
                }}
                aria-hidden="true"
              />
            )}
            <div className="relative h-28 w-28 overflow-hidden rounded-full ring-4 ring-cream-soft shadow-lg dark:ring-night-soft">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- can be a Google URL or a locally-generated data URL
                <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-leaf-100 font-display text-4xl font-bold text-leaf-700 dark:bg-night dark:text-leaf-500">
                  {initial}
                </div>
              )}
              {avatarBusy && (
                <div className="absolute inset-0 flex items-center justify-center bg-ink/40 dark:bg-night/60">
                  <Loader2 className="animate-spin text-cream" size={22} />
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarBusy}
              aria-label="Change profile picture"
              className="focus-ring absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-leaf-500 text-ink dark:text-cream shadow-md transition-transform hover:-translate-y-0.5 hover:bg-leaf-600 disabled:opacity-60"
            >
              <Camera size={16} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarPick}
            />
          </motion.div>

          {profile.avatarUrl && (
            <button
              type="button"
              onClick={handleAvatarRemove}
              disabled={avatarBusy}
              className="mt-2 flex items-center gap-1 font-body text-xs text-ink-soft dark:text-cream/60 transition-colors hover:text-red-600 disabled:opacity-60"
            >
              <Trash2 size={12} />
              Remove photo
            </button>
          )}
          {avatarError && <p className="mt-2 font-body text-xs text-red-600">{avatarError}</p>}

          <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink dark:text-cream md:text-4xl">
            {profile.name || "Your Profile"}
          </h1>
          <p className="mt-1 flex items-center gap-1.5 font-body text-sm text-ink-soft dark:text-cream/60">
            <Mail size={14} />
            {profile.email}
          </p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-4 flex flex-wrap items-center justify-center gap-2"
          >
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-ink/10 dark:border-night-border bg-cream-soft dark:bg-night-soft px-3 py-1 font-body text-xs font-medium text-ink-soft dark:text-cream/60">
              <Calendar size={12} />
              Member since {formatDate(profile.memberSince)}
            </span>
            {profile.googleLinked && (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-ink/10 dark:border-night-border bg-cream-soft dark:bg-night-soft px-3 py-1 font-body text-xs font-medium text-ink-soft dark:text-cream/60">
                <ShieldCheck size={12} />
                Google connected
              </span>
            )}
            {profile.subscriptionActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-leaf-500 px-3 py-1 font-body text-xs font-semibold text-ink dark:text-cream">
                <BadgeCheck size={12} />
                Speaking Club Member
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-ink/10 dark:border-night-border bg-cream-soft dark:bg-night-soft px-3 py-1 font-body text-xs font-medium text-ink-soft dark:text-cream/60">
                Not a Speaking Club member yet
              </span>
            )}
          </motion.div>
        </div>
      </section>

      {/* ===== Body ===== */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <div className="mb-8 flex items-center gap-2 border-b border-ink/10 dark:border-night-border sm:gap-3">
          <div className="no-scrollbar -mb-px flex flex-1 gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-3 font-display text-sm font-semibold transition-colors sm:px-4 ${
                  activeTab === t.id ? "text-ink dark:text-cream" : "text-ink-soft dark:text-cream/60 hover:text-ink dark:hover:text-cream"
                }`}
              >
                <t.icon size={15} />
                <span>{t.label}</span>
                {activeTab === t.id && (
                  <motion.div
                    layoutId="profile-tab-underline"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-leaf-500 sm:inset-x-3"
                  />
                )}
              </button>
            ))}
          </div>
          <div className="hidden shrink-0 pb-3 sm:block">
            <LogoutButton />
          </div>
        </div>

        {activeTab === "profile" && (
          <div className="flex flex-col gap-6">
          {/* Profile info */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ duration: 0.5 }}
          >
          <Card>
            <h2 className="font-display text-lg font-bold text-ink dark:text-cream">Profile Details</h2>
            <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
              This is what shows up in the navbar and on your mock test attempts.
            </p>

            <form onSubmit={handleNameSave} className="mt-5 flex flex-col gap-4">
              <div>
                <label htmlFor="name" className="mb-1.5 block font-body text-sm font-medium text-ink dark:text-cream">
                  Full name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameStatus({ text: "", type: "" });
                  }}
                  className="focus-ring w-full rounded-xl border border-ink/15 dark:border-night-border bg-cream-soft dark:bg-night-soft px-4 py-2.5 font-body text-[15px] text-ink dark:text-cream placeholder:text-ink-soft/50 dark:placeholder:text-cream/40"
                  placeholder="Your name"
                />
              </div>

              <div>
                <label className="mb-1.5 block font-body text-sm font-medium text-ink dark:text-cream">Email</label>
                <input
                  type="email"
                  value={profile.email}
                  disabled
                  className="w-full cursor-not-allowed rounded-xl border border-ink/10 dark:border-night-border bg-cream-deep dark:bg-night-deep px-4 py-2.5 font-body text-[15px] text-ink-soft dark:text-cream/60"
                />
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" variant="accent" size="sm" disabled={nameSaving}>
                  {nameSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  Save changes
                </Button>
                {nameStatus.text && (
                  <span
                    className={`font-body text-sm ${
                      nameStatus.type === "success" ? "text-leaf-700 dark:text-leaf-500" : "text-red-600"
                    }`}
                  >
                    {nameStatus.text}
                  </span>
                )}
              </div>
            </form>
          </Card>
          </motion.div>
          </div>
        )}

        {activeTab === "security" && (
          <div className="flex flex-col gap-6">
          {/* Password */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
          <Card>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink dark:text-cream">
              <KeyRound size={18} />
              {profile.hasPassword ? "Change Password" : "Set a Password"}
            </h2>
            <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
              {profile.hasPassword
                ? "Update the password you use to log in with your email."
                : "You currently sign in with Google only. Set a password to also be able to log in with your email."}
            </p>

            <form onSubmit={handlePasswordSubmit} className="mt-5 flex flex-col gap-4">
              {profile.hasPassword && (
                <div>
                  <label htmlFor="currentPassword" className="mb-1.5 block font-body text-sm font-medium text-ink dark:text-cream">
                    Current password
                  </label>
                  <input
                    id="currentPassword"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="focus-ring w-full rounded-xl border border-ink/15 dark:border-night-border bg-cream-soft dark:bg-night-soft px-4 py-2.5 font-body text-[15px] text-ink dark:text-cream"
                  />
                </div>
              )}

              <div>
                <label htmlFor="newPassword" className="mb-1.5 block font-body text-sm font-medium text-ink dark:text-cream">
                  New password
                </label>
                <input
                  id="newPassword"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="focus-ring w-full rounded-xl border border-ink/15 dark:border-night-border bg-cream-soft dark:bg-night-soft px-4 py-2.5 font-body text-[15px] text-ink dark:text-cream"
                  placeholder="At least 6 characters"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="mb-1.5 block font-body text-sm font-medium text-ink dark:text-cream">
                  Confirm new password
                </label>
                <input
                  id="confirmPassword"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="focus-ring w-full rounded-xl border border-ink/15 dark:border-night-border bg-cream-soft dark:bg-night-soft px-4 py-2.5 font-body text-[15px] text-ink dark:text-cream"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="-mt-2 flex w-fit items-center gap-1.5 font-body text-xs text-ink-soft dark:text-cream/60 transition-colors hover:text-ink dark:hover:text-cream"
              >
                {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                {showPw ? "Hide" : "Show"} passwords
              </button>

              <div className="flex items-center gap-3">
                <Button type="submit" variant="accent" size="sm" disabled={pwSaving}>
                  {pwSaving ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                  {profile.hasPassword ? "Update password" : "Set password"}
                </Button>
                {pwStatus.text && (
                  <span
                    className={`font-body text-sm ${
                      pwStatus.type === "success" ? "text-leaf-700 dark:text-leaf-500" : "text-red-600"
                    }`}
                  >
                    {pwStatus.text}
                  </span>
                )}
              </div>
            </form>
          </Card>
          </motion.div>

          {/* Sessions & devices */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ duration: 0.5, delay: 0.14 }}
          >
          <Card>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink dark:text-cream">
              <Monitor size={18} />
              Sessions &amp; Devices
            </h2>
            <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
              Where you&apos;re currently logged in with your email/password.
            </p>

            {sessionsError && <p className="mt-3 font-body text-xs text-red-600">{sessionsError}</p>}

            {sessions === null && !sessionsError && (
              <div className="mt-4 flex items-center gap-2 font-body text-sm text-ink-soft dark:text-cream/60">
                <Loader2 size={14} className="animate-spin" />
                Loading...
              </div>
            )}

            {sessions && (
              <div className="mt-4 flex flex-col gap-2">
                {sessions.length === 0 && (
                  <p className="font-body text-sm text-ink-soft dark:text-cream/60">No tracked sessions found.</p>
                )}
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-cream dark:bg-night px-3 py-2.5"
                  >
                    <div>
                      <div className="font-body text-sm font-medium text-ink dark:text-cream">
                        {s.deviceLabel}
                        {s.isCurrent && (
                          <span className="ml-2 rounded-pill bg-leaf-100 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-wide text-leaf-700 dark:bg-night dark:text-leaf-500">
                            This device
                          </span>
                        )}
                      </div>
                      <div className="font-body text-xs text-ink-soft dark:text-cream/60">
                        Last active {formatDate(s.lastSeenAt)}
                      </div>
                    </div>
                    {!s.isCurrent && (
                      <button
                        type="button"
                        onClick={() => handleRevokeSession(s.id)}
                        disabled={revokingId === s.id}
                        aria-label={`Log out ${s.deviceLabel}`}
                        className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft dark:text-cream/60 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                      >
                        {revokingId === s.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <LogOut size={15} />
                        )}
                      </button>
                    )}
                  </div>
                ))}
                {profile.googleLinked && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-cream dark:bg-night px-3 py-2.5">
                    <div>
                      <div className="font-body text-sm font-medium text-ink dark:text-cream">Google sign-in</div>
                      <div className="font-body text-xs text-ink-soft dark:text-cream/60">
                        Managed by your Google account — not revocable from here
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
          </motion.div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="flex flex-col gap-6">
          {/* Notification preferences */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ duration: 0.5, delay: 0.12 }}
          >
          <Card>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink dark:text-cream">
              {emailReminders ? <Bell size={18} /> : <BellOff size={18} />}
              Notifications
            </h2>
            <div className="mt-4 flex items-center justify-between gap-4">
              <div>
                <div className="font-body text-sm font-medium text-ink dark:text-cream">Weekly practice reminders</div>
                <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/60">
                  Email nudge when your next mock test unlocks.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailReminders}
                onClick={handleReminderToggle}
                disabled={reminderSaving}
                className={`focus-ring flex h-7 w-12 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-200 disabled:opacity-60 ${
                  emailReminders ? "justify-end bg-leaf-500" : "justify-start bg-ink/15 dark:bg-night-border"
                }`}
              >
                <motion.span layout transition={{ type: "spring", stiffness: 700, damping: 32 }} className="h-6 w-6 rounded-full bg-white shadow-sm" />
              </button>
            </div>
          </Card>
          </motion.div>

          {/* Danger zone */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10%" }}
            transition={{ duration: 0.5, delay: 0.16 }}
          >
          <Card className="border-red-200 bg-red-50/40 hover:border-red-300 dark:border-red-900/50 dark:bg-red-950/20 dark:hover:border-red-800">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-red-700 dark:text-red-400">
              <AlertTriangle size={18} />
              Danger Zone
            </h2>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b border-red-200/70 pb-4 dark:border-red-900/40">
              <div>
                <div className="font-body text-sm font-medium text-ink dark:text-cream">Export your data</div>
                <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/60">
                  Download everything stored on your account as a JSON file.
                </p>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                Export
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-body text-sm font-medium text-ink dark:text-cream">Delete account</div>
                <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/60">
                  Permanently removes your account and mock test history. Can&apos;t be undone.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDeleteModalOpen(true);
                  setDeleteConfirmEmail("");
                  setDeleteError("");
                }}
                className="focus-ring inline-flex items-center gap-2 rounded-pill border-2 border-red-600 px-5 py-2.5 font-display text-sm font-semibold text-red-600 transition-all hover:-translate-y-0.5 hover:bg-red-600 hover:text-cream dark:border-red-500 dark:text-red-400"
              >
                <Trash2 size={15} />
                Delete
              </button>
            </div>
          </Card>
          </motion.div>
          </div>
        )}

        {activeTab === "progress" && (
          <div className="flex flex-col gap-6">
        {/* Speaking Club progress */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.5, delay: 0.15 }}
          
        >
          <Card>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink dark:text-cream">
              <Mic size={18} />
              Speaking Club Progress
            </h2>

            {!profile.subscriptionActive && (
              <div className="mt-4">
                <p className="font-body text-sm text-ink-soft dark:text-cream/60">
                  Join Speaking Club to unlock weekly AI-voice mock speaking tests and start tracking your
                  band score improvement here.
                </p>
                <Link
                  href="/payment"
                  className="mt-4 inline-flex items-center gap-2 rounded-pill bg-leaf-500 px-5 py-2.5 font-display text-sm font-semibold text-ink dark:text-cream shadow-sm transition-all hover:-translate-y-0.5 hover:bg-leaf-600 hover:shadow-lg"
                >
                  <Mic size={15} />
                  Join Speaking Club
                </Link>
              </div>
            )}

            {profile.subscriptionActive && attempts === null && (
              <div className="mt-6 flex items-center gap-2 font-body text-sm text-ink-soft dark:text-cream/60">
                <Loader2 size={15} className="animate-spin" />
                Loading your progress...
              </div>
            )}

            {profile.subscriptionActive && stats && (
              <div className="mt-6 flex flex-col gap-5">
                <RingStat
                  icon={ListChecks}
                  numericValue={stats.totalCompleted}
                  label="Tests completed"
                  pct={stats.totalCompleted ? 100 : 0}
                />
                <RingStat
                  icon={Target}
                  numericValue={stats.avgScore ?? 0}
                  decimals={1}
                  staticValue={stats.avgScore == null ? "—" : undefined}
                  label="Average band score"
                  pct={stats.avgScore != null ? (stats.avgScore / MAX_BAND) * 100 : 0}
                />
                <RingStat
                  icon={Flame}
                  numericValue={stats.streak}
                  suffix={stats.streak === 1 ? " week" : " weeks"}
                  label="Practice streak"
                  pct={Math.min(100, stats.streak * 20)}
                />

                {trendData.length >= 2 && (
                  <div className="border-t border-ink/10 dark:border-night-border pt-4">
                    <div className="mb-2 font-body text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-cream/60">
                      Score trend
                    </div>
                    <div className="h-28 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 10, fill: isDark ? "#F5EEDF99" : "#3A3D30" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[0, MAX_BAND]}
                            tick={{ fontSize: 10, fill: isDark ? "#F5EEDF99" : "#3A3D30" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            formatter={(v: number) => [v.toFixed(1), "Band score"]}
                            contentStyle={{
                              fontSize: 12,
                              borderRadius: 10,
                              borderColor: isDark ? "#242A1C" : "#e5e0d0",
                              backgroundColor: isDark ? "#14170F" : "#FFFFFF",
                              color: isDark ? "#F5EEDF" : "#15170F",
                            }}
                            labelStyle={{ color: isDark ? "#F5EEDF" : "#15170F" }}
                          />
                          <Line
                            type="monotone"
                            dataKey="score"
                            stroke="#6BCB3F"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: "#6BCB3F" }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {attempts && attempts.filter((a) => a.completed_at).length > 0 && (
                  <div className="border-t border-ink/10 dark:border-night-border pt-4">
                    <div className="mb-2.5 font-body text-xs font-semibold uppercase tracking-wide text-ink-soft dark:text-cream/60">
                      Recent attempts
                    </div>
                    <div className="flex flex-col gap-2">
                      {attempts
                        .filter((a) => a.completed_at)
                        .slice(0, 3)
                        .map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between rounded-xl bg-cream dark:bg-night px-3 py-2"
                          >
                            <span className="font-body text-sm text-ink-soft dark:text-cream/60">
                              {formatDate(a.started_at)}
                            </span>
                            <span
                              className={`font-display text-sm font-bold ${
                                a.score != null ? "text-leaf-700 dark:text-leaf-500" : "text-ink-soft dark:text-cream/60"
                              }`}
                            >
                              {a.score != null ? a.score.toFixed(1) : "Pending"}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <Link
                  href="/mock-test"
                  className="mt-1 inline-flex items-center justify-center gap-2 rounded-pill border-2 border-ink px-5 py-2.5 font-display text-sm font-semibold text-ink dark:border-cream dark:text-cream transition-all hover:-translate-y-0.5 hover:bg-ink hover:text-cream hover:shadow-lg dark:hover:bg-cream dark:hover:text-ink"
                >
                  Go to Mock Test dashboard
                </Link>

                {stats.avgScore != null && (
                  <button
                    type="button"
                    onClick={handleShare}
                    className="inline-flex items-center justify-center gap-2 rounded-pill bg-cream dark:bg-night px-5 py-2.5 font-display text-sm font-semibold text-ink-soft dark:text-cream/60 transition-all hover:-translate-y-0.5 hover:text-ink dark:hover:text-cream"
                  >
                    <Share2 size={14} />
                    {shareStatus || "Share your band score"}
                  </button>
                )}
              </div>
            )}
          </Card>
        </motion.div>

      {/* Achievements */}
      {stats && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-10%" }}
          transition={{ duration: 0.5 }}
          
        >
          <Card>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink dark:text-cream">
              <Award size={18} />
              Achievements
            </h2>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {achievements.map((a) => {
                const Icon = a.icon;
                return (
                  <div
                    key={a.id}
                    className={`flex flex-col items-center gap-2 rounded-2xl border px-3 py-5 text-center transition-all ${
                      a.unlocked
                        ? "border-leaf-300 bg-leaf-50 hover-lift dark:border-leaf-600 dark:bg-night"
                        : "border-ink/10 dark:border-night-border bg-cream dark:bg-night opacity-50"
                    }`}
                  >
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-full ${
                        a.unlocked ? "bg-leaf-500 text-ink dark:text-cream" : "bg-ink/10 dark:bg-night-border text-ink-soft dark:text-cream/60"
                      }`}
                    >
                      <Icon size={20} />
                    </div>
                    <span className="font-display text-xs font-bold text-ink dark:text-cream">{a.label}</span>
                    {!a.unlocked && (
                      <span className="font-body text-[10px] text-ink-soft dark:text-cream/60">Locked</span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </motion.section>
      )}
          </div>
        )}
      </section>

      {!embedded && <Footer />}

      {deleteModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 px-6 backdrop-blur-sm"
          onClick={() => !deleting && setDeleteModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-cream-soft dark:bg-night-soft p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 font-display text-lg font-bold text-red-700 dark:text-red-400">
              <AlertTriangle size={18} />
              Delete your account?
            </h3>
            <p className="mt-2 font-body text-sm text-ink-soft dark:text-cream/60">
              This permanently deletes your login, subscription status, and mock test history. This
              cannot be undone. Type <span className="font-semibold text-ink dark:text-cream">{profile?.email}</span> to
              confirm.
            </p>
            <input
              type="email"
              value={deleteConfirmEmail}
              onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              placeholder={profile?.email}
              className="focus-ring mt-4 w-full rounded-xl border border-ink/15 dark:border-night-border bg-cream dark:bg-night px-4 py-2.5 font-body text-[15px] text-ink dark:text-cream"
            />
            {deleteError && <p className="mt-2 font-body text-xs text-red-600">{deleteError}</p>}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
                className="font-body text-sm text-ink-soft dark:text-cream/60 transition-colors hover:text-ink dark:hover:text-cream disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="focus-ring inline-flex items-center gap-2 rounded-pill bg-red-600 px-5 py-2.5 font-display text-sm font-semibold text-cream transition-all hover:-translate-y-0.5 hover:bg-red-700 disabled:opacity-60"
              >
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                Delete permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
