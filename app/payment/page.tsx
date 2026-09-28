"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Check, Coins, Copy, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { AuthModal } from "@/components/auth-modal";
import { buttonVariants } from "@/components/ui/button";
import { getPlan } from "@/lib/plans";

const REAL_NUMBER = "01758594364";
const BKASH_NUMBER = process.env.NEXT_PUBLIC_BKASH_NUMBER || REAL_NUMBER;
const NAGAD_NUMBER = process.env.NEXT_PUBLIC_NAGAD_NUMBER || REAL_NUMBER;

type AuthStage = "checking" | "needsLogin" | "alreadySubscribed" | "ready";
type Method = "bkash" | "nagad";

export default function PaymentPage() {
  // useSearchParams() needs a Suspense boundary around it, or the build
  // de-opts this whole page to client-only rendering.
  return (
    <Suspense fallback={<LoadingScreen />}>
      <PaymentPageInner />
    </Suspense>
  );
}

function LoadingScreen() {
  return (
    <main>
      <Navbar />
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="animate-spin text-leaf-600" size={28} />
      </div>
    </main>
  );
}

function PaymentPageInner() {
  const searchParams = useSearchParams();
  const plan = getPlan(searchParams.get("plan"));
  const PLAN_AMOUNT = plan.price;
  const DISCOUNT_PERCENT = plan.originalPrice
    ? Math.round(((plan.originalPrice - plan.price) / plan.originalPrice) * 100)
    : null;

  const [stage, setStage] = useState<AuthStage>("checking");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [method, setMethod] = useState<Method>("bkash");
  const [senderNumber, setSenderNumber] = useState("");
  const [trxId, setTrxId] = useState("");
  const [discountCode, setDiscountCode] = useState("");
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [finalAmount, setFinalAmount] = useState<number | null>(null);

  // A Refer & Earn discount code (see /dashboard/refer) is only "applied"
  // once it's actually confirmed real by the server — checking against
  // discount_credits (percent, ownership, not-already-used) — not just
  // because the box has *some* text in it. Debounced so it doesn't fire on
  // every keystroke; the server re-checks this again on submit regardless,
  // since a code could get used elsewhere in between.
  const [codeStatus, setCodeStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codePercent, setCodePercent] = useState<number | null>(null);

  useEffect(() => {
    const code = discountCode.trim();
    if (!code) {
      setCodeStatus("idle");
      setCodeError(null);
      setCodePercent(null);
      return;
    }
    setCodeStatus("checking");
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/referral/validate-code?code=${encodeURIComponent(code)}`);
        const data = await res.json();
        if (data.valid) {
          setCodeStatus("valid");
          setCodePercent(data.percent);
          setCodeError(null);
        } else {
          setCodeStatus("invalid");
          setCodePercent(null);
          setCodeError(data.error ?? "That discount code isn't valid.");
        }
      } catch {
        setCodeStatus("invalid");
        setCodePercent(null);
        setCodeError("Couldn't check that code — please try again.");
      }
    }, 450);
    return () => clearTimeout(handle);
  }, [discountCode]);

  const estimatedAmount =
    codeStatus === "valid" && codePercent !== null
      ? Math.round(PLAN_AMOUNT * (1 - codePercent / 100))
      : PLAN_AMOUNT;

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (!data.user) {
      setStage("needsLogin");
      return;
    }
    if (data.user.subscriptionActive) {
      setExpiresAt(data.user.subscription_expires_at ?? null);
      setStage("alreadySubscribed");
      return;
    }
    setStage("ready");
  }

  const payNumber = method === "bkash" ? BKASH_NUMBER : NAGAD_NUMBER;

  function copyNumber() {
    navigator.clipboard.writeText(payNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!/^01[0-9]{9}$/.test(senderNumber.trim())) {
      setError("Enter the valid 11-digit number you sent money from.");
      return;
    }
    if (trxId.trim().length < 4) {
      setError("Enter the Transaction ID (TrxID) from your SMS.");
      return;
    }
    // Something's typed in the discount box but it hasn't come back valid
    // (or is still being checked) — don't let a mistaken/mistyped code
    // silently fall through as "no discount"; make them fix or clear it.
    if (discountCode.trim() && codeStatus !== "valid") {
      setError(
        codeStatus === "checking"
          ? "Still checking that discount code — please wait a moment."
          : codeError ?? "That discount code isn't valid. Fix it or clear the field to continue without one."
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/payment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: plan.slug,
          method,
          senderNumber: senderNumber.trim(),
          trxId: trxId.trim(),
          discountCode: discountCode.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong, please try again.");
        return;
      }
      setFinalAmount(data.amount ?? PLAN_AMOUNT);
      setSubmitted(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (stage === "checking") {
    return <LoadingScreen />;
  }

  return (
    <main className="bg-cream-soft">
      <Navbar />

      <AuthModal
        open={stage === "needsLogin"}
        onClose={() => (window.location.href = "/")}
        onSuccess={checkAuth}
        title="Sign in to subscribe"
        subtitle="Create an account or log in to continue to payment."
      />

      <section className="mx-auto max-w-3xl px-6 py-14 md:py-16">
        {stage === "alreadySubscribed" ? (
          <StatusCard
            icon={<ShieldCheck size={26} className="text-leaf-600" />}
            title="You're already a member"
            body={
              expiresAt
                ? `Your membership runs until ${new Date(expiresAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}.`
                : "Your membership is active."
            }
          />
        ) : submitted ? (
          <>
            <StatusCard
              icon={<Check size={26} className="text-leaf-600" strokeWidth={3} />}
              title="Payment request submitted"
              body={`We'll verify your bKash/Nagad TrxID${
                finalAmount && finalAmount !== PLAN_AMOUNT ? ` (৳${finalAmount} with your discount applied)` : ""
              } and activate your ${plan.name} membership within 24 hours. You'll get a confirmation on your account email.`}
            />

            {/* Deliberately its own separate, high-contrast block (not folded
                into StatusCard's body text) — this instruction needs to be
                impossible to skim past, since missing the community group
                link means missing every class/schedule update after this. */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
              className="mt-4 rounded-2xl border-2 border-amber-400 bg-amber-50 p-6 text-center shadow-sm"
            >
              <p className="font-display text-sm font-extrabold uppercase tracking-wide text-amber-800">
                ⚠️ Important — don&apos;t miss this
              </p>
              <p className="mt-2 font-body text-sm leading-relaxed text-ink">
                Once your payment is confirmed, we&apos;ll email you the link to join the{" "}
                <span className="font-bold">LingoCraft Facebook Community (Messenger group)</span>. Please
                join it as soon as you get the email — that&apos;s where all class schedules, updates, and
                announcements are shared.
              </p>
            </motion.div>
          </>
        ) : (
          <>
            {/* ---- Card 1: plan summary + reassurance, "standard checkout" style ---- */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm md:p-8"
            >
              <h1 className="font-display text-xl font-extrabold text-ink md:text-2xl">
                Membership Plan
              </h1>

              <div className="mt-6 grid gap-5 md:grid-cols-[1fr_260px]">
                <div>
                  <p className="font-display text-sm font-semibold text-ink">You choose this plan</p>
                  <p className="mt-0.5 font-body text-sm text-ink-soft">
                    Your Speaking Club membership.
                  </p>

                  <div className="relative mt-4 rounded-xl border-2 border-leaf-500 bg-leaf-50 p-5">
                    {DISCOUNT_PERCENT !== null && (
                      <span className="absolute -top-3 right-4 rounded-pill bg-leaf-600 px-3 py-1 font-display text-xs font-bold text-white shadow-sm">
                        {DISCOUNT_PERCENT}% OFF
                      </span>
                    )}

                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-display text-base font-bold text-leaf-700">
                          {plan.name} — Monthly
                        </p>
                        <p className="mt-1 font-body text-sm text-ink-soft">{plan.tagline}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        {plan.originalPrice && (
                          <span className="block font-body text-sm text-ink-soft/50 line-through">
                            ৳{plan.originalPrice}
                          </span>
                        )}
                        <span className="block font-display text-xl font-extrabold text-leaf-700">
                          ৳{PLAN_AMOUNT}<span className="text-sm font-semibold">/mo</span>
                        </span>
                      </div>
                    </div>

                    <ul className="mt-4 grid grid-cols-1 gap-2 border-t border-leaf-300/50 pt-4 sm:grid-cols-2">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-center gap-2">
                          <Check size={13} className="shrink-0 text-leaf-600" strokeWidth={3} />
                          <span className="font-body text-xs text-ink-soft">{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center gap-3 rounded-xl bg-leaf-50 p-5 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                    <Coins size={22} className="text-leaf-600" />
                  </div>
                  <p className="font-body text-xs leading-relaxed text-leaf-700">
                    <span className="font-semibold">Don&apos;t worry!</span> LingoCraft only charges a
                    one-time bKash/Nagad payment — no card is saved, no automatic renewals.
                  </p>
                </div>
              </div>
            </motion.div>

            {/* ---- Card 2: registration / payment details form ---- */}
            <motion.form
              onSubmit={handleSubmit}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }}
              className="mt-6 rounded-2xl border border-ink/10 bg-white p-6 shadow-sm md:p-8"
            >
              <h2 className="font-display text-xl font-extrabold text-ink md:text-2xl">
                Payment details
              </h2>
              <p className="mt-1 font-body text-sm text-ink-soft">
                Send money via bKash or Nagad, then submit the details below.
              </p>

              {/* method toggle */}
              <div className="mt-6 grid grid-cols-2 gap-3">
                {(["bkash", "nagad"] as Method[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMethod(m)}
                    className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 font-display text-sm font-semibold capitalize transition-all duration-200 ${
                      method === m
                        ? "border-leaf-500 bg-leaf-50 text-leaf-700"
                        : "border-ink/10 text-ink-soft hover:border-leaf-300"
                    }`}
                  >
                    <Smartphone size={16} />
                    {m}
                  </button>
                ))}
              </div>

              {/* merchant number */}
              <label className="mt-6 flex flex-col gap-1.5">
                <span className="font-body text-sm font-medium text-ink">
                  Send Money to this {method === "bkash" ? "bKash" : "Nagad"} number
                  <span className="ml-0.5 text-red-500">*</span>
                </span>
                <div className="flex items-center justify-between gap-3 rounded-xl border border-ink/15 bg-cream-soft px-4 py-3">
                  <span className="font-display text-base font-bold tracking-wide text-ink">
                    {payNumber}
                  </span>
                  <button
                    type="button"
                    onClick={copyNumber}
                    className="flex items-center gap-1.5 rounded-pill bg-ink px-3 py-1.5 font-body text-xs font-semibold text-cream transition-colors hover:bg-ink-soft"
                  >
                    <Copy size={12} />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </label>

              <div className="mt-5 flex flex-col gap-5">
                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-sm font-medium text-ink">
                    The number you sent money from<span className="ml-0.5 text-red-500">*</span>
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="01XXXXXXXXX"
                    value={senderNumber}
                    onChange={(e) => setSenderNumber(e.target.value)}
                    className="h-12 rounded-xl border border-ink/15 bg-white px-4 font-body text-sm text-ink outline-none focus-ring"
                  />
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-sm font-medium text-ink">
                    Transaction ID (TrxID)<span className="ml-0.5 text-red-500">*</span>
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. 9F3K2LX7Q1"
                    value={trxId}
                    onChange={(e) => setTrxId(e.target.value)}
                    className="h-12 rounded-xl border border-ink/15 bg-white px-4 font-body text-sm uppercase text-ink outline-none focus-ring"
                  />
                  <span className="font-body text-xs text-ink-soft/70">
                    Enter the TrxID from the SMS you received after sending money.
                  </span>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-sm font-medium text-ink">
                    Have a Refer &amp; Earn discount code?{" "}
                    <span className="font-normal text-ink-soft/70">(optional)</span>
                  </span>
                  <input
                    type="text"
                    placeholder="e.g. LC-7F3K9A"
                    value={discountCode}
                    onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                    className={`h-12 rounded-xl border bg-white px-4 font-body text-sm uppercase text-ink outline-none focus-ring ${
                      codeStatus === "invalid"
                        ? "border-red-300"
                        : codeStatus === "valid"
                        ? "border-leaf-500"
                        : "border-ink/15"
                    }`}
                  />
                  {codeStatus === "checking" ? (
                    <span className="font-body text-xs text-ink-soft/70">Checking code…</span>
                  ) : codeStatus === "valid" ? (
                    <span className="font-body text-xs font-medium text-leaf-700">
                      {codePercent}% off applied — send ৳{estimatedAmount} instead of ৳{PLAN_AMOUNT}.
                    </span>
                  ) : codeStatus === "invalid" ? (
                    <span className="font-body text-xs font-medium text-red-600">{codeError}</span>
                  ) : (
                    <span className="font-body text-xs text-ink-soft/70">
                      Get 25% off by referring a friend or redeeming theirs on{" "}
                      <a href="/dashboard/refer" className="underline">
                        Refer &amp; Earn
                      </a>
                      .
                    </span>
                  )}
                </label>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 font-body text-sm text-red-600">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting || codeStatus === "checking"}
                  className={buttonVariants({ variant: "accent", size: "lg" }) + " w-full gap-2"}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Confirm Payment"
                  )}
                </button>

                <p className="text-center font-body text-xs text-ink-soft/70">
                  After you submit, we&apos;ll verify it and activate your membership within 24 hours.
                </p>
              </div>
            </motion.form>
          </>
        )}
      </section>

      <Footer />
    </main>
  );
}

function StatusCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-2xl border border-ink/10 bg-white p-8 text-center shadow-sm"
    >
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-leaf-100">
        {icon}
      </div>
      <h1 className="mt-5 font-display text-2xl font-extrabold text-ink">{title}</h1>
      <p className="mt-2 font-body text-sm leading-relaxed text-ink-soft">{body}</p>
      <a href="/" className={buttonVariants({ variant: "primary" }) + " mt-6 w-full"}>
        Back to homepage
      </a>
    </motion.div>
  );
}
