import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// GET returns every box with its items nested inside (including
// unpublished ones — this is the admin view, unlike the public
// /study-materials page which only ever reads published items).
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data: boxes, error: boxesError } = await supabaseServer
    .from("material_boxes")
    .select("id, title, type, position, created_at")
    .order("position", { ascending: true });

  if (boxesError) {
    return NextResponse.json({ error: boxesError.message }, { status: 500 });
  }

  const { data: items, error: itemsError } = await supabaseServer
    .from("material_items")
    .select("id, box_id, title, body, video_url, file_path, file_name, published, position, created_at")
    .order("position", { ascending: true });

  if (itemsError) {
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const boxesWithItems = (boxes ?? []).map((box) => ({
    ...box,
    items: (items ?? []).filter((item) => item.box_id === box.id),
  }));

  return NextResponse.json({ boxes: boxesWithItems });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, type, position } = await req.json();
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("material_boxes")
    .insert({ title, type: type || "resource", position: position ?? 0 })
    .select("id, title, type, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ box: { ...data, items: [] } });
}
