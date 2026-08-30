import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import {
  getAlertById,
  getShiftById,
  markReassignmentNotified,
  reassignStudent,
  resolveAlert,
} from "@/lib/speaking-club-db";
import { sendSpeakingClubReassignmentEmail, notifyReassignmentViaN8n } from "@/lib/mailer";

// Phase 5 (plan §9 / §4.2) — resolves one open partner-absent alert.
// POST /api/admin/speaking-club/alerts/resolve
//   { alertId, action: "move_empty" | "add_third" | "dismiss", targetShiftId?, notify? }
//
// "move_empty"/"add_third" move the alert's present_username (the lonely
// student physically alone in the room — absent_username is the one who
// never showed up, there's nothing to reassign for them) into targetShiftId,
// either into an open regular seat or as the temporary 3rd person, then
// marks the alert resolved and — unless notify is explicitly false — emails
// the student their new room/passkey right away (see the comment on
// markReassignmentNotified() for why this doesn't wait for Phase 6/n8n).
// "dismiss" just closes the alert with no reassignment (false positive).
//
// Deliberately does NOT clear the student's seat on the original alert
// shift (unlike reassign-proactive's clearSeatForUsername call) — see
// PHASE5-TESTING.md for why that's safe: once this alert is marked
// resolved, the next detection pass won't touch it again even after the
// student's heartbeat there goes stale.
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const alertId = body?.alertId;
  const action = body?.action;
  const notify = body?.notify !== false; // default true

  if (!alertId || typeof alertId !== "string") {
    return NextResponse.json({ error: "alertId is required" }, { status: 400 });
  }
  if (action !== "move_empty" && action !== "add_third" && action !== "dismiss") {
    return NextResponse.json({ error: "action must be move_empty, add_third, or dismiss" }, { status: 400 });
  }

  const alert = await getAlertById(alertId);
  if (!alert) {
    return NextResponse.json({ error: "This alert is no longer available (it may have already been resolved)" }, { status: 404 });
  }

  if (action === "dismiss") {
    await resolveAlert(alertId, "dismissed");
    return NextResponse.json({ ok: true });
  }

  const targetShiftId = body?.targetShiftId;
  if (!targetShiftId || typeof targetShiftId !== "string") {
    return NextResponse.json({ error: "targetShiftId is required for move_empty/add_third" }, { status: 400 });
  }

  const targetShift = await getShiftById(targetShiftId);
  if (!targetShift) {
    return NextResponse.json({ error: "Target room+shift not found" }, { status: 404 });
  }

  const asThirdPerson = action === "add_third";

  // Guard against the seat actually being taken since the alert list was
  // last fetched (e.g. two admin tabs open, or the target filled up in the
  // meantime) — suggestReassignmentTargets() already filtered for this at
  // list time, but that snapshot can go stale between page load and click.
  if (!asThirdPerson && targetShift.username1 && targetShift.username2) {
    return NextResponse.json({ error: "No empty seat left in this room+shift, choose another target" }, { status: 409 });
  }
  if (asThirdPerson && targetShift.temp_username) {
    return NextResponse.json({ error: "This room+shift already has a 3rd person" }, { status: 409 });
  }

  const { reassignmentId } = await reassignStudent({
    studentUsername: alert.present_username,
    reason: "partner_absent",
    previousShift: { room_code: alert.room_code, shift_number: alert.shift_number },
    targetShiftId: targetShift.shift_id,
    targetRoomCode: targetShift.room_code,
    targetShiftNumber: targetShift.shift_number,
    asThirdPerson,
  });

  await resolveAlert(alertId, asThirdPerson ? "added_third_person" : "moved_empty_room");

  if (notify) {
    const notice = {
      to: alert.present_username,
      roomCode: targetShift.room_code,
      shiftNumber: targetShift.shift_number,
      passkey: targetShift.passkey,
      startTime: targetShift.start_time,
      endTime: targetShift.end_time,
      asThirdPerson,
    };
    // Phase 6 — n8n is the long-term home for this notification (plan
    // §4.4); falls back to sending it directly if N8N_REASSIGNMENT_WEBHOOK_URL
    // isn't configured, same as Phase 5 did before Phase 6 existed.
    const handedToN8n = await notifyReassignmentViaN8n(notice);
    if (!handedToN8n) {
      await sendSpeakingClubReassignmentEmail(notice);
    }
  }
  // Marked notified=true either way — true-after-sending, or true-with-no-
  // send when the admin unchecked "notify" (see markReassignmentNotified()'s
  // doc comment in lib/speaking-club-db.ts for why).
  await markReassignmentNotified(reassignmentId);

  return NextResponse.json({ ok: true, reassignmentId });
}
