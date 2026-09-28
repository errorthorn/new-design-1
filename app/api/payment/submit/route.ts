import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { sendPaymentClaimEmail } from "@/lib/mailer";
import { getPlan } from "@/lib/plans";

const VALID_METHODS = new Set(["bkash", "nagad"]);
// Bangladeshi mobile numbers: 11 digits, starting 01.
const PHONE_RE = /^01[0-9]{9}$/;

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.user) return auth.response!;
  const { user } = auth;

  const {
    plan: planSlug,
    method,
    senderNumber,
    trxId,
    discountCode,
  }: {
    plan?: string;
    method?: string;
    senderNumber?: string;
    trxId?: string;
    discountCode?: string;
  } = await req.json();

  // The price shown/charged always comes from the shared plan config, not
  // anything the client sends — getPlan() falls back to Pro for a
  // missing/unknown/unpurchasable slug, so this can't be spoofed to a
  // cheaper plan.
  const plan = getPlan(planSlug);
  const PLAN_AMOUNT = plan.price;

  if (!method || !VALID_METHODS.has(method)) {
    return NextResponse.json({ error: "Choose bKash or Nagad." }, { status: 400 });
  }
  if (!senderNumber || !PHONE_RE.test(senderNumber.trim())) {
    return NextResponse.json(
      { error: "Enter the valid 11-digit number you sent money from." },
      { status: 400 }
    );
  }
  if (!trxId || trxId.trim().length < 4) {
    return NextResponse.json({ error: "Enter the Transaction ID (TrxID) from your SMS." }, { status: 400 });
  }

  const db = await getDb();

  // A Refer & Earn discount code (see /dashboard/refer) is optional — if
  // present it must belong to this account and not have been used
  // already. Marking it used happens here (on submit, not on admin
  // approval) since the discounted amount the person is claiming to have
  // sent needs to match what they actually sent; if this specific claim
  // later gets rejected, /api/admin/payments un-marks it so it isn't lost.
  let amount = PLAN_AMOUNT;
  let appliedCode: string | null = null;
  let appliedPercent: number | null = null;

  if (discountCode && discountCode.trim()) {
    const code = discountCode.trim().toUpperCase();

    // A referral_code (shared to bring a friend in) is not the same thing
    // as a discount code (redeemable for 25% off, always "LC-XXXXXX") —
    // see lib/referral.ts. This used to be silently rejected as a generic
    // "not found" here while the payment page's preview claimed a 25%
    // discount was already "applied" for any non-empty text — the actual
    // live check now lives in /api/referral/validate-code and the page
    // calls it as the person types, but this stays as the final,
    // authoritative check in case that client-side check was bypassed.
    if (!code.startsWith("LC-")) {
      const referralRes = await db.execute({
        sql: "SELECT 1 FROM users WHERE referral_code = ?",
        args: [code],
      });
      if (referralRes.rows[0]) {
        return NextResponse.json(
          {
            error:
              "That's a referral code, not a discount code — ask your friend to redeem it on their own Refer & Earn page first.",
          },
          { status: 400 }
        );
      }
    }

    const creditRes = await db.execute({
      sql: "SELECT id, percent, used FROM discount_credits WHERE code = ? AND user_id = ?",
      args: [code, user.id],
    });
    const credit = creditRes.rows[0];
    if (!credit) {
      return NextResponse.json({ error: "That discount code wasn't found on your account." }, { status: 404 });
    }
    if (credit.used) {
      return NextResponse.json({ error: "That discount code has already been used." }, { status: 409 });
    }
    appliedPercent = Number(credit.percent);
    appliedCode = code;
    amount = Math.round(PLAN_AMOUNT * (1 - appliedPercent / 100));

    await db.execute({
      sql: "UPDATE discount_credits SET used = 1, used_at = datetime('now') WHERE id = ?",
      args: [credit.id],
    });
  }

  await db.execute({
    sql: `INSERT INTO payment_claims (user_id, email, plan, method, sender_number, trx_id, amount, status, discount_code, discount_percent)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    args: [
      user.id,
      user.email,
      plan.slug,
      method,
      senderNumber.trim(),
      trxId.trim().toUpperCase(),
      amount,
      appliedCode,
      appliedPercent,
    ],
  });

  // Best-effort notification — a failed email shouldn't fail the claim,
  // since the row is already saved and visible via the admin flow either way.
  try {
    await sendPaymentClaimEmail({
      email: user.email,
      plan: plan.name,
      method,
      senderNumber: senderNumber.trim(),
      trxId: trxId.trim().toUpperCase(),
      amount,
    });
  } catch (err) {
    console.error("[payment/submit] failed to send admin notification email:", err);
  }

  return NextResponse.json({ ok: true, amount });
}