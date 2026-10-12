import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { assignStudents, listAllShifts } from "@/lib/speaking-club-db";

type BulkRow = {
  room_code?: string;
  shift_number?: number | string;
  username1?: string;
  username2?: string;
};

type RowResult = {
  room_code: string;
  shift_number: number | string;
  ok: boolean;
  error?: string;
};

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

// Phase 4 (plan §9) — "Bulk assignment / CSV upload or auto-pair button
// (§5.2)": assigning ~300 students across 50 rooms × 3 shifts one-by-one
// isn't practical. The CSV itself is parsed client-side (app/admin/
// speaking-club/page.tsx) into plain rows and previewed to the admin
// before it ever reaches this route — this route just validates each row
// against the real schema and applies it, returning a per-row result so
// the admin panel can show exactly which rows succeeded/failed instead of
// an all-or-nothing failure.
// POST /api/admin/speaking-club/bulk-assign  { rows: BulkRow[] }
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const rows: BulkRow[] = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) {
    return NextResponse.json({ error: "rows must be a non-empty array" }, { status: 400 });
  }
  if (rows.length > 200) {
    return NextResponse.json({ error: "You can upload a maximum of 200 rows at a time." }, { status: 400 });
  }

  // One lookup of the full 150-row grid, instead of a query per CSV row.
  const shifts = await listAllShifts();
  const byKey = new Map(shifts.map((s) => [`${s.room_code}::${s.shift_number}`, s]));

  const results: RowResult[] = [];

  for (const row of rows) {
    const roomCode = (row.room_code ?? "").trim().toLowerCase();
    const shiftNumber = Number(row.shift_number);

    if (!roomCode || ![1, 2, 3].includes(shiftNumber)) {
      results.push({
        room_code: row.room_code ?? "",
        shift_number: row.shift_number ?? "",
        ok: false,
        error: "room_code or shift_number is invalid",
      });
      continue;
    }

    const shift = byKey.get(`${roomCode}::${shiftNumber}`);
    if (!shift) {
      results.push({ room_code: roomCode, shift_number: shiftNumber, ok: false, error: "This room+shift was not found" });
      continue;
    }

    const username1 = normalizeEmail(row.username1);
    const username2 = normalizeEmail(row.username2);
    if (username1 && username2 && username1 === username2) {
      results.push({
        room_code: roomCode,
        shift_number: shiftNumber,
        ok: false,
        error: "Same student twice",
      });
      continue;
    }

    try {
      await assignStudents(shift.shift_id, username1, username2);
      results.push({ room_code: roomCode, shift_number: shiftNumber, ok: true });
    } catch (err: any) {
      results.push({ room_code: roomCode, shift_number: shiftNumber, ok: false, error: err?.message ?? "Failed" });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return NextResponse.json({ results, succeeded, failed: results.length - succeeded });
}
