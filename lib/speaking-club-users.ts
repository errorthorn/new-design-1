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
    `SELECT email, name, subscription_active FROM users WHERE subscription_active = 1 ORDER BY name ASC`
  );
  return (res.rows as any[]).map((row) => ({
    email: row.email as string,
    name: (row.name as string) ?? null,
    subscription_active: Boolean(row.subscription_active),
  }));
}
