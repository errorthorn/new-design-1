// app/api/contact/route.js
//
// Powers the form on /contact. No login required — anyone should be able
// to reach out. Doesn't write to a database (there's no "messages" table
// and this doesn't need one) — it just validates and emails the admin via
// the same lib/mailer.js pattern already used for password resets and
// payment claims, with the same graceful fallback (logs to console
// instead of failing if RESEND_API_KEY / ADMIN_NOTIFY_EMAIL aren't set).
import { NextResponse } from "next/server";
import { sendContactMessageEmail } from "@/lib/mailer";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  let body: { name?: string; email?: string; phone?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const phone = (body.phone || "").trim();
  const message = (body.message || "").trim();

  if (!name) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email." }, { status: 400 });
  }
  if (!message || message.length < 10) {
    return NextResponse.json(
      { error: "Please write a bit more detail in the message (at least 10 characters)." },
      { status: 400 }
    );
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "The message is too long." }, { status: 400 });
  }

  try {
    await sendContactMessageEmail({ name, email, phone: phone || null, message });
  } catch (err) {
    console.error("[contact] failed to send notification email:", err);
    return NextResponse.json(
      { error: "Could not send message. Please try again shortly, or call us directly." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
