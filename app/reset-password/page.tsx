"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState({ text: "", type: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus({ text: "", type: "" });

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus({ text: data.error || "Something went wrong.", type: "error" });
        return;
      }

      setStatus({ text: "Password updated! Taking you to your account…", type: "success" });
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1200);
    } catch {
      setStatus({ text: "Couldn't reach the server. Try again.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <>
        <h2 className="form-title">Invalid link</h2>
        <p className="form-subtitle">
          This reset link is missing its token.{" "}
          <Link href="/forgot-password" className="link">Request a new one</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="form-title">Set a new password</h2>
      <p className="form-subtitle">Choose something you haven&apos;t used before.</p>

      <form onSubmit={handleSubmit} noValidate>
        <div className={`field ${error ? "has-error" : ""}`}>
          <label htmlFor="password">New password</label>
          <div className="password-input">
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              placeholder="At least 6 characters"
              autoComplete="new-password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPassword(e.target.value); setError(""); }}
            />
            <button
              type="button"
              className="toggle-visibility"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M9.9 5.1A10.9 10.9 0 0 1 12 5c7 0 10.5 7 10.5 7a13.2 13.2 0 0 1-3.1 3.9M6.2 6.6C3.4 8.3 1.5 12 1.5 12s3.5 7 10.5 7c1.2 0 2.3-.2 3.3-.5" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
              )}
            </button>
          </div>
        </div>

        <div className={`field ${error ? "has-error" : ""}`}>
          <label htmlFor="confirm">Confirm new password</label>
          <input
            type={showPassword ? "text" : "password"}
            id="confirm"
            placeholder="Type it again"
            value={confirm}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setConfirm(e.target.value); setError(""); }}
          />
          <p className="field-error" role="alert">{error}</p>
        </div>

        <button type="submit" className={`btn-submit ${loading ? "is-loading" : ""}`} disabled={loading}>
          <span className="btn-label">Update password</span>
          <span className="btn-spinner" aria-hidden="true"></span>
        </button>

        <p className={`form-status ${status.type}`} role="status" aria-live="polite">{status.text}</p>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="auth-page">
      <section className="brand-panel">
        <div className="brand-panel__inner">
          <Link href="/" className="brand-mark">
            <img src="/logo.svg" alt="LingoCraft logo" className="brand-mark__logo" />
            <span className="brand-mark__name">LingoCraft</span>
          </Link>
          <div className="brand-copy">
            <h1>Almost there.</h1>
            <p>Set a new password and you&apos;ll be right back in.</p>
          </div>
        </div>
      </section>

      <section className="form-panel">
        <div className="form-panel__inner">
          <Suspense fallback={<p>Loading…</p>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </section>
    </div>
  );
}
