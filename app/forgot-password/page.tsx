"use client";

import { useState } from "react";
import Link from "next/link";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState({ text: "", type: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setStatus({ text: "", type: "" });

    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      setStatus({ text: data.message, type: "success" });
      setSent(true);
    } catch {
      setStatus({ text: "Couldn't reach the server. Try again.", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="brand-panel">
        <div className="brand-panel__inner">
          <Link href="/" className="brand-mark">
            <img src="/logo.svg" alt="LingoCraft logo" className="brand-mark__logo" />
            <span className="brand-mark__name">LingoCraft</span>
          </Link>
          <div className="brand-copy">
            <h1>Forgot your<br />password?</h1>
            <p>No problem — we&apos;ll email you a link to set a new one.</p>
          </div>
        </div>
      </section>

      <section className="form-panel">
        <div className="form-panel__inner">
          <h2 className="form-title">Reset password</h2>
          <p className="form-subtitle">
            Remembered it? <Link href="/login" className="link">Back to log in</Link>
          </p>

          {sent ? (
            <p className="form-status success" style={{ marginTop: 32, textAlign: "left" }}>
              {status.text}
            </p>
          ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className={`field ${error ? "has-error" : ""}`}>
                <label htmlFor="email">Email</label>
                <input
                  type="email"
                  id="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setEmail(e.target.value); setError(""); }}
                />
                <p className="field-error" role="alert">{error}</p>
              </div>

              <button type="submit" className={`btn-submit ${loading ? "is-loading" : ""}`} disabled={loading}>
                <span className="btn-label">Send reset link</span>
                <span className="btn-spinner" aria-hidden="true"></span>
              </button>

              <p className={`form-status ${status.type}`} role="status" aria-live="polite">{status.text}</p>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
