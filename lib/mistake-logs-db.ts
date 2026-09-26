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
  sourceRefId: string | null;
  createdAt: string;
};

export type MistakeLogPage = { mistakes: MistakeLogItem[]; nextCursor: string | null };

/**
 * Keyset-paginated read of one student's own mistake_logs rows for a
 * given source. `cursor` is the ISO created_at of the last item the
 * client already has; omit for the first page. mistake_logs grows
 * faster than its source tables (many mistakes per session), so this
 * has needed pagination from the start (plan §6 Phase F step 3).
 */
export async function getMistakeLogsPage(source: "speaking_club" | "mock_test", studentUsername: string, cursor: string | null): Promise<MistakeLogPage> {
  let query = supabaseServer
    .from("mistake_logs")
    .select("id, category, description, source_ref_id, created_at")
    .eq("student_username", studentUsername)
    .eq("source", source)
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);

  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query;
  if (error) throw error;

  const mistakes: MistakeLogItem[] = (data ?? []).map((m: { id: string; category: string; description: string; source_ref_id: string | null; created_at: string }) => ({
    id: m.id,
    category: m.category,
    description: m.description,
    sourceRefId: m.source_ref_id,
    createdAt: m.created_at,
  }));

  // A full page -> there might be more; a short/empty page means we've
  // reached the end. Good enough without a separate COUNT.
  const nextCursor = mistakes.length === PAGE_SIZE ? mistakes[mistakes.length - 1].createdAt : null;

  return { mistakes, nextCursor };
}
