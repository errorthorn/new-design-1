import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { assignStudents } from "@/lib/speaking-club-db";

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

// Phase 4 (plan §9) — "Room + shift assignment UI (§5.1)": sets/replaces
// the two regular participants (username1/username2) on one room+shift row.
// POST /api/admin/speaking-club/assign  { shiftId, username1?, username2? }
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const shiftId = body?.shiftId;
  if (!shiftId || typeof shiftId !== "string") {
    return NextResponse.json({ error: "shiftId is required" }, { status: 400 });
  }

  const username1 = normalizeEmail(body.username1);
  const username2 = normalizeEmail(body.username2);

  if (username1 && username2 && username1 === username2) {
    return NextResponse.json({ error: "The same student cannot be placed in the same room twice." }, { status: 400 });
  }

  await assignStudents(shiftId, username1, username2);
  return NextResponse.json({ ok: true });
}
