import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";
import { computeEligibility, getWeekProgram } from "@/lib/mock-test";

// Looks the signed-in user up by email. If they already have a students row
// (i.e. they've checked in at least once before), returns everything the
// check-in page needs — name, phone, eligibility — so a RETURNING student
// never has to re-type their name/phone. First-timers get hasProfile:false
// and still see the one-time form (POST below), which is what actually
// creates the row — phone stays a required, unique column in Supabase, so
// this avoids a schema change while still cutting the friction to zero
// after the first visit.
export async function GET() {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const { data: student } = await supabaseServer
    .from("students")
    .select("id, name, phone")
    .eq("user_email", user.email)
    .maybeSingle();

  if (!student) {
    return NextResponse.json({ hasProfile: false });
  }

  const { eligible, nextEligibleAt } = await computeEligibility(student.id, await getWeekProgram(user));

  return NextResponse.json({
    hasProfile: true,
    studentId: student.id,
    name: student.name,
    phone: student.phone,
    eligible,
    nextEligibleAt,
  });
}

export async function POST(req: NextRequest) {
  // The mock test is a member benefit — require a real LingoCraft account
  // (checked server-side, not just trusted from the request body) before
  // touching the Supabase student/attempt tables at all.
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const body = await req.json();
  const phone = body.phone;
  const name = user.name || body.name || "Student";
  const email = user.email;

  if (!phone) {
    return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
  }

  // Prefer looking the student up by the account's email (so the same
  // person is recognized even if they type their phone number slightly
  // differently); fall back to phone for people who somehow have no email.
  let student = null as { id: string; name: string } | null;

  if (email) {
    const { data } = await supabaseServer
      .from("students")
      .select("id, name")
      .eq("user_email", email)
      .maybeSingle();
    student = data;
  }

  if (!student) {
    const { data: byPhone } = await supabaseServer
      .from("students")
      .select("id, name, user_email")
      .eq("phone", phone)
      .maybeSingle();

    // The phone number is already linked to a DIFFERENT account — don't
    // silently reassign that row to this account, which would hijack the
    // other account's test history (and lock the original owner out of
    // their own records). Ask the person to double-check the number.
    if (byPhone && byPhone.user_email && byPhone.user_email !== email) {
      return NextResponse.json(
        {
          error:
            "This phone number is linked to another account. Please double-check the number, or contact us for help.",
        },
        { status: 409 }
      );
    }

    student = byPhone ? { id: byPhone.id, name: byPhone.name } : null;
  }

  if (!student) {
    const { data: created, error: createError } = await supabaseServer
      .from("students")
      .insert({ name, phone, user_email: email })
      .select("id, name")
      .single();

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
    student = created;
  } else {
    // Keep the row's phone/email/name in sync with the account.
    await supabaseServer
      .from("students")
      .update({ phone, user_email: email, name })
      .eq("id", student.id);
  }

  const { eligible, nextEligibleAt } = await computeEligibility(student.id, await getWeekProgram(user));

  return NextResponse.json({
    studentId: student.id,
    name: student.name,
    eligible,
    nextEligibleAt,
  });
}
