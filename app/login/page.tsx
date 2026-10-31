"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { withWelcome } from "@/lib/welcome-redirect";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [status, setStatus] = useState({ text: "", type: "" });
  const [loading, setLoading] = useState(false);

  // NextAuth redirects back here with ?error=... when Google sign-in fails
  // (misconfigured NEXTAUTH_SECRET/redirect URI, our own signIn callback
  // throwing, etc.) — this used to be silently ignored, so a broken Google
  // login looked like "nothing happened" with zero feedback to debug from.
  useEffect(() => {
    const err = searchParams.get("error");
    if (!err) return;
    const message =
      err === "OAuthAccountNotLinked"
        ? "That email is already used with a password sign-in. Log in with your password instead, or contact support to link Google."
        : "Google sign-in didn't go through. Please try again, or use email/password.";
    setStatus({ text: message, type: "error" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validate() {
    let ok = true;
    setEmailError("");
    setPasswordError("");

    if (!email.trim()) {
      setEmailError("Enter your email address.");
      ok = false;
    } else if (!EMAIL_RE.test(email.trim())) {
      setEmailError("That doesn't look like a valid email.");
      ok = false;
    }

    if (!password) {
      setPasswordError("Enter your password.");
      ok = false;
    }

    return ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ text: "", type: "" });
    if (!validate()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, remember }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus({ text: data.error || "Something went wrong.", type: "error" });
        return;
      }

      setStatus({ text: `Welcome back${data.user?.name ? ", " + data.user.name : ""}!`, type: "success" });
      // ?welcome=1 makes the globally-mounted <AuthWelcomeWatcher />
      // (app/layout.tsx) show the post-login congrats modal on the
      // destination page — see lib/welcome-redirect.ts.
      router.push(withWelcome(nextPath));
      router.refresh();
    } catch {
      setStatus({ text: "Couldn't reach the server. Try again.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="form-panel">
        <div className="form-panel__inner">
          <h2 className="form-title">Welcome back</h2>
          <p className="form-subtitle">Enter your email to sign in to your account</p>

          <form onSubmit={handleSubmit} noValidate>
            <div className={`field ${emailError ? "has-error" : ""}`}>
              <label htmlFor="email">Email Address</label>
              <div className="field-input">
                <span className="field-input__icon"><Mail size={18} /></span>
                <input
                  type="email"
                  id="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setEmail(e.target.value); setEmailError(""); }}
                />
              </div>
              <p className="field-error" role="alert">{emailError}</p>
            </div>

            <div className={`field ${passwordError ? "has-error" : ""}`}>
              <div className="field-label-row">
                <label htmlFor="password">Password</label>
                <Link href="/forgot-password" className="link link--small">Forgot?</Link>
              </div>
              <div className="field-input password-input">
                <span className="field-input__icon"><Lock size={18} /></span>
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setPasswordError(""); }}
                />
                <button
                  type="button"
                  className="toggle-visibility"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <p className="field-error" role="alert">{passwordError}</p>
            </div>

            <label className="remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRemember(e.target.checked)}
              />
              <span>Keep me logged in</span>
            </label>

            <button type="submit" className={`btn-submit ${loading ? "is-loading" : ""}`} disabled={loading}>
              <span className="btn-label">Sign In</span>
              <span className="btn-spinner" aria-hidden="true"></span>
            </button>

            <p className={`form-status ${status.type}`} role="status" aria-live="polite">{status.text}</p>
          </form>

          <div className="divider"><span>Or continue with</span></div>

          <button
            type="button"
            className="btn-google"
            onClick={() => signIn("google", { callbackUrl: withWelcome(nextPath) })}
          >
            <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.05l3.02-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>
            Google
          </button>

          <p className="auth-card__footer">
            Don&apos;t have an account?{" "}
            <Link href={`/signup?next=${encodeURIComponent(nextPath)}`} className="link">Sign up</Link>
          </p>
        </div>
      </section>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
