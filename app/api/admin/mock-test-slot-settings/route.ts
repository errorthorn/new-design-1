import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getSlotSettings, updateSlotSettings, type SlotSettings } from "@/lib/mock-test-slots";

// The admin page (app/admin/mock-test/page.tsx) reads snake_case field
// names, matching the raw DB columns — getSlotSettings()/updateSlotSettings()
// use camelCase internally (that's the convention the rest of
// lib/mock-test-slots.ts uses). Convert at this API boundary so the two
// sides actually agree; returning the camelCase shape directly here was a
// real bug — the admin form would receive `undefined` for every field
// (capacity_per_slot etc. simply didn't exist on the response object) and
// render every input blank, which is exactly what was happening.
function toSnakeCase(s: SlotSettings) {
  return {
    capacity_per_slot: s.capacityPerSlot,
    slot_minutes: s.slotMinutes,
    window_start_hour: s.windowStartHour,
    window_duration_hours: s.windowDurationHours,
    expected_student_count: s.expectedStudentCount,
    booking_opens_on: s.bookingOpensOn,
    timezone: s.timezone,
  };
}

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const settings = await getSlotSettings();
  return NextResponse.json({ settings: toSnakeCase(settings) });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const capacityPerSlot = Number(body.capacityPerSlot);
  const slotMinutes = Number(body.slotMinutes);
  const windowStartHour = Number(body.windowStartHour);
  const windowDurationHours = Number(body.windowDurationHours);
  const expectedStudentCount = Number(body.expectedStudentCount);
  const bookingOpensOn: string | null =
    typeof body.bookingOpensOn === "string" && body.bookingOpensOn.trim() ? body.bookingOpensOn.trim() : null;

  const valid =
    Number.isInteger(capacityPerSlot) &&
    capacityPerSlot >= 1 &&
    capacityPerSlot <= 200 &&
    Number.isInteger(slotMinutes) &&
    slotMinutes >= 5 &&
    slotMinutes <= 120 &&
    Number.isInteger(windowStartHour) &&
    windowStartHour >= 0 &&
    windowStartHour <= 23 &&
    Number.isInteger(windowDurationHours) &&
    windowDurationHours >= 1 &&
    windowDurationHours <= 24 &&
    Number.isInteger(expectedStudentCount) &&
    expectedStudentCount >= 1 &&
    expectedStudentCount <= 100000 &&
    (bookingOpensOn === null || /^\d{4}-\d{2}-\d{2}$/.test(bookingOpensOn));

  if (!valid) {
    return NextResponse.json(
      {
        error:
          "Please enter valid numbers (capacity 1-200, slot 5-120 min, start hour 0-23, duration 1-24 hrs, expected students 1-100000).",
      },
      { status: 400 }
    );
  }

  try {
    await updateSlotSettings({
      capacityPerSlot,
      slotMinutes,
      windowStartHour,
      windowDurationHours,
      expectedStudentCount,
      bookingOpensOn,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not save settings." }, { status: 500 });
  }

  const settings = await getSlotSettings();
  return NextResponse.json({ ok: true, settings: toSnakeCase(settings) });
}
