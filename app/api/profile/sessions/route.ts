// app/api/profile/sessions/route.ts
//
// Powers the "Sessions & Devices" card on /profile. Only covers our own
// email/password JWT sessions (see lib/auth.ts) — a Google-signed-in
// session isn't tracked in user_sessions and can't be revoked from here;
// the profile page shows that as a separate, non-revocable line instead.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getCurrentSessionId, listUserSessions, revokeUserSession } from "@/lib/auth";

const NOT_LOGGED_IN = "Not logged in.";

export async function GET() {
  const { user, response } = await requireUser(NOT_LOGGED_IN);
  if (!user) return response!;

  const currentSid = await getCurrentSessionId();
  const rows = await listUserSessions(user.id);

  return NextResponse.json({
    sessions: rows.map((r: any) => ({
      id: r.id,
      deviceLabel: r.device_label || "Unknown device",
      ip: r.ip || null,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      isCurrent: r.id === currentSid,
    })),
  });
}

export async function DELETE(request: Request) {
  const { user, response } = await requireUser(NOT_LOGGED_IN);
  if (!user) return response!;

  let body: { sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const currentSid = await getCurrentSessionId();
  if (body.sessionId === currentSid) {
    return NextResponse.json(
      { error: "This is your current device — use the regular Logout button to sign out of it." },
      { status: 400 }
    );
  }

  await revokeUserSession(user.id, body.sessionId);
  return NextResponse.json({ ok: true });
}
