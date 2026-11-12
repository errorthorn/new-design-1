// lib/api-auth.ts
//
// Every member-only API route repeated the same two checks:
//   1. is someone signed in at all? (getCurrentUser())
//   2. do they have an active Speaking Club subscription?
// with the same shape of 401/403 response each time. Centralized here so
// the check itself lives in one place — the error *text* still varies by
// route on purpose (some routes are Bangla-facing, like the rest of the
// validation messages in that same file; some are English), so callers
// can override it, but the mechanism (and the response shape) is now
// standardized.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasProAccess } from "@/lib/plans";

type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const DEFAULT_LOGIN_MESSAGE = "Please log in first.";
const DEFAULT_SUBSCRIPTION_MESSAGE = "Speaking Club subscription is not active.";
const DEFAULT_PRO_MESSAGE = "This is a Pro-plan feature — upgrade your membership to unlock it.";

type AuthResult =
  | { user: CurrentUser; response: null }
  | { user: null; response: NextResponse };

/**
 * Call at the top of any signed-in-only Route Handler:
 *
 *   const { user, response } = await requireUser();
 *   if (!user) return response;
 *
 * Returns the current user, or a 401 NextResponse if no one is signed in.
 */
export async function requireUser(
  message: string = DEFAULT_LOGIN_MESSAGE
): Promise<AuthResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, response: NextResponse.json({ error: message }, { status: 401 }) };
  }
  return { user, response: null };
}

/**
 * Same as requireUser(), plus the "Speaking Club subscription active"
 * check every mock-test route also needs.
 *
 *   const { user, response } = await requireActiveMember();
 *   if (!user) return response;
 */
export async function requireActiveMember(
  loginMessage: string = DEFAULT_LOGIN_MESSAGE,
  subscriptionMessage: string = DEFAULT_SUBSCRIPTION_MESSAGE
): Promise<AuthResult> {
  const result = await requireUser(loginMessage);
  if (!result.user) return result;

  if (!result.user.subscriptionActive) {
    return {
      user: null,
      response: NextResponse.json({ error: subscriptionMessage }, { status: 403 }),
    };
  }
  return result;
}

/**
 * Same as requireActiveMember(), plus the Pro-tier check for features that
 * Starter doesn't include (Weekly Live Classes, Class Notes/recordings —
 * see lib/plans.ts). An active Starter member gets a distinct
 * "requiresPlan: 'pro'" 403 rather than the generic "subscription not
 * active" one, so the frontend can point them at an upgrade instead of a
 * fresh signup.
 *
 *   const { user, response } = await requireProMember();
 *   if (!user) return response;
 */
export async function requireProMember(
  loginMessage: string = DEFAULT_LOGIN_MESSAGE,
  subscriptionMessage: string = DEFAULT_SUBSCRIPTION_MESSAGE,
  proMessage: string = DEFAULT_PRO_MESSAGE
): Promise<AuthResult> {
  const result = await requireActiveMember(loginMessage, subscriptionMessage);
  if (!result.user) return result;

  if (!hasProAccess(result.user)) {
    return {
      user: null,
      response: NextResponse.json({ error: proMessage, requiresPlan: "pro" }, { status: 403 }),
    };
  }
  return result;
}
