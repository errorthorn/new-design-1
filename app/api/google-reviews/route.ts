import { NextResponse } from "next/server";

// Pulls real reviews from your Google Business Profile via the official
// Google Places API (Place Details, fields=reviews). Requires two env vars:
//   GOOGLE_PLACES_API_KEY  — from Google Cloud Console (Places API enabled)
//   GOOGLE_PLACE_ID        — your business's Place ID (find it at
//                            https://developers.google.com/maps/documentation/places/web-service/place-id)
//
// Important, honest limitation: Google's official API returns at most 5
// reviews per place, chosen by Google as "most relevant" — there's no way
// to request more or choose which 5. Sites that show more than 5 are using
// unofficial scraping methods that violate Google's Terms of Service; this
// route deliberately doesn't do that.
//
// Cached for 6 hours (Next.js fetch cache) so normal traffic doesn't burn
// through the Places API quota — Google's free monthly credit comfortably
// covers a cache refreshed a few times a day.
export async function GET() {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;

  if (!apiKey || !placeId) {
    // Not configured yet — return an empty list rather than an error so the
    // homepage marquee just falls back to member testimonials.
    return NextResponse.json({ reviews: [] });
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    url.searchParams.set("place_id", placeId);
    url.searchParams.set("fields", "reviews,rating,user_ratings_total");
    url.searchParams.set("reviews_no_translations", "true");
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString(), { next: { revalidate: 21600 } }); // 6h
    const data = await res.json();

    if (data.status !== "OK" || !data.result?.reviews) {
      return NextResponse.json({ reviews: [] });
    }

    const reviews = data.result.reviews.map(
      (r: {
        author_name: string;
        profile_photo_url: string;
        rating: number;
        relative_time_description: string;
        text: string;
        time: number;
      }) => ({
        name: r.author_name,
        avatar: r.profile_photo_url,
        rating: r.rating,
        relativeTime: r.relative_time_description,
        quote: r.text,
        source: "google" as const,
        sortKey: r.time,
      })
    );

    return NextResponse.json({
      reviews,
      overallRating: data.result.rating ?? null,
      totalReviews: data.result.user_ratings_total ?? null,
    });
  } catch {
    return NextResponse.json({ reviews: [] });
  }
}
