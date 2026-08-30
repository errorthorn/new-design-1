// app/api/speaking-club/turn-stats/route.ts
//
// Phase 7 deliverable (plan §7, §9 Phase 7): "log TURN usage via
// getStats() for the first 1-2 weeks [after launch]". This is the
// receiving end — hooks/use-speaking-room-call.ts calls getStats() on
// each RTCPeerConnection when a call ends and POSTs the summary here,
// mirroring the presence heartbeat route's pattern (best-effort,
// requireUser, only accepted for a shift the caller is actually
// assigned to).
//
// Deliberately the SAME "only report for a real shiftId" rule as
// presence/heartbeat/route.ts — the Phase 2 dev test-identity path
// (?as=...) has no real shiftId and never runs in production, so it
// simply never reports usage, which is correct (nothing to log).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getShiftById, recordTurnUsage } from "@/lib/speaking-club-db";

const MAX_REASONABLE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB per single call-end report — a sane upper bound so a client bug can't poison the Monitoring tab's totals
const MAX_REASONABLE_DURATION_SECONDS = 6 * 60 * 60; // 6 hours

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const shiftId = body?.shiftId;
  if (typeof shiftId !== "string" || !shiftId.trim()) {
    return NextResponse.json({ error: "shiftId is required" }, { status: 400 });
  }

  const shift = await getShiftById(shiftId);
  if (!shift) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  const assignedEmails = [shift.username1, shift.username2, shift.temp_username].filter(Boolean);
  if (!assignedEmails.includes(user.email)) {
    // Same "silent, non-fatal" shape as the heartbeat route — this is a
    // background report the room UI doesn't surface to the student either way.
    return NextResponse.json({ ok: false, reason: "not_assigned" }, { status: 403 });
  }

  const usedRelay = Boolean(body?.usedRelay);
  const relayBytesSent = clampBytes(body?.relayBytesSent);
  const relayBytesReceived = clampBytes(body?.relayBytesReceived);
  const callDurationSeconds = clampDuration(body?.callDurationSeconds);
  const peerCount = Number.isFinite(body?.peerCount) ? Math.min(3, Math.max(1, Math.round(body.peerCount))) : 2;

  try {
    await recordTurnUsage({
      shiftId: shift.shift_id,
      roomCode: shift.room_code,
      shiftNumber: shift.shift_number,
      username: user.email,
      usedRelay,
      relayBytesSent,
      relayBytesReceived,
      callDurationSeconds,
      peerCount,
    });
  } catch (err) {
    // Same graceful-degrade posture as every other best-effort write in
    // this feature — a failed usage log must never surface as an error to
    // a student who just finished (or is mid-) a call.
    console.error("[speaking-club/turn-stats] failed to record", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }

  return NextResponse.json({ ok: true });
}

function clampBytes(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_REASONABLE_BYTES);
}

function clampDuration(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_REASONABLE_DURATION_SECONDS);
}
