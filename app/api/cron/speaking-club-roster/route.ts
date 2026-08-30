import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/admin-auth";
import { listAllShifts } from "@/lib/speaking-club-db";
import { getDisplayNamesByEmails } from "@/lib/speaking-club-users";

// Phase 6 (plan §6 / §9 Phase 6) — "Routine notification: scheduled
// trigger before each shift start — reads current room/shift/username
// assignments, emails each student their room's existing fixed passkey."
//
// This route is the READ side of that: it doesn't send anything itself,
// it just hands back exactly the rows an n8n schedule-triggered workflow
// needs (one HTTP Request node call) to loop over and email via its own
// Email/Resend node. See PHASE6-N8N-SETUP.md for the actual workflow to
// build in n8n against this.
//
// GET /api/cron/speaking-club-roster?shiftNumber=1
//   shiftNumber: optional, 1|2|3 — filter to one shift's roster (the
//   normal case: n8n runs 3 separate schedules, one ~15-30 min before
//   each shift, each passing its own shiftNumber). Omit to get all 3.
//
// Auth: same x-cron-secret / requireCron() as the alert-detection cron
// route — this is the same "automation caller" trust level, and this
// route hands back passkeys, so it must never be left unauthenticated.
export async function GET(req: NextRequest) {
  const unauthorized = requireCron(req);
  if (unauthorized) return unauthorized;

  const shiftNumberParam = req.nextUrl.searchParams.get("shiftNumber");
  let shiftNumberFilter: number | null = null;
  if (shiftNumberParam !== null) {
    shiftNumberFilter = Number(shiftNumberParam);
    if (![1, 2, 3].includes(shiftNumberFilter)) {
      return NextResponse.json({ error: "shiftNumber must be 1, 2, or 3" }, { status: 400 });
    }
  }

  const shifts = await listAllShifts();
  const relevant = shifts.filter(
    (s) =>
      s.room_status === "active" &&
      (shiftNumberFilter === null || s.shift_number === shiftNumberFilter) &&
      (s.username1 || s.username2 || s.temp_username)
  );

  const emails = Array.from(
    new Set(
      relevant.flatMap((s) => [s.username1, s.username2, s.temp_username].filter((e): e is string => !!e))
    )
  );
  const names = await getDisplayNamesByEmails(emails);

  type RosterRow = {
    email: string;
    name: string;
    roomCode: string;
    shiftNumber: 1 | 2 | 3;
    passkey: string;
    startTime: string;
    endTime: string;
    role: "primary" | "third";
  };

  const roster: RosterRow[] = [];
  for (const s of relevant) {
    const seats: [string | null, "primary" | "third"][] = [
      [s.username1, "primary"],
      [s.username2, "primary"],
      [s.temp_username, "third"],
    ];
    for (const [email, role] of seats) {
      if (!email) continue;
      roster.push({
        email,
        name: names[email] ?? email,
        roomCode: s.room_code,
        shiftNumber: s.shift_number,
        passkey: s.passkey,
        startTime: s.start_time,
        endTime: s.end_time,
        role,
      });
    }
  }

  return NextResponse.json({ roster, count: roster.length });
}
