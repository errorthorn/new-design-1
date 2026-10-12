// app/api/speaking-club/presence/heartbeat/route.ts
//
// Phase 5 deliverable (plan §4.1): "A scheduled backend check... monitors
// all active rooms for the current shift" — that check needs to know who
// is ACTUALLY present, not just who's assigned. This route is how the
// student's browser reports that in: hooks/use-speaking-room-call.ts
// calls this every ~45s while the call is connected. Written to
// speaking_room_presence (sql/schema.sql, Phase 5 section), which
// detectAndFlagPartnerAbsences() (lib/speaking-club-db.ts) reads.
//
// Authorization mirrors join/route.ts's "not_assigned" check — a student
// can only heartbeat a shift they're actually assigned to (regular seat
// or temp 3rd person), not an arbitrary shiftId.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getShiftById, recordPresenceHeartbeat } from "@/lib/speaking-club-db";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  let shiftId: unknown;
  try {
    const body = await request.json();
    shiftId = body?.shiftId;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (typeof shiftId !== "string" || !shiftId.trim()) {
    return NextResponse.json({ error: "shiftId is required" }, { status: 400 });
  }

  const shift = await getShiftById(shiftId);
  if (!shift) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  const assignedEmails = [shift.username1, shift.username2, shift.temp_username].filter(Boolean);
  if (!assignedEmails.includes(user.email)) {
    // Not an error the student needs to see (the room page fires this
    // silently in the background) — just don't record a heartbeat for a
    // shift this account isn't actually on.
    return NextResponse.json({ ok: false, reason: "not_assigned" }, { status: 403 });
  }

  await recordPresenceHeartbeat(shiftId, user.email);
  return NextResponse.json({ ok: true });
}
