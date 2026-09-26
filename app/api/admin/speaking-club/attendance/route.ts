// app/api/admin/speaking-club/attendance/route.ts
//
// Admin gap-fix: the admin assigns each room+shift's duo by hand, but
// had no way to see who's since stopped showing up without checking
// every room manually. GET, requireAdmin — reads
// lib/speaking-club-attendance.ts's getAttendanceRoster() (cross-
// references the manual room+shift assignments against qualified
// speaking_attendance rows) and attaches, per student: their name (from
// the Supabase `students` table, keyed by user_email) and their
// subscription start/end dates (from the Turso `users` table, keyed by
// the same email — see lib/speaking-club-users.ts's
// getSubscriptionInfoByEmails) — so the admin panel can tell "recently
// joined, hasn't had a real chance yet" apart from "been a member for
// months and just stopped."
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { supabaseServer } from "@/lib/supabase";
import { getAttendanceRoster } from "@/lib/speaking-club-attendance";
import { getSubscriptionInfoByEmails } from "@/lib/speaking-club-users";

const DEFAULT_WINDOW_DAYS = 7;
// speaking_attendance rows are never deleted/expired — this cap is only
// how far back a single request is willing to scan, not how long data
// is kept. Raised from 30 to 60 so "the whole current month, or a bit
// more" is one click away without needing a bigger cap than that.
const MAX_WINDOW_DAYS = 60;

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const windowDays = Number.isInteger(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_WINDOW_DAYS) : DEFAULT_WINDOW_DAYS;

  try {
    const result = await getAttendanceRoster(windowDays);

    const usernames = Array.from(new Set(result.roster.map((r) => r.username)));
    const nameByEmail = new Map<string, string>();
    if (usernames.length > 0) {
      const { data: students, error: studentsError } = await supabaseServer
        .from("students")
        .select("name, user_email")
        .in("user_email", usernames);
      if (studentsError) throw studentsError;
      for (const s of (students ?? []) as { name: string; user_email: string | null }[]) {
        if (s.user_email) nameByEmail.set(s.user_email, s.name);
      }
    }

    // Turso lookup — a completely separate DB from the students query
    // above, deliberately kept as two independent calls rather than one
    // join (see lib/speaking-club-users.ts's file header: Supabase and
    // Turso have no foreign key between them by design).
    const subscriptionByEmail = await getSubscriptionInfoByEmails(usernames);

    const withExtras = (entries: typeof result.roster) =>
      entries.map((e) => {
        const sub = subscriptionByEmail[e.username];
        return {
          ...e,
          name: nameByEmail.get(e.username) ?? null,
          subscriptionStart: sub?.startDate ?? null,
          subscriptionEnd: sub?.expiresAt ?? null,
          subscriptionActive: sub?.active ?? false,
        };
      });

    return NextResponse.json({
      windowDays: result.windowDays,
      today: result.today,
      roster: withExtras(result.roster),
      flagged: withExtras(result.flagged),
    });
  } catch (err) {
    console.error("[admin/speaking-club/attendance] failed", err);
    return NextResponse.json({ error: "There was a problem loading attendance" }, { status: 500 });
  }
}
