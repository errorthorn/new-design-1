"use client";

import { AdminShell } from "@/components/admin/admin-shell";
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
  is_test: number;
  member_group: string | null;
};

type GroupRow = { name: string; n: number };

const PLAN_BADGE_STYLE: Record<string, string> = {
  pro: "bg-white border border-leaf-500 text-leaf-700",
  starter: "bg-blue-100 text-blue-700",
  dedicated: "bg-leaf-600 text-white",
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

  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupFilter, setGroupFilter] = useState("");

  // single-account group label
  const [memberGroupInput, setMemberGroupInput] = useState("");

  // bulk grant
  const [bulkEmails, setBulkEmails] = useState("");
  const [bulkGroup, setBulkGroup] = useState("");
  const [bulkPlan, setBulkPlan] = useState<PlanSlug>("pro");
  const [bulkDays, setBulkDays] = useState("30");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{ granted: number; notFound: string[] } | null>(null);

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
      const qs = groupFilter ? `?group=${encodeURIComponent(groupFilter)}` : "";
      const res = await fetch(`/api/admin/members${qs}`, {
        headers: { "x-admin-secret": secret },
      });
      const data = await res.json();
      if (!res.ok) {
        setMembersError(data.error ?? "Couldn't load the members list.");
        return;
      }
      setMembers(data.members ?? []);
      setGroups(data.groups ?? []);
    } catch {
      setMembersError("There was a problem loading the members list.");
    }
  }

  useEffect(() => {
    if (unlocked) loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, groupFilter]);

  async function postMembers(payload: Record<string, unknown>) {
    const res = await fetch("/api/admin/members", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-secret": secret },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Something went wrong");
    return data;
  }

  // Pasted list -> split on spaces/commas/new lines -> sent 25 at a time so no single request runs long.
  async function grantBulk() {
    const list = Array.from(
      new Set(
        bulkEmails
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.includes("@"))
      )
    );
    const group = bulkGroup.trim();
    if (!list.length) return setError("Paste at least one email.");
    if (!group) return setError("Give the group a name (e.g. batch-1) so you can find these people later.");
    if (!window.confirm(`Give ${list.length} accounts ${PLANS[bulkPlan].name} access for ${bulkDays || 30} days, group "${group}"?`)) return;
    setError(null);
    setBulkBusy(true);
    setBulkResult(null);
    let granted = 0;
    const notFound: string[] = [];
    try {
      for (let i = 0; i < list.length; i += 25) {
        setBulkProgress(`${Math.min(i + 25, list.length)} / ${list.length}`);
        const data = await postMembers({
          action: "grant_bulk",
          emails: list.slice(i, i + 25),
          group,
          plan: bulkPlan,
          days: Number(bulkDays) || 30,
        });
        granted += data.granted.length;
        notFound.push(...data.notFound);
      }
      setBulkResult({ granted, notFound });
      loadMembers();
    } catch (e: any) {
      setError(`${e.message} (done so far: ${granted}). It is safe to run the same list again.`);
    } finally {
      setBulkBusy(false);
      setBulkProgress(null);
    }
  }

  async function revokeGroup(name: string) {
    if (!window.confirm(`Switch OFF access for everyone in group "${name}"?`)) return;
    setError(null);
    try {
      const data = await postMembers({ action: "revoke_group", group: name });
      setError(null);
      setBulkResult(null);
      window.alert(`Access switched off for ${data.revoked} accounts.`);
      loadMembers();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveMemberGroup() {
    if (!member) return;
    setError(null);
    setBusy(true);
    try {
      const data = await postMembers({ action: "set_group", email: email.trim(), group: memberGroupInput });
      setMember((m) => (m ? { ...m, member_group: data.member_group } : m));
      loadMembers();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

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
      setMemberGroupInput(data.user?.member_group ?? "");
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
          group: memberGroupInput,
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
              member_group: memberGroupInput.trim() || m.member_group,
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

  // Marks/unmarks this account as a sample/test account (see
  // /admin/members's note below) — kept out of Speaking Club auto-pair
  // regardless of whether its own subscription is on, so it never gets
  // proposed as a real student's partner.
  async function toggleTest() {
    if (!member) return;
    setError(null);
    setBusy(true);
    try {
      const nextIsTest = member.is_test ? 0 : 1;
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": secret },
        body: JSON.stringify({ email: email.trim(), action: "set_test", isTest: Boolean(nextIsTest) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      setMember((m) => (m ? { ...m, is_test: nextIsTest } : m));
      loadMembers();
    } finally {
      setBusy(false);
    }
  }

  if (!unlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setUnlocked(true);
          }}
          className="bg-white rounded-2xl p-6 border border-leaf-300 w-full max-w-sm"
        >
          <label className="block text-sm font-medium mb-1">Admin secret</label>
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-xl border border-leaf-300 px-4 py-3 mb-4"
            placeholder="ADMIN_SECRET"
          />
          <button className="w-full rounded-full py-3 font-bold text-white bg-leaf-600">Enter</button>
        </form>
      </div>
    );
  }

  const active =
    member &&
    Boolean(member.subscription_active) &&
    (!member.subscription_expires_at || new Date(member.subscription_expires_at) > new Date());

  return (
    <AdminShell current="members" title="Members" width="max-w-3xl">

        {/* Bulk grant by group */}
        <div className="bg-white rounded-2xl border border-leaf-300 p-5 mb-8">
          <h2 className="font-semibold mb-1">Give access to a group</h2>
          <p className="text-xs text-black/50 mb-3">
            Paste the emails (one per line, or separated by commas/spaces). Everyone gets the plan below and is
            labelled with the group name, so you can filter, find and switch off exactly these people later. Emails
            with no account yet are listed afterwards &mdash; they need to sign up first, then run the list again.
          </p>
          <textarea
            value={bulkEmails}
            onChange={(e) => setBulkEmails(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-leaf-300 px-4 py-3 mb-3 text-sm font-mono"
            placeholder={"a@gmail.com\nb@gmail.com\n..."}
          />
          <div className="flex items-center gap-3 flex-wrap mb-3">
            <input
              value={bulkGroup}
              onChange={(e) => setBulkGroup(e.target.value)}
              list="member-groups"
              maxLength={40}
              className="w-40 rounded-xl border border-leaf-300 px-3 py-2 text-sm"
              placeholder="Group name"
            />
            <datalist id="member-groups">
              {groups.map((g) => (
                <option key={g.name} value={g.name} />
              ))}
            </datalist>
            <select
              value={bulkPlan}
              onChange={(e) => setBulkPlan(e.target.value as PlanSlug)}
              className="rounded-xl border border-leaf-300 px-3 py-2 text-sm bg-white"
            >
              {(Object.keys(PLANS) as PlanSlug[])
                .filter((slug) => PLANS[slug].purchasable)
                .map((slug) => (
                  <option key={slug} value={slug}>
                    {PLANS[slug].name}
                  </option>
                ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-black/60">
              Days
              <input
                type="number"
                min={1}
                value={bulkDays}
                onChange={(e) => setBulkDays(e.target.value)}
                className="w-20 rounded-xl border border-leaf-300 px-3 py-2"
              />
            </label>
          </div>
          <button
            onClick={grantBulk}
            disabled={bulkBusy}
            className="rounded-full px-6 py-3 font-bold text-white bg-leaf-600 disabled:opacity-60"
          >
            {bulkBusy ? `Working… ${bulkProgress ?? ""}` : "Give access"}
          </button>
          {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
          {bulkResult && (
            <div className="mt-3 text-sm">
              <p className="font-semibold text-leaf-700">{bulkResult.granted} accounts activated.</p>
              {bulkResult.notFound.length > 0 && (
                <>
                  <p className="text-red-600 mt-2">No account found for {bulkResult.notFound.length}:</p>
                  <textarea
                    readOnly
                    value={bulkResult.notFound.join("\n")}
                    rows={Math.min(6, bulkResult.notFound.length)}
                    className="w-full mt-1 rounded-xl border border-red-200 px-3 py-2 text-xs font-mono"
                  />
                </>
              )}
            </div>
          )}
        </div>

        {/* Members list */}
        <div className="bg-white rounded-2xl border border-leaf-300 p-5 mb-8">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h2 className="font-semibold">{groupFilter ? `Group: ${groupFilter}` : "Active & past members"}</h2>
            <div className="flex items-center gap-2">
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                className="rounded-xl border border-leaf-300 px-3 py-1.5 text-sm bg-white"
              >
                <option value="">All members</option>
                {groups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name} ({g.n})
                  </option>
                ))}
              </select>
              {groupFilter && (
                <button
                  onClick={() => revokeGroup(groupFilter)}
                  className="rounded-xl px-3 py-1.5 text-sm font-semibold text-red-600 border border-red-200 bg-white"
                >
                  Switch off this group
                </button>
              )}
            </div>
          </div>
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
                      setMemberGroupInput(m.member_group ?? "");
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
                      {Boolean(m.is_test) && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">🧪</span>
                      )}
                      {m.member_group && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-leaf-100 text-leaf-700 border border-leaf-300">
                          {m.member_group}
                        </span>
                      )}
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
            className="flex-1 rounded-xl border border-leaf-300 px-4 py-3 bg-white"
            placeholder="student@example.com"
          />
          <button disabled={busy} className="rounded-xl px-4 py-3 font-bold text-white bg-leaf-600 disabled:opacity-60">
            Search
          </button>
        </form>

        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        {member === null && (
          <p className="text-sm text-black/50">No account found with this email — they need to sign up first.</p>
        )}

        {member && (
          <div className="bg-white rounded-2xl border border-leaf-300 p-5">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-semibold">{member.name || "(no name)"}</p>
              <div className="flex items-center gap-1.5">
                {Boolean(member.is_test) && (
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                    🧪 Test
                  </span>
                )}
                <PlanBadge plan={member.plan} />
              </div>
            </div>
            <p className="text-sm text-black/60 mb-3">{member.email}</p>

            <p className="text-sm mb-4">
              Current status:{" "}
              {active ? (
                <span className="font-semibold text-leaf-700">Active</span>
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
                          ? "bg-leaf-600 text-white border-[#6FC24A]"
                          : "bg-white text-black/60 border-leaf-300"
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
                  className="w-24 rounded-xl border border-leaf-300 px-3 py-2"
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
                  className="w-20 rounded-xl border border-leaf-300 px-3 py-2"
                />
              </div>
            </div>
            <p className="text-xs text-black/40 mb-4">
              Auto-suggested from days &amp; plan — Starter ≈ 2/month, Pro/Dedicated ≈ 4/month (weekly) — editable by hand.
            </p>

            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <label className="text-sm text-black/60">Group</label>
              <input
                value={memberGroupInput}
                onChange={(e) => setMemberGroupInput(e.target.value)}
                list="member-groups"
                maxLength={40}
                className="w-40 rounded-xl border border-leaf-300 px-3 py-2 text-sm"
                placeholder="(none)"
              />
              <button
                type="button"
                onClick={saveMemberGroup}
                disabled={busy}
                className="rounded-xl px-3 py-2 text-sm font-semibold border border-leaf-300 bg-white disabled:opacity-60"
              >
                Save group
              </button>
              <span className="text-xs text-black/40">Activate also saves this label if filled.</span>
            </div>

            <label className="flex items-center gap-2 mb-4 text-sm text-black/70 select-none">
              <input type="checkbox" checked={Boolean(member.is_test)} onChange={toggleTest} disabled={busy} />
              🧪 Sample / test account — never proposed as a real student&apos;s partner in Speaking Club auto-pair,
              even while its own subscription is on
            </label>

            <div className="flex gap-3">
              <button
                onClick={grant}
                disabled={busy}
                className="flex-1 rounded-full py-3 font-bold text-white bg-leaf-600 disabled:opacity-60"
              >
                Activate Subscription
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Revoke ${member.email}'s subscription right now?`)) revoke();
                }}
                disabled={busy}
                className="flex-1 rounded-full py-3 font-bold text-red-600 bg-white border border-red-200 disabled:opacity-60"
              >
                Revoke Access
              </button>
            </div>
            <button
              onClick={() => {
                setMember(undefined);
                setEmail("");
              }}
              className="mt-3 w-full text-center text-sm text-black/40 underline"
            >
              Close
            </button>
          </div>
        )}
    </AdminShell>
  );
}
