// app/api/profile/password/route.js
//
// Two cases in one route, same as the rest of this app treats "signed in
// via email or via Google" as one unified thing:
//
// 1. Account already has a password (email/password signup, or a Google
//    account that set one here before) — currentPassword is required and
//    checked with bcrypt, exactly like /api/auth/login does.
// 2. Account signed up with Google only and has never had a password —
//    no currentPassword to check, this just adds one, so the person can
//    from now on *also* log in with email + password.
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";

export async function POST(request: Request) {
  const { user, response } = await requireUser("Not logged in.");
  if (!user) return response!;

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const currentPassword = body.currentPassword || "";
  const newPassword = body.newPassword || "";

  if (newPassword.length < 6) {
    return NextResponse.json(
      { error: "New password must be at least 6 characters." },
      { status: 400 }
    );
  }

  const db = await getDb();
  const res = await db.execute({
    sql: "SELECT password_hash FROM users WHERE id = ?",
    args: [user.id],
  });
  const row = res.rows[0];
  const hadPassword = Boolean(row?.password_hash);

  if (hadPassword) {
    if (!currentPassword) {
      return NextResponse.json({ error: "Please enter your current password." }, { status: 400 });
    }
    const ok = await bcrypt.compare(currentPassword, String(row?.password_hash));
    if (!ok) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
    }
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { error: "New password must be different from the current one." },
        { status: 400 }
      );
    }
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.execute({
    sql: "UPDATE users SET password_hash = ? WHERE id = ?",
    args: [passwordHash, user.id],
  });

  return NextResponse.json({ ok: true, wasSet: !hadPassword });
}
