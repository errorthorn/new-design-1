import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const SELECT_COLUMNS =
  "id, title, description, type, scheduled_at, duration_minutes, meeting_url, video_url, published, position, created_at";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, description, type, scheduled_at, duration_minutes, meeting_url, video_url, published, position } =
    await req.json();

  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = String(title).trim();
  if (description !== undefined) updates.description = description ? String(description).trim() : null;
  if (type !== undefined) updates.type = type === "recorded" ? "recorded" : "live";
  if (scheduled_at !== undefined) {
    updates.scheduled_at = scheduled_at ? new Date(scheduled_at).toISOString() : null;
  }
  if (duration_minutes !== undefined) {
    updates.duration_minutes = duration_minutes ? Number(duration_minutes) : null;
  }
  if (meeting_url !== undefined) updates.meeting_url = meeting_url ? String(meeting_url).trim() : null;
  if (video_url !== undefined) updates.video_url = video_url ? String(video_url).trim() : null;
  if (published !== undefined) updates.published = Boolean(published);
  if (position !== undefined) updates.position = position;

  const { data, error } = await supabaseServer
    .from("classes")
    .update(updates)
    .eq("id", params.id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ class: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { error } = await supabaseServer.from("classes").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
