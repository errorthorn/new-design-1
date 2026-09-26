import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { box_id, title, body, video_url, published, position } = await req.json();
  if (!box_id || !title) {
    return NextResponse.json({ error: "box_id and title are required" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("material_items")
    .insert({
      box_id,
      title,
      body: body || null,
      video_url: video_url || null,
      published: published ?? true,
      position: position ?? 0,
    })
    .select("id, box_id, title, body, video_url, file_path, file_name, published, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
