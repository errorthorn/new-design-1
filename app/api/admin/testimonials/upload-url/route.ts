import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// Step 1: mint a signed upload URL, same two-step flow as
// /api/admin/material-items/upload-url — the admin's browser PUTs the photo
// straight to Supabase Storage, it never passes through this function.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const testimonialId = req.nextUrl.searchParams.get("testimonialId");
  const fileName = req.nextUrl.searchParams.get("fileName");
  if (!testimonialId || !fileName) {
    return NextResponse.json({ error: "testimonialId and fileName are required" }, { status: 400 });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `${testimonialId}/${Date.now()}-${safeName}`;

  const { data, error } = await supabaseServer.storage
    .from("testimonial-avatars")
    .createSignedUploadUrl(path);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ path: data.path, token: data.token });
}

// Step 2: after the browser's direct PUT succeeds, record the photo on the
// testimonial row (replacing/deleting any previous photo for that row).
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { testimonialId, path } = await req.json();
  if (!testimonialId || !path) {
    return NextResponse.json({ error: "testimonialId and path are required" }, { status: 400 });
  }

  const { data: existing } = await supabaseServer
    .from("testimonials")
    .select("avatar_path")
    .eq("id", testimonialId)
    .maybeSingle();

  if (existing?.avatar_path && existing.avatar_path !== path) {
    await supabaseServer.storage.from("testimonial-avatars").remove([existing.avatar_path]);
  }

  const { data, error } = await supabaseServer
    .from("testimonials")
    .update({ avatar_path: path })
    .eq("id", testimonialId)
    .select("id, name, role, quote, avatar_path, published, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    testimonial: {
      ...data,
      avatar_url: supabaseServer.storage.from("testimonial-avatars").getPublicUrl(path).data
        .publicUrl,
    },
  });
}
