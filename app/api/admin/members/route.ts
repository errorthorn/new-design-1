import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { mockTestsPerMonth } from "@/lib/plans";
import { grantReferrerRewardIfPending } from "@/lib/referral";

// There's no real payment gateway wired up yet (same manual-confirm
// situation as the bKash/Nagad flow on the static site). Approving a claim
// on /admin/payments already activates the subscription and sets the plan,
// so this page's main job now is *viewing* who's currently a member (with
// their Pro/Starter badge) — the email-lookup + grant/revoke form below is
// only needed for manual overrides (comps, custom durations, fixing a
// mistake), not as a required second step after every payment.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();

  if (email) {
    const res = await db.execute({
      sql: "SELECT id, email, name, subscription_active, subscription_expires_at, subscription_weeks, plan FROM users WHERE email = ?",
      args: [email],
    });
    return NextResponse.json({ user: res.rows[0] ?? null });
  }

  // No email given — return everyone who currently has (or has ever had) an
  // active subscription, most-recently-expiring first, so the page can
  // render a members list with a plan badge per row.
  const res = await db.execute(
    `SELECT id, email, name, subscription_active, subscription_expires_at, subscription_weeks, plan
     FROM users
     WHERE subscription_active = 1 OR plan IS NOT NULL
     ORDER BY subscription_expires_at DESC
     LIMIT 200`
  );
  return NextResponse.json({ members: res.rows });
}

// A plan is sold in whole months. Mock-test cadence depends on the plan
// (Starter: 2/month, Pro/Dedicated: weekly ~4/month — see
// mockTestsPerMonth in lib/plans.ts), so the suggested weeks scale with
// months AND plan tier. This is only ever the *suggested* value — the
// admin can still type a different number of weeks by hand for a custom
// plan.
function defaultWeeksForDays(days: number, planSlug: string): number {
  const months = days / 30;
  return Math.max(1, Math.round(months * mockTestsPerMonth(planSlug)));
}

const VALID_PLANS = new Set(["starter", "pro", "dedicated"]);

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { email, action, days, weeks, plan } = await req.json();
  if (!email || !action) {
    return NextResponse.json({ error: "email and action are required" }, { status: 400 });
  }

  const db = await getDb();

  if (action === "grant") {
    // Defaults to a 90-day (3-month) membership from today; the admin can
    // pass a different `days` value for a different plan length.
    const planDays = Number(days) || 90;
    // Plan tier for the badge (and for the mock-test cadence below) —
    // falls back to 'pro' (same default as payment_claims) if the admin
    // doesn't pick one.
    const planSlug = VALID_PLANS.has(plan) ? plan : "pro";
    const expiresAt = new Date(Date.now() + planDays * 24 * 60 * 60 * 1000);
    // `weeks` lets the admin override how many mock-test slots this
    // membership includes; otherwise it's derived from the plan length
    // AND tier.
    const planWeeks = Number(weeks) > 0 ? Number(weeks) : defaultWeeksForDays(planDays, planSlug);
    const res = await db.execute({
      sql: "UPDATE users SET subscription_active = 1, subscription_expires_at = ?, subscription_weeks = ?, plan = ? WHERE email = ?",
      args: [expiresAt.toISOString(), planWeeks, planSlug, email],
    });
    if (res.rowsAffected === 0) {
      return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
    }

    // This account just went active by hand — same referral-reward hook
    // as an approved payment (see /api/admin/payments). No-ops if this
    // account was never referred, or the referrer was already rewarded.
    const grantedRes = await db.execute({
      sql: "SELECT id FROM users WHERE email = ?",
      args: [email],
    });
    const grantedUserId = grantedRes.rows[0]?.id as number | undefined;
    if (grantedUserId) {
      await grantReferrerRewardIfPending(Number(grantedUserId));
    }

    return NextResponse.json({
      ok: true,
      subscription_expires_at: expiresAt.toISOString(),
      subscription_weeks: planWeeks,
      plan: planSlug,
    });
  }

  if (action === "revoke") {
    const res = await db.execute({
      sql: "UPDATE users SET subscription_active = 0 WHERE email = ?",
      args: [email],
    });
    if (res.rowsAffected === 0) {
      return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "action must be 'grant' or 'revoke'" }, { status: 400 });
}
