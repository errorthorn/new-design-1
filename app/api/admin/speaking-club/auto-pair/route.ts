import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { assignSeat, assignStudents, findOpenSeats, getAssignedUsernames, listAllShifts } from "@/lib/speaking-club-db";
import { listSubscribedUsers } from "@/lib/speaking-club-users";

type ProposedPair = {
  shiftId: string;
  room_code: string;
  shift_number: number;
  field: "username1" | "username2" | "both";
  username1?: string;
  username2?: string;
  name1?: string | null;
  name2?: string | null;
};

// Phase 4 (plan §9 / §5.2) — "auto-pair unassigned users button, reviewed
// and confirmed by admin". Two-step by design, matching the plan's
// "reviewed and confirmed" requirement literally:
//   1. POST with no body (or confirm:false) -> returns a PROPOSAL only,
//      nothing is written to the DB yet.
//   2. Admin reviews the proposal in the panel, then POSTs it back with
//      confirm:true -> actually writes the assignments.
// This mirrors the bulk-assign route's "preview then submit" shape rather
// than committing blind on the first call.
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => ({}));

  if (body?.confirm === true) {
    const pairs: ProposedPair[] = Array.isArray(body.pairs) ? body.pairs : [];
    if (pairs.length === 0) {
      return NextResponse.json({ error: "Pairs are required to confirm" }, { status: 400 });
    }

    let applied = 0;
    for (const p of pairs) {
      if (p.field === "both") {
        await assignStudents(p.shiftId, p.username1 ?? null, p.username2 ?? null);
      } else if (p.field === "username1") {
        await assignSeat(p.shiftId, "username1", p.username1 ?? null);
      } else if (p.field === "username2") {
        await assignSeat(p.shiftId, "username2", p.username2 ?? null);
      }
      applied++;
    }
    return NextResponse.json({ ok: true, applied });
  }

  // --- Proposal (dry run) ---
  const [shifts, subscribed] = await Promise.all([listAllShifts(), listSubscribedUsers()]);

  const assigned = getAssignedUsernames(shifts);
  const pool = subscribed.filter((u) => !assigned.has(u.email));
  const { emptyShifts, singleSeats } = findOpenSeats(shifts);

  const proposal: ProposedPair[] = [];
  let i = 0;

  // Prefer filling a shift's BOTH seats with two fresh students first,
  // so a room isn't left as "one stranger added to an existing pair"
  // when a genuinely empty room was available (see findOpenSeats comment).
  for (const shift of emptyShifts) {
    if (i + 1 >= pool.length) break;
    const a = pool[i];
    const b = pool[i + 1];
    proposal.push({
      shiftId: shift.shift_id,
      room_code: shift.room_code,
      shift_number: shift.shift_number,
      field: "both",
      username1: a.email,
      username2: b.email,
      name1: a.name,
      name2: b.name,
    });
    i += 2;
  }

  // Then fill remaining single open seats one student at a time.
  for (const seat of singleSeats) {
    if (i >= pool.length) break;
    const a = pool[i];
    const entry: ProposedPair = {
      shiftId: seat.shift.shift_id,
      room_code: seat.shift.room_code,
      shift_number: seat.shift.shift_number,
      field: seat.field,
    };
    if (seat.field === "username1") {
      entry.username1 = a.email;
      entry.name1 = a.name;
    } else {
      entry.username2 = a.email;
      entry.name2 = a.name;
    }
    proposal.push(entry);
    i += 1;
  }

  const usedCount = i;
  return NextResponse.json({
    proposal,
    subscribedUnassignedCount: pool.length,
    matchedCount: usedCount,
    leftoverUnassignedCount: Math.max(0, pool.length - usedCount),
    availableSeatsCount: emptyShifts.length * 2 + singleSeats.length,
  });
}
