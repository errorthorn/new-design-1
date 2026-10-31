// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { signSession, sessionCookie, createUserSession } from "@/lib/auth";

export async function POST(request: Request) {
  let body: { email?: string; password?: string; remember?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const remember = Boolean(body.remember);

  const invalid = () =>
    NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

  if (!email || !password) return invalid();

  const db = await getDb();
  const res0 = await db.execute({
    sql: "SELECT * FROM users WHERE email = ?",
    args: [email],
  });
  const user = res0.rows[0];
  if (!user) return invalid();

  if (!user.password_hash) {
    // This account was created via Google sign-in and has no password.
    return NextResponse.json(
      { error: "This account uses Google sign-in. Use \"Continue with Google\" instead." },
      { status: 401 }
    );
  }

  const ok = await bcrypt.compare(password, String(user.password_hash));
  if (!ok) return invalid();

  const sid = crypto.randomUUID();
  const token = signSession(
    {
      id: user.id as string | number,
      email: user.email as string,
      name: user.name as string | null,
    },
    sid
  );
  await createUserSession(user.id as string | number, sid, request);

  const res = NextResponse.json({
    user: { id: user.id, email: user.email, name: user.name },
  });
  res.headers.set("Set-Cookie", sessionCookie(token, { remember }));
  return res;
}
