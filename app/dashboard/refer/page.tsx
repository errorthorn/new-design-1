"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Gift,
  Copy,
  Check,
  Users,
  Share2,
  Ticket,
  Loader2,
  PartyPopper,
} from "lucide-react";

type Friend = { name: string; createdAt: string; rewarded: boolean; alreadyMember: boolean };
type Discount = {
  code: string;
  percent: number;
  reason: string;
  used: boolean;
  usedAt: string | null;
  createdAt: string;
  alreadyPaidBeforeRedeeming: boolean;
  refunded: boolean;
  refundedAt: string | null;
  refundNumber: string | null;
  refundMethod: string | null;
};
type ReferralData = {
  code: string;
  hasRedeemed: boolean;
  friendsJoined: number;
  friends: Friend[];
  discounts: Discount[];
};

function formatDate(iso: string) {
  return new Date(iso.replace(" ", "T") + "Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Correct brand casing/spelling — "bkash"/"nagad" is what's stored in the
// DB (see lib/referral / discount_credits.refund_method), but "bKash" and
// "Nagad" is how people actually recognize these on screen.
const METHOD_LABEL: Record<string, string> = { bkash: "bKash", nagad: "Nagad" };

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-full border border-leaf-600 bg-white px-4 py-2 font-body text-xs font-semibold text-leaf-700 transition-colors hover:bg-leaf-50 dark:bg-night dark:text-leaf-500 dark:hover:bg-night-border"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : label}
    </button>
  );
}

// Shown instead of "Ready to use at checkout" for a referral reward code
// (either side — referrer or redeemer) that turned out unusable — that
// person had already paid/subscribed before the referral was redeemed, so
// the 25% off never had anything to apply to. Lets them tell us which
// bKash/Nagad number to manually send the refund to (see
// /api/referral/refund-number and /admin/referrals).
function RefundRequestCard({ discount, onSaved }: { discount: Discount; onSaved: () => void }) {
  const [method, setMethod] = useState<"bkash" | "nagad">("bkash");
  const [number, setNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (discount.refunded) {
    return (
      <div className="rounded-xl border border-leaf-600/50 bg-leaf-50 px-3.5 py-3 dark:bg-night">
        <p className="font-display text-sm font-bold tracking-wide">{discount.code}</p>
        <p className="mt-0.5 font-body text-[11px] text-leaf-700 dark:text-leaf-500">
          Refunded{discount.refundedAt ? ` · ${formatDate(discount.refundedAt)}` : ""}
        </p>
      </div>
    );
  }

  if (discount.refundNumber) {
    return (
      <div className="rounded-xl border border-ink/10 px-3.5 py-3 dark:border-night-border">
        <p className="font-display text-sm font-bold tracking-wide">{discount.code}</p>
        <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/50">
          We&apos;ll send your {discount.percent}% refund to {discount.refundNumber} via{" "}
          <span
            className={`font-semibold ${
              discount.refundMethod === "bkash"
                ? "text-[#E2136E]"
                : discount.refundMethod === "nagad"
                ? "text-[#EE3124]"
                : ""
            }`}
          >
            {METHOD_LABEL[discount.refundMethod ?? ""] ?? discount.refundMethod}
          </span>{" "}
          — usually within a couple of days.
        </p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^01[0-9]{9}$/.test(number.trim())) {
      setError("Enter a valid 11-digit bKash/Nagad number.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/referral/refund-number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: discount.code, method, number: number.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Something went wrong, please try again.");
        return;
      }
      onSaved();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-amber-400/60 bg-amber-50 px-3.5 py-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="font-display text-sm font-bold tracking-wide">{discount.code}</p>
      <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/60">
        You&apos;d already paid before this code was ready, so it couldn&apos;t be applied at checkout —
        we&apos;ll send your {discount.percent}% back manually instead. Pick bKash or Nagad and tell us the number:
      </p>
      <form onSubmit={submit} className="mt-2.5 flex flex-col gap-2">
        <div className="flex gap-2">
          {(["bkash", "nagad"] as const).map((m) => {
            const selected = method === m;
            const brand = m === "bkash" ? "#E2136E" : "#EE3124";
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                style={selected ? { borderColor: brand, backgroundColor: `${brand}14`, color: brand } : undefined}
                className={`flex-1 rounded-lg border px-3 py-1.5 font-body text-xs font-semibold ${
                  selected
                    ? ""
                    : "border-ink/15 text-ink-soft dark:border-night-border dark:text-cream/50"
                }`}
              >
                {METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="01XXXXXXXXX"
            inputMode="numeric"
            className="h-10 min-w-0 flex-1 rounded-lg border border-ink/15 bg-white px-3 font-body text-xs text-ink outline-none focus:border-leaf-600 dark:border-night-border dark:bg-night dark:text-cream"
          />
          <button
            type="submit"
            disabled={saving}
            className="h-10 shrink-0 rounded-lg bg-leaf-600 px-4 font-body text-xs font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
        {error && <p className="font-body text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
      </form>
    </div>
  );
}

export default function ReferPage() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);

  const [redeemInput, setRedeemInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);

  const [shareStatus, setShareStatus] = useState<null | "shared" | "copied" | "failed">(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    fetch("/api/referral")
      .then((res) => res.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }

  async function handleRedeem(e: React.FormEvent) {
    e.preventDefault();
    setRedeemError(null);
    setRedeemSuccess(null);
    if (!redeemInput.trim()) {
      setRedeemError("Enter a referral code first.");
      return;
    }
    setRedeeming(true);
    try {
      const res = await fetch("/api/referral/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: redeemInput.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        setRedeemError(d.error ?? "Something went wrong, please try again.");
        return;
      }
      setRedeemSuccess(`Code applied! You've earned a 25% discount — code ${d.discountCode}.`);
      setRedeemInput("");
      load();
    } catch {
      setRedeemError("Network error — please try again.");
    } finally {
      setRedeeming(false);
    }
  }

  async function handleShare() {
    const referralUrl =
      typeof window !== "undefined" ? `${window.location.origin}/signup` : "";
    const message = `Join me on LingCraft for IELTS prep! Use my referral code ${data?.code} on the Refer & Earn page and we'll both get 25% off.${
      referralUrl ? ` ${referralUrl}` : ""
    }`;

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: "Join me on LingCraft",
          text: message,
          url: referralUrl || undefined,
        });
        setShareStatus("shared");
      } else {
        throw new Error("no-web-share");
      }
    } catch (err) {
      // AbortError just means the user closed the native share sheet —
      // that's not a failure, so don't fall back to copying in that case.
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      try {
        await navigator.clipboard.writeText(message);
        setShareStatus("copied");
      } catch {
        setShareStatus("failed");
      }
    } finally {
      setTimeout(() => setShareStatus(null), 2500);
    }
  }

  if (loading || !data) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="animate-spin text-leaf-600" size={28} />
      </div>
    );
  }

  return (
    <div>
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="font-display text-2xl font-semibold tracking-tight md:text-3xl"
      >
        Refer &amp; Earn
      </motion.h1>
      <p className="mt-1 font-body text-sm text-ink-soft dark:text-cream/60">
        Invite a study buddy — you both get 25% off your next membership payment.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-5">
          {/* Hero: referral code */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
            className="relative overflow-hidden rounded-2xl border border-leaf-600/40 bg-gradient-to-br from-leaf-700 via-leaf-600 to-leaf-500 p-6 text-cream shadow-lg shadow-leaf-700/20 sm:p-8"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-16 left-1/3 h-48 w-48 rounded-full bg-white/10 blur-2xl" />

            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 font-body text-xs font-semibold">
                  <Gift size={13} /> Refer a friend
                </span>
                <h2 className="mt-3 font-display text-xl font-semibold sm:text-2xl">
                  Get 25% off — for both of you
                </h2>
                <p className="mt-1 max-w-sm font-body text-sm text-cream/85">
                  Share your code. When a friend signs up and redeems it, you each
                  unlock a 25% discount code for your next payment.
                </p>
              </div>
              <div className="rounded-2xl bg-black/15 px-5 py-3 text-center">
                <p className="font-body text-[11px] uppercase tracking-wide text-cream/70">
                  Friends joined
                </p>
                <p className="font-display text-2xl font-semibold">{data.friendsJoined}</p>
              </div>
            </div>

            <div className="relative mt-6">
              <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-cream/70">
                Your referral code
              </p>
              <div className="mt-1.5 flex items-center gap-3 rounded-2xl border border-white/25 bg-white/10 px-4 py-3">
                <span className="flex-1 font-display text-lg font-bold tracking-[0.2em]">
                  {data.code}
                </span>
                <CopyButton text={data.code} />
              </div>
            </div>

            <div className="relative mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-display text-sm font-semibold text-leaf-700 transition-transform hover:-translate-y-0.5"
              >
                <Share2 size={15} /> Share with a friend
              </button>
              {shareStatus && (
                <span className="font-body text-xs font-medium text-cream/90">
                  {shareStatus === "shared" && "Shared!"}
                  {shareStatus === "copied" && "Copied — paste it anywhere to share!"}
                  {shareStatus === "failed" && "Couldn't share — copy your code above instead."}
                </span>
              )}
            </div>
          </motion.div>

          {/* How it works */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft"
          >
            <h2 className="font-display text-lg font-semibold">How it works</h2>
            <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { n: "1", title: "Share", desc: "Send your code to a friend who wants to prep for IELTS." },
                { n: "2", title: "They redeem", desc: "Your friend enters it on their own Refer & Earn page and gets their own 25%-off code right away." },
                { n: "3", title: "They subscribe, you get a code", desc: "Once your friend actually subscribes, your 25%-off code shows up under \u201cYour discount codes\u201d, on the right." },
                { n: "4", title: "Use it at checkout", desc: "Enter that code on the payment page next time either of you pays." },
              ].map((s) => (
                <div key={s.n}>
                  <div className="grid h-8 w-8 place-items-center rounded-full border border-leaf-600 font-display text-sm font-bold text-leaf-700 dark:text-leaf-500">
                    {s.n}
                  </div>
                  <p className="mt-2 font-display text-sm font-semibold">{s.title}</p>
                  <p className="mt-0.5 font-body text-xs text-ink-soft dark:text-cream/50">{s.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 border-t border-ink/10 pt-5 dark:border-night-border">
              <h3 className="font-display text-sm font-semibold">Already subscribed?</h3>
              <p className="mt-1 font-body text-xs text-ink-soft dark:text-cream/50">
                No problem — you still get your 25%, whether you&apos;re the one who shared the code
                or the one who redeemed it. It&apos;s just sent to you directly instead of applied at
                checkout.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { n: "1", title: "You're already a member", desc: "Your membership was already active when this referral was redeemed." },
                  { n: "2", title: "We flag it", desc: "That code shows up under \u201cYour discount codes\u201d marked for a manual refund." },
                  { n: "3", title: "You tell us where", desc: "Add your bKash or Nagad number right there on the card." },
                  { n: "4", title: "We send it", desc: "Your 25% back is sent to that number, usually within a couple of days." },
                ].map((s) => (
                  <div key={s.n}>
                    <div className="grid h-7 w-7 place-items-center rounded-full border border-amber-500/60 font-display text-xs font-bold text-amber-700 dark:text-amber-400">
                      {s.n}
                    </div>
                    <p className="mt-1.5 font-display text-xs font-semibold">{s.title}</p>
                    <p className="mt-0.5 font-body text-[11px] text-ink-soft dark:text-cream/50">{s.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Redeem a friend's code */}
          {!data.hasRedeemed && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.15 }}
              className="rounded-2xl border border-ink/10 bg-cream-soft p-6 dark:border-night-border dark:bg-night-soft"
            >
              <div className="flex items-start gap-4">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-leaf-600 bg-white text-leaf-700 dark:bg-night dark:text-leaf-500">
                  <Ticket size={20} />
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold">Have a friend&apos;s code?</h2>
                  <p className="mt-0.5 font-body text-sm text-ink-soft dark:text-cream/60">
                    Enter it once to unlock your own 25% discount code.
                  </p>
                </div>
              </div>

              <form onSubmit={handleRedeem} className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  value={redeemInput}
                  onChange={(e) => setRedeemInput(e.target.value.toUpperCase())}
                  placeholder="Enter referral code"
                  maxLength={12}
                  className="h-12 flex-1 rounded-full border border-ink/15 bg-white px-5 font-body text-sm tracking-wide text-ink outline-none focus:border-leaf-600 dark:border-night-border dark:bg-night dark:text-cream"
                />
                <button
                  type="submit"
                  disabled={redeeming}
                  className="h-12 shrink-0 rounded-full bg-leaf-600 px-6 font-display text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {redeeming ? "Redeeming…" : "Redeem Code"}
                </button>
              </form>
              {redeemError && (
                <p className="mt-2 font-body text-xs font-medium text-red-600 dark:text-red-400">{redeemError}</p>
              )}
              {redeemSuccess && (
                <p className="mt-2 flex items-center gap-1.5 font-body text-xs font-medium text-leaf-700 dark:text-leaf-500">
                  <PartyPopper size={14} /> {redeemSuccess}
                </p>
              )}
            </motion.div>
          )}
        </div>

        {/* Side panel: your discount codes + friends */}
        <div className="flex flex-col gap-5">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft"
          >
            <h2 className="font-display text-base font-semibold">Your discount codes</h2>
            {data.discounts.length === 0 ? (
              <p className="mt-3 font-body text-xs text-ink-soft dark:text-cream/50">
                Refer a friend or redeem someone else&apos;s code to earn your first 25%-off code.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2.5">
                {data.discounts.map((d) =>
                  d.alreadyPaidBeforeRedeeming ? (
                    <RefundRequestCard key={d.code} discount={d} onSaved={load} />
                  ) : (
                    <div
                      key={d.code}
                      className={`flex items-center justify-between rounded-xl border px-3.5 py-3 ${
                        d.used
                          ? "border-ink/10 opacity-50 dark:border-night-border"
                          : "border-leaf-600/50 bg-leaf-50 dark:bg-night"
                      }`}
                    >
                      <div>
                        <p className="font-display text-sm font-bold tracking-wide">{d.code}</p>
                        <p className="font-body text-[11px] text-ink-soft dark:text-cream/50">
                          {d.percent}% off · {d.used ? `Used ${formatDate(d.usedAt ?? d.createdAt)}` : "Ready to use at checkout"}
                        </p>
                      </div>
                      {!d.used && <CopyButton text={d.code} label="Copy" />}
                    </div>
                  )
                )}
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.15 }}
            className="rounded-2xl border border-ink/10 bg-cream-soft p-5 dark:border-night-border dark:bg-night-soft"
          >
            <h2 className="flex items-center gap-2 font-display text-base font-semibold">
              <Users size={16} className="text-leaf-700 dark:text-leaf-500" /> Friends you referred
            </h2>
            {data.friends.length === 0 ? (
              <p className="mt-3 font-body text-xs text-ink-soft dark:text-cream/50">
                No one has joined with your code yet — share it to get started.
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2.5">
                {data.friends.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 font-body text-sm">
                    <span className="truncate">{f.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {f.rewarded ? (
                        <span className="rounded-full bg-leaf-50 px-2 py-0.5 text-[10px] font-semibold text-leaf-700 dark:bg-night dark:text-leaf-500">
                          Rewarded
                        </span>
                      ) : f.alreadyMember ? (
                        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[10px] font-semibold text-ink-soft dark:bg-night-border dark:text-cream/50">
                          Already a member
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                          Waiting to subscribe
                        </span>
                      )}
                      <span className="text-xs text-ink-soft dark:text-cream/50">{formatDate(f.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
