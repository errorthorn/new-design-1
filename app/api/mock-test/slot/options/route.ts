import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";
import { computeEligibility, getWeekProgram } from "@/lib/mock-test";
import { getSlotOptions, getSlotSettings } from "@/lib/mock-test-slots";

// Lists the next few days' slots with how many seats are already taken, for
// the student-facing time picker. Read-only — picking one is a separate
// POST to /api/mock-test/slot.
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

  const [options, settings] = await Promise.all([getSlotOptions(8, student.id), getSlotSettings()]);
  return NextResponse.json({ eligible: true, options, bookingOpensOn: settings.bookingOpensOn });
}
