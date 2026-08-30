import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { setRoomStatus } from "@/lib/speaking-club-db";

// Fix for plan §9 Phase 4's known gap: "no room-inactive toggle in the UI".
// POST /api/admin/speaking-club/room-status  { roomCode, status }
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const roomCode = body?.roomCode;
  const status = body?.status;

  if (!roomCode || typeof roomCode !== "string") {
    return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
  }
  if (status !== "active" && status !== "inactive") {
    return NextResponse.json({ error: "status must be 'active' or 'inactive'" }, { status: 400 });
  }

  await setRoomStatus(roomCode, status);
  return NextResponse.json({ ok: true });
}
