// app/api/speaking-club/attendance/route.ts
//
// GET — the signed-in student's Speaking Club attendance stats (current /
// longest streak, sessions in the last 7 days, total, attended today).
// Read-only; attendance itself is written server-side when a call ends
// (see app/api/speaking-club/turn-stats/route.ts).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getAttendanceStats } from "@/lib/speaking-club-attendance";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    return NextResponse.json({ attendance: await getAttendanceStats(user.email) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem loading your attendance" }, { status: 500 });
  }
}
