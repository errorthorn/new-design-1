import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { assignStudents, getAssignedUsernames, listAllShifts } from "@/lib/speaking-club-db";
import { listGroupMembers, listMemberGroups } from "@/lib/speaking-club-users";

// "Assign a whole group" page (app/admin/speaking-club/group-assign).
//
//   GET  ?group=batch-1   -> the group list, that group's members (with anyone already seated marked), and each
//                            shift's clock time.
//   POST {action:"plan", shifts:{1:[email...],2:[...],3:[...]}}
//          Each shift's list is read in order, two at a time = one pair = one room (an odd last email sits alone).
//          Returns which room every pair would take: the first completely empty ACTIVE rooms of that shift, in room
//          order. Nothing is written. Refuses (409) if a person is already seated somewhere or there are not enough
//          empty rooms.
//   POST {action:"apply", rows:[{shiftId, username1, username2}]}
//          Writes those rows (the page sends them in small chunks so a request never runs long). Every row is
//          re-checked against the live grid first, so a room that got filled in the meantime is skipped, not
//          overwritten. assignStudents() sends each student their passkey bell notification.

export const maxDuration = 60;

const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
const roomOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin(req, "speaking-club");
  if (unauthorized) return unauthorized;

  const groups = await listMemberGroups();
  const group = (req.nextUrl.searchParams.get("group") ?? "").trim();
  const shifts = await listAllShifts();

  const times: Record<number, { start: string; end: string }> = {};
  for (const s of shifts) times[s.shift_number] ??= { start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) };

  if (!group) return NextResponse.json({ groups, members: [], times });

  const members = await listGroupMembers(group);
  const seated = new Map<string, { room_code: string; shift_number: number }>();
  for (const s of shifts) {
    for (const e of [s.username1, s.username2, s.temp_username]) {
      if (e) seated.set(e.toLowerCase(), { room_code: s.room_code, shift_number: s.shift_number });
    }
  }
  return NextResponse.json({
    groups,
    times,
    members: members.map((m) => ({
      email: m.email,
      name: m.name,
      active: m.subscription_active,
      seated: seated.get(m.email.toLowerCase()) ?? null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin(req, "speaking-club");
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === "plan") {
    const input = body?.shifts ?? {};
    const lists: Record<1 | 2 | 3, string[]> = {
      1: Array.isArray(input[1]) ? input[1].map(norm).filter(Boolean) : [],
      2: Array.isArray(input[2]) ? input[2].map(norm).filter(Boolean) : [],
      3: Array.isArray(input[3]) ? input[3].map(norm).filter(Boolean) : [],
    };
    const all = [...lists[1], ...lists[2], ...lists[3]];
    if (all.length === 0) return NextResponse.json({ error: "Nobody selected." }, { status: 400 });
    if (new Set(all).size !== all.length) {
      return NextResponse.json({ error: "Someone is selected in more than one shift." }, { status: 400 });
    }

    const grid = await listAllShifts();
    const taken = getAssignedUsernames(grid);
    const clash = all.filter((e) => taken.has(e));
    if (clash.length) {
      return NextResponse.json(
        { error: `${clash.length} selected student(s) already have a room: ${clash.slice(0, 5).join(", ")}${clash.length > 5 ? "…" : ""}. Reload the page.` },
        { status: 409 }
      );
    }

    const rows: { shiftId: string; roomCode: string; shiftNumber: number; username1: string; username2: string | null }[] = [];
    for (const n of [1, 2, 3] as const) {
      const list = lists[n];
      if (!list.length) continue;
      const free = grid
        .filter((s) => s.shift_number === n && s.room_status === "active" && !s.username1 && !s.username2 && !s.temp_username)
        .sort((a, b) => roomOrder(a.room_code, b.room_code));
      const pairs = Math.ceil(list.length / 2);
      if (free.length < pairs) {
        return NextResponse.json(
          { error: `Shift ${n} needs ${pairs} empty rooms but only ${free.length} are free.` },
          { status: 409 }
        );
      }
      for (let i = 0; i < pairs; i++) {
        rows.push({
          shiftId: free[i].shift_id,
          roomCode: free[i].room_code,
          shiftNumber: n,
          username1: list[i * 2],
          username2: list[i * 2 + 1] ?? null,
        });
      }
    }
    return NextResponse.json({ rows });
  }

  if (action === "apply") {
    const rows: any[] = Array.isArray(body?.rows) ? body.rows.slice(0, 20) : [];
    if (rows.length === 0) return NextResponse.json({ error: "rows required" }, { status: 400 });

    const grid = await listAllShifts();
    const byId = new Map(grid.map((s) => [s.shift_id, s]));
    const taken = getAssignedUsernames(grid);

    const done: string[] = [];
    const failed: { roomCode: string; shiftNumber: number; error: string }[] = [];
    for (const r of rows) {
      const shift = byId.get(String(r?.shiftId));
      const u1 = norm(r?.username1);
      const u2 = norm(r?.username2) || null;
      if (!shift || !u1) {
        failed.push({ roomCode: String(r?.roomCode ?? "?"), shiftNumber: Number(r?.shiftNumber) || 0, error: "Invalid row" });
        continue;
      }
      const fail = (error: string) => failed.push({ roomCode: shift.room_code, shiftNumber: shift.shift_number, error });
      if (shift.username1 || shift.username2 || shift.temp_username) {
        fail("Room got occupied in the meantime");
        continue;
      }
      if (taken.has(u1) || (u2 && taken.has(u2)) || u1 === u2) {
        fail("A student already has a room");
        continue;
      }
      try {
        await assignStudents(shift.shift_id, u1, u2);
        taken.add(u1);
        if (u2) taken.add(u2);
        done.push(shift.room_code + "#" + shift.shift_number);
      } catch (err: any) {
        fail(err?.message ?? "Failed");
      }
    }
    return NextResponse.json({ ok: true, done: done.length, failed });
  }

  return NextResponse.json({ error: "action must be 'plan' or 'apply'" }, { status: 400 });
}
