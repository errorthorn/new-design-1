import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

// Public, unauthenticated — merges real Google reviews (via
// /api/google-reviews) with published member testimonials (managed at
// /admin/testimonials) into one list for the homepage marquee. Only entries
// actually sourced from Google carry source: "google" (and get the Google
// badge on the card) — member entries are never mislabeled as Google
// reviews.
async function fetchMemberTestimonials() {
  const { data, error } = await supabaseServer
    .from("testimonials")
    .select("id, name, role, quote, avatar_path, rating, position")
    .eq("published", true)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function GET(req: NextRequest) {
  const [googleResult, memberResult] = await Promise.allSettled([
    fetch(new URL("/api/google-reviews", req.url)).then((r) => (r.ok ? r.json() : { reviews: [] })),
    fetchMemberTestimonials(),
  ]);

  const googleReviews =
    googleResult.status === "fulfilled" ? googleResult.value.reviews ?? [] : [];

  const memberRows = memberResult.status === "fulfilled" ? memberResult.value : [];

  const memberReviews = memberRows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    quote: row.quote,
    rating: row.rating ?? 5,
    avatar: row.avatar_path
      ? supabaseServer.storage.from("testimonial-avatars").getPublicUrl(row.avatar_path).data
          .publicUrl
      : null,
    source: "member" as const,
  }));

  return NextResponse.json({
    testimonials: [...googleReviews, ...memberReviews],
    googleSummary:
      googleResult.status === "fulfilled" && googleResult.value.overallRating
        ? {
            rating: googleResult.value.overallRating,
            total: googleResult.value.totalReviews,
          }
        : null,
  });
}

