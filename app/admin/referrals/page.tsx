"use client";

import { useEffect, useState } from "react";

type Claim = {
  id: number;
  plan: string;
  amount: number;
  created_at: string;
};

type Referral = {
  referral_id: number;
  redeemed_at: string;
  referrer_id: number;
  referrer_email: string;
  redeemed_id: number;
  redeemed_email: string;
  referrer_credit_id: number | null;
  referrer_code: string | null;
  referrer_used: number | null;
  referrer_used_at: string | null;
  referrer_refunded: number | null;
  referrer_refunded_at: string | null;
  referrer_refund_number: string | null;
  referrer_refund_method: string | null;
  referrer_already_paid_before_redeeming: boolean;
  referrer_earlier_claim: Claim | null;
  redeemer_credit_id: number | null;
  redeemer_code: string | null;
  redeemer_used: number | null;
  redeemer_used_at: string | null;
  redeemer_refunded: number | null;
  redeemer_refunded_at: string | null;
  redeemer_refund_number: string | null;
  redeemer_refund_method: string | null;
  redeemer_already_paid_before_redeeming: boolean;
  redeemer_earlier_claim: Claim | null;
};

export default function AdminReferralsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [referrals, setReferrals] = useState<Referral[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"needs_attention" | "all">("needs_attention");
  const [search, setSearch] = useState("");

  async function load(currentSecret: string) {
    setError(null);
    try {
      const res = await fetch("/api/admin/referrals", {
        headers: { "x-admin-secret": currentSecret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setReferrals(data.referrals);
    } catch {
      setError("There was a problem loading.");
    }
  }

  useEffect(() => {
    if (unlocked) load(secret);
  }, [unlocked]);

  async function toggleRefunded(creditId: number, refunded: boolean, side: "referrer" | "redeemer") {
    setBusyId(creditId);
    setError(null);
    try {
      const res = await fetch("/api/admin/referrals", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ discountCreditId: creditId, refunded }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setReferrals((prev) =>
        prev
          ? prev.map((r) => {
              const matches = side === "referrer" ? r.referrer_credit_id === creditId : r.redeemer_credit_id === creditId;
              if (!matches) return r;
              return side === "referrer"
                ? { ...r, referrer_refunded: refunded ? 1 : 0, referrer_refunded_at: refunded ? new Date().toISOString() : null }
                : { ...r, redeemer_refunded: refunded ? 1 : 0, redeemer_refunded_at: refunded ? new Date().toISOString() : null };
            })
          : prev
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setUnlocked(true);
          }}
          className="bg-white rounded-2xl p-6 border border-black/10 w-full max-w-sm"
        >
          <label className="block text-sm font-medium mb-1">Admin secret</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-xl border border-black/10 px-4 py-3 mb-4"
            placeholder="ADMIN_SECRET"
          />
          <button className="w-full rounded-full py-3 font-bold text-white bg-black">Enter</button>
        </form>
      </div>
    );
  }

  const query = search.trim().toUpperCase();
  const visible =
    referrals?.filter((r) => {
      // A search takes priority over the tab — searching should be able to
      // surface an already-resolved pair even while "Needs attention" is
      // selected, since the whole point is "did THIS code get used".
      if (query) {
        return (
          r.referrer_code?.toUpperCase().includes(query) ||
          r.redeemer_code?.toUpperCase().includes(query) ||
          r.referrer_email?.toUpperCase().includes(query) ||
          r.redeemed_email?.toUpperCase().includes(query)
        );
      }
      return filter === "needs_attention"
        ? (r.redeemer_already_paid_before_redeeming && !r.redeemer_refunded) ||
            (r.referrer_already_paid_before_redeeming && !r.referrer_refunded)
        : true;
    }) ?? [];

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-12 flex justify-center">
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-4 text-sm mb-4 flex-wrap">
          <a href="/admin/questions" className="underline text-black/50">
            Questions
          </a>
          <a href="/admin/members" className="underline text-black/50">
            Members
          </a>
          <a href="/admin/scoring" className="underline text-black/50">
            Scoring
          </a>
          <a href="/admin/study-materials" className="underline text-black/50">
            Study Materials
          </a>
          <a href="/admin/testimonials" className="underline text-black/50">
            Testimonials
          </a>
          <a href="/admin/speaking-club" className="underline text-black/50">
            Speaking Club
          </a>
          <a href="/admin/mock-test" className="underline text-black/50">
            Mock Test
          </a>
          <a href="/admin/quiz" className="underline text-black/50">
            Quiz
          </a>
          <a href="/admin/classes" className="underline text-black/50">
            Classes
          </a>
          <a href="/admin/payments" className="underline text-black/50">
            Payments
          </a>
          <span className="font-semibold">Referrals</span>
          <a href="/admin/bug-reports" className="underline text-black/50">
            Bug Reports
          </a>
        </div>

        <h1 className="text-2xl font-bold mb-2">Referral History</h1>
        <p className="text-sm text-black/60 mb-6">
          Every Refer &amp; Earn redemption. If either side — the friend who redeemed, or the
          referrer who shared the code — was already an active subscriber when this happened,
          their 25%-off code couldn&apos;t apply to anything. That&apos;s flagged below so you
          can refund the difference by hand.
        </p>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by discount code (LC-XXXXXX) or email"
            className="w-full rounded-xl border border-black/10 px-4 py-2.5 text-sm bg-white"
          />
        </div>

        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter("needs_attention")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                filter === "needs_attention" ? "bg-black text-white" : "bg-white border border-black/10 text-black/60"
              }`}
            >
              Needs attention
            </button>
            <button
              onClick={() => setFilter("all")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                filter === "all" ? "bg-black text-white" : "bg-white border border-black/10 text-black/60"
              }`}
            >
              All
            </button>
          </div>
          {search.trim() && (
            <p className="text-xs text-black/40">
              Showing matches for &quot;{search.trim()}&quot; across both tabs — {visible.length} found
            </p>
          )}
        </div>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {referrals === null && !error && <p className="text-sm text-black/50">Loading...</p>}

        {referrals !== null && visible.length === 0 && (
          <p className="text-sm text-black/50">
            {filter === "needs_attention"
              ? "Nothing needs attention — no already-paid redemptions waiting on a refund."
              : "No referrals have been redeemed yet."}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {visible.map((r) => {
            const needsReferrer = r.referrer_already_paid_before_redeeming;
            const needsRedeemer = r.redeemer_already_paid_before_redeeming;
            return (
              <div key={r.referral_id} className="bg-white rounded-xl border border-black/10 p-5">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <p className="font-semibold">
                    {r.referrer_email} <span className="text-black/40 font-normal">referred</span> {r.redeemed_email}
                  </p>
                  <div className="flex gap-1.5">
                    {needsReferrer && (
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          r.referrer_refunded ? "bg-[#E4F4DD] text-[#2E6B2A]" : "bg-red-100 text-red-600"
                        }`}
                      >
                        Referrer {r.referrer_refunded ? "refunded" : "needs refund"}
                      </span>
                    )}
                    {needsRedeemer && (
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          r.redeemer_refunded ? "bg-[#E4F4DD] text-[#2E6B2A]" : "bg-red-100 text-red-600"
                        }`}
                      >
                        Redeemer {r.redeemer_refunded ? "refunded" : "needs refund"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-y-1.5 text-sm text-black/70 mb-4">
                  <span className="text-black/40">Redeemed</span>
                  <span className="font-medium">
                    {new Date(r.redeemed_at).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" })}
                  </span>

                  <span className="text-black/40">Referrer&apos;s code</span>
                  <span className="font-mono font-medium">
                    <span className={query && r.referrer_code?.toUpperCase().includes(query) ? "bg-yellow-200 rounded px-1" : ""}>
                      {r.referrer_code ?? "—"}
                    </span>{" "}
                    {r.referrer_code && (
                      <span className="text-xs text-black/40">
                        ({r.referrer_used ? "used" : "unused"}) — {r.referrer_email}
                      </span>
                    )}
                  </span>

                  <span className="text-black/40">Redeemer&apos;s code</span>
                  <span className="font-mono font-medium">
                    <span className={query && r.redeemer_code?.toUpperCase().includes(query) ? "bg-yellow-200 rounded px-1" : ""}>
                      {r.redeemer_code ?? "—"}
                    </span>{" "}
                    {r.redeemer_code && (
                      <span className="text-xs text-black/40">
                        ({r.redeemer_used ? "used" : "unused"}) — {r.redeemed_email}
                      </span>
                    )}
                  </span>

                  {needsReferrer && r.referrer_earlier_claim && (
                    <>
                      <span className="text-black/40">Referrer paid before this</span>
                      <span className="font-medium">
                        ৳{r.referrer_earlier_claim.amount} · {r.referrer_earlier_claim.plan} plan ·{" "}
                        {new Date(r.referrer_earlier_claim.created_at).toLocaleDateString("bn-BD", { dateStyle: "medium" })}
                        <span className="ml-2 text-xs text-black/40">
                          (25% of this would be ৳{Math.round(r.referrer_earlier_claim.amount * 0.25)})
                        </span>
                      </span>
                    </>
                  )}

                  {needsReferrer && (
                    <>
                      <span className="text-black/40">Send referrer&apos;s refund to</span>
                      <span className="font-medium">
                        {r.referrer_refund_number ? (
                          <>
                            {r.referrer_refund_number}{" "}
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                              style={{
                                backgroundColor:
                                  r.referrer_refund_method === "bkash"
                                    ? "#E2136E"
                                    : r.referrer_refund_method === "nagad"
                                    ? "#EE3124"
                                    : "#999",
                              }}
                            >
                              {r.referrer_refund_method === "bkash"
                                ? "bKash"
                                : r.referrer_refund_method === "nagad"
                                ? "Nagad"
                                : r.referrer_refund_method ?? "—"}
                            </span>
                          </>
                        ) : (
                          <span className="text-amber-600">Waiting on the number — not submitted yet</span>
                        )}
                      </span>
                    </>
                  )}

                  {needsRedeemer && r.redeemer_earlier_claim && (
                    <>
                      <span className="text-black/40">Redeemer paid before this</span>
                      <span className="font-medium">
                        ৳{r.redeemer_earlier_claim.amount} · {r.redeemer_earlier_claim.plan} plan ·{" "}
                        {new Date(r.redeemer_earlier_claim.created_at).toLocaleDateString("bn-BD", { dateStyle: "medium" })}
                        <span className="ml-2 text-xs text-black/40">
                          (25% of this would be ৳{Math.round(r.redeemer_earlier_claim.amount * 0.25)})
                        </span>
                      </span>
                    </>
                  )}

                  {needsRedeemer && (
                    <>
                      <span className="text-black/40">Send redeemer&apos;s refund to</span>
                      <span className="font-medium">
                        {r.redeemer_refund_number ? (
                          <>
                            {r.redeemer_refund_number}{" "}
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                              style={{
                                backgroundColor:
                                  r.redeemer_refund_method === "bkash"
                                    ? "#E2136E"
                                    : r.redeemer_refund_method === "nagad"
                                    ? "#EE3124"
                                    : "#999",
                              }}
                            >
                              {r.redeemer_refund_method === "bkash"
                                ? "bKash"
                                : r.redeemer_refund_method === "nagad"
                                ? "Nagad"
                                : r.redeemer_refund_method ?? "—"}
                            </span>
                          </>
                        ) : (
                          <span className="text-amber-600">Waiting on the number — not submitted yet</span>
                        )}
                      </span>
                    </>
                  )}
                </div>

                <div className="flex gap-2 flex-wrap">
                  {needsReferrer && r.referrer_credit_id && (
                    <button
                      onClick={() => toggleRefunded(r.referrer_credit_id as number, !r.referrer_refunded, "referrer")}
                      disabled={busyId === r.referrer_credit_id}
                      className={`rounded-full px-4 py-2 text-sm font-bold disabled:opacity-60 ${
                        r.referrer_refunded
                          ? "bg-white border border-black/10 text-black/60"
                          : "bg-[#6FC24A] text-white"
                      }`}
                    >
                      {r.referrer_refunded ? "Mark referrer as not refunded" : "Mark referrer as refunded"}
                    </button>
                  )}
                  {needsRedeemer && r.redeemer_credit_id && (
                    <button
                      onClick={() => toggleRefunded(r.redeemer_credit_id as number, !r.redeemer_refunded, "redeemer")}
                      disabled={busyId === r.redeemer_credit_id}
                      className={`rounded-full px-4 py-2 text-sm font-bold disabled:opacity-60 ${
                        r.redeemer_refunded
                          ? "bg-white border border-black/10 text-black/60"
                          : "bg-[#6FC24A] text-white"
                      }`}
                    >
                      {r.redeemer_refunded ? "Mark redeemer as not refunded" : "Mark redeemer as refunded"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
