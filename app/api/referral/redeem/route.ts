// app/api/referral/redeem/route.js
//
// One-time redemption of a friend's referral code. The redeemer gets
// their 25%-off discount credit right away. The referrer's own credit is
// NOT granted here — it's granted later, only once the redeemer actually
// subscribes (see grantReferrerRewardIfPending in lib/referral.ts), so a
// redemption that never turns into a real subscriber can't be farmed for
// free discount codes.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { grantDiscountCredit } from "@/lib/referral";
import { createNotification } from "@/lib/notifications";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const code = (body.code || "").trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Enter a referral code." }, { status: 400 });
  }

  const db = await getDb();

  const alreadyRedeemed = await db.execute({
    sql: "SELECT 1 FROM referrals WHERE referred_id = ?",
    args: [user.id],
  });
  if (alreadyRedeemed.rows[0]) {
    return NextResponse.json(
      { error: "You've already redeemed a referral code on this account." },
      { status: 409 }
    );
  }

  const referrerRes = await db.execute({
    sql: "SELECT id, email FROM users WHERE referral_code = ?",
    args: [code],
  });
  const referrer = referrerRes.rows[0];
  if (!referrer) {
    return NextResponse.json({ error: "That referral code doesn't exist." }, { status: 404 });
  }
  if (Number(referrer.id) === Number(user.id)) {
    return NextResponse.json({ error: "You can't refer yourself." }, { status: 400 });
  }

  // Snapshot whether this account is already subscribed *before* the
  // redemption happens — see lib/db.ts referrals.redeemer_already_subscribed
  // for why this has to be checked here (subscription_active) rather than
  // inferred later from payment_claims: a subscription granted by hand on
  // /admin/members never creates a payment_claims row, so that timestamp
  // check missed it.
  const subRes = await db.execute({
    sql: "SELECT subscription_active FROM users WHERE id = ?",
    args: [user.id],
  });
  const alreadySubscribed = Boolean(Number(subRes.rows[0]?.subscription_active ?? 0));

  // Same snapshot for the referrer — they're an existing user, so they're
  // frequently already subscribed themselves at the moment their code gets
  // redeemed. If so, their reward code has nowhere to apply itself either
  // (see lib/db.ts referrals.referrer_already_subscribed), and needs the
  // same manual-refund flow as the redeemer's.
  const referrerSubRes = await db.execute({
    sql: "SELECT subscription_active FROM users WHERE id = ?",
    args: [referrer.id],
  });
  const referrerAlreadySubscribed = Boolean(Number(referrerSubRes.rows[0]?.subscription_active ?? 0));

  let referralId: number;
  try {
    const insertRes = await db.execute({
      sql: "INSERT INTO referrals (referrer_id, referred_id, redeemer_already_subscribed, referrer_already_subscribed) VALUES (?, ?, ?, ?)",
      args: [referrer.id, user.id, alreadySubscribed ? 1 : 0, referrerAlreadySubscribed ? 1 : 0],
    });
    referralId = Number(insertRes.lastInsertRowid);
  } catch {
    // UNIQUE(referred_id) race — someone else's request beat this one.
    return NextResponse.json(
      { error: "You've already redeemed a referral code on this account." },
      { status: 409 }
    );
  }

  // The redeemer's own code is granted right away — it only ever pays off
  // if THEY go on to pay, so there's no farming risk on this side.
  //
  // The referrer's code is deliberately NOT granted here. Handing it out
  // the moment a code is redeemed — before the redeemer has paid anything
  // — would let a referrer farm free 25%-off codes with throwaway
  // accounts that never subscribe. Instead it's granted later, only once
  // this account actually goes active (subscription_active = 1), by
  // grantReferrerRewardIfPending() — called from wherever that flag gets
  // set: /api/admin/payments (approved claim) and /api/admin/members
  // (manual grant). See lib/referral.ts for the full reasoning.
  const redeemerDiscountCode = await grantDiscountCredit(Number(user.id), "referral_redeemed", referralId);

  if (referrer.email) {
    await createNotification({
      userEmail: String(referrer.email),
      type: "referral_reward",
      title: "Someone joined using your referral code! 🎉",
      body: "You'll get your 25%-off discount code once they subscribe.",
      link: "/dashboard/refer",
    });
  }

  return NextResponse.json({ ok: true, discountCode: redeemerDiscountCode });
}
