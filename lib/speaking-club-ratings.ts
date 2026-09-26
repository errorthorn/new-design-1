// lib/speaking-club-ratings.ts
//
// Server-only helpers for the end-of-session quick rating (see the
// speaking_session_ratings table in sql/schema.sql). Same supabaseServer
// (service role) pattern as lib/speaking-club-db.ts — never import this
// into a client component.
import { supabaseServer } from "@/lib/supabase";
import { getDisplayNamesByEmails } from "@/lib/speaking-club-users";
import { dhakaToday } from "@/lib/speaking-club-words";

export const PAIR_AGAIN_VALUES = ["yes", "maybe", "no"] as const;
export type PairAgain = (typeof PAIR_AGAIN_VALUES)[number];

export function isPairAgain(value: unknown): value is PairAgain {
  return typeof value === "string" && (PAIR_AGAIN_VALUES as readonly string[]).includes(value);
}

/**
 * Saves (or updates) this student's rating for today's session on a shift.
 * One row per student per session, so a second submit — e.g. they rated,
 * then the shift ended while the card was still open — overwrites instead
 * of double-counting.
 */
export async function saveSessionRating(params: {
  username: string;
  shiftId: string;
  roomCode: string | null;
  shiftNumber: number | null;
  partnerUsernames: string[];
  rating: number;
  wouldPairAgain: PairAgain | null;
}): Promise<void> {
  const { error } = await supabaseServer.from("speaking_session_ratings").upsert(
    {
      username: params.username,
      shift_id: params.shiftId,
      room_code: params.roomCode,
      shift_number: params.shiftNumber,
      session_date: dhakaToday(),
      partner_usernames: params.partnerUsernames,
      rating: params.rating,
      would_pair_again: params.wouldPairAgain,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "username,session_date,shift_id" }
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Admin Monitoring tab
// ---------------------------------------------------------------------------

export type SessionRatingSummary = {
  total: number;
  /** Mean rating (1-5) rounded to one decimal, or null when there are no ratings yet. */
  average: number | null;
  /** Index 0 = how many gave 1 star … index 4 = how many gave 5. */
  distribution: [number, number, number, number, number];
  pairAgain: { yes: number; maybe: number; no: number; unanswered: number };
  /** Newest low ratings (1-2) or "no, not again" answers — where an admin would look first. */
  needsAttention: {
    id: string;
    raterName: string;
    partnerNames: string[];
    roomCode: string | null;
    shiftNumber: number | null;
    sessionDate: string;
    rating: number;
    wouldPairAgain: PairAgain | null;
    createdAt: string;
  }[];
};

type RawRating = {
  id: string;
  username: string;
  room_code: string | null;
  shift_number: number | null;
  session_date: string;
  partner_usernames: string[] | null;
  rating: number;
  would_pair_again: PairAgain | null;
  created_at: string;
};

export async function getSessionRatingSummary(lookbackDays = 14): Promise<SessionRatingSummary> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabaseServer
    .from("speaking_session_ratings")
    .select("id, username, room_code, shift_number, session_date, partner_usernames, rating, would_pair_again, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;

  const rows = (data ?? []) as RawRating[];
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const pairAgain = { yes: 0, maybe: 0, no: 0, unanswered: 0 };
  let sum = 0;
  for (const r of rows) {
    if (r.rating >= 1 && r.rating <= 5) distribution[r.rating - 1] += 1;
    sum += r.rating;
    if (r.would_pair_again) pairAgain[r.would_pair_again] += 1;
    else pairAgain.unanswered += 1;
  }

  const flagged = rows.filter((r) => r.rating <= 2 || r.would_pair_again === "no").slice(0, 10);
  const names = await getDisplayNamesByEmails(flagged.flatMap((r) => [r.username, ...(r.partner_usernames ?? [])]));

  return {
    total: rows.length,
    average: rows.length > 0 ? Math.round((sum / rows.length) * 10) / 10 : null,
    distribution,
    pairAgain,
    needsAttention: flagged.map((r) => ({
      id: r.id,
      raterName: names[r.username] ?? r.username,
      partnerNames: (r.partner_usernames ?? []).map((e) => names[e] ?? e),
      roomCode: r.room_code,
      shiftNumber: r.shift_number,
      sessionDate: r.session_date,
      rating: r.rating,
      wouldPairAgain: r.would_pair_again,
      createdAt: r.created_at,
    })),
  };
}
