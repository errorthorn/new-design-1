// lib/data-retention.ts
//
// Automatic cleanup: data is deleted once its job is done, so Supabase
// storage doesn't just grow forever. Called once a day by
// app/api/cron/data-cleanup/route.ts (which also supports ?dryRun=1 to see
// what WOULD be deleted without deleting anything).
//
// What is kept / removed, per area:
//
//  Speaking Club AI feedback (speaking_feedback + its mistake_logs)
//    Per student, only the rows from their two most recent feedback DAYS
//    (Asia/Dhaka) are kept: the latest day, and the day before it (what the
//    Performance page shows as "previous day"). Everything older is
//    deleted, including that session's transcript and its mistake_logs rows. Counting is per student and never by
//    calendar age, so a student who stops attending is never left with an
//    empty page. Only 'done'/'failed' rows are deleted, never a row that is
//    still 'pending'/'processing'.
//
//  Mock test (mock_test_attempts)
//    The attempt row itself stays (score, dates: needed for streaks, stats,
//    progress). Its recording (Storage) and transcript are removed
//    MOCK_MEDIA_GRACE_DAYS after the teacher scored it, once the mistake-log
//    worker has finished with it (or after MOCK_MEDIA_FORCE_DAYS regardless).
//    Mock-test mistake_logs are kept for each student's latest two attempts.
//
//  Quizzes (quiz_attempts / quiz_questions)
//    quiz_attempts rows stay (streaks + Performance stats read them); only
//    the bulky `answers` JSON is cleared, except for attempts on a currently
//    published quiz and each student's latest attempt that had a mistake
//    (that one drives their Mistake Log). Questions of retired auto-generated
//    quizzes are deleted once no kept attempt needs them. Manually created
//    quizzes are never touched.
//
//  speaking_turn_usage: rows older than TURN_USAGE_KEEP_DAYS are deleted
//    (the admin monitoring view only looks at the last 14 days).

import { supabaseServer } from "@/lib/supabase";

const MOCK_MEDIA_GRACE_DAYS = 7;
const MOCK_MEDIA_FORCE_DAYS = 30;
const TURN_USAGE_KEEP_DAYS = 30;
const MOCK_AUDIO_BUCKET = "mock-test-audio";
const AUTO_QUIZ_SOURCE = "speaking_club_mistakes";

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
function dhakaDayKey(iso: string): string {
  return new Date(new Date(iso).getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Reads every row of a query by paging (Supabase returns max 1000 per call).
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function removeFiles(bucket: string, paths: string[], dry: boolean) {
  if (dry || paths.length === 0) return;
  for (const part of chunk(paths, 100)) {
    const { error } = await supabaseServer.storage.from(bucket).remove(part);
    if (error) console.error(`[data-retention] could not remove files from ${bucket}`, error);
  }
}

export type CleanupStepResult = Record<string, number | string>;

// --- Speaking Club feedback -------------------------------------------------

async function cleanupSpeakingFeedback(dry: boolean): Promise<CleanupStepResult> {
  type Row = { id: string; student_username: string; created_at: string; status: string };
  const rows = await fetchAll<Row>((from, to) =>
    supabaseServer
      .from("speaking_feedback")
      .select("id, student_username, created_at, status")
      .order("created_at", { ascending: false })
      .range(from, to)
  );

  const byStudent = new Map<string, Row[]>();
  for (const r of rows) {
    const list = byStudent.get(r.student_username) ?? [];
    list.push(r);
    byStudent.set(r.student_username, list);
  }

  const doomed: Row[] = [];
  for (const list of byStudent.values()) {
    const keepDays = new Set<string>();
    for (const r of list) {
      const day = dhakaDayKey(r.created_at);
      if (keepDays.size < 2) keepDays.add(day);
    }
    for (const r of list) {
      if (keepDays.has(dhakaDayKey(r.created_at))) continue;
      if (r.status === "done" || r.status === "failed") doomed.push(r);
    }
  }

  const ids = doomed.map((r) => r.id);
  if (!dry && ids.length > 0) {
    for (const part of chunk(ids, 200)) {
      const { error: logsError } = await supabaseServer.from("mistake_logs").delete().eq("source", "speaking_club").in("source_ref_id", part);
      if (logsError) throw logsError;
    }
    for (const part of chunk(ids, 200)) {
      const { error } = await supabaseServer.from("speaking_feedback").delete().in("id", part);
      if (error) throw error;
    }
  }
  return { feedbackRowsDeleted: ids.length };
}

// --- Mock test --------------------------------------------------------------

async function cleanupMockTest(dry: boolean): Promise<CleanupStepResult> {
  const now = Date.now();
  const graceCutoff = new Date(now - MOCK_MEDIA_GRACE_DAYS * 86400000).toISOString();
  const forceCutoff = new Date(now - MOCK_MEDIA_FORCE_DAYS * 86400000).toISOString();

  // 1) Recording + transcript of attempts the teacher already scored.
  type Att = { id: string; audio_path: string | null; scored_at: string | null; mistake_log_processed_at: string | null };
  const candidates = await fetchAll<Att>((from, to) =>
    supabaseServer
      .from("mock_test_attempts")
      .select("id, audio_path, scored_at, mistake_log_processed_at")
      .lt("scored_at", graceCutoff)
      .or("audio_path.not.is.null,transcript.not.is.null")
      .range(from, to)
  );
  // Wait for the mistake-log worker (it reads the transcript/audio) unless
  // the attempt has been scored for a long time already.
  const atts = candidates.filter((a) => a.mistake_log_processed_at != null || (a.scored_at ?? "") < forceCutoff);
  const attemptIds = atts.map((a) => a.id);
  const audioPaths = atts.map((a) => a.audio_path).filter((p): p is string => !!p);
  if (!dry && attemptIds.length > 0) {
    await removeFiles(MOCK_AUDIO_BUCKET, audioPaths, dry);
    for (const part of chunk(attemptIds, 200)) {
      const { error } = await supabaseServer.from("mock_test_attempts").update({ audio_path: null, transcript: null }).in("id", part);
      if (error) throw error;
    }
  }

  // 2) Mock-test mistake_logs: keep each student's latest two attempts.
  type Log = { id: string; student_username: string; source_ref_id: string | null; created_at: string };
  const logs = await fetchAll<Log>((from, to) =>
    supabaseServer
      .from("mistake_logs")
      .select("id, student_username, source_ref_id, created_at")
      .eq("source", "mock_test")
      .order("created_at", { ascending: false })
      .range(from, to)
  );
  const byStudent = new Map<string, Log[]>();
  for (const l of logs) {
    const list = byStudent.get(l.student_username) ?? [];
    list.push(l);
    byStudent.set(l.student_username, list);
  }
  const doomedLogIds: string[] = [];
  for (const list of byStudent.values()) {
    const keepRefs = new Set<string>();
    for (const l of list) {
      const ref = l.source_ref_id ?? l.id;
      if (keepRefs.size < 2) keepRefs.add(ref);
    }
    for (const l of list) if (!keepRefs.has(l.source_ref_id ?? l.id)) doomedLogIds.push(l.id);
  }
  if (!dry) {
    for (const part of chunk(doomedLogIds, 200)) {
      const { error } = await supabaseServer.from("mistake_logs").delete().in("id", part);
      if (error) throw error;
    }
  }
  return { mockAttemptsMediaCleared: attemptIds.length, mockAudioFiles: audioPaths.length, mockMistakeLogsDeleted: doomedLogIds.length };
}

// --- Quizzes ----------------------------------------------------------------

async function cleanupQuizzes(dry: boolean): Promise<CleanupStepResult> {
  const { data: quizRows, error: quizError } = await supabaseServer.from("quizzes").select("id, published, auto_source");
  if (quizError) throw quizError;
  const publishedIds = new Set((quizRows ?? []).filter((q) => q.published).map((q) => q.id as string));
  const autoIds = new Set((quizRows ?? []).filter((q) => q.auto_source === AUTO_QUIZ_SOURCE).map((q) => q.id as string));

  // Only attempts that still hold answers matter here (already-cleared ones
  // have nothing left to remove and nothing to protect).
  type Att = { id: string; quiz_id: string; user_email: string; completed_at: string | null; score: number | null; total_questions: number | null };
  const attempts = await fetchAll<Att>((from, to) =>
    supabaseServer
      .from("quiz_attempts")
      .select("id, quiz_id, user_email, completed_at, score, total_questions")
      .not("answers", "is", null)
      .range(from, to)
  );

  // Each student's latest attempt that had at least one wrong/skipped answer:
  // the Mistake Log (app/api/quiz/mistakes/route.ts) is built from it.
  const latestMistake = new Map<string, Att>();
  for (const a of attempts) {
    if (a.score == null || a.total_questions == null || a.score >= a.total_questions) continue;
    const best = latestMistake.get(a.user_email);
    if (!best || (a.completed_at ?? "") > (best.completed_at ?? "")) latestMistake.set(a.user_email, a);
  }
  const keepAttemptIds = new Set([...latestMistake.values()].map((a) => a.id));

  const toStrip = attempts.filter((a) => autoIds.has(a.quiz_id) && !publishedIds.has(a.quiz_id) && !keepAttemptIds.has(a.id));
  if (!dry) {
    for (const part of chunk(toStrip.map((a) => a.id), 200)) {
      const { error } = await supabaseServer.from("quiz_attempts").update({ answers: null }).in("id", part);
      if (error) throw error;
    }
  }

  // Questions of retired auto quizzes that no remaining attempt needs.
  const stillNeeded = new Set<string>(publishedIds);
  const stripIds = new Set(toStrip.map((a) => a.id));
  for (const a of attempts) if (!stripIds.has(a.id)) stillNeeded.add(a.quiz_id);
  const retiredQuizIds = [...autoIds].filter((id) => !stillNeeded.has(id));
  let questionsDeleted = 0;
  for (const part of chunk(retiredQuizIds, 50)) {
    if (dry) {
      const { count } = await supabaseServer.from("quiz_questions").select("id", { count: "exact", head: true }).in("quiz_id", part);
      questionsDeleted += count ?? 0;
    } else {
      const { data, error } = await supabaseServer.from("quiz_questions").delete().in("quiz_id", part).select("id");
      if (error) throw error;
      questionsDeleted += data?.length ?? 0;
    }
  }
  return { quizAnswersCleared: toStrip.length, quizQuestionsDeleted: questionsDeleted };
}

// --- Call-usage log ---------------------------------------------------------

async function cleanupTurnUsage(dry: boolean): Promise<CleanupStepResult> {
  const cutoff = new Date(Date.now() - TURN_USAGE_KEEP_DAYS * 86400000).toISOString();
  if (dry) {
    const { count, error } = await supabaseServer.from("speaking_turn_usage").select("id", { count: "exact", head: true }).lt("created_at", cutoff);
    if (error) throw error;
    return { turnUsageRowsDeleted: count ?? 0 };
  }
  const { data, error } = await supabaseServer.from("speaking_turn_usage").delete().lt("created_at", cutoff).select("id");
  if (error) throw error;
  return { turnUsageRowsDeleted: data?.length ?? 0 };
}

// Runs every step independently so one failing step never blocks the rest.
export async function runDataCleanup(dry = false) {
  const steps: [string, (dry: boolean) => Promise<CleanupStepResult>][] = [
    ["speakingFeedback", cleanupSpeakingFeedback],
    ["mockTest", cleanupMockTest],
    ["quizzes", cleanupQuizzes],
    ["turnUsage", cleanupTurnUsage],
  ];
  const results: Record<string, CleanupStepResult | { error: string }> = {};
  for (const [name, fn] of steps) {
    try {
      results[name] = await fn(dry);
    } catch (err: any) {
      console.error(`[data-retention] step ${name} failed`, err);
      results[name] = { error: err?.message ?? String(err) };
    }
  }
  return { dryRun: dry, results };
}
