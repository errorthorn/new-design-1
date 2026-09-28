import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { createNotification } from "@/lib/notifications";
import { getPlan, mockTestsPerMonth, monthsGrantedForPlan } from "@/lib/plans";
import { grantReferrerRewardIfPending } from "@/lib/referral";

// Same ADMIN_SECRET pattern as /api/admin/members — this is the missing
// piece of the manual bKash/Nagad flow: instead of the admin having to
// already know which email to look up, this lists every claim a customer
// has submitted so the admin can check it against their bKash/Nagad app
// and click Allow/Reject.
const PLAN_DAYS = 30; // billing is monthly right now (quarterly/6-month are "Coming Soon" on /pricing)

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const res = await db.execute(
    `SELECT id, user_id, email, plan, method, sender_number, trx_id, amount, status, created_at, discount_code, discount_percent
     FROM payment_claims
     ORDER BY created_at DESC
     LIMIT 100`
  );

  return NextResponse.json({ claims: res.rows });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id, action } = await req.json();
  if (!id || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "id and a valid action are required" }, { status: 400 });
  }

  const db = await getDb();

  const claimRes = await db.execute({
    sql: "SELECT id, user_id, email, status, discount_code, plan FROM payment_claims WHERE id = ?",
    args: [id],
  });
  const claim = claimRes.rows[0];
  if (!claim) {
    return NextResponse.json({ error: "Claim not found." }, { status: 404 });
  }
  if (claim.status !== "pending") {
    return NextResponse.json({ error: `This claim was already ${claim.status}.` }, { status: 409 });
  }

  if (action === "reject") {
    await db.execute({
      sql: "UPDATE payment_claims SET status = 'rejected' WHERE id = ?",
      args: [id],
    });
    // Give the discount code back — it was only spent because this claim
    // was expected to go through. A rejected claim shouldn't cost the
    // customer their reward; they can resubmit and reuse the same code.
    if (claim.discount_code) {
      await db.execute({
        sql: "UPDATE discount_credits SET used = 0, used_at = NULL WHERE code = ? AND user_id = ?",
        args: [claim.discount_code, claim.user_id],
      });
    }
    await createNotification({
      userEmail: String(claim.email),
      type: "payment_rejected",
      title: "Your payment couldn't be verified",
      body: "We couldn't match this transaction to a bKash/Nagad payment. Please double-check the details and resubmit.",
      link: "/payment",
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // approve: mark the claim, and grant the subscription (with the plan the
  // claim was for) in one go so the admin doesn't need a second trip to
  // /admin/members just to set the plan badge — that page is now for
  // viewing members and handling manual overrides, not required follow-up.
  // Pro's "Buy 1 Get 1 Free" promo means a Pro approval grants 2 months,
  // not 1 — see monthsGrantedForPlan(). subscription_weeks scales with
  // that too (mock-test cadence per month × however many months this
  // approval actually covers), so a Pro customer really does get roughly
  // weekly tests across both of their free months, not just the first.
  const months = monthsGrantedForPlan(String(claim.plan));
  const expiresAt = new Date(Date.now() + months * PLAN_DAYS * 24 * 60 * 60 * 1000);
  const weeks = mockTestsPerMonth(String(claim.plan)) * months;
  await db.execute({
    sql: "UPDATE users SET subscription_active = 1, subscription_expires_at = ?, subscription_weeks = ?, plan = ? WHERE id = ?",
    args: [expiresAt.toISOString(), weeks, claim.plan, claim.user_id],
  });
  await db.execute({
    sql: "UPDATE payment_claims SET status = 'approved' WHERE id = ?",
    args: [id],
  });

  // This account just went active — if it was referred by someone, this
  // is the real signal (not the earlier redemption) that the referrer's
  // 25%-off reward should actually be handed out. No-ops if there's no
  // referral on record, or the referrer was already rewarded for it.
  await grantReferrerRewardIfPending(Number(claim.user_id));

  await createNotification({
    userEmail: String(claim.email),
    type: "payment_approved",
    title: "Payment approved 🎉",
    body:
      months > 1
        ? `You're now a ${getPlan(String(claim.plan)).name} plan Speaking Club Member. Thanks to the Buy 1 Get 1 Free offer, you get ${months} months — active until ${expiresAt.toDateString()}.`
        : `You're now a ${getPlan(String(claim.plan)).name} plan Speaking Club Member. Your membership is active until ${expiresAt.toDateString()}.`,
    link: "/dashboard/profile",
  });

  return NextResponse.json({
    ok: true,
    status: "approved",
    subscription_expires_at: expiresAt.toISOString(),
    plan: claim.plan,
    months_granted: months,
  });
}
