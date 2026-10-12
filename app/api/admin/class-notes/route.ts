import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const SELECT_COLUMNS = "id, title, description, content, file_url, published, position, created_at";

// GET returns every note (published or not — this is the admin view),
// ordered the way the admin panel lists them. Mirrors /api/admin/classes.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data, error } = await supabaseServer
    .from("class_notes")
    .select(SELECT_COLUMNS)
    .order("position", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, description, content, file_url, position } = await req.json();

  if (!title || !String(title).trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("class_notes")
    .insert({
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      content: content ? String(content).trim() : null,
      file_url: file_url ? String(file_url).trim() : null,
      position: position ?? 0,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ note: data });
}
