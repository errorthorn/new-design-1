import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

// Every Refer & Earn redemption, for /admin/referrals. The tricky case
// this exists for: a friend can redeem a referral code even if they'd
// already paid *before* redeeming it (see app/api/referral/redeem/route.ts
// — there's no check either way, on purpose, so a late redemption never
// blocks the referrer's reward). When that happens, the referrer's
// 25%-off code is stuck unused — it can't be applied retroactively to a
// claim that's already been submitted/approved — so an admin needs to
// see it and refund the difference by hand.
//
// This applies to the REFERRER side ONLY, not the redeemer: the referrer
// is, by definition, an existing user, so they're frequently already
// subscribed themselves when a friend redeems their code. `redeemer_*`
// columns/fields still exist and are still populated (kept for display
// context and because the redeemer's own subscription snapshot is now
// used for a different purpose — see below), but
// `redeemer_already_paid_before_redeeming` is always false — a previous
// version of this route incorrectly ran the same check on the redeemer
// side too, which has been reverted.
//
// The refund is only granted when the referral was genuine: the referrer
// had already paid before redemption (nothing to apply their reward to)
// AND the redeemer was an actual new customer (NOT already subscribed) at
// that moment. Without that second condition, two already-subscribed
// accounts could redeem each other's codes and pull real cash out via
// the refund flow with zero new subscribers gained — see
// redeemerWasAlreadyCustomer below.
//
// `referrer_already_paid_before_redeeming` is read straight off
// referrals.referrer_already_subscribed / redeemer_already_subscribed —
// snapshots taken at redemption time (see app/api/referral/redeem and
// lib/db.ts) that cover both an approved payment_claims row AND a
// subscription an admin granted by hand on /admin/members, which never
// creates a payment_claims row at all.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const db = await getDb();

  const referralsRes = await db.execute(`
    SELECT
      r.id AS referral_id,
      r.created_at AS redeemed_at,
      r.redeemer_already_subscribed,
      r.referrer_already_subscribed,
      ref.id AS referrer_id, ref.email AS referrer_email,
      red.id AS redeemed_id, red.email AS redeemed_email,
      rc.id AS referrer_credit_id, rc.code AS referrer_code,
      rc.used AS referrer_used, rc.used_at AS referrer_used_at,
      rc.refunded AS referrer_refunded, rc.refunded_at AS referrer_refunded_at,
      rc.refund_number AS referrer_refund_number, rc.refund_method AS referrer_refund_method,
      dc.id AS redeemer_credit_id, dc.code AS redeemer_code,
      dc.used AS redeemer_used, dc.used_at AS redeemer_used_at,
      dc.refunded AS redeemer_refunded, dc.refunded_at AS redeemer_refunded_at,
      dc.refund_number AS redeemer_refund_number, dc.refund_method AS redeemer_refund_method
    FROM referrals r
    JOIN users ref ON ref.id = r.referrer_id
    JOIN users red ON red.id = r.referred_id
    LEFT JOIN discount_credits rc ON rc.referral_id = r.id AND rc.reason = 'referral_referrer'
    LEFT JOIN discount_credits dc ON dc.referral_id = r.id AND dc.reason = 'referral_redeemed'
    ORDER BY r.created_at DESC
    LIMIT 200
  `);

  // Best-effort lookup of an approved claim around the redemption time —
  // purely for display context (so the admin can see what plan/amount to
  // base the refund on). Can come back empty for a manually-granted
  // account (no payment_claims row exists for those); the actual
  // already-paid flags below never depend on this, so that case still
  // shows correctly, just without the extra context line.
  async function earlierClaimFor(userId: number, beforeIso: string) {
    return db.execute({
      sql: `SELECT id, plan, amount, created_at FROM payment_claims
            WHERE user_id = ? AND status = 'approved' AND created_at < ?
            ORDER BY created_at ASC LIMIT 1`,
      args: [userId, beforeIso],
    });
  }

  // Second fallback signal for legacy (NULL) rows only: is this account
  // *currently* subscribed? Needed alongside the payment_claims check
  // above because a subscription granted by hand on /admin/members never
  // creates a payment_claims row — that case was silently missed by the
  // claims-only check, which is exactly the accounts this was reported
  // against (comped/manually-granted members on either side of a
  // referral).
  async function currentlySubscribed(userId: number) {
    const res = await db.execute({ sql: "SELECT subscription_active FROM users WHERE id = ?", args: [userId] });
    return Boolean(Number(res.rows[0]?.subscription_active ?? 0));
  }

  const rows = await Promise.all(
    referralsRes.rows.map(async (row) => {
      const redeemedAt = row.redeemed_at as string;

      // Redeemer side. Policy: the manual-refund flow is for the
      // REFERRER side only (see app/api/referral/route.ts) — a previous
      // version of this code wrongly ran the same "already paid before
      // redeeming" check for the redeemer too, which is not the intended
      // behavior. This signal is now repurposed below (see
      // redeemerWasAlreadyCustomer) to gate the REFERRER's refund instead.
      const redeemerSnapshot = row.redeemer_already_subscribed;
      const redeemerClaimRes = await earlierClaimFor(row.redeemed_id as number, redeemedAt);
      const redeemerEarlierClaim = redeemerClaimRes.rows[0] ?? null;
      let redeemerWasAlreadyCustomer: boolean;
      if (redeemerSnapshot !== null && redeemerSnapshot !== undefined) {
        redeemerWasAlreadyCustomer = Boolean(Number(redeemerSnapshot));
      } else {
        redeemerWasAlreadyCustomer =
          Boolean(redeemerEarlierClaim) || (await currentlySubscribed(row.redeemed_id as number));
      }
      const redeemerAlreadyPaid = false;

      // Referrer side. A cash refund is only warranted when the referral
      // was genuine: the referrer had nothing to apply their reward to
      // (already subscribed) AND the redeemer was an actual new customer
      // (NOT already subscribed) at the moment of redemption. Without the
      // second half of that check, two already-subscribed accounts could
      // redeem each other's codes back and forth and pull real cash out
      // via the refund flow despite the business gaining zero new
      // subscribers from it — this is the anti-collusion guard for that.
      const referrerSnapshot = row.referrer_already_subscribed;
      const referrerAlreadyUsed = Boolean(row.referrer_used);
      const referrerClaimRes = await earlierClaimFor(row.referrer_id as number, redeemedAt);
      const referrerEarlierClaim = referrerClaimRes.rows[0] ?? null;
      let referrerWasAlreadySubscribed: boolean;
      if (referrerSnapshot !== null && referrerSnapshot !== undefined) {
        referrerWasAlreadySubscribed = Boolean(Number(referrerSnapshot));
      } else {
        referrerWasAlreadySubscribed =
          Boolean(referrerEarlierClaim) || (await currentlySubscribed(row.referrer_id as number));
      }
      let referrerAlreadyPaid = referrerWasAlreadySubscribed && !redeemerWasAlreadyCustomer;
      if (referrerAlreadyUsed) referrerAlreadyPaid = false;

      return {
        ...row,
        redeemer_already_paid_before_redeeming: redeemerAlreadyPaid,
        redeemer_earlier_claim: redeemerEarlierClaim,
        referrer_already_paid_before_redeeming: referrerAlreadyPaid,
        referrer_earlier_claim: referrerEarlierClaim,
      };
    })
  );

  return NextResponse.json({ referrals: rows });
}

// Toggle a discount_credits row's manual-refund flag — works for either
// side's credit id (the /admin/referrals UI passes whichever one it just
// showed a "Mark as refunded" button for).
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { discountCreditId, refunded } = await req.json();
  if (!discountCreditId || typeof refunded !== "boolean") {
    return NextResponse.json(
      { error: "discountCreditId and a boolean refunded are required" },
      { status: 400 }
    );
  }

  const db = await getDb();
  await db.execute({
    sql: "UPDATE discount_credits SET refunded = ?, refunded_at = ? WHERE id = ?",
    args: [refunded ? 1 : 0, refunded ? new Date().toISOString() : null, discountCreditId],
  });

  return NextResponse.json({ ok: true });
}
