// app/api/auth/forgot-password/route.js
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createResetToken } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/mailer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();

  // Always return the same generic response whether or not the email
  // exists — this stops someone from using this endpoint to find out
  // which emails have accounts.
  const genericOk = () =>
    NextResponse.json({
      message: "If an account exists for that email, we've sent a reset link.",
    });

  if (!EMAIL_RE.test(email)) return genericOk();

  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT id, password_hash FROM users WHERE email = ?",
    args: [email],
  });
  const user = res.rows[0];

  // Google-only accounts have no password to reset.
  if (!user || !user.password_hash) return genericOk();

  const { rawToken, tokenHash, expiresAt } = createResetToken();

  await db.execute({
    sql: "UPDATE users SET reset_token_hash = ?, reset_token_expires_at = ? WHERE id = ?",
    args: [tokenHash, expiresAt, user.id],
  });

  const origin = request.headers.get("origin") || process.env.NEXTAUTH_URL || "http://localhost:3000";
  const resetUrl = `${origin}/reset-password?token=${rawToken}`;

  try {
    await sendPasswordResetEmail(email, resetUrl);
  } catch (err) {
    console.error("[forgot-password] failed to send email:", err);
    // Still return the generic success message — we don't want to leak
    // whether sending failed due to a bad address vs. a real error.
  }

  return genericOk();
}
