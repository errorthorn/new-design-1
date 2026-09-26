import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireProMember } from "@/lib/api-auth";

// Members only see published classes, split the same way the dashboard UI
// renders them: upcoming live sessions (scheduled_at in the future) and
// recordings, each sorted the way a student would actually want to scan
// them — soonest-first for upcoming, most-recent-first for recordings.
// Weekly Live Classes + recordings are a Pro-only line item (see
// lib/plans.ts) — a Starter member is active but not Pro, so this checks
// both rather than just requireActiveMember.
export async function GET() {
  const { user, response } = await requireProMember(
    undefined,
    undefined,
    "Live classes and recordings are part of the Pro plan — upgrade to unlock them."
  );
  if (!user) return response!;

  const { data, error } = await supabaseServer
    .from("classes")
    .select("id, title, description, type, scheduled_at, duration_minutes, meeting_url, video_url, position")
    .eq("published", true)
    .order("position", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const now = Date.now();

  const upcoming = rows
    .filter((c) => c.type === "live" && (!c.scheduled_at || new Date(c.scheduled_at).getTime() >= now))
    .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

  const past = rows
    .filter((c) => c.type === "live" && c.scheduled_at && new Date(c.scheduled_at).getTime() < now)
    .sort((a, b) => (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? ""));

  const recordings = rows
    .filter((c) => c.type === "recorded")
    .sort((a, b) => (b.scheduled_at ?? "").localeCompare(a.scheduled_at ?? ""));

  return NextResponse.json({ upcoming, past, recordings });
}
