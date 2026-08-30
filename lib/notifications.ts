// lib/notifications.ts
//
// Thin helpers around the `notifications` table (see lib/db.ts). Any real
// event a student would want to know about — a payment getting approved,
// a mock test getting scored, a referral reward landing — calls
// createNotification() right where that event already happens in the
// codebase. The dashboard bell icon (components/dashboard/dashboard-shell.tsx)
// just reads this table back via /api/notifications.
//
// Keyed by user_email (not user_id) on purpose: some callers — the mock
// test scoring route in particular — only have the student's email on
// hand (it comes from Supabase's `students` table, not this DB's
// `users.id`), so email is the one identifier every caller can reliably
// provide.
import { getDb } from "@/lib/db";

export type NotificationType =
  | "payment_approved"
  | "payment_rejected"
  | "referral_reward"
  | "mock_test_scored";

export async function createNotification({
  userEmail,
  type,
  title,
  body,
  link,
}: {
  userEmail: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO notifications (user_email, type, title, body, link) VALUES (?, ?, ?, ?, ?)`,
    args: [userEmail.toLowerCase(), type, title, body ?? null, link ?? null],
  });
}

export async function getNotifications(userEmail: string, limit = 20) {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT id, type, title, body, link, read, created_at
          FROM notifications WHERE user_email = ?
          ORDER BY created_at DESC LIMIT ?`,
    args: [userEmail.toLowerCase(), limit],
  });
  return res.rows;
}

export async function getUnreadCount(userEmail: string) {
  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT COUNT(*) as c FROM notifications WHERE user_email = ? AND read = 0`,
    args: [userEmail.toLowerCase()],
  });
  return Number(res.rows[0]?.c ?? 0);
}

/** Marks one notification read — scoped to userEmail so one account can never mark another's as read. */
export async function markNotificationRead(id: number, userEmail: string) {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE notifications SET read = 1 WHERE id = ? AND user_email = ?`,
    args: [id, userEmail.toLowerCase()],
  });
}

export async function markAllNotificationsRead(userEmail: string) {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE notifications SET read = 1 WHERE user_email = ? AND read = 0`,
    args: [userEmail.toLowerCase()],
  });
}
