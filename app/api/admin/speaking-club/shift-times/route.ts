import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { updateShiftTimesForAll } from "@/lib/speaking-club-db";

// Fix for a reported gap: admin had no way to set/change when each shift
// (1, 2, 3) actually runs — times were only ever set once via seed data.
// POST /api/admin/speaking-club/shift-times  { shiftNumber, startTime, endTime }
// Applies to all 50 rooms at once (see updateShiftTimesForAll's comment for why).
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const shiftNumber = body?.shiftNumber;
  const startTime = body?.startTime;
  const endTime = body?.endTime;

  if (![1, 2, 3].includes(shiftNumber)) {
    return NextResponse.json({ error: "shiftNumber must be 1, 2, or 3" }, { status: 400 });
  }
  const timePattern = /^\d{2}:\d{2}(:\d{2})?$/;
  if (typeof startTime !== "string" || !timePattern.test(startTime)) {
    return NextResponse.json({ error: "startTime must be in HH:MM format" }, { status: 400 });
  }
  if (typeof endTime !== "string" || !timePattern.test(endTime)) {
    return NextResponse.json({ error: "endTime must be in HH:MM format" }, { status: 400 });
  }

  try {
    await updateShiftTimesForAll(shiftNumber as 1 | 2 | 3, startTime, endTime);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "Failed to update shift times" }, { status: 400 });
  }
}
