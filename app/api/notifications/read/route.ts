import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { markAllNotificationsRead, markNotificationRead } from "@/lib/notifications";

// Body: { id: number } marks one notification read (used when a student
// taps a specific one); an empty/omitted body marks everything read (used
// by the "Mark all as read" link and when the bell dropdown is opened).
export async function POST(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const body = await req.json().catch(() => ({}) as { id?: number });

  if (body?.id) {
    await markNotificationRead(Number(body.id), user.email);
  } else {
    await markAllNotificationsRead(user.email);
  }

  return NextResponse.json({ ok: true });
}
