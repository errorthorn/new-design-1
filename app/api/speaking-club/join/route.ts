// app/api/speaking-club/join/route.ts
//
// Phase 3 deliverable (plan §9): "Passkey entry UI... Time-window
// validation logic (§3.4) — reject expired/wrong-shift passkeys."
// Core check is validatePasskey() (Phase 1's lookup + §3.4's
// passkey-matches-room+shift AND current_time-in-window rule, unchanged
// from Phase 1/2). This route adds one more check on top: the passkey
// must belong to *this* signed-in student's own room+shift (not just be
// valid for someone's), since we have that data — a passkey typed into
// the wrong shift's field, or someone else's forwarded passkey, is
// rejected with a distinct message rather than silently let in.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { validatePasskey } from "@/lib/speaking-club-db";

const REASON_MESSAGES: Record<string, string> = {
  not_found: "That passkey is wrong — please check the passkey sent to your email again.",
  inactive_room: "This room is not active right now. Please contact support.",
  outside_window: "This session isn't running right now — this passkey only works during your shift time.",
  not_assigned: "This passkey isn't for your shift today — use the passkey sent to your own email.",
};

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  let passkey: unknown;
  try {
    const body = await request.json();
    passkey = body?.passkey;
  } catch {
    return NextResponse.json({ error: "The request is invalid." }, { status: 400 });
  }

  if (typeof passkey !== "string" || !passkey.trim()) {
    return NextResponse.json({ error: "Please enter a passkey." }, { status: 400 });
  }

  const result = await validatePasskey(passkey);
  if (!result.ok) {
    return NextResponse.json({ error: REASON_MESSAGES[result.reason] }, { status: 403 });
  }

  const { shift } = result;
  const assignedEmails = [shift.username1, shift.username2, shift.temp_username].filter(Boolean);
  if (!assignedEmails.includes(user.email)) {
    return NextResponse.json({ error: REASON_MESSAGES.not_assigned }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    shiftId: shift.shift_id, // Phase 5: the room page needs this to send presence heartbeats
    roomCode: shift.room_code,
    shiftNumber: shift.shift_number,
    endTime: shift.end_time,
  });
}
