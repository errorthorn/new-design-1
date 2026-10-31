// lib/mistake-logs-db.ts
//
// Shared read helper behind /api/speaking-club/mistakes and (§7.1)
// /api/mock-test/mistakes — both routes are the same query shape, just a
// different `source` value, so this is factored out once rather than
// duplicated. Introduced alongside the §7.1 Mock Test migration; Phase F
// originally wrote this logic directly inside the Speaking Club route.
import { supabaseServer } from "@/lib/supabase";

const PAGE_SIZE = 20;

export type MistakeLogItem = {
  id: string;
  category: string;
  description: string;
  /** The student's exact words / the corrected version. Null for rows logged before these were stored. */
  original: string | null;
  corrected: string | null;
  sourceRefId: string | null;
  createdAt: string;
};

export const MISTAKE_CATEGORIES = ["grammar", "vocabulary", "pronunciation", "fluency", "coherence"] as const;
export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number];

export type MistakeLogPage = { mistakes: MistakeLogItem[]; nextCursor: string | null };

/**
 * Keyset-paginated read of one student's own mistake_logs rows for a
 * given source. `cursor` is the ISO created_at of the last item the
 * client already has; omit for the first page. mistake_logs grows
 * faster than its source tables (many mistakes per session), so this
 * has needed pagination from the start (plan §6 Phase F step 3).
 */
export async function getMistakeLogsPage(
  source: "speaking_club" | "mock_test",
  studentUsername: string,
  cursor: string | null,
  category?: MistakeCategory | null
): Promise<MistakeLogPage> {
  let query = supabaseServer
    .from("mistake_logs")
    .select("id, category, description, original_text, corrected_text, source_ref_id, created_at")
    .eq("student_username", studentUsername)
    .eq("source", source)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (category) query = query.eq("category", category);
  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw error;

  const mistakes: MistakeLogItem[] = (data ?? []).map((m: { id: string; category: string; description: string; original_text: string | null; corrected_text: string | null; source_ref_id: string | null; created_at: string }) => ({
    id: m.id,
    category: m.category,
    description: m.description,
    original: m.original_text,
    corrected: m.corrected_text,
    sourceRefId: m.source_ref_id,
    createdAt: m.created_at,
  }));

  // A full page -> there might be more; a short/empty page means we've
  // reached the end. Good enough without a separate COUNT.
  const nextCursor = mistakes.length === PAGE_SIZE ? mistakes[mistakes.length - 1].createdAt : null;

  return { mistakes, nextCursor };
}

/**
 * Total mistakes per category for one student + source, so the UI can
 * show a count on each category tab (and hide empty ones) without having
 * to page through every row first. One cheap head-only COUNT per
 * category, run in parallel.
 */
export async function getMistakeCategoryCounts(
  source: "speaking_club" | "mock_test",
  studentUsername: string
): Promise<Record<MistakeCategory, number>> {
  const entries = await Promise.all(
    MISTAKE_CATEGORIES.map(async (category) => {
      const { count, error } = await supabaseServer
        .from("mistake_logs")
        .select("id", { count: "exact", head: true })
        .eq("student_username", studentUsername)
        .eq("source", source)
        .eq("category", category);
      if (error) throw error;
      return [category, count ?? 0] as const;
    })
  );
  return Object.fromEntries(entries) as Record<MistakeCategory, number>;
}
