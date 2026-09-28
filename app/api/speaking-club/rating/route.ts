// app/api/speaking-club/rating/route.ts
//
// POST — saves the end-of-session quick rating: { shiftId, rating: 1-5,
// wouldPairAgain?: "yes" | "maybe" | "no" }. Write-only for students; the
// data is read by admins (Monitoring tab) via lib/speaking-club-ratings.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/api-auth";
import { getShiftById } from "@/lib/speaking-club-db";
import { isPairAgain, saveSessionRating } from "@/lib/speaking-club-ratings";

export async function POST(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Rating must be a whole number from 1 to 5." }, { status: 400 });
  }
  if (body?.wouldPairAgain != null && !isPairAgain(body.wouldPairAgain)) {
    return NextResponse.json({ error: "Invalid answer." }, { status: 400 });
  }
  const shiftId = typeof body?.shiftId === "string" ? body.shiftId.trim() : "";
  if (!shiftId) {
    return NextResponse.json({ error: "Missing shift." }, { status: 400 });
  }

  try {
    // Same rule as heartbeat / words: only for a shift this account is
    // actually on. Room, shift number and partners come from the shift row
    // (server truth), never from the client.
    const shift = await getShiftById(shiftId);
    if (!shift) return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    const assigned = [shift.username1, shift.username2, shift.temp_username].filter(Boolean) as string[];
    if (!assigned.includes(user.email)) {
      return NextResponse.json({ error: "You are not assigned to this shift." }, { status: 403 });
    }

    await saveSessionRating({
      username: user.email,
      shiftId: shift.shift_id,
      roomCode: shift.room_code ?? null,
      shiftNumber: shift.shift_number ?? null,
      partnerUsernames: Array.from(new Set(assigned.filter((e) => e !== user.email))),
      rating,
      wouldPairAgain: body?.wouldPairAgain ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem saving your rating" }, { status: 500 });
  }
}
