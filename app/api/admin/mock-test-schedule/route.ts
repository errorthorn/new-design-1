import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

// Lets an admin attach a real-world date to each mock-test week number
// (e.g. "Week 3 -> Aug 27") so the /mock-test dashboard can show students
// an actual date instead of a vague "unlocks later". This is purely a
// display label: the rolling 7-day eligibility rule in lib/mock-test.ts
// still decides when a student can actually start a test, so setting or
// clearing a date here never locks/unlocks anyone by itself.
const MAX_WEEK = 52; // sanity ceiling, not a real program length

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const res = await db.execute(
    "SELECT week_number, unlock_date FROM mock_test_week_schedule ORDER BY week_number ASC"
  );

  return NextResponse.json({ schedule: res.rows });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  // Accept either a single { week_number, unlock_date } or a bulk
  // { entries: [...] } so the admin page can save the whole table in one
  // request instead of one round trip per row.
  const entries: Array<{ week_number: number; unlock_date: string | null }> = Array.isArray(body.entries)
    ? body.entries
    : [body];

  const db = await getDb();

  for (const entry of entries) {
    const weekNumber = Number(entry.week_number);
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > MAX_WEEK) {
      return NextResponse.json(
        { error: `week_number must be an integer between 1 and ${MAX_WEEK}.` },
        { status: 400 }
      );
    }
    const unlockDate = entry.unlock_date ? String(entry.unlock_date) : null;
    await db.execute({
      sql: `INSERT INTO mock_test_week_schedule (week_number, unlock_date) VALUES (?, ?)
            ON CONFLICT(week_number) DO UPDATE SET unlock_date = excluded.unlock_date`,
      args: [weekNumber, unlockDate],
    });
  }

  const res = await db.execute(
    "SELECT week_number, unlock_date FROM mock_test_week_schedule ORDER BY week_number ASC"
  );
  return NextResponse.json({ ok: true, schedule: res.rows });
}
