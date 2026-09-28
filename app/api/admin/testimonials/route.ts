import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

function withAvatarUrl(row: {
  id: string;
  name: string;
  role: string | null;
  quote: string;
  avatar_path: string | null;
  rating: number;
  published: boolean;
  position: number;
  created_at: string;
}) {
  return {
    ...row,
    avatar_url: row.avatar_path
      ? supabaseServer.storage.from("testimonial-avatars").getPublicUrl(row.avatar_path).data
          .publicUrl
      : null,
  };
}

// GET returns every testimonial, published or not — this is the admin view.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data, error } = await supabaseServer
    .from("testimonials")
    .select("id, name, role, quote, avatar_path, rating, published, position, created_at")
    .order("position", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ testimonials: (data ?? []).map(withAvatarUrl) });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { name, role, quote, rating, published, position } = await req.json();
  if (!name || !quote) {
    return NextResponse.json({ error: "name and quote are required" }, { status: 400 });
  }
  const clampedRating = Math.min(5, Math.max(1, Number(rating) || 5));

  const { data, error } = await supabaseServer
    .from("testimonials")
    .insert({
      name,
      role: role || null,
      quote,
      rating: clampedRating,
      published: published ?? true,
      position: position ?? 0,
    })
    .select("id, name, role, quote, avatar_path, rating, published, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ testimonial: withAvatarUrl(data) });
}
