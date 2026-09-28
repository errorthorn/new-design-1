import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listAllShifts } from "@/lib/speaking-club-db";
import { getDisplayNamesByEmails } from "@/lib/speaking-club-users";

// Phase 4 (plan §9) — "Room/shift management table view (§5.3): table of
// all 50 rooms × 3 shifts, who's assigned, status."
// GET /api/admin/speaking-club/shifts
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const shifts = await listAllShifts();

  // Resolve every username1/username2/temp_username email into a display
  // name in one batched Turso query, same pattern Phase 3 already uses for
  // the student dashboard (lib/speaking-club-users.ts).
  const emails: string[] = [];
  for (const s of shifts) {
    if (s.username1) emails.push(s.username1);
    if (s.username2) emails.push(s.username2);
    if (s.temp_username) emails.push(s.temp_username);
  }
  const names = await getDisplayNamesByEmails(emails);

  const rows = shifts.map((s) => ({
    ...s,
    username1_name: s.username1 ? names[s.username1] ?? s.username1 : null,
    username2_name: s.username2 ? names[s.username2] ?? s.username2 : null,
    temp_username_name: s.temp_username ? names[s.temp_username] ?? s.temp_username : null,
  }));

  return NextResponse.json({ shifts: rows });
}
