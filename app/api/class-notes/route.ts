import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireProMember } from "@/lib/api-auth";

// Members only see published notes, newest-authored-position first — same
// gating pattern as /api/classes (requireProMember, service-role read).
// "Recorded Classes and Slide PDFs" is a Pro-only line item (see
// lib/plans.ts), so this needs the Pro check, not just an active sub.
export async function GET() {
  const { user, response } = await requireProMember(
    undefined,
    undefined,
    "Class notes are part of the Pro plan — upgrade to unlock them."
  );
  if (!user) return response!;

  const { data, error } = await supabaseServer
    .from("class_notes")
    .select("id, title, description, content, file_url, position, created_at")
    .eq("published", true)
    .order("position", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: data ?? [] });
}
