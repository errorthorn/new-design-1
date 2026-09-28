import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, description, time_limit_minutes, published, position } = await req.json();
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = String(title).trim();
  if (description !== undefined) updates.description = description ? String(description).trim() : null;
  if (time_limit_minutes !== undefined) {
    updates.time_limit_minutes = time_limit_minutes ? Number(time_limit_minutes) : null;
  }
  if (published !== undefined) updates.published = Boolean(published);
  if (position !== undefined) updates.position = position;

  const { data, error } = await supabaseServer
    .from("quizzes")
    .update(updates)
    .eq("id", params.id)
    .select("id, title, description, time_limit_minutes, published, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ quiz: data });
}

// Deleting a quiz cascades to its questions and attempts (on delete
// cascade in schema.sql) — no extra cleanup needed since quizzes never
// point at Storage files.
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { error } = await supabaseServer.from("quizzes").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
