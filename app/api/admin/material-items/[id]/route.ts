import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, body, video_url, published, position } = await req.json();
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (body !== undefined) updates.body = body || null;
  if (video_url !== undefined) updates.video_url = video_url || null;
  if (published !== undefined) updates.published = published;
  if (position !== undefined) updates.position = position;

  const { data, error } = await supabaseServer
    .from("material_items")
    .update(updates)
    .eq("id", params.id)
    .select("id, box_id, title, body, video_url, file_path, file_name, published, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data: item } = await supabaseServer
    .from("material_items")
    .select("file_path")
    .eq("id", params.id)
    .maybeSingle();

  if (item?.file_path) {
    await supabaseServer.storage.from("study-materials").remove([item.file_path]);
  }

  const { error } = await supabaseServer.from("material_items").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
