import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";
import { computeEligibility, getWeekProgram } from "@/lib/mock-test";
import { getActiveBooking, bookChosenSlot } from "@/lib/mock-test-slots";

// GET — read-only status check: is this student eligible, and do they
// already have a slot booked? Never books anything itself (that's what the
// picker UI + POST below is for) — so simply loading the mock-test page
// never has the side effect of reserving a seat on the student's behalf.
export async function GET() {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const { data: student } = await supabaseServer
    .from("students")
    .select("id")
    .eq("user_email", user.email)
    .maybeSingle();

  if (!student) {
    return NextResponse.json(
      { error: "No student profile yet — please check in first." },
      { status: 404 }
    );
  }

  const { eligible, nextEligibleAt } = await computeEligibility(student.id, await getWeekProgram(user));
  if (!eligible) {
    return NextResponse.json({ eligible: false, nextEligibleAt });
  }

  const slot = await getActiveBooking(student.id);
  return NextResponse.json({ eligible: true, slot });
}

// POST { slotStart } — the student's actual pick. Delegates the real
// validation and race-safe capacity check to book_specific_mock_test_slot
// (see lib/mock-test-slots.ts / sql/schema.sql) — this route is just auth +
// eligibility + wiring.
export async function POST(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const body = await req.json().catch(() => null);
  const slotStart = body?.slotStart;
  if (typeof slotStart !== "string" || Number.isNaN(new Date(slotStart).getTime())) {
    return NextResponse.json({ error: "Please pick a valid time." }, { status: 400 });
  }

  const { data: student } = await supabaseServer
    .from("students")
    .select("id")
    .eq("user_email", user.email)
    .maybeSingle();

  if (!student) {
    return NextResponse.json(
      { error: "No student profile yet — please check in first." },
      { status: 404 }
    );
  }

  const { eligible, nextEligibleAt } = await computeEligibility(student.id, await getWeekProgram(user));
  if (!eligible) {
    return NextResponse.json({ eligible: false, nextEligibleAt });
  }

  try {
    const slot = await bookChosenSlot(student.id, slotStart);
    return NextResponse.json({ eligible: true, slot });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Could not book that slot. Please try again." },
      { status: 409 }
    );
  }
}
