// app/api/speaking-club/room-access/route.ts
//
// Server-side gate for the call room page. GET ?code=room-07
//
// Allows entry only if the signed-in user is assigned (username1 / username2 /
// temp_username) to THIS room's shift AND that shift is running right now
// (Asia/Dhaka) — the same rules as the passkey step, enforced again here so
// typing /speaking-club/room/room-12 into the address bar no longer works.
//
// On success it also returns `channelKey`: an unguessable per-room, per-day
// token (HMAC of room + shift + date, signed with a server secret). The room
// page uses it as the Realtime channel name instead of the plain room code, so
// even someone who bypasses the page can't guess which channel to listen on —
// channel names are no longer just "room-01" … "room-50".
import { createHmac } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { findShiftsByUsername, shiftTimeState, currentDhakaTime } from "@/lib/speaking-club-db";

function channelKeyFor(roomCode: string, shiftId: string): string {
  const secret = process.env.JWT_SECRET || (process.env.NODE_ENV !== "production" ? "dev-only-secret" : "");
  if (!secret) throw new Error("JWT_SECRET is not set");
  // Rotates every day (Asia/Dhaka date) so an old key stops working.
  const dhakaDate = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return createHmac("sha256", secret).update(`room-channel:${roomCode}:${shiftId}:${dhakaDate}`).digest("hex").slice(0, 32);
}

export async function GET(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "Room code is required." }, { status: 400 });

  const shifts = await findShiftsByUsername(user.email);
  const now = currentDhakaTime();
  const shift = shifts.find(
    (s) => s.room_code === code && s.room_status === "active" && shiftTimeState(s, now) === "now"
  );

  if (!shift) {
    return NextResponse.json(
      { error: "You're not assigned to this room right now." },
      { status: 403 }
    );
  }

  return NextResponse.json({
    ok: true,
    shiftId: shift.shift_id,
    channelKey: channelKeyFor(shift.room_code, shift.shift_id),
  });
}
