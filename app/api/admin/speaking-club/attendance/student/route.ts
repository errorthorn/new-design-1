// app/api/admin/speaking-club/attendance/student/route.ts
//
// Companion to .../attendance (the assigned-roster view): that one only
// covers students currently sitting in an active room+shift seat. This is
// "search a specific student by email" — works for anyone who has ever had
// a speaking_attendance row, current assignment or not. GET, requireAdmin —
// reads lib/speaking-club-attendance.ts's getStudentAttendance() and
// attaches the same name + subscription info the roster route attaches.
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseServer } from "@/lib/supabase";
import { getStudentAttendance } from "@/lib/speaking-club-attendance";
import { getSubscriptionInfoByEmails } from "@/lib/speaking-club-users";

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 60; // a single student's own history — fine to look back further than the roster view.

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const windowDays = Number.isInteger(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;

  try {
    const [result, { data: student, error: studentError }, subscriptionByEmail] = await Promise.all([
      getStudentAttendance(email, windowDays),
      supabaseServer.from("students").select("name, user_email").eq("user_email", email).maybeSingle(),
      getSubscriptionInfoByEmails([email]),
    ]);
    if (studentError) throw studentError;

    const sub = subscriptionByEmail[email];

    return NextResponse.json({
      ...result,
      name: student?.name ?? null,
      subscriptionStart: sub?.startDate ?? null,
      subscriptionEnd: sub?.expiresAt ?? null,
      subscriptionActive: sub?.active ?? false,
    });
  } catch (err) {
    console.error("[admin/speaking-club/attendance/student] failed", err);
    return NextResponse.json({ error: "There was a problem loading this student's attendance" }, { status: 500 });
  }
}
