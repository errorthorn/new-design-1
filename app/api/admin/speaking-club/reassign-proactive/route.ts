import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  clearSeatForUsername,
  findShiftsByUsername,
  getShiftById,
  markReassignmentNotified,
  reassignStudent,
  type SpeakingShiftLookup,
} from "@/lib/speaking-club-db";
import { sendSpeakingClubReassignmentEmail, notifyReassignmentViaN8n } from "@/lib/mailer";

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

// Phase 5 (plan §9 / §4.5) — "Reassign student to different shift/room"
// for a student who reports a conflict in advance, before any absence
// actually happens. Distinct from alerts/resolve: there's no alert row
// here, the admin just picks a student + a target room+shift directly.
// POST /api/admin/speaking-club/reassign-proactive
//   { studentUsername, targetShiftId, asThirdPerson?, notify? }
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const studentUsername = normalizeEmail(body?.studentUsername);
  const targetShiftId = body?.targetShiftId;
  const asThirdPerson = Boolean(body?.asThirdPerson);
  const notify = body?.notify !== false; // default true

  if (!studentUsername) {
    return NextResponse.json({ error: "studentUsername is required" }, { status: 400 });
  }
  if (!targetShiftId || typeof targetShiftId !== "string") {
    return NextResponse.json({ error: "targetShiftId is required" }, { status: 400 });
  }

  const targetShift = await getShiftById(targetShiftId);
  if (!targetShift) {
    return NextResponse.json({ error: "Target room+shift not found" }, { status: 404 });
  }

  if (!asThirdPerson && targetShift.username1 && targetShift.username2) {
    return NextResponse.json({ error: "No empty seat left in this room+shift — try adding as a 3rd person" }, { status: 409 });
  }
  if (asThirdPerson && targetShift.temp_username) {
    return NextResponse.json({ error: "This room+shift already has a 3rd person" }, { status: 409 });
  }
  if (
    !asThirdPerson &&
    ((targetShift.username1 === studentUsername) || (targetShift.username2 === studentUsername))
  ) {
    return NextResponse.json({ error: "This student is already in this room+shift" }, { status: 400 });
  }

  // If this student already sits on another shift with the SAME
  // shift_number (the recurring slot they're trying to move away from),
  // vacate that seat so they aren't double-booked into two rooms for the
  // same daily time window. A student with a conflict on a *different*
  // shift_number's slot is left untouched — this route only ever adds
  // them to targetShiftId, it doesn't guess which other slot to clear.
  const existingShifts = await findShiftsByUsername(studentUsername);
  const oldShift = existingShifts.find(
    (s) => s.shift_number === targetShift.shift_number && s.shift_id !== targetShift.shift_id
  );

  let previousShift: Pick<SpeakingShiftLookup, "room_code" | "shift_number"> | null = null;
  if (oldShift) {
    await clearSeatForUsername(oldShift.shift_id, studentUsername);
    previousShift = { room_code: oldShift.room_code, shift_number: oldShift.shift_number };
  }

  const { reassignmentId } = await reassignStudent({
    studentUsername,
    reason: "proactive_conflict",
    previousShift,
    targetShiftId: targetShift.shift_id,
    targetRoomCode: targetShift.room_code,
    targetShiftNumber: targetShift.shift_number,
    asThirdPerson,
  });

  if (notify) {
    const notice = {
      to: studentUsername,
      roomCode: targetShift.room_code,
      shiftNumber: targetShift.shift_number,
      passkey: targetShift.passkey,
      startTime: targetShift.start_time,
      endTime: targetShift.end_time,
      asThirdPerson,
    };
    const handedToN8n = await notifyReassignmentViaN8n(notice);
    if (!handedToN8n) {
      await sendSpeakingClubReassignmentEmail(notice);
    }
  }
  await markReassignmentNotified(reassignmentId);

  return NextResponse.json({ ok: true, reassignmentId });
}
