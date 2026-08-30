import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const SELECT_COLUMNS = "id, title, description, content, file_url, published, position, created_at";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, description, content, file_url, published, position } = await req.json();

  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = String(title).trim();
  if (description !== undefined) updates.description = description ? String(description).trim() : null;
  if (content !== undefined) updates.content = content ? String(content).trim() : null;
  if (file_url !== undefined) updates.file_url = file_url ? String(file_url).trim() : null;
  if (published !== undefined) updates.published = Boolean(published);
  if (position !== undefined) updates.position = position;

  const { data, error } = await supabaseServer
    .from("class_notes")
    .update(updates)
    .eq("id", params.id)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ note: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { error } = await supabaseServer.from("class_notes").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
