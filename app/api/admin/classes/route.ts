import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const SELECT_COLUMNS =
  "id, title, description, type, scheduled_at, duration_minutes, meeting_url, video_url, published, position, created_at";

// GET returns every class (published or not — this is the admin view),
// regardless of type, ordered the way the admin panel lists them.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data, error } = await supabaseServer
    .from("classes")
    .select(SELECT_COLUMNS)
    .order("position", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ classes: data ?? [] });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, description, type, scheduled_at, duration_minutes, meeting_url, video_url, position } =
    await req.json();

  if (!title || !String(title).trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const classType = type === "recorded" ? "recorded" : "live";

  const { data, error } = await supabaseServer
    .from("classes")
    .insert({
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      type: classType,
      scheduled_at: scheduled_at ? new Date(scheduled_at).toISOString() : null,
      duration_minutes: duration_minutes ? Number(duration_minutes) : null,
      meeting_url: meeting_url ? String(meeting_url).trim() : null,
      video_url: video_url ? String(video_url).trim() : null,
      position: position ?? 0,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ class: data });
}
