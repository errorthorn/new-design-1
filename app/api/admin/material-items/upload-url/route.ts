import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// Step 1: mint a signed upload URL, same two-step flow as
// /api/mock-test/upload-audio — the admin's browser PUTs the PDF straight
// to Supabase Storage, it never passes through this Next.js function.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const itemId = req.nextUrl.searchParams.get("itemId");
  const fileName = req.nextUrl.searchParams.get("fileName");
  if (!itemId || !fileName) {
    return NextResponse.json({ error: "itemId and fileName are required" }, { status: 400 });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `items/${itemId}/${Date.now()}-${safeName}`;

  const { data, error } = await supabaseServer.storage
    .from("study-materials")
    .createSignedUploadUrl(path);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}

// Step 2: after the browser's direct PUT succeeds, record the file on the
// item row (replacing any previous file for that item).
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { itemId, path, fileName } = await req.json();
  if (!itemId || !path) {
    return NextResponse.json({ error: "itemId and path are required" }, { status: 400 });
  }

  const { data: existing } = await supabaseServer
    .from("material_items")
    .select("file_path")
    .eq("id", itemId)
    .maybeSingle();

  if (existing?.file_path && existing.file_path !== path) {
    await supabaseServer.storage.from("study-materials").remove([existing.file_path]);
  }

  const { data, error } = await supabaseServer
    .from("material_items")
    .update({ file_path: path, file_name: fileName || null })
    .eq("id", itemId)
    .select("id, box_id, title, body, video_url, file_path, file_name, published, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ item: data });
}
