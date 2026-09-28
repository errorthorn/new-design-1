// lib/speaking-club-users.ts
//
// Phase 3 (plan §9): the Speaking Club schema (Supabase) stores partner
// assignments as plain emails (speaking_shifts.username1/username2/
// temp_username — see sql/schema.sql comments), by design, since Supabase
// and the accounts DB (Turso, lib/db.ts) are intentionally separate
// databases with no foreign key between them (same "DB-agnostic link"
// pattern used by students.user_email). This file is the lookup that
// turns those emails back into a display name for the dashboard/room UI.
import { getDb } from "@/lib/db";

/** Maps email -> display name (falls back to the email itself if no account row matches). */
export async function getDisplayNamesByEmails(emails: string[]): Promise<Record<string, string>> {
  const uniqueEmails = Array.from(new Set(emails.filter(Boolean)));
  if (uniqueEmails.length === 0) return {};

  const db = await getDb();
  const placeholders = uniqueEmails.map(() => "?").join(",");
  const res = await db.execute({
    sql: `SELECT email, name FROM users WHERE email IN (${placeholders})`,
    args: uniqueEmails,
  });

  const map: Record<string, string> = {};
  for (const email of uniqueEmails) map[email] = email;
  for (const row of res.rows as any[]) {
    if (row.email) map[row.email as string] = (row.name as string) || (row.email as string);
  }
  return map;
}

export type SpeakingClubUser = {
  email: string;
  name: string | null;
  subscription_active: boolean;
};

export type SubscriptionInfo = {
  active: boolean;
  /** ISO datetime, or null if this account has never had a subscription set. */
  expiresAt: string | null;
  /**
   * ISO datetime, or null if it can't be computed. There's no dedicated
   * "subscription started on" column in the users table (lib/db.ts) —
   * only subscription_expires_at and subscription_weeks (how many weeks
   * the current plan covers, set alongside the expiry — see
   * app/api/admin/members/route.ts). This is the best available proxy:
   * expiresAt minus weeks. Exact for a subscription that's never been
   * renewed/extended since it was set; a renewal that stacked extra time
   * on top of an existing expiry would push this "start" date later than
   * the student's TRUE first day, so treat it as "at least this recent,"
   * not as gospel.
   */
  startDate: string | null;
  weeks: number | null;
};

/**
 * Batch subscription lookup, keyed by email — for admin views (e.g. the
 * Speaking Club Attendance tab) that need to tell "recently joined, no
 * surprise they haven't attended yet" apart from "been a member for
 * months and just stopped showing up," without a per-student round trip.
 */
export async function getSubscriptionInfoByEmails(emails: string[]): Promise<Record<string, SubscriptionInfo>> {
  const uniqueEmails = Array.from(new Set(emails.filter(Boolean)));
  if (uniqueEmails.length === 0) return {};

  const db = await getDb();
  const placeholders = uniqueEmails.map(() => "?").join(",");
  const res = await db.execute({
    sql: `SELECT email, subscription_active, subscription_expires_at, subscription_weeks FROM users WHERE email IN (${placeholders})`,
    args: uniqueEmails,
  });

  const map: Record<string, SubscriptionInfo> = {};
  for (const row of res.rows as any[]) {
    const expiresAt = (row.subscription_expires_at as string) ?? null;
    const weeks = row.subscription_weeks != null ? Number(row.subscription_weeks) : null;
    let startDate: string | null = null;
    if (expiresAt && weeks) {
      const d = new Date(expiresAt);
      d.setUTCDate(d.getUTCDate() - weeks * 7);
      startDate = d.toISOString();
    }
    map[row.email as string] = { active: Boolean(row.subscription_active), expiresAt, startDate, weeks };
  }
  return map;
}

/**
 * Phase 4 (plan §5.1/§9) — "user search/select": lets the admin panel find
 * an existing Turso account by email or name while assigning a room+shift,
 * instead of typing a raw email blind. Only ever called from an
 * admin-authenticated API route (see requireAdmin in lib/admin-auth.ts).
 */
export async function searchSpeakingClubUsers(query: string, limit = 20): Promise<SpeakingClubUser[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const db = await getDb();
  const like = `%${trimmed}%`;
  const res = await db.execute({
    sql: `SELECT email, name, subscription_active FROM users
          WHERE email LIKE ? OR name LIKE ?
          ORDER BY subscription_active DESC, name ASC
          LIMIT ?`,
    args: [like, like, limit],
  });

  return (res.rows as any[]).map((row) => ({
    email: row.email as string,
    name: (row.name as string) ?? null,
    subscription_active: Boolean(row.subscription_active),
  }));
}

/**
 * Every account with an active Speaking Club subscription — the pool
 * auto-pair (§5.2) draws from. Same `subscription_active` flag that
 * `/admin/members` grants/revokes (see README's "Two databases" note —
 * this is the Turso side, unrelated to the speaking_shifts assignment
 * rows, which live in Supabase).
 */
export async function listSubscribedUsers(): Promise<SpeakingClubUser[]> {
  const db = await getDb();
  const res = await db.execute(
    // is_test = 0 keeps sample/test accounts (see /admin/members) out of
    // the auto-pair pool even while their own subscription is switched on
    // for testing — so a real student never gets paired with one by
    // mistake. A test account can still be assigned to a shift by hand.
    `SELECT email, name, subscription_active FROM users WHERE subscription_active = 1 AND is_test = 0 ORDER BY name ASC`
  );
  return (res.rows as any[]).map((row) => ({
    email: row.email as string,
    name: (row.name as string) ?? null,
    subscription_active: Boolean(row.subscription_active),
  }));
}
