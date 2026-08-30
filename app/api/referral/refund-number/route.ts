// app/api/referral/refund-number/route.ts
//
// A referral reward code is worthless if the person it belongs to had
// already paid — approved, or granted by hand — before the referral was
// redeemed (see /api/admin/referrals for the detection logic). This
// applies on EITHER side of a referral: the redeemer (joined already
// subscribed) or the referrer (an existing user who was often already
// subscribed themselves). The fix is a manual bKash/Nagad refund, but the
// number they paid *from* isn't necessarily their own — plenty of people
// pay from a shop/kiosk bKash — so we can't just look that up. This lets
// the person tell us where to send it, which then shows up on
// /admin/referrals for whoever's processing refunds.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";

const VALID_METHODS = new Set(["bkash", "nagad"]);
const PHONE_RE = /^01[0-9]{9}$/;
// Referrer side only — see app/api/admin/referrals/route.ts. The manual
// refund flow never applies to a redeemer's code, so a redeemer should
// never be able to attach a refund number to one either.
const VALID_REASONS = new Set(["referral_referrer"]);

export async function POST(req: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const {
    code,
    method,
    number,
  }: { code?: string; method?: string; number?: string } = await req.json();

  if (!method || !VALID_METHODS.has(method)) {
    return NextResponse.json({ error: "Choose bKash or Nagad." }, { status: 400 });
  }
  if (!number || !PHONE_RE.test(number.trim())) {
    return NextResponse.json({ error: "Enter a valid 11-digit bKash/Nagad number." }, { status: 400 });
  }
  if (!code || !code.trim()) {
    return NextResponse.json({ error: "Missing discount code." }, { status: 400 });
  }

  const db = await getDb();

  // Must be this account's own referral-reward code (either side) — never
  // let someone set a refund destination on a code that isn't theirs.
  const creditRes = await db.execute({
    sql: "SELECT id, user_id, reason FROM discount_credits WHERE code = ?",
    args: [code.trim().toUpperCase()],
  });
  const credit = creditRes.rows[0];
  if (!credit || Number(credit.user_id) !== Number(user.id) || !VALID_REASONS.has(credit.reason as string)) {
    return NextResponse.json({ error: "That discount code wasn't found on your account." }, { status: 404 });
  }

  await db.execute({
    sql: "UPDATE discount_credits SET refund_number = ?, refund_method = ? WHERE id = ?",
    args: [number.trim(), method, credit.id],
  });

  return NextResponse.json({ ok: true });
}
