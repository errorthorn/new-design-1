"use client";

import { useEffect, useState } from "react";
import { PLANS, getPlan, monthsGrantedForPlan, type PlanSlug } from "@/lib/plans";

type Claim = {
  id: number;
  user_id: number;
  email: string;
  plan: string;
  method: string;
  sender_number: string;
  trx_id: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  discount_code: string | null;
  discount_percent: number | null;
};

const PLAN_BADGE_STYLE: Record<string, string> = {
  pro: "bg-[#6FC24A]/15 text-[#2E6B2A]",
  starter: "bg-blue-100 text-blue-700",
  dedicated: "bg-black text-white",
};

function PlanBadge({ plan }: { plan: string }) {
  const label = PLANS[plan as PlanSlug]?.name ?? plan;
  return (
    <span
      className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${
        PLAN_BADGE_STYLE[plan] ?? "bg-black/10 text-black/60"
      }`}
    >
      {label}
    </span>
  );
}

export default function AdminPaymentsPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  async function load(currentSecret: string) {
    setError(null);
    try {
      const res = await fetch("/api/admin/payments", {
        headers: { "x-admin-secret": currentSecret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setClaims(data.claims);
    } catch {
      setError("There was a problem loading.");
    }
  }

  useEffect(() => {
    if (unlocked) load(secret);
  }, [unlocked]);

  async function act(id: number, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setClaims((prev) =>
        prev ? prev.map((c) => (c.id === id ? { ...c, status: action === "approve" ? "approved" : "rejected" } : c)) : prev
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

  const visible = claims?.filter((c) => (filter === "pending" ? c.status === "pending" : true)) ?? [];

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-12 flex justify-center">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-4 text-sm mb-4">
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
          <span className="font-semibold">Payments</span>
          <a href="/admin/referrals" className="underline text-black/50">
            Referrals
          </a>
          <a href="/admin/bug-reports" className="underline text-black/50">
            Bug Reports
          </a>
        </div>

        <h1 className="text-2xl font-bold mb-2">Payment Claims</h1>
        <p className="text-sm text-black/60 mb-6">
          TrxIDs submitted by customers after sending money via bKash/Nagad will show up here.
          Match the number and TrxID in your bKash/Nagad app and Allow — the subscription will activate immediately.
        </p>

        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setFilter("pending")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
              filter === "pending" ? "bg-black text-white" : "bg-white border border-black/10 text-black/60"
            }`}
          >
            Pending
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

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {claims === null && !error && <p className="text-sm text-black/50">Loading...</p>}

        {claims !== null && visible.length === 0 && (
          <p className="text-sm text-black/50">
            {filter === "pending" ? "No pending claims right now." : "No claims have been submitted yet."}
          </p>
        )}

        <div className="flex flex-col gap-3">
          {visible.map((c) => (
            <div key={c.id} className="bg-white rounded-xl border border-black/10 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold">{c.email}</p>
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    c.status === "pending"
                      ? "bg-yellow-100 text-yellow-700"
                      : c.status === "approved"
                      ? "bg-[#E4F4DD] text-[#2E6B2A]"
                      : "bg-red-100 text-red-600"
                  }`}
                >
                  {c.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-y-1.5 text-sm text-black/70 mb-4">
                <span className="text-black/40">Plan</span>
                <span>
                  <PlanBadge plan={c.plan} />
                  {monthsGrantedForPlan(c.plan) > 1 && (
                    <span className="ml-2 text-xs font-semibold text-amber-600">
                      🎁 Buy 1 Get 1 — approving grants {monthsGrantedForPlan(c.plan)} months
                    </span>
                  )}
                </span>

                <span className="text-black/40">Method</span>
                <span className="capitalize font-medium">{c.method}</span>

                <span className="text-black/40">Sender number</span>
                <span className="font-medium">{c.sender_number}</span>

                <span className="text-black/40">Transaction ID</span>
                <span className="font-mono font-medium">{c.trx_id}</span>

                <span className="text-black/40">Amount to verify</span>
                <span className="font-medium">৳{c.amount}</span>

                {c.discount_code && (
                  <>
                    <span className="text-black/40">Discount applied</span>
                    <span className="font-medium">
                      <span className="rounded-full bg-[#E4F4DD] px-2 py-0.5 text-xs font-bold text-[#2E6B2A]">
                        {c.discount_percent}% off · {c.discount_code}
                      </span>{" "}
                      <span className="text-black/40 text-xs">
                        (full price ৳{getPlan(c.plan).price} → ৳{c.amount} — this was a{" "}
                        <a href="/dashboard/refer" className="underline">
                          Refer &amp; Earn
                        </a>{" "}
                        code, not a plain discount)
                      </span>
                    </span>
                  </>
                )}

                <span className="text-black/40">Submitted</span>
                <span className="font-medium">
                  {new Date(c.created_at).toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>

              {c.status === "pending" && (
                <div className="flex gap-3">
                  <button
                    onClick={() => act(c.id, "approve")}
                    disabled={busyId === c.id}
                    className="flex-1 rounded-full py-2.5 font-bold text-white bg-[#6FC24A] disabled:opacity-60"
                  >
                    Allow
                  </button>
                  <button
                    onClick={() => act(c.id, "reject")}
                    disabled={busyId === c.id}
                    className="flex-1 rounded-full py-2.5 font-bold text-red-600 bg-white border border-red-200 disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
