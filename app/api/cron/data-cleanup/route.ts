import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/admin-auth";
import { runDataCleanup } from "@/lib/data-retention";

// Hit this ONCE A DAY (any time; late night Asia/Dhaka is a good choice) from
// the same scheduler as the other cron routes, with the same x-cron-secret.
// It deletes data whose job is done - see lib/data-retention.ts for exactly
// what is kept and removed.
//
// Add ?dryRun=1 to see what WOULD be deleted, without deleting anything.
// Run it that way once before enabling the daily schedule.
export const maxDuration = 60; // safe to re-run: anything not finished today is picked up tomorrow

async function run(req: NextRequest) {
  const unauthorized = requireCron(req);
  if (unauthorized) return unauthorized;

  const dry = req.nextUrl.searchParams.get("dryRun") === "1";
  const result = await runDataCleanup(dry);
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
