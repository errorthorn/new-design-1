// app/api/auth/logout/route.js
import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentSessionId } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function POST() {
  const sid = await getCurrentSessionId();
  if (sid) {
    const db = await getDb();
    await db.execute({ sql: "DELETE FROM user_sessions WHERE id = ?", args: [sid] });
  }

  const res = NextResponse.json({ ok: true });

  // Clear our own email/password session cookie...
  res.headers.append("Set-Cookie", clearSessionCookie());

  // ...and NextAuth's cookie too, in case the person signed in with Google.
  // (Covers both the plain and the __Secure- prefixed name NextAuth uses
  // over HTTPS in production.)
  res.headers.append("Set-Cookie", "next-auth.session-token=; Path=/; HttpOnly; Max-Age=0");
  res.headers.append("Set-Cookie", "__Secure-next-auth.session-token=; Path=/; HttpOnly; Max-Age=0; Secure");

  return res;
}
