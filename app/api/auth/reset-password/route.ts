// app/api/auth/reset-password/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/db";
import { hashResetToken, signSession, sessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  let body: { token?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const token = body.token || "";
  const password = body.password || "";

  if (!token) {
    return NextResponse.json({ error: "Missing reset token." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  const tokenHash = hashResetToken(token);
  const db = await getDb();

  const res = await db.execute({
    sql: "SELECT id, email, name, reset_token_expires_at FROM users WHERE reset_token_hash = ?",
    args: [tokenHash],
  });
  const user = res.rows[0];

  if (!user) {
    return NextResponse.json({ error: "This reset link is invalid. Request a new one." }, { status: 400 });
  }
  if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at as string) < new Date()) {
    return NextResponse.json({ error: "This reset link has expired. Request a new one." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await db.execute({
    sql: "UPDATE users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = ?",
    args: [passwordHash, user.id],
  });

  // Sign the person in right away, so they land in the app instead of
  // having to log in again immediately after resetting their password.
  const sessionToken = signSession({
    id: user.id as string | number,
    email: user.email as string,
    name: user.name as string | null,
  });
  const out = NextResponse.json({ ok: true });
  out.headers.set("Set-Cookie", sessionCookie(sessionToken));
  return out;
}
