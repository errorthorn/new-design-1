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
import { supabaseServer } from "@/lib/supabase";
import { ADMIN_SECTIONS, ADMIN_SECTION_LABELS, isAdminSection, type AdminSection } from "@/lib/admin-sections";

// ---------------------------------------------------------------------------
// Who can do what
//
//  - The OWNER holds ADMIN_SECRET and can use every admin API.
//  - A STAFF member is either an ACCOUNT the owner linked on /admin/staff (signs in normally,
//    sees "Admin" in the profile menu, needs no key) or holds a personal access key.
//    The key is stored only as a hash in `admin_staff`, together with the sections that
//    person may use. They type it into the same box the admin pages already have.
//  - Any admin API that names no section is OWNER-ONLY (payments, members, staff, ...), so
//    a route that is forgotten stays locked instead of opening up to staff.
// ---------------------------------------------------------------------------
export { ADMIN_SECTIONS, ADMIN_SECTION_LABELS, isAdminSection, type AdminSection };

/** Staff keys are random and long, so a fast hash is enough (nothing to brute-force). */
export function hashStaffKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateStaffKey(): string {
  return `lcs_${crypto.randomBytes(24).toString("base64url")}`;
}

const LAST_USED_REFRESH_MS = 5 * 60_000;

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
 *   const unauthorized = await requireAdmin(req, "quiz");
 *   if (unauthorized) return unauthorized;
 *
 * `section` is the part of the panel this route belongs to. The owner (ADMIN_SECRET) always
 * passes; a staff key — or a signed-in account the owner linked on /admin/staff, sent with no
 * key at all — passes only if that section was granted to it. With no `section` the
 * route is owner-only. Returns a NextResponse to send back, or null to proceed:
 *   401 - no key, or a key that is unknown / switched off
 *   403 - a valid staff key without access to this section
 */
export async function requireAdmin(req: NextRequest, section?: AdminSection): Promise<NextResponse | null> {
  const provided = (req.headers.get("x-admin-secret") ?? "").trim();

  let staff: StaffRow | null = null;
  if (provided) {
    const expected = process.env.ADMIN_SECRET;
    if (expected && timingSafeStringEqual(provided, expected)) return null; // owner

    const { data, error } = await supabaseServer
      .from("admin_staff")
      .select("id, sections, active, last_used_at")
      .eq("key_hash", hashStaffKey(provided))
      .maybeSingle();
    if (error) {
      // Fail closed: if the staff list can't be read, nobody but the owner gets in.
      console.error("[admin-auth] staff lookup failed:", error.message);
      return NextResponse.json({ error: "Could not verify access. Try again." }, { status: 503 });
    }
    staff = (data as StaffRow | null) ?? null;
  } else {
    // No key sent: this may be a signed-in account that the owner gave admin access to.
    const lookup = await findSessionStaff();
    if (lookup.error) {
      return NextResponse.json({ error: "Could not verify access. Try again." }, { status: 503 });
    }
    staff = lookup.staff;
  }

  if (!staff || !staff.active) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!section) {
    return NextResponse.json({ error: "This area is for the owner only." }, { status: 403 });
  }
  const granted: string[] = Array.isArray(staff.sections) ? staff.sections : [];
  if (!granted.includes(section)) {
    return NextResponse.json({ error: `You don't have access to ${ADMIN_SECTION_LABELS[section]}.` }, { status: 403 });
  }

  const lastUsed = staff.last_used_at ? new Date(staff.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > LAST_USED_REFRESH_MS) {
    try {
      await supabaseServer.from("admin_staff").update({ last_used_at: new Date().toISOString() }).eq("id", staff.id);
    } catch {
      // best-effort bookkeeping only
    }
  }
  return null;
}

type StaffRow = { id: string; sections: string[] | null; active: boolean; last_used_at: string | null; name?: string | null };

/**
 * The admin_staff row linked to the account that is signed in right now (matched by
 * users.id, never by a typed-in email), or null. `error` is true only when the staff
 * list itself could not be read, so callers can fail closed instead of guessing.
 */
export async function findSessionStaff(): Promise<{ staff: StaffRow | null; error: boolean }> {
  let userId: string | null = null;
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const user: any = await getCurrentUser();
    if (user?.id !== undefined && user?.id !== null) userId = String(user.id);
  } catch {
    userId = null; // no request context / not signed in
  }
  if (!userId) return { staff: null, error: false };

  const { data, error } = await supabaseServer
    .from("admin_staff")
    .select("id, name, sections, active, last_used_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Most likely the 2026-10-29 migration has not been run yet: nobody is account-linked.
    console.error("[admin-auth] account staff lookup failed:", error.message);
    return { staff: null, error: true };
  }
  return { staff: (data as StaffRow | null) ?? null, error: false };
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
