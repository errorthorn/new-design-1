import { NextRequest, NextResponse } from "next/server";
import { requireCron } from "@/lib/admin-auth";
import { detectAndFlagPartnerAbsences } from "@/lib/speaking-club-db";

// Phase 5 (plan §9 / §4.1 / §4.4) — the scheduled check a scheduler
// (Vercel Cron, n8n's schedule trigger, etc) hits every 1-2 minutes so
// alerts appear even when no admin has the panel open. The admin panel's
// GET /api/admin/speaking-club/alerts also runs the same detection pass
// inline before listing, so this route is a convenience for background
// freshness, not the only path that keeps alerts correct.
//
// Auth: x-cron-secret header, checked against CRON_SECRET (falls back to
// ADMIN_SECRET if unset — see requireCron()'s doc comment in
// lib/admin-auth.ts). Accepts GET (most schedulers default to a plain GET
// hit) and POST (some webhook-style schedulers only send POST).
async function run(req: NextRequest) {
  const unauthorized = requireCron(req);
  if (unauthorized) return unauthorized;

  await detectAndFlagPartnerAbsences();
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
