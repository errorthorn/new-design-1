// lib/mailer.ts
//
// Sends email via Resend (https://resend.com — free tier is enough for a
// small app). If RESEND_API_KEY isn't set, we don't fail — we just log the
// email to the console instead, so password reset still works while you're
// developing locally without an email provider set up yet.

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || "LingoCraft <onboarding@resend.dev>";
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL;

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  if (!resend) {
    console.log("\n[mailer] RESEND_API_KEY not set — printing email instead of sending it:");
    console.log(`[mailer] To: ${to}`);
    console.log(`[mailer] Reset link: ${resetUrl}\n`);
    return { simulated: true };
  }

  return resend.emails.send({
    from: FROM,
    to,
    subject: "Reset your LingoCraft password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#2b2b28;">Reset your password</h2>
        <p style="color:#3a3a35; line-height:1.5;">
          We got a request to reset your LingoCraft password. This link is
          valid for 1 hour. If you didn't request this, you can ignore this
          email.
        </p>
        <p style="margin: 28px 0;">
          <a href="${resetUrl}" style="background:#4C9A2A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">
            Reset password
          </a>
        </p>
        <p style="color:#8a8a80; font-size:13px;">
          Or paste this link into your browser:<br>${resetUrl}
        </p>
      </div>
    `,
  });
}

// Notifies the admin that a bKash/Nagad payment claim needs manual review.
// Same graceful fallback as above — no ADMIN_NOTIFY_EMAIL (or no
// RESEND_API_KEY) just logs it to the console instead of failing.
type PaymentClaim = {
  email: string;
  plan: string;
  method: string;
  senderNumber: string;
  trxId: string;
  amount: number;
};

export async function sendPaymentClaimEmail(claim: PaymentClaim) {
  if (!resend || !ADMIN_NOTIFY_EMAIL) {
    console.log("\n[mailer] New payment claim — verify and grant manually at /admin/members:");
    console.log(`[mailer] ${JSON.stringify(claim)}\n`);
    return { simulated: true };
  }

  return resend.emails.send({
    from: FROM,
    to: ADMIN_NOTIFY_EMAIL,
    subject: `New payment claim — ${claim.email}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#2b2b28;">New ${claim.plan} payment claim</h2>
        <table style="width:100%; border-collapse:collapse; color:#3a3a35; font-size:14px;">
          <tr><td style="padding:6px 0; color:#8a8a80;">Account email</td><td>${claim.email}</td></tr>
          <tr><td style="padding:6px 0; color:#8a8a80;">Plan</td><td>${claim.plan}</td></tr>
          <tr><td style="padding:6px 0; color:#8a8a80;">Method</td><td>${claim.method}</td></tr>
          <tr><td style="padding:6px 0; color:#8a8a80;">Sender number</td><td>${claim.senderNumber}</td></tr>
          <tr><td style="padding:6px 0; color:#8a8a80;">Transaction ID</td><td>${claim.trxId}</td></tr>
          <tr><td style="padding:6px 0; color:#8a8a80;">Amount</td><td>৳${claim.amount}</td></tr>
        </table>
        <p style="color:#8a8a80; font-size:13px; margin-top:20px;">
          Verify this in your bKash/Nagad app, then activate it from
          /admin/members.
        </p>
      </div>
    `,
  });
}

// Notifies the admin that someone submitted the /contact form. Same
// graceful fallback as the other functions here — no ADMIN_NOTIFY_EMAIL
// (or no RESEND_API_KEY) just logs it to the console instead of failing,
// so the form still "works" (the message isn't lost, just not emailed)
// while you're developing locally without an email provider set up yet.
type ContactMessage = {
  name: string;
  email: string;
  phone: string | null;
  message: string;
};

// Sent when Phase 5's admin panel reassigns a student — either the
// reactive partner-absent flow (§4.2) or the proactive planned-conflict
// flow (§4.5). Phase 6 (n8n) is still the long-term home for the
// *routine* daily passkey email (§6) — this one function is just Phase
// 5's own "tell them right now, since n8n doesn't exist yet" send, so the
// feature is actually usable before Phase 6 is built. Same graceful
// console-log fallback as everything else in this file.
type ReassignmentNotice = {
  to: string;
  roomCode: string;
  shiftNumber: number;
  passkey: string;
  startTime: string; // "HH:MM:SS"
  endTime: string;
  asThirdPerson: boolean;
};

function formatTime12h(hhmmss: string): string {
  const [h, m] = hhmmss.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

const N8N_REASSIGNMENT_WEBHOOK_URL = process.env.N8N_REASSIGNMENT_WEBHOOK_URL;
const N8N_REASSIGNMENT_WEBHOOK_SECRET = process.env.N8N_REASSIGNMENT_WEBHOOK_SECRET;

/**
 * Phase 6 (plan §6 / §4.4) — hands a reassignment notification off to n8n
 * instead of sending it directly, when N8N_REASSIGNMENT_WEBHOOK_URL is
 * configured. This is the notification's actual long-term home per the
 * plan (§4.4: "Notification (telling the student) → n8n, its strength —
 * email automation") — sendSpeakingClubReassignmentEmail() below is
 * Phase 5's direct-send fallback, which keeps working with zero n8n setup
 * (same graceful-degrade pattern as every other function in this file).
 * See PHASE6-N8N-SETUP.md for the n8n workflow this POSTs to.
 *
 * Returns true if n8n accepted the hand-off (caller must NOT also call
 * sendSpeakingClubReassignmentEmail — that would double-send the
 * student), or false if no webhook is configured, or the call itself
 * failed, in which case the caller should fall back to sending directly.
 */
export async function notifyReassignmentViaN8n(notice: ReassignmentNotice): Promise<boolean> {
  if (!N8N_REASSIGNMENT_WEBHOOK_URL) return false;
  try {
    const res = await fetch(N8N_REASSIGNMENT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(N8N_REASSIGNMENT_WEBHOOK_SECRET ? { "x-webhook-secret": N8N_REASSIGNMENT_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(notice),
    });
    if (!res.ok) {
      console.error(`[mailer] n8n webhook responded ${res.status} — falling back to direct send`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[mailer] n8n webhook call failed — falling back to direct send:", err);
    return false;
  }
}

export async function sendSpeakingClubReassignmentEmail(notice: ReassignmentNotice) {
  const windowText = `${formatTime12h(notice.startTime)}–${formatTime12h(notice.endTime)}`;
  if (!resend) {
    console.log("\n[mailer] Speaking Club reassignment — printing instead of sending:");
    console.log(`[mailer] ${JSON.stringify(notice)}\n`);
    return { simulated: true };
  }

  return resend.emails.send({
    from: FROM,
    to: notice.to,
    subject: `Your Speaking Club room changed — ${notice.roomCode}, Shift ${notice.shiftNumber}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#2b2b28;">Your Speaking Club room has changed</h2>
        <p style="color:#3a3a35; line-height:1.5;">
          ${
            notice.asThirdPerson
              ? "Your original partner wasn't able to join today, so we've added you to an active session with another pair for this shift."
              : "Your original partner wasn't able to join today, so we've moved you to a different room for this shift."
          }
        </p>
        <table style="width:100%; border-collapse:collapse; color:#3a3a35; font-size:14px; margin:20px 0;">
          <tr><td style="padding:6px 0; color:#8a8a80;">Room</td><td>${notice.roomCode}</td></tr>
          <tr><td style="padding:6px 0; color:#8a8a80;">Shift</td><td>Shift ${notice.shiftNumber} (${windowText})</td></tr>
          <tr><td style="padding:6px 0; color:#8a8a80;">Passkey</td><td><b>${notice.passkey}</b></td></tr>
        </table>
        <p style="color:#8a8a80; font-size:13px;">
          Enter this passkey on your Speaking Club dashboard during the shift window above.
        </p>
      </div>
    `,
  });
}

export async function sendContactMessageEmail(message: ContactMessage) {
  if (!resend || !ADMIN_NOTIFY_EMAIL) {
    console.log("\n[mailer] New contact form message:");
    console.log(`[mailer] ${JSON.stringify(message)}\n`);
    return { simulated: true };
  }

  return resend.emails.send({
    from: FROM,
    to: ADMIN_NOTIFY_EMAIL,
    replyTo: message.email,
    subject: `New contact form message — ${message.name}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color:#2b2b28;">New message from the Contact page</h2>
        <table style="width:100%; border-collapse:collapse; color:#3a3a35; font-size:14px;">
          <tr><td style="padding:6px 0; color:#8a8a80; vertical-align:top;">Name</td><td>${message.name}</td></tr>
          <tr><td style="padding:6px 0; color:#8a8a80; vertical-align:top;">Email</td><td>${message.email}</td></tr>
          ${message.phone ? `<tr><td style="padding:6px 0; color:#8a8a80; vertical-align:top;">Phone</td><td>${message.phone}</td></tr>` : ""}
        </table>
        <p style="color:#8a8a80; font-size:13px; margin-top:20px; margin-bottom:4px;">Message</p>
        <p style="color:#3a3a35; line-height:1.6; white-space:pre-wrap;">${message.message}</p>
      </div>
    `,
  });
}
