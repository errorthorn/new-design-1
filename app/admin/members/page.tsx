"use client";

import { useEffect, useState } from "react";
import { PLANS, mockTestsPerMonth, type PlanSlug } from "@/lib/plans";

type MemberRow = {
  id: number;
  email: string;
  name: string | null;
  subscription_active: number;
  subscription_expires_at: string | null;
  subscription_weeks: number | null;
  plan: string | null;
};

const PLAN_BADGE_STYLE: Record<string, string> = {
  pro: "bg-[#6FC24A]/15 text-[#2E6B2A]",
  starter: "bg-blue-100 text-blue-700",
  dedicated: "bg-black text-white",
};

function PlanBadge({ plan }: { plan: string | null }) {
  if (!plan) return <span className="text-xs text-black/40">No plan set</span>;
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

// Suggests weeks = months * mock-tests-per-month for the selected plan,
// so the two fields stay sensible together by default (Pro, 1 month/30
// days -> 4 weeks; Starter, 1 month -> 2 weeks) while still being
// editable by hand for a custom plan.
function suggestedWeeks(days: string, planSlug: PlanSlug): string {
  const n = Number(days);
  if (!n || n <= 0) return String(mockTestsPerMonth(planSlug));
  return String(Math.max(1, Math.round((n / 30) * mockTestsPerMonth(planSlug))));
}

export default function AdminMembersPage() {
  const [secret, setSecret] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [member, setMember] = useState<MemberRow | null | undefined>(undefined); // undefined = not searched yet
  const [days, setDays] = useState("90");
  const [weeks, setWeeks] = useState("12");
  const [weeksTouched, setWeeksTouched] = useState(false);
  const [plan, setPlan] = useState<PlanSlug>("pro");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadMembers() {
    setMembersError(null);
    try {
      const res = await fetch("/api/admin/members", {
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (!res.ok) {
        setMembersError(data.error ?? "Couldn't load the members list.");
        return;
      }
      setMembers(data.members ?? []);
    } catch {
      setMembersError("There was a problem loading the members list.");
    }
  }

  useEffect(() => {
    if (unlocked) loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/members?email=${encodeURIComponent(email.trim())}`, {
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        setMember(undefined);
        return;
      }
      setMember(data.user);
      if (data.user?.plan && (data.user.plan === "starter" || data.user.plan === "pro" || data.user.plan === "dedicated")) {
        setPlan(data.user.plan);
      }
    } finally {
      setBusy(false);
    }
  }

  async function grant() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({
          email: email.trim(),
          action: "grant",
          days: Number(days) || 90,
          weeks: Number(weeks) || undefined,
          plan,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setMember((m) =>
        m
          ? {
              ...m,
              subscription_active: 1,
              subscription_expires_at: data.subscription_expires_at,
              subscription_weeks: data.subscription_weeks,
              plan: data.plan,
            }
          : m
      );
      loadMembers();
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ email: email.trim(), action: "revoke" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setMember((m) => (m ? { ...m, subscription_active: 0 } : m));
      loadMembers();
    } finally {
      setBusy(false);
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

  const active =
    member &&
    Boolean(member.subscription_active) &&
    (!member.subscription_expires_at || new Date(member.subscription_expires_at) > new Date());

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-12 flex justify-center">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-4 text-sm mb-4 flex-wrap">
          <a href="/admin/questions" className="underline text-black/50">
            Questions
          </a>
          <span className="font-semibold">Members</span>
          <a href="/admin/scoring" className="underline text-black/50">
            Scoring
          </a>
          <a href="/admin/payments" className="underline text-black/50">
            Payments
          </a>
          <a href="/admin/referrals" className="underline text-black/50">
            Referrals
          </a>
          <a href="/admin/bug-reports" className="underline text-black/50">
            Bug Reports
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
        </div>

        <h1 className="text-2xl font-bold mb-2">Speaking Club Members</h1>
        <p className="text-sm text-black/60 mb-6">
          Approving a payment on{" "}
          <a href="/admin/payments" className="underline">
            Payments
          </a>{" "}
          already activates the subscription and sets the plan badge — you don&apos;t need to redo it
          here. Use this page to see who&apos;s active, or to manually grant/revoke/adjust an account.
        </p>

        {/* Members list */}
        <div className="bg-white rounded-xl border border-black/10 p-5 mb-8">
          <h2 className="font-semibold mb-3">Active &amp; past members</h2>
          {membersError && <p className="text-red-600 text-sm mb-3">{membersError}</p>}
          {members === null && !membersError && <p className="text-sm text-black/50">Loading...</p>}
          {members && members.length === 0 && (
            <p className="text-sm text-black/50">No members yet — approve a payment or grant one below.</p>
          )}
          {members && members.length > 0 && (
            <div className="flex flex-col divide-y divide-black/5">
              {members.map((m) => {
                const isActive =
                  Boolean(m.subscription_active) &&
                  (!m.subscription_expires_at || new Date(m.subscription_expires_at) > new Date());
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      setEmail(m.email);
                      setMember(m);
                      if (m.plan === "starter" || m.plan === "pro" || m.plan === "dedicated") setPlan(m.plan);
                    }}
                    className="flex items-center justify-between gap-3 py-3 text-left hover:bg-black/[0.02] -mx-1 px-1 rounded-lg"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{m.name || m.email}</p>
                      <p className="text-xs text-black/40 truncate">
                        {m.email}
                        {m.subscription_expires_at && (
                          <>
                            {" "}
                            &middot;{" "}
                            {isActive ? "Expires" : "Expired"}{" "}
                            {new Date(m.subscription_expires_at).toLocaleDateString("bn-BD", { dateStyle: "medium" })}
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isActive && <span className="text-xs text-black/40">Inactive</span>}
                      <PlanBadge plan={m.plan} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <h2 className="font-semibold mb-2">Manual override</h2>
        <form onSubmit={lookup} className="flex gap-2 mb-6">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 rounded-xl border border-black/10 px-4 py-3 bg-white"
            placeholder="student@example.com"
          />
          <button disabled={busy} className="rounded-xl px-4 py-3 font-bold text-white bg-[#6FC24A] disabled:opacity-60">
            Search
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {member === null && (
          <p className="text-sm text-black/50">No account found with this email — they need to sign up first.</p>
        )}

        {member && (
          <div className="bg-white rounded-xl border border-black/10 p-5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-semibold">{member.name || "(no name)"}</p>
              <PlanBadge plan={member.plan} />
            </div>
            <p className="text-sm text-black/60 mb-3">{member.email}</p>

            <p className="text-sm mb-4">
              Current status:{" "}
              {active ? (
                <span className="font-semibold text-[#2E6B2A]">Active</span>
              ) : (
                <span className="font-semibold text-red-600">Inactive</span>
              )}
              {member.subscription_expires_at && (
                <>
                  {" "}
                  &middot; Expires:{" "}
                  {new Date(member.subscription_expires_at).toLocaleDateString("bn-BD", { dateStyle: "medium" })}
                </>
              )}
              {member.subscription_weeks != null && (
                <>
                  {" "}
                  &middot; Mock test weeks: <span className="font-semibold">{member.subscription_weeks}</span>
                </>
              )}
            </p>

            <div className="flex items-center gap-2 mb-4">
              <label className="text-sm text-black/60">Plan</label>
              <div className="flex gap-1.5">
                {(Object.keys(PLANS) as PlanSlug[])
                  .filter((slug) => PLANS[slug].purchasable)
                  .map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      onClick={() => {
                        setPlan(slug);
                        // Re-suggest weeks for the newly-picked plan (same
                        // days, different cadence) unless the admin has
                        // already typed a custom weeks value by hand.
                        if (!weeksTouched) setWeeks(suggestedWeeks(days, slug));
                      }}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold border ${
                        plan === slug
                          ? "bg-[#6FC24A] text-white border-[#6FC24A]"
                          : "bg-white text-black/60 border-black/10"
                      }`}
                    >
                      {PLANS[slug].name}
                    </button>
                  ))}
              </div>
            </div>

            <div className="flex items-center gap-4 mb-1 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-sm text-black/60">Duration (days)</label>
                <input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDays(next);
                    // Keep the weeks suggestion in sync until the admin
                    // has deliberately typed their own weeks value.
                    if (!weeksTouched) setWeeks(suggestedWeeks(next, plan));
                  }}
                  className="w-24 rounded-lg border border-black/10 px-3 py-2"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm text-black/60">Mock test weeks</label>
                <input
                  type="number"
                  min={1}
                  value={weeks}
                  onChange={(e) => {
                    setWeeksTouched(true);
                    setWeeks(e.target.value);
                  }}
                  className="w-20 rounded-lg border border-black/10 px-3 py-2"
                />
              </div>
            </div>
            <p className="text-xs text-black/40 mb-4">
              Auto-suggested from days &amp; plan — Starter ≈ 2/month, Pro/Dedicated ≈ 4/month (weekly) — editable by hand.
            </p>

            <div className="flex gap-3">
              <button
                onClick={grant}
                disabled={busy}
                className="flex-1 rounded-full py-3 font-bold text-white bg-[#6FC24A] disabled:opacity-60"
              >
                Activate Subscription
              </button>
              <button
                onClick={revoke}
                disabled={busy}
                className="flex-1 rounded-full py-3 font-bold text-red-600 bg-white border border-red-200 disabled:opacity-60"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
