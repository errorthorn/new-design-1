// app/api/speaking-club/my-status/route.ts
//
// Phase 3 deliverable (plan §9): "Dashboard showing 'your current room'
// once validated" — this is the data behind the real (non-mock)
// /speaking-club dashboard. Returns the signed-in student's assigned
// shifts for today (for the "waiting" schedule list) plus, if one is
// active right now, enough info to show the passkey-entry step (partner
// name, shift window) without leaking the passkey itself — the passkey
// only ever comes from n8n's email (plan §6), never from this API.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { findShiftsByUsername, shiftTimeState, currentDhakaTime } from "@/lib/speaking-club-db";
import { getDisplayNamesByEmails } from "@/lib/speaking-club-users";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const shifts = await findShiftsByUsername(user.email);
  const now = currentDhakaTime();

  // Partner display names for every shift at once, one Turso round-trip
  // instead of one per shift.
  const partnerEmails = shifts.flatMap((s) =>
    [s.username1, s.username2, s.temp_username].filter((e): e is string => !!e && e !== user.email)
  );
  const names = await getDisplayNamesByEmails(partnerEmails);

  const shiftSummaries = shifts
    .map((s) => {
      const partnerEmail = [s.username1, s.username2, s.temp_username].find(
        (e): e is string => !!e && e !== user.email
      );
      return {
        shiftId: s.shift_id,
        shiftNumber: s.shift_number,
        roomCode: s.room_code,
        startTime: s.start_time,
        endTime: s.end_time,
        state: shiftTimeState(s, now),
        partnerName: partnerEmail ? names[partnerEmail] ?? partnerEmail : null,
        isThirdPerson: s.temp_username === user.email,
      };
    })
    .sort((a, b) => a.shiftNumber - b.shiftNumber);

  const active = shiftSummaries.find((s) => s.state === "now") ?? null;

  return NextResponse.json({ shifts: shiftSummaries, activeShift: active });
}
