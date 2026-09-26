// lib/admin-auth.ts
//
// Every teacher/admin-only route (the /admin/* API surface, plus
// /api/mock-test/questions which uses the same shared-secret pattern)
// checked this exact same way, each with its own copy-pasted
// isAuthorized() function. Centralized here so there's one place that
// defines what "admin" means for the API, and one error shape for every
// route that enforces it.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Constant-time string comparison. Hashing both sides first (instead of
 * comparing the raw strings) means we always compare two fixed-length
 * 32-byte digests, which sidesteps crypto.timingSafeEqual's requirement
 * that its inputs already be equal length — so this never throws or
 * short-circuits based on the secret's length, only its content.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const digestA = crypto.createHash("sha256").update(a).digest();
  const digestB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

/**
 * Call at the top of any admin-only Route Handler:
 *
 *   const unauthorized = requireAdmin(req);
 *   if (unauthorized) return unauthorized;
 *
 * Returns a 401 NextResponse if the request doesn't carry the correct
 * x-admin-secret header, otherwise null (meaning: proceed).
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const secret = req.headers.get("x-admin-secret");
  const expected = process.env.ADMIN_SECRET;
  const authorized =
    Boolean(secret) && Boolean(expected) && timingSafeStringEqual(secret as string, expected as string);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/**
 * Same shape as requireAdmin(), for the Phase 5 detection route that a
 * scheduler (Vercel Cron, n8n's schedule trigger, etc — see
 * PHASE5-TESTING.md) hits automatically every 1-2 min instead of a human
 * typing ADMIN_SECRET into the panel. Checks x-cron-secret against
 * CRON_SECRET if you've set one (recommended — a scheduler config file is
 * a worse place to leak ADMIN_SECRET than it needs to be); falls back to
 * ADMIN_SECRET so this still works with zero extra setup if you haven't
 * configured CRON_SECRET yet.
 */
export function requireCron(req: NextRequest): NextResponse | null {
  const secret = req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET || process.env.ADMIN_SECRET;
  const authorized =
    Boolean(secret) && Boolean(expected) && timingSafeStringEqual(secret as string, expected as string);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
