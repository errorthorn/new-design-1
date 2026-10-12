// app/api/profile/route.js
//
// Powers the /profile page. Separate from /api/auth/me (which the navbar
// polls on every page and deliberately stays lean) because this route also
// needs a couple of fields /api/auth/me has no reason to expose:
// whether a password is set (so the page can offer "change" vs "set a
// password" for Google-only accounts) and when the account was created.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { clearSessionCookie } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

const NOT_LOGGED_IN = "Not logged in.";

// Resized/compressed client-side before it ever gets here (see the upload
// handler in app/profile/page.tsx) — this is just a hard server-side
// backstop so a stored avatar can never bloat the users table.
const MAX_AVATAR_DATA_URL_LENGTH = 1_500_000; // ~1.1MB of actual image data
const AVATAR_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp);base64,/;

export async function GET() {
  const { user, response } = await requireUser(NOT_LOGGED_IN);
  if (!user) return response!;

  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT password_hash, google_id, created_at FROM users WHERE id = ?",
    args: [user.id],
  });
  const row = res.rows[0];

  return NextResponse.json({
    profile: {
      id: user.id,
      email: user.email,
      name: user.name || "",
      avatarUrl: user.avatarUrl,
      subscriptionActive: user.subscriptionActive,
      subscriptionExpiresAt: user.subscription_expires_at ?? null,
      hasPassword: Boolean(row?.password_hash),
      googleLinked: Boolean(row?.google_id),
      memberSince: row?.created_at ?? null,
      emailRemindersEnabled: user.emailRemindersEnabled,
      seenAchievements: user.seenAchievements,
      achievementsInitialized: user.achievementsInitialized,
    },
  });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireUser(NOT_LOGGED_IN);
  if (!user) return response!;

  let body: {
    name?: string;
    avatarUrl?: string | null;
    emailRemindersEnabled?: boolean;
    seenAchievements?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const updates: string[] = [];
  const args: (string | number)[] = [];

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) {
      return NextResponse.json({ error: "Name cannot be left empty." }, { status: 400 });
    }
    if (name.length > 80) {
      return NextResponse.json({ error: "Name is too long." }, { status: 400 });
    }
    updates.push("name = ?");
    args.push(name);
  }

  // avatarUrl: string data-URL to set a new picture, or null to remove the
  // current one and fall back to the initials avatar (or, for Google
  // accounts, whatever Google's picture syncs back to on next sign-in).
  if ("avatarUrl" in body) {
    if (body.avatarUrl === null) {
      updates.push("avatar_url = NULL");
    } else if (typeof body.avatarUrl === "string") {
      const dataUrl = body.avatarUrl;
      if (!AVATAR_DATA_URL_RE.test(dataUrl)) {
        return NextResponse.json({ error: "This image format is not supported." }, { status: 400 });
      }
      if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH) {
        return NextResponse.json(
          { error: "The image is too large. Please try a smaller image." },
          { status: 400 }
        );
      }
      updates.push("avatar_url = ?");
      args.push(dataUrl);
    } else {
      return NextResponse.json({ error: "Invalid avatarUrl." }, { status: 400 });
    }
  }

  if (typeof body.emailRemindersEnabled === "boolean") {
    updates.push("email_reminders_enabled = ?");
    args.push(body.emailRemindersEnabled ? 1 : 0);
  }

  // Achievement "seen" state — written whenever the client recomputes
  // which badges are unlocked (see app/profile/page.tsx). Writing this
  // always also marks achievements_initialized, since the only caller of
  // this field is that recompute effect.
  if (Array.isArray(body.seenAchievements)) {
    const clean = body.seenAchievements.filter((x): x is string => typeof x === "string").slice(0, 50);
    updates.push("seen_achievements = ?");
    args.push(JSON.stringify(clean));
    updates.push("achievements_initialized = 1");
  }

  if (!updates.length) {
    return NextResponse.json({ error: "Nothing found to change." }, { status: 400 });
  }

  const db = await getDb();
  args.push(user.id);
  await db.execute({
    sql: `UPDATE users SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  return NextResponse.json({ ok: true });
}

// Permanently deletes the account. Requires the person to re-type their
// own email as { confirmEmail } in the body — a lightweight but real
// guard against a stray click or a compromised/left-open session doing
// something irreversible.
//
// Cascades: the libSQL `users` row and any `payment_claims`/`user_sessions`
// rows are deleted outright. On the Supabase side, the matching `students`
// row (linked by user_email) is deleted, which cascades to
// `mock_test_attempts` automatically (on delete cascade, see schema.sql).
// NOTE: this does NOT delete the underlying audio files already sitting in
// the `mock-test-audio` Storage bucket for those attempts — Storage object
// deletion needs a separate Supabase Storage API call per file, which
// isn't wired up yet. Flagging this as a known gap rather than silently
// leaving orphaned recordings unmentioned.
export async function DELETE(request: Request) {
  const { user, response } = await requireUser(NOT_LOGGED_IN);
  if (!user) return response!;

  let body: { confirmEmail?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (
    !body.confirmEmail ||
    body.confirmEmail.trim().toLowerCase() !== String(user.email).toLowerCase()
  ) {
    return NextResponse.json(
      { error: "Email doesn't match — please type your account email exactly to confirm." },
      { status: 400 }
    );
  }

  const db = await getDb();
  await db.execute({ sql: "DELETE FROM user_sessions WHERE user_id = ?", args: [user.id] });
  await db.execute({ sql: "DELETE FROM payment_claims WHERE user_id = ?", args: [user.id] });
  await db.execute({ sql: "DELETE FROM users WHERE id = ?", args: [user.id] });

  try {
    // Best-effort — the account deletion itself (above) already succeeded
    // and is the irreversible, important part. If Supabase is briefly
    // unreachable, the person's login is already gone either way; a
    // leftover `students` row with no matching login isn't a security
    // issue, just cleanup debt.
    await supabaseServer.from("students").delete().eq("user_email", user.email);
  } catch (err) {
    console.error("Failed to delete Supabase student data on account deletion:", err);
  }

  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", clearSessionCookie());
  res.headers.append("Set-Cookie", "next-auth.session-token=; Path=/; HttpOnly; Max-Age=0");
  res.headers.append(
    "Set-Cookie",
    "__Secure-next-auth.session-token=; Path=/; HttpOnly; Max-Age=0; Secure"
  );
  return res;
}
