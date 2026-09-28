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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const key of ["name", "role", "quote", "rating", "published", "position"] as const) {
    if (key in body) {
      update[key] = key === "rating" ? Math.min(5, Math.max(1, Number(body[key]) || 5)) : body[key];
    }
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("testimonials")
    .update(update)
    .eq("id", params.id)
    .select("id, name, role, quote, avatar_path, rating, published, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ testimonial: withAvatarUrl(data) });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data: existing } = await supabaseServer
    .from("testimonials")
    .select("avatar_path")
    .eq("id", params.id)
    .maybeSingle();

  if (existing?.avatar_path) {
    await supabaseServer.storage.from("testimonial-avatars").remove([existing.avatar_path]);
  }

  const { error } = await supabaseServer.from("testimonials").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
