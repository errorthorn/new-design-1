// lib/speaking-feedback-db.ts
//
// Server-only query helpers over the Phase A schema (sql/schema.sql,
// "SPEAKING CLUB — AI Feedback + Categorized Mistake Log" section).
// Deliberately its own file, not added to lib/speaking-club-db.ts —
// mirrors the plan's own reasoning for keeping speaking_feedback /
// mistake_logs separate from speaking_shifts (§4: "that table is about
// room/access logic, not feedback content"). Service role key, RLS
// bypassed — same as every other *-db.ts helper in this codebase — so
// this must only ever be called from API routes / server components,
// never imported into a client component.

import { supabaseServer } from "@/lib/supabase";

const MAX_TRANSCRIPT_CHARS = 20000; // plan §3: transcripts run ~2,000-3,000 tokens; this is a generous sane upper bound, not a normal-case limit
const MAX_CUE_CARD_QUESTIONS = 50; // defensive cap, mirrors MAX_TRANSCRIPT_CHARS's role — the day's real pool is a handful of cards
const MAX_TOPIC_TITLE_CHARS = 200;

/**
 * Phase C (plan §5/§6 Phase C) — the ingestion write. Creates a
 * `pending` speaking_feedback row and returns immediately; no Gemini
 * call happens here (that's Phase D's background worker). Truncates an
 * unreasonably long transcript defensively rather than rejecting it
 * outright — a truncated transcript still degrades to "somewhat worse
 * feedback for this session," not a hard failure for the student.
 */
export async function createPendingSpeakingFeedback(params: {
  shiftId: string;
  studentUsername: string;
  transcript: string;
  /**
   * The admin-set "Topic of the day" title active when the student
   * submitted (see speaking_club_topic_of_day / getTopicOfDay). Omitted
   * or the 'Free talk' default means there was no real topic to check
   * the conversation against — Phase D's worker skips on-topic checking
   * in that case rather than flagging an unstructured chat as off-topic.
   */
  topicTitle?: string | null;
  /**
   * The full cue-card question pool for the day (not just whichever
   * card happened to be showing at submit time — there's no
   * server-side "current card" state to read; see the comment on
   * speaking_club_topic_of_day in sql/schema.sql). Gives the Phase D
   * worker the actual prompts the pair had in front of them.
   */
  cueCardQuestions?: string[] | null;
}): Promise<{ id: string }> {
  const transcript = params.transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS);

  const topicTitle = params.topicTitle?.trim();
  const cueCardQuestions = (params.cueCardQuestions ?? [])
    .map((q) => (typeof q === "string" ? q.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_CUE_CARD_QUESTIONS);

  const { data, error } = await supabaseServer
    .from("speaking_feedback")
    .insert({
      shift_id: params.shiftId,
      student_username: params.studentUsername,
      transcript,
      // 'Free talk' is the schema default for an admin who never set a
      // real topic (speaking_club_topic_of_day.topic_title) — store null
      // rather than that placeholder string, so the worker's "is there
      // actually a topic to check against" test is a plain null check.
      topic_title: topicTitle && topicTitle.toLowerCase() !== "free talk" ? topicTitle.slice(0, MAX_TOPIC_TITLE_CHARS) : null,
      cue_card_questions: cueCardQuestions.length > 0 ? cueCardQuestions : null,
      status: "pending",
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: data.id as string };
}

// -----------------------------------------------------------------------
// Admin feedback viewer (gap-fix: the Monitoring tab only ever showed
// aggregate counts — "is the pipeline healthy" — never the actual
// feedback_summary text or per-mistake breakdown for any specific
// student, which lived only on that student's own /dashboard/performance
// and /dashboard/mistake-log. Mirrors the keyset-pagination shape of
// getMistakeLogsPage (lib/mistake-logs-db.ts) for the same admin-panel
// "Load more" pattern already used elsewhere in this codebase.
// -----------------------------------------------------------------------

const ADMIN_FEEDBACK_PAGE_SIZE = 20;

export type AdminSpeakingFeedbackMistake = { id: string; category: string; description: string };

export type AdminSpeakingFeedbackItem = {
  id: string;
  shiftId: string | null;
  studentUsername: string;
  topicTitle: string | null;
  feedbackSummary: string | null;
  mistakeCount: number;
  status: "pending" | "processing" | "done" | "failed";
  createdAt: string;
  processedAt: string | null;
  mistakes: AdminSpeakingFeedbackMistake[];
};

export type AdminSpeakingFeedbackPage = { items: AdminSpeakingFeedbackItem[]; nextCursor: string | null };

/**
 * Keyset-paginated read of ALL students' speaking_feedback rows (not
 * scoped to one student_username, unlike getMistakeLogsPage) — this is
 * the admin-panel counterpart. `status` and `studentQuery` (a substring
 * match against student_username) are optional filters; `cursor` is the
 * ISO created_at of the last item the client already has, omit for the
 * first page. Each row's mistake_logs breakdown is fetched in one
 * second batched query (by source_ref_id IN (...)) rather than N+1
 * per-row queries.
 */
export async function listSpeakingFeedbackForAdmin(params: {
  status?: "pending" | "processing" | "done" | "failed" | null;
  studentQuery?: string | null;
  cursor?: string | null;
}): Promise<AdminSpeakingFeedbackPage> {
  let query = supabaseServer
    .from("speaking_feedback")
    .select("id, shift_id, student_username, topic_title, feedback_summary, mistake_count, status, created_at, processed_at")
    .order("created_at", { ascending: false })
    .limit(ADMIN_FEEDBACK_PAGE_SIZE);

  if (params.status) query = query.eq("status", params.status);
  const studentQuery = params.studentQuery?.trim();
  if (studentQuery) query = query.ilike("student_username", `%${studentQuery}%`);
  if (params.cursor) query = query.lt("created_at", params.cursor);

  const { data, error } = await query;
  if (error) throw error;

  type Row = {
    id: string;
    shift_id: string | null;
    student_username: string;
    topic_title: string | null;
    feedback_summary: string | null;
    mistake_count: number;
    status: "pending" | "processing" | "done" | "failed";
    created_at: string;
    processed_at: string | null;
  };
  const rows = (data ?? []) as Row[];
  const ids = rows.map((r) => r.id);

  // Batched, not N+1: one query for every mistake belonging to any row
  // on this page, grouped client-side by source_ref_id below.
  const mistakesByFeedbackId = new Map<string, AdminSpeakingFeedbackMistake[]>();
  if (ids.length > 0) {
    const { data: mistakeRows, error: mistakeError } = await supabaseServer
      .from("mistake_logs")
      .select("id, source_ref_id, category, description")
      .eq("source", "speaking_club")
      .in("source_ref_id", ids);
    if (mistakeError) throw mistakeError;
    for (const m of (mistakeRows ?? []) as { id: string; source_ref_id: string | null; category: string; description: string }[]) {
      if (!m.source_ref_id) continue;
      const list = mistakesByFeedbackId.get(m.source_ref_id) ?? [];
      list.push({ id: m.id, category: m.category, description: m.description });
      mistakesByFeedbackId.set(m.source_ref_id, list);
    }
  }

  const items: AdminSpeakingFeedbackItem[] = rows.map((r) => ({
    id: r.id,
    shiftId: r.shift_id,
    studentUsername: r.student_username,
    topicTitle: r.topic_title,
    feedbackSummary: r.feedback_summary,
    mistakeCount: r.mistake_count,
    status: r.status,
    createdAt: r.created_at,
    processedAt: r.processed_at,
    mistakes: mistakesByFeedbackId.get(r.id) ?? [],
  }));

  // A full page -> there might be more; a short/empty page means we've
  // reached the end — same "good enough without a separate COUNT" call
  // as getMistakeLogsPage.
  const nextCursor = items.length === ADMIN_FEEDBACK_PAGE_SIZE ? items[items.length - 1].createdAt : null;

  return { items, nextCursor };
}
