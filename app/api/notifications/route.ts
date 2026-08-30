import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getNotifications, getUnreadCount } from "@/lib/notifications";

// Powers the bell icon in the dashboard header — returns this student's
// most recent notifications plus an unread count for the badge dot.
export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const [notifications, unreadCount] = await Promise.all([
    getNotifications(user.email),
    getUnreadCount(user.email),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
