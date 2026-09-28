// app/api/referral/validate-code/route.ts
//
// /payment used to show "25% off applied" the moment the discount-code box
// had ANY text in it — including someone's own referral_code (which looks
// similar but isn't a discount code at all; see lib/referral.ts for the
// difference) or plain typos. The real check only ever happened on submit,
// so the preview was lying. This is that real check, exposed so the page
// can call it live (debounced) as the person types and only claim the
// discount is "applied" once it's actually confirmed.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";

export async function GET(req: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("code") || "").trim().toUpperCase();
  if (!raw) {
    return NextResponse.json({ valid: false, error: "Enter a code." });
  }

  const db = await getDb();

  // Referral codes (shared to bring a friend in) and discount codes
  // (redeemable for 25% off) look similar but are never the same value —
  // discount codes always come back "LC-XXXXXX" from lib/referral.ts.
  // Catching the mix-up here means a person mistakenly pasting their own
  // referral code gets a specific, useful answer instead of a generic
  // "not found".
  if (!raw.startsWith("LC-")) {
    const referralRes = await db.execute({
      sql: "SELECT 1 FROM users WHERE referral_code = ?",
      args: [raw],
    });
    if (referralRes.rows[0]) {
      return NextResponse.json({
        valid: false,
        error:
          "That's a referral code, not a discount code — ask your friend to redeem it on their own Refer & Earn page first.",
      });
    }
  }

  const creditRes = await db.execute({
    sql: "SELECT percent, used FROM discount_credits WHERE code = ? AND user_id = ?",
    args: [raw, user.id],
  });
  const credit = creditRes.rows[0];

  if (!credit) {
    return NextResponse.json({ valid: false, error: "That discount code wasn't found on your account." });
  }
  if (credit.used) {
    return NextResponse.json({ valid: false, error: "That discount code has already been used." });
  }

  return NextResponse.json({ valid: true, percent: Number(credit.percent) });
}
