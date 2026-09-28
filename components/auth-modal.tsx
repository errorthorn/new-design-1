"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { signIn } from "next-auth/react";
import { Loader2, X } from "lucide-react";
import { withWelcome } from "@/lib/welcome-redirect";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = "login" | "signup";

export function AuthModal({
  open,
  onClose,
  onSuccess,
  title = "Sign in to continue",
  subtitle = "You'll need an account before this next step.",
}: {
  open: boolean;
  onClose?: () => void;
  onSuccess: () => void;
  title?: string;
  subtitle?: string;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!EMAIL_RE.test(email.trim())) {
      setError("That doesn't look like a valid email.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        mode === "login"
          ? { email: email.trim(), password, remember: true }
          : { name: name.trim(), email: email.trim(), password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      onSuccess();
      // Marks the URL so the globally-mounted <AuthWelcomeWatcher />
      // (app/layout.tsx) shows the "you're in, here's the dashboard"
      // congrats modal on top of whichever page this modal was opened
      // from — speaking club, mock test, or payment. router.replace here
      // only updates the query string, no page reload, so it won't
      // disturb onSuccess()'s own effects (checkAuth, setAuthStage, etc.)
      // above.
      router.replace(withWelcome(window.location.pathname + window.location.search), { scroll: false });
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleGoogle() {
    setGoogleLoading(true);
    // Google's flow is a full-page redirect that unmounts this modal
    // entirely, so the query-marker trick (not a JS callback) is what
    // gets the congrats modal to show up after the person lands back
    // here — see lib/welcome-redirect.ts.
    signIn("google", { callbackUrl: withWelcome(window.location.href) });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 px-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative w-full max-w-sm rounded-2xl bg-white p-7 shadow-2xl"
          >
            {onClose && (
              <button
                onClick={onClose}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-cream-soft"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            )}

            <h2 className="font-display text-xl font-extrabold text-ink">{title}</h2>
            <p className="mt-1 font-body text-sm text-ink-soft">{subtitle}</p>

            <button
              onClick={handleGoogle}
              disabled={googleLoading}
              className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-xl border border-ink/15 bg-white py-3 font-body text-sm font-semibold text-ink transition-colors hover:bg-cream-soft disabled:opacity-60"
            >
              {googleLoading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-ink/10" />
              <span className="font-body text-xs text-ink-soft/60">or</span>
              <div className="h-px flex-1 bg-ink/10" />
            </div>

            <div className="mb-4 flex rounded-xl bg-cream-soft p-1">
              <button
                type="button"
                onClick={() => setMode("login")}
                className={`flex-1 rounded-lg py-2 font-display text-sm font-semibold transition-colors ${
                  mode === "login" ? "bg-white text-ink shadow-sm" : "text-ink-soft"
                }`}
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`flex-1 rounded-lg py-2 font-display text-sm font-semibold transition-colors ${
                  mode === "signup" ? "bg-white text-ink shadow-sm" : "text-ink-soft"
                }`}
              >
                Sign up
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              {mode === "signup" && (
                <input
                  type="text"
                  placeholder="Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 rounded-xl border border-ink/15 bg-white px-4 font-body text-sm text-ink outline-none focus-ring"
                />
              )}
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 rounded-xl border border-ink/15 bg-white px-4 font-body text-sm text-ink outline-none focus-ring"
              />
              <input
                type="password"
                placeholder={mode === "signup" ? "Create a password" : "Password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-xl border border-ink/15 bg-white px-4 font-body text-sm text-ink outline-none focus-ring"
              />

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 font-body text-xs text-red-600">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-leaf-600 font-display text-sm font-bold text-white transition-colors hover:bg-leaf-700 disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : mode === "login" ? (
                  "Log in"
                ) : (
                  "Create account"
                )}
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C33.9 6 29.2 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C33.9 6 29.2 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.8-2 13.2-5.2l-6.1-5.2c-2 1.5-4.6 2.4-7.1 2.4-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C9.6 39.6 16.3 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.2 5.6l6.1 5.2C40.8 36.1 44 30.6 44 24c0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
