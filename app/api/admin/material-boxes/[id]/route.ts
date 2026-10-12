import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, type, position } = await req.json();
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (type !== undefined) updates.type = type;
  if (position !== undefined) updates.position = position;

  const { data, error } = await supabaseServer
    .from("material_boxes")
    .update(updates)
    .eq("id", params.id)
    .select("id, title, type, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ box: data });
}

// Deleting a box cascades to its items (on delete cascade in schema.sql),
// but the actual files those items point at in Storage are orphaned unless
// we clean them up here first.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data: items } = await supabaseServer
    .from("material_items")
    .select("file_path")
    .eq("box_id", params.id);

  const paths = (items ?? []).map((i) => i.file_path).filter(Boolean) as string[];
  if (paths.length > 0) {
    await supabaseServer.storage.from("study-materials").remove(paths);
  }

  const { error } = await supabaseServer.from("material_boxes").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
