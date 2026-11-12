import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { mockTestsPerMonth } from "@/lib/plans";
import { grantReferrerRewardIfPending } from "@/lib/referral";
import { createNotification } from "@/lib/notifications";

// There's no real payment gateway wired up yet (same manual-confirm
// situation as the bKash/Nagad flow on the static site). Approving a claim
// on /admin/payments already activates the subscription and sets the plan,
// so this page's main job now is *viewing* who's currently a member (with
// their Pro/Starter badge) — the email-lookup + grant/revoke form below is
// only needed for manual overrides (comps, custom durations, fixing a
// mistake), not as a required second step after every payment.
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();

  if (email) {
    const res = await db.execute({
      sql: "SELECT id, email, name, subscription_active, subscription_expires_at, subscription_weeks, plan, is_test, member_group FROM users WHERE email = ?",
      args: [email],
    });
    return NextResponse.json({ user: res.rows[0] ?? null });
  }

  // ?group=batch-1 -> everyone in that group (up to 1000), plus the list of all group names with head-counts so the
  // page can show a filter.
  const group = normalizeGroup(req.nextUrl.searchParams.get("group"));
  const groupsRes = await db.execute(
    "SELECT member_group AS name, COUNT(*) AS n FROM users WHERE member_group IS NOT NULL AND member_group != '' GROUP BY member_group ORDER BY member_group"
  );
  if (group) {
    const gr = await db.execute({
      sql: `SELECT id, email, name, subscription_active, subscription_expires_at, subscription_weeks, plan, is_test, member_group
            FROM users WHERE member_group = ? ORDER BY email LIMIT 1000`,
      args: [group],
    });
    return NextResponse.json({ members: gr.rows, groups: groupsRes.rows });
  }

  // No email given — return everyone who currently has (or has ever had) an
  // active subscription, most-recently-expiring first, so the page can
  // render a members list with a plan badge per row.
  const res = await db.execute(
    `SELECT id, email, name, subscription_active, subscription_expires_at, subscription_weeks, plan, is_test, member_group
     FROM users
     WHERE subscription_active = 1 OR plan IS NOT NULL OR is_test = 1
     ORDER BY subscription_expires_at DESC
     LIMIT 200`
  );
  return NextResponse.json({ members: res.rows, groups: groupsRes.rows });
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

/** Group label: trimmed, single-spaced, max 40 chars, "" -> null. Case is kept as typed but compared exactly, so
 * the page offers existing names to pick from instead of retyping. */
function normalizeGroup(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const g = v.replace(/\s+/g, " ").trim().slice(0, 40);
  return g || null;
}

/** Grants one account (same effect as the single "Activate Subscription" button). Returns false if no such email. */
async function grantOne(
  db: Awaited<ReturnType<typeof getDb>>,
  email: string,
  opts: { planSlug: string; planDays: number; planWeeks: number; group?: string | null }
): Promise<boolean> {
  const expiresAt = new Date(Date.now() + opts.planDays * 24 * 60 * 60 * 1000);
  const res = await db.execute({
    // member_group is only touched when a group was given, so a plain grant never wipes an existing label.
    sql: opts.group
      ? "UPDATE users SET subscription_active = 1, subscription_expires_at = ?, subscription_weeks = ?, plan = ?, member_group = ? WHERE email = ?"
      : "UPDATE users SET subscription_active = 1, subscription_expires_at = ?, subscription_weeks = ?, plan = ? WHERE email = ?",
    args: opts.group
      ? [expiresAt.toISOString(), opts.planWeeks, opts.planSlug, opts.group, email]
      : [expiresAt.toISOString(), opts.planWeeks, opts.planSlug, email],
  });
  if (res.rowsAffected === 0) return false;
  try {
    const r = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] });
    const id = r.rows[0]?.id as number | undefined;
    if (id) await grantReferrerRewardIfPending(Number(id));
  } catch {
    // referral reward is a bonus; never fail the grant over it
  }
  await createNotification({
    userEmail: email,
    type: "membership_granted",
    title: "Membership activated 🎉",
    body: `You now have Speaking Club access, active until ${expiresAt.toDateString()}.`,
    link: "/dashboard/profile",
  });
  return true;
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const action = body?.action as string | undefined;
  // Normalized exactly like GET's lookup and like every account's own
  // stored email (register/route.ts does the same .trim().toLowerCase()
  // before INSERT). Grant/revoke here used to skip this step — a search
  // box that auto-capitalizes (common on a phone keyboard) or a
  // copy-pasted email with different casing would still find the account
  // on GET (which does normalize) but then silently match zero rows here,
  // since SQLite's `=` is case-sensitive. The account looked found, the
  // grant looked submitted, and nothing actually changed.
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const { days, weeks, plan } = body ?? {};

  // ---- group / bulk actions (no single `email`) ----
  if (action === "grant_bulk" || action === "revoke_group") {
    const db = await getDb();
    const group = normalizeGroup(body?.group);
    if (!group) return NextResponse.json({ error: "A group name is required." }, { status: 400 });

    if (action === "revoke_group") {
      const res = await db.execute({
        sql: "UPDATE users SET subscription_active = 0 WHERE member_group = ?",
        args: [group],
      });
      return NextResponse.json({ ok: true, revoked: res.rowsAffected });
    }

    // grant_bulk: the page sends the pasted list in chunks (~25 per request) to stay inside serverless time limits.
    const raw: unknown[] = Array.isArray(body?.emails) ? body.emails : [];
    const emails = Array.from(
      new Set(raw.map((e) => (typeof e === "string" ? e.trim().toLowerCase() : "")).filter((e) => e.includes("@")))
    ).slice(0, 50);
    const planSlug = VALID_PLANS.has(plan) ? plan : "pro";
    const planDays = Number(days) || 90;
    const planWeeks = Number(weeks) > 0 ? Number(weeks) : defaultWeeksForDays(planDays, planSlug);
    const granted: string[] = [];
    const notFound: string[] = [];
    for (const e of emails) {
      try {
        (await grantOne(db, e, { planSlug, planDays, planWeeks, group })) ? granted.push(e) : notFound.push(e);
      } catch {
        notFound.push(e);
      }
    }
    return NextResponse.json({ ok: true, granted, notFound });
  }

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
    // Optional group label from the page (blank = leave the current label alone).
    const grantGroup = normalizeGroup(body?.group);
    if (grantGroup) {
      await db.execute({ sql: "UPDATE users SET member_group = ? WHERE email = ?", args: [grantGroup, email] });
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

    // The payment-approval flow (see /api/admin/payments) tells the
    // student their membership is active via the dashboard bell — this
    // manual path used to skip that entirely, so a hand-granted student
    // had no on-site signal they now had access at all.
    await createNotification({
      userEmail: email,
      type: "membership_granted",
      title: "Membership activated 🎉",
      body: `You now have Speaking Club access, active until ${expiresAt.toDateString()}.`,
      link: "/dashboard/profile",
    });

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

  if (action === "set_group") {
    const group = normalizeGroup(body?.group);
    const res = await db.execute({
      sql: "UPDATE users SET member_group = ? WHERE email = ?",
      args: [group, email],
    });
    if (res.rowsAffected === 0) {
      return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, member_group: group });
  }

  if (action === "set_test") {
    const isTest = body?.isTest ? 1 : 0;
    const res = await db.execute({
      sql: "UPDATE users SET is_test = ? WHERE email = ?",
      args: [isTest, email],
    });
    if (res.rowsAffected === 0) {
      return NextResponse.json({ error: "No account found with that email." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, is_test: isTest });
  }

  return NextResponse.json({ error: "action must be 'grant', 'revoke', 'set_group', 'set_test', 'grant_bulk' or 'revoke_group'" }, { status: 400 });
}
