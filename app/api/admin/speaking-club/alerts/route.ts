import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { detectAndFlagPartnerAbsences, listOpenAlerts, suggestReassignmentTargets } from "@/lib/speaking-club-db";
import { getDisplayNamesByEmails } from "@/lib/speaking-club-users";

// Phase 5 (plan §9 / §5 item 4) — "Live 'partner absent' alert list."
// GET /api/admin/speaking-club/alerts
//
// Runs the detection pass inline before listing, so the admin panel is
// never stale even if no cron/scheduler is set up yet (see
// PHASE5-TESTING.md — a scheduled hit on /api/cron/speaking-club-alerts
// is what keeps alerts appearing between page loads when nobody has the
// panel open, but this GET is a complete, correct source of truth on its
// own either way).
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  await detectAndFlagPartnerAbsences();
  const alerts = await listOpenAlerts();

  const names = await getDisplayNamesByEmails(
    alerts.flatMap((a) => [a.present_username, a.absent_username].filter((e): e is string => !!e))
  );

  const enriched = await Promise.all(
    alerts.map(async (a) => {
      const { emptyRoomTargets, thirdPersonTargets } = await suggestReassignmentTargets({
        shift_id: a.shift_id,
        room_code: a.room_code,
        shift_number: a.shift_number,
      });
      return {
        id: a.id,
        shiftId: a.shift_id,
        roomCode: a.room_code,
        shiftNumber: a.shift_number,
        presentUsername: a.present_username,
        presentName: names[a.present_username] ?? a.present_username,
        absentUsername: a.absent_username,
        absentName: a.absent_username ? names[a.absent_username] ?? a.absent_username : null,
        detectedAt: a.detected_at,
        emptyRoomTargets: emptyRoomTargets.map((t) => ({
          shiftId: t.shift_id,
          roomCode: t.room_code,
          shiftNumber: t.shift_number,
        })),
        thirdPersonTargets: thirdPersonTargets.map((t) => ({
          shiftId: t.shift_id,
          roomCode: t.room_code,
          shiftNumber: t.shift_number,
        })),
      };
    })
  );

  return NextResponse.json({ alerts: enriched });
}
