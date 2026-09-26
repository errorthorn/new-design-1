// lib/referral.ts
//
// Shared helpers for the Refer & Earn feature (/dashboard/refer). Two kinds
// of codes exist and they must never be confused with each other:
//
//  - referral_code: one per account, permanent, shared with friends
//    (users.referral_code). Someone else redeems THIS to link the two
//    accounts in the `referrals` table.
//  - discount codes: short-lived reward codes in `discount_credits`,
//    earned by either side of a referral, each good for one 25%-off
//    payment (see app/api/payment/submit/route.ts).
import { getDb } from "@/lib/db";
import { createNotification } from "@/lib/notifications";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — easy to read aloud
const REFERRAL_REWARD_PERCENT = 25;

function randomCode(length: number) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

/**
 * Returns this user's referral code, generating and saving one on first
 * use if they don't have one yet. Retries on the rare collision (the
 * partial unique index on users.referral_code is the real guarantee).
 */
export async function ensureReferralCode(userId: number, existingCode: string | null): Promise<string> {
  if (existingCode) return existingCode;

  const db = await getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode(7);
    try {
      await db.execute({
        sql: "UPDATE users SET referral_code = ? WHERE id = ? AND referral_code IS NULL",
        args: [code, userId],
      });
      const check = await db.execute({
        sql: "SELECT referral_code FROM users WHERE id = ?",
        args: [userId],
      });
      const saved = check.rows[0]?.referral_code as string | undefined;
      if (saved) return saved;
    } catch {
      // Collided with another account's code — loop and try a new one.
    }
  }
  throw new Error("Could not generate a referral code, please try again.");
}

/** Creates one new unused 25%-off discount credit for a user and returns its code. */
export async function grantDiscountCredit(
  userId: number,
  reason: "referral_referrer" | "referral_redeemed",
  referralId?: number
): Promise<string> {
  const db = await getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `LC-${randomCode(6)}`;
    try {
      await db.execute({
        sql: `INSERT INTO discount_credits (user_id, code, percent, reason, referral_id) VALUES (?, ?, ?, ?, ?)`,
        args: [userId, code, REFERRAL_REWARD_PERCENT, reason, referralId ?? null],
      });
      return code;
    } catch {
      // Extremely unlikely UNIQUE(code) collision — try again.
    }
  }
  throw new Error("Could not create a discount code, please try again.");
}

/**
 * Grants the REFERRER's 25%-off reward for a referral, but only once the
 * person they referred has an actual active subscription — not the
 * moment the code gets redeemed (see app/api/referral/redeem/route.ts,
 * which only grants the redeemer's own code up front).
 *
 * Why: redemption alone costs nothing and proves nothing — anyone can
 * create an account and redeem a code without ever paying. If the
 * referrer's code were handed out right then, a referrer could farm free
 * 25%-off codes with throwaway accounts that never subscribe, no real
 * conversion required. Gating it on `subscription_active` flipping to 1
 * means the referrer only ever gets rewarded for a friend who actually
 * became a paying member.
 *
 * That alone isn't quite enough, though: if the redeemer was ALREADY an
 * active subscriber the moment they redeemed the code, they aren't a new
 * customer either — they'd have renewed regardless, referral or not. So
 * this also skips the grant entirely when
 * referrals.redeemer_already_subscribed is set (see
 * app/api/referral/redeem/route.ts) — otherwise someone could get an
 * already-subscribed friend to redeem their code and simply collect the
 * reward whenever that friend's next normal renewal happens to fire this
 * function, with zero incremental revenue actually gained.
 *
 * Call this from every place that can set users.subscription_active = 1
 * for a user: an approved payment claim (/api/admin/payments) and a
 * manual grant (/api/admin/members). Safe to call unconditionally on
 * every such activation (including renewals) — it no-ops if this user
 * was never referred, if the redeemer was already subscribed at
 * redemption time, or if the referrer's reward for that referral was
 * already granted.
 */
export async function grantReferrerRewardIfPending(userId: number): Promise<void> {
  const db = await getDb();

  const referralRes = await db.execute({
    sql: "SELECT id, referrer_id, redeemer_already_subscribed FROM referrals WHERE referred_id = ?",
    args: [userId],
  });
  const referral = referralRes.rows[0];
  if (!referral) return; // this account was never referred by anyone

  const referralId = Number(referral.id);
  const referrerId = Number(referral.referrer_id);

  // The redeemer was already an active subscriber at the moment they
  // redeemed this code — snapshotted back in
  // app/api/referral/redeem/route.ts, not re-checked here. That means
  // whatever activation just called this function (a renewal, most
  // likely) isn't a genuinely new customer the referral brought in — this
  // account was already paying, referral or not. Rewarding the referrer
  // for it would let someone farm free 25%-off codes by having an
  // already-subscribed friend redeem their code and simply wait for that
  // friend's next normal renewal. Skip the grant entirely for this
  // referral; it's never retried since it isn't tied to `existing` below.
  if (Boolean(Number(referral.redeemer_already_subscribed ?? 0))) return;

  // Never double-grant — this runs on every activation (first payment,
  // every renewal, any manual grant), not just the first one.
  const existing = await db.execute({
    sql: "SELECT 1 FROM discount_credits WHERE referral_id = ? AND reason = 'referral_referrer'",
    args: [referralId],
  });
  if (existing.rows[0]) return;

  const referrerRes = await db.execute({
    sql: "SELECT email, subscription_active FROM users WHERE id = ?",
    args: [referrerId],
  });
  const referrerRow = referrerRes.rows[0];
  if (!referrerRow) return; // referrer account no longer exists — nothing to grant

  // Snapshot the referrer's OWN subscription status right now, at the
  // moment the reward is actually granted (not back at redemption time,
  // which can be days or weeks earlier). /admin/referrals and
  // /api/referral read this to flag "referrer had nothing to apply this
  // to, needs a manual bKash/Nagad refund instead" (see
  // app/api/referral/route.ts).
  const referrerAlreadySubscribed = Boolean(Number(referrerRow.subscription_active ?? 0));
  await db.execute({
    sql: "UPDATE referrals SET referrer_already_subscribed = ? WHERE id = ?",
    args: [referrerAlreadySubscribed ? 1 : 0, referralId],
  });

  const referrerDiscountCode = await grantDiscountCredit(referrerId, "referral_referrer", referralId);

  const referrerEmail = referrerRow.email as string | null;
  if (referrerEmail) {
    await createNotification({
      userEmail: referrerEmail,
      type: "referral_reward",
      title: "Someone used your referral code! 🎁",
      body: `You've earned a 25%-off discount code: ${referrerDiscountCode}`,
      link: "/dashboard/refer",
    });
  }
}

export { REFERRAL_REWARD_PERCENT };
