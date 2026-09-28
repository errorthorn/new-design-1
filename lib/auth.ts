// lib/auth.ts
//
// Two things live here:
//
// 1. Our own email/password session — a JWT stored in an httpOnly cookie
//    named "session". This is what /login and /signup use directly.
//
// 2. getCurrentUser() — a single helper that checks EITHER our own cookie
//    OR a NextAuth session (used for Google sign-in), so the rest of the
//    app never has to care which way someone signed in.

import jwt from "jsonwebtoken";
import crypto from "crypto";
import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/next-auth-options";
import { getDb } from "@/lib/db";

const DEV_FALLBACK_SECRET = "dev-only-secret-change-me";

// Resolved lazily (at sign/verify time) rather than once at module load,
// so a missing JWT_SECRET can't crash `next build` itself — Next sets
// NODE_ENV=production during the build too, and some hosts only inject
// real env vars at runtime, not at build time. Checking lazily means the
// failure only happens if a session is actually signed/verified without
// the var set, which is exactly the unsafe case this guards against.
//
// In production, silently falling back to a fixed, publicly-known string
// would let anyone who has seen this codebase forge a valid session
// cookie for any account, so we refuse to run rather than do that.
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is not set. Refusing to sign or verify sessions in " +
        "production with the hardcoded fallback secret — set JWT_SECRET " +
        "in your environment."
    );
  }
  return DEV_FALLBACK_SECRET;
}

const COOKIE_NAME = "session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ⚠️ TEMPORARY TESTING SWITCH ⚠️
// While on, no sign-in step is needed — every visitor is auto-signed-in
// as a standing "dev tester" account. Subscription is back to the REAL
// check (the dev tester starts with no subscription, same paywall as any
// normal account — grant it a subscription from /admin/payments or
// /admin/members to test the paid experience).
// Controlled by an env var (rather than a hardcoded boolean) so it can
// never accidentally ship "on" in production — just don't set
// BYPASS_LOGIN=true anywhere outside your local .env.
const BYPASS_LOGIN = process.env.BYPASS_LOGIN === "true";

export const SESSION_COOKIE_NAME = COOKIE_NAME;

// ---- our own email/password session ----

export function signSession(
  user: { id: number | string; email: string; name?: string | null },
  sid?: string
) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, sid: sid || crypto.randomUUID() },
    getJwtSecret(),
    { expiresIn: MAX_AGE_SECONDS }
  );
}

export function verifySession(token: string) {
  // Resolved outside the try/catch on purpose: if JWT_SECRET is missing
  // in production, getJwtSecret() throws, and that should surface as a
  // real error, not get swallowed by the catch below (which exists only
  // to turn an invalid/expired token into "not signed in").
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, { remember = true }: { remember?: boolean } = {}) {
  const parts = [`${COOKIE_NAME}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  if (remember) parts.push(`Max-Age=${MAX_AGE_SECONDS}`);
  return parts.join("; ");
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`;
}

// ---- device sessions (see the user_sessions table in lib/db.ts) ----
//
// Only covers our own email/password JWT cookie. Google sign-in goes
// through NextAuth's own cookie/session machinery, which isn't wired into
// this table — a Google-signed-in device shows up on /profile as a single
// separate "managed by Google" line instead of a row here, and can't be
// remotely revoked from this app (see app/profile/page.tsx).

function parseDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;
  let os = "Unknown OS";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/mac os/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "a browser";
  if (/edg\//i.test(ua)) browser = "Edge";
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = "Chrome";
  else if (/firefox\//i.test(ua)) browser = "Firefox";
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = "Safari";

  return `${browser} on ${os}`;
}

/** Call right after signSession() on a successful login/register, with the
 * SAME sid that was embedded in the token. Records the device so it shows
 * up on /profile → Sessions & Devices. */
export async function createUserSession(
  userId: number | string,
  sid: string,
  request: Request
) {
  const db = await getDb();
  const userAgent = request.headers.get("user-agent");
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  await db.execute({
    sql: "INSERT INTO user_sessions (id, user_id, device_label, ip) VALUES (?, ?, ?, ?)",
    args: [sid, userId, parseDeviceLabel(userAgent), ip],
  });
}

export async function listUserSessions(userId: number | string) {
  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT id, device_label, ip, created_at, last_seen_at FROM user_sessions WHERE user_id = ? ORDER BY last_seen_at DESC",
    args: [userId],
  });
  return res.rows;
}

/** Deletes a session row — only if it belongs to the given user, so one
 * account can never revoke another's device by guessing a session id. */
export async function revokeUserSession(userId: number | string, sessionId: string) {
  const db = await getDb();
  await db.execute({
    sql: "DELETE FROM user_sessions WHERE id = ? AND user_id = ?",
    args: [sessionId, userId],
  });
}

/** Reads the sid out of the current request's own session cookie, without
 * the full getCurrentUser() round trip — used by the sessions API to know
 * which row is "this device" so it can be marked/protected in the list. */
export async function getCurrentSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = token ? verifySession(token) : null;
  return (payload && typeof payload === "object" && (payload as any).sid) || null;
}

// ---- unified "who is signed in" check (our cookie OR NextAuth/Google) ----

// A subscription counts as active only if the flag is set AND (there's no
// expiry date, or the expiry date hasn't passed yet). Centralized here so
// every caller (page or API route) applies the exact same rule.
function withSubscriptionStatus(row: any) {
  if (!row) return row;
  const notExpired =
    !row.subscription_expires_at || new Date(row.subscription_expires_at) > new Date();
  let seenAchievements: string[] = [];
  try {
    seenAchievements = JSON.parse(row.seen_achievements || "[]");
  } catch {
    seenAchievements = [];
  }
  return {
    ...row,
    avatarUrl: row.avatar_url || null,
    subscriptionActive: Boolean(row.subscription_active) && notExpired,
    // How many weekly mock-test slots this membership includes (set by an
    // admin — see /admin/members and /admin/mock-test). Null/0 means no
    // admin override yet; the dashboard applies its own default in that
    // case rather than assuming a number here.
    subscriptionWeeks: row.subscription_weeks != null ? Number(row.subscription_weeks) : null,
    // Plan tier the account is currently on ('starter' | 'pro' | 'dedicated'),
    // or null if never granted a plan. Only meaningful together with
    // subscriptionActive — see hasProAccess() in lib/plans.ts, which is
    // the single place that decides what an expired/no-plan account can
    // access, rather than every caller re-deriving it.
    plan: row.plan ?? null,
    emailRemindersEnabled:
      row.email_reminders_enabled === undefined || row.email_reminders_enabled === null
        ? true
        : Boolean(row.email_reminders_enabled),
    seenAchievements,
    achievementsInitialized: Boolean(row.achievements_initialized),
  };
}

/**
 * Call from a server component or Route Handler. Returns the user row
 * ({ id, email, name, subscriptionActive, ... }) if signed in via either
 * method, otherwise null (or the dev test user — see below).
 */
export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const payload = token ? verifySession(token) : null;

  if (payload && typeof payload === "object") {
    const sid = (payload as any).sid as string | undefined;
    const userId = (payload as any).sub as string;
    const db = await getDb();

    if (sid) {
      // Revocation check (see comment above) + the user fetch used to be
      // two separate round trips to the database on every single
      // authenticated request site-wide. Since a row is only returned
      // when BOTH the session still exists AND the user still exists,
      // one JOIN does the same check in one round trip. If this returns
      // nothing, the session was revoked — hard stop, same as before,
      // deliberately not falling back to check a Google/NextAuth session
      // in the same request.
      const res = await db.execute({
        sql: `
          SELECT u.id, u.email, u.name, u.avatar_url, u.subscription_active, u.subscription_expires_at,
                 u.subscription_weeks, u.plan, u.email_reminders_enabled, u.seen_achievements, u.achievements_initialized
          FROM users u
          JOIN user_sessions s ON s.user_id = u.id
          WHERE u.id = ? AND s.id = ?
        `,
        args: [userId, sid],
      });
      if (res.rows[0]) return withSubscriptionStatus(res.rows[0]);
      return null;
    }

    // Grandfathered token with no sid (issued before revocation existed) —
    // no session row to check against, just fetch the user directly.
    const res = await db.execute({
      sql: "SELECT id, email, name, avatar_url, subscription_active, subscription_expires_at, subscription_weeks, plan, email_reminders_enabled, seen_achievements, achievements_initialized FROM users WHERE id = ?",
      args: [userId],
    });
    if (res.rows[0]) return withSubscriptionStatus(res.rows[0]);
  }

  // Fall back to a Google (NextAuth) session.
  const nextAuthSession = await getServerSession(authOptions);
  if (nextAuthSession?.user?.dbId) {
    const db = await getDb();
    const res = await db.execute({
      sql: "SELECT id, email, name, avatar_url, subscription_active, subscription_expires_at, subscription_weeks, plan, email_reminders_enabled, seen_achievements, achievements_initialized FROM users WHERE id = ?",
      args: [nextAuthSession.user.dbId],
    });
    if (res.rows[0]) return withSubscriptionStatus(res.rows[0]);
  }

  // ⚠️ TEMPORARY TESTING SWITCH ⚠️
  // No real session found — but while bypassing, hand back a standing
  // "dev tester" account instead of null, so every page that would
  // otherwise redirect to /login just works with no sign-in step at all.
  // It's a real row in the users table (auto-created once, subscription
  // OFF by default) so foreign keys like attempts/payment_claims still
  // work normally, and the paywall behaves exactly like a real account.
  if (BYPASS_LOGIN) {
    return withSubscriptionStatus(await getOrCreateDevTestUser());
  }

  return null;
}

async function getOrCreateDevTestUser() {
  const db = await getDb();
  const email = "dev-tester@local.test";
  const existing = await db.execute({
    sql: "SELECT id, email, name, avatar_url, subscription_active, subscription_expires_at, subscription_weeks, plan, email_reminders_enabled, seen_achievements, achievements_initialized FROM users WHERE email = ?",
    args: [email],
  });
  if (existing.rows[0]) return existing.rows[0];

  await db.execute({
    sql: "INSERT INTO users (email, name, subscription_active) VALUES (?, ?, 0)",
    args: [email, "Dev Tester"],
  });
  const created = await db.execute({
    sql: "SELECT id, email, name, avatar_url, subscription_active, subscription_expires_at, subscription_weeks, plan, email_reminders_enabled, seen_achievements, achievements_initialized FROM users WHERE email = ?",
    args: [email],
  });
  return created.rows[0];
}

// ---- password-reset tokens ----
// We only ever store a hash of the token, never the token itself — the
// same principle as passwords. The emailed link contains the raw token.

export function createResetToken() {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  return { rawToken, tokenHash, expiresAt: expiresAt.toISOString() };
}

export function hashResetToken(rawToken: string) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
