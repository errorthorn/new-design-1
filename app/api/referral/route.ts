// app/api/referral/route.js
//
// Powers /dashboard/refer. Read-only — redemption is a separate endpoint
// (app/api/referral/redeem/route.ts) since it has its own validation and
// side effects (creating a referrals row + the redeemer's discount
// credit; the referrer's own credit is granted later — see
// grantReferrerRewardIfPending in lib/referral.ts).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { ensureReferralCode } from "@/lib/referral";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const db = await getDb();

  const userRow = await db.execute({
    sql: "SELECT referral_code FROM users WHERE id = ?",
    args: [user.id],
  });
  const code = await ensureReferralCode(
    Number(user.id),
    (userRow.rows[0]?.referral_code as string | null) ?? null
  );

  // Whether this account has already redeemed someone else's code —
  // gates the "have a friend's code?" box on the page (one-time only).
  const redeemedRes = await db.execute({
    sql: "SELECT 1 FROM referrals WHERE referred_id = ?",
    args: [user.id],
  });
  const hasRedeemed = Boolean(redeemedRes.rows[0]);

  // rewarded: whether the referral-reward code for THIS friend has
  // actually been granted yet (see grantReferrerRewardIfPending in
  // lib/referral.ts) — it only lands once they go active, not the moment
  // they redeem, so the page can show "waiting for them to subscribe"
  // instead of implying the reward already landed.
  //
  // alreadyMember: whether this friend was ALREADY an active subscriber
  // at the moment they redeemed the code (snapshotted in
  // app/api/referral/redeem/route.ts). If so, grantReferrerRewardIfPending
  // deliberately never rewards this referral — they weren't a new
  // customer the referral brought in, so "waiting for them to subscribe"
  // would be misleading (they already are, and no reward is coming).
  const friendsRes = await db.execute({
    sql: `SELECT u.name, u.email, r.created_at,
                 (dc.id IS NOT NULL) AS rewarded,
                 r.redeemer_already_subscribed
          FROM referrals r
          JOIN users u ON u.id = r.referred_id
          LEFT JOIN discount_credits dc ON dc.referral_id = r.id AND dc.reason = 'referral_referrer'
          WHERE r.referrer_id = ?
          ORDER BY r.created_at DESC`,
    args: [user.id],
  });
  const friends = friendsRes.rows.map((row) => ({
    name: (row.name as string | null) || (row.email as string).split("@")[0],
    createdAt: row.created_at as string,
    rewarded: Boolean(row.rewarded),
    alreadyMember: Boolean(Number(row.redeemer_already_subscribed ?? 0)),
  }));

  const discountsRes = await db.execute({
    sql: `SELECT dc.id, dc.code, dc.percent, dc.reason, dc.used, dc.used_at, dc.created_at,
                 dc.referral_id, dc.refunded, dc.refunded_at, dc.refund_number, dc.refund_method,
                 r.redeemer_already_subscribed, r.referrer_already_subscribed, r.created_at AS redeemed_at,
                 r.referred_id AS redeemer_user_id
          FROM discount_credits dc
          LEFT JOIN referrals r ON r.id = dc.referral_id
          WHERE dc.user_id = ?
          ORDER BY dc.used ASC, dc.created_at DESC`,
    args: [user.id],
  });

  // Whether a given account was already an active subscriber at the
  // moment of redemption. `snapshot` is the value already recorded on the
  // referrals row for that account (see /api/referral/redeem and
  // lib/db.ts) — NULL for a referral redeemed before that column existed,
  // in which case fall back to two signals: (a) was there an approved
  // payment_claims row before the redemption timestamp (the original
  // approach), OR (b) is the account *currently* on an active
  // subscription. (b) is needed because a subscription granted by hand on
  // /admin/members never creates a payment_claims row, so (a) alone
  // silently misses exactly the accounts that hit this — someone who was
  // already an active member (comped or manually granted) before the
  // referral was redeemed.
  async function wasAlreadySubscribed(
    userId: number,
    snapshot: unknown,
    redeemedAt: string | null
  ): Promise<boolean> {
    if (snapshot !== null && snapshot !== undefined) {
      return Boolean(Number(snapshot));
    }
    if (redeemedAt) {
      const earlierClaim = await db.execute({
        sql: `SELECT 1 FROM payment_claims
              WHERE user_id = ? AND status = 'approved' AND created_at < ?
              LIMIT 1`,
        args: [userId, redeemedAt],
      });
      if (earlierClaim.rows[0]) return true;
    }
    const currentSub = await db.execute({
      sql: "SELECT subscription_active FROM users WHERE id = ?",
      args: [userId],
    });
    return Boolean(Number(currentSub.rows[0]?.subscription_active ?? 0));
  }

  // Whether this account's own referrer-reward discount code has nothing
  // left to apply itself to, because this account was already an active
  // subscriber at the moment the underlying referral was redeemed. Policy:
  // this manual-refund flow is for the REFERRER side only (reason ===
  // "referral_referrer") — a referrer is, by definition, an existing
  // user, so they're often already subscribed when a friend redeems their
  // code, and their 25%-off reward code then has nowhere to apply itself.
  // It deliberately does NOT apply to the redeemer side (reason ===
  // "referral_redeemed"): a previous version of this code wrongly
  // extended the same check there, which is not the intended behavior and
  // has been reverted.
  //
  // The refund is only granted when the referral was genuine: on top of
  // the referrer already having paid, the redeemer must have been an
  // actual new customer — NOT already subscribed themselves — at the
  // moment of redemption. Without that second condition, two
  // already-subscribed accounts could redeem each other's codes and pull
  // real cash out via the refund flow with zero new subscribers gained.
  // Guarded on !used so a code that legitimately got applied later (e.g.
  // after the subscription lapsed) still shows as "Used", not stuck
  // asking for a refund number forever.
  const discounts = await Promise.all(
    discountsRes.rows.map(async (row) => {
      const reason = row.reason as string;
      const used = Boolean(row.used);
      let alreadyPaidBeforeRedeeming = false;

      // Referrer side only — see comment above.
      if (!used && reason === "referral_referrer") {
        const redeemedAt = (row.redeemed_at as string | null) ?? null;
        const referrerWasAlreadySubscribed = await wasAlreadySubscribed(
          Number(user.id),
          row.referrer_already_subscribed,
          redeemedAt
        );
        const redeemerUserId = row.redeemer_user_id as number | null;
        const redeemerWasAlreadyCustomer = redeemerUserId
          ? await wasAlreadySubscribed(redeemerUserId, row.redeemer_already_subscribed, redeemedAt)
          : false; // unknown redeemer (very old row) — don't block on it
        alreadyPaidBeforeRedeeming = referrerWasAlreadySubscribed && !redeemerWasAlreadyCustomer;
      }

      return {
        code: row.code as string,
        percent: row.percent as number,
        reason,
        used,
        usedAt: (row.used_at as string | null) ?? null,
        createdAt: row.created_at as string,
        alreadyPaidBeforeRedeeming,
        refunded: Boolean(row.refunded),
        refundedAt: (row.refunded_at as string | null) ?? null,
        refundNumber: (row.refund_number as string | null) ?? null,
        refundMethod: (row.refund_method as string | null) ?? null,
      };
    })
  );

  return NextResponse.json({
    code,
    hasRedeemed,
    friendsJoined: friends.length,
    friends,
    discounts,
  });
}
