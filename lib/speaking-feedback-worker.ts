// lib/speaking-feedback-worker.ts
//
// Phase D deliverable (SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §5/§6 Phase D).
// Called by app/api/cron/speaking-club-feedback-worker/route.ts, which a
// scheduler (Vercel Cron, n8n, etc) hits every 1 minute — same pattern as
// the existing speaking-club-alerts/speaking-club-roster cron routes.
//
// This is the ONLY place in the codebase that should call Gemini for
// this feature — everything upstream (Phase B capture, Phase C ingest)
// deliberately does no AI work, just queues a row for this worker.
//
// §7.1 MOCK TEST MIGRATION (was future scope, now built): per the plan's
// own instruction ("reuse Phase D's worker and Gemini prompt as-is —
// don't build a second pipeline"), this file now pulls from TWO source
// tables — speaking_feedback (Speaking Club) and mock_test_attempts
// (Mock Test) — through the same throttled loop and same Gemini prompt,
// just tagged with a different `source`.
//
// SEPARATE-KEYS FOLLOW-UP (was: one shared GEMINI_SPEAKING_FEEDBACK_API_KEY
// budget-split between both sources — see git history / the plan's §7.1
// step 7 shared-quota reminder for that earlier design). Now each source
// has its OWN Gemini API key/project (GEMINI_SPEAKING_FEEDBACK_API_KEY
// for speaking_club, GEMINI_MOCK_TEST_FEEDBACK_API_KEY for mock_test —
// see .env.example), so there is no shared free-tier quota to split
// between them anymore: each source claims up to its own full BATCH_SIZE
// independently, against its own key's own 15 RPM / 1,000 RPD ceiling. A
// missing key for one source just means that source is skipped this run
// (logged) while the other source's key, if present, still runs normally
// — see processPendingSpeakingFeedbackBatch.
import { runPool } from "@/lib/run-pool";
import { GoogleGenAI, Type } from "@google/genai";
import { supabaseServer } from "@/lib/supabase";
import { IELTS_EXAMINER_INSTRUCTION, IELTS_REPORT_SCHEMA, MAX_LOGGED_MISTAKES, MISTAKE_CATEGORY_INSTRUCTION, MISTAKE_LIMIT_INSTRUCTION, PRONUNCIATION_NOTES_INSTRUCTION, formatIeltsFeedback, parseIeltsReport, quoteInTranscript } from "@/lib/speaking-ielts-feedback";
import { splitPronunciationNotes } from "@/lib/speaking-club/pronunciation-notes";

// Flash-Lite tier (plan §3). gemini-2.5-flash-lite was switched off for new API
// keys in 2026 (404 "no longer available to new users") and shuts down on
// 16 Oct 2026; gemini-3.1-flash-lite is Google's documented replacement. Set
// GEMINI_TEXT_MODEL to change the model without a code change next time.
const MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite";

// Mock Test rows are claimed in one small batch per run (its own key, low volume).
const BATCH_SIZE = 10;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.max(min, n)) : fallback;
}

// ---- Speaking Club pacing (free-tier friendly) -------------------------------------------
// A whole slot (~100 students) submits its transcript at the same moment, so the queue gets a
// burst of ~100 rows. The worker drains it at a steady, rate-limit-aware pace instead of
// hoping the burst fits in one run:
//   - FEEDBACK_WORKER_RPM (default 10): max Gemini calls STARTED per minute, counted from the
//     database (claimed_at), so overlapping cron runs share ONE budget. Keep it below your key's
//     requests-per-minute limit (Google AI Studio -> your project -> Rate limits).
//   - FEEDBACK_WORKER_CONCURRENCY (default 6, max 8): max calls in flight at once, also counted
//     from the database, across all runs.
//   - FEEDBACK_WORKER_CALL_TIMEOUT_MS (default 150000): one Gemini call is cut off after this.
//     It is a normal failed attempt, so a stuck call can no longer hang a run until Vercel kills it.
//   - FEEDBACK_WORKER_BUDGET_MS (default 55000): a run stops STARTING new calls after this; the
//     in-flight ones still finish. budget + call timeout must stay under the route's maxDuration (300s).
// A 429 from Gemini is NOT counted as one of the row's 3 attempts: the row goes back to the queue
// and the whole queue pauses (see markRateLimited), so a quota hiccup never turns into "Feedback
// couldn't be generated".
const SPEAKING_RPM = envInt("FEEDBACK_WORKER_RPM", 10, 1, 60);
const WORKER_CONCURRENCY = envInt("FEEDBACK_WORKER_CONCURRENCY", 6, 1, 8);
const CALL_TIMEOUT_MS = envInt("FEEDBACK_WORKER_CALL_TIMEOUT_MS", 150_000, 20_000, 240_000);
const RUN_TIME_BUDGET_MS = envInt("FEEDBACK_WORKER_BUDGET_MS", 55_000, 10_000, 120_000);
// How long an idle lane waits before asking again when the per-minute budget is used up.
const CAPACITY_RECHECK_MS = 4_000;

// Plan §5 step 6 (Speaking Club) / §7.1 gap-fix (Mock Test, see the
// mistake_log_attempt_count column comment in sql/schema.sql): 3 total
// attempts before giving up on a row.
const MAX_ATTEMPTS = 3;

// A run stuck at 'processing' longer than this was almost certainly
// abandoned by a killed/timed-out worker invocation, not an actually
// in-flight Gemini call — see the claimed_at column comment in sql/schema.sql.
const STALE_PROCESSING_MINUTES = 10;

const ALLOWED_CATEGORIES = ["grammar", "vocabulary", "pronunciation", "fluency", "coherence"] as const;
type Category = (typeof ALLOWED_CATEGORIES)[number];

type MistakeSource = "speaking_club" | "mock_test";

const MAX_QUOTE_CHARS = 400;

// What the shared processing loop below needs, regardless of which
// table a row actually came from.
type ClaimedItem = {
  source: MistakeSource;
  id: string;
  studentUsername: string;
  transcript: string;
  attemptCount: number; // already incremented for THIS attempt by the claim step
  // Gap-fix (see topic_title/cue_card_questions in sql/schema.sql) —
  // speaking_club only; mock_test has no topic-of-the-day concept, so
  // these stay undefined for that source and callGeminiForFeedback below
  // just skips the on-topic instructions in that case.
  topicTitle?: string;
  cueCardQuestions?: string[];
  shiftId?: string; // speaking_club only — used to look up how long the student was in the call
};

type GeminiFeedbackResult = {
  feedback_summary: string;
  mistakes: { category: Category; description: string; original?: string | null; correction?: string | null }[];
  ielts_report?: unknown; // speaking_club only; see lib/speaking-ielts-feedback.ts
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    feedback_summary: {
      type: Type.STRING,
      description:
        "A short, encouraging overall paragraph (3-5 sentences) summarizing how the student did in this session.",
    },
    mistakes: {
      type: Type.ARRAY,
      description: "Every individual mistake found in the transcript, one entry per mistake.",
      items: {
        type: Type.OBJECT,
        properties: {
          category: {
            type: Type.STRING,
            enum: [...ALLOWED_CATEGORIES],
            description: "The type of mistake.",
          },
          original: {
            type: Type.STRING,
            description:
              "The student's EXACT words from the transcript that contain this mistake, copied character-for-character (the clause or sentence, not the whole answer). Never paraphrase or correct it.",
          },
          correction: {
            type: Type.STRING,
            description: "The same words rewritten correctly (for fluency/coherence: a smoother, clearer version).",
          },
          description: {
            type: Type.STRING,
            description: "A short plain-English reason why it is a mistake (e.g. 'past simple needed for a finished action').",
          },
        },
        required: ["category", "original", "correction", "description"],
      },
    },
  },
  required: ["feedback_summary", "mistakes"],
};

// Speaking Club additionally asks for an IELTS-examiner style report (see
// lib/speaking-ielts-feedback.ts). Mock Test keeps the original schema: its student-facing
// feedback is the teacher's own band feedback, and no summary text is stored for it.
function responseSchemaFor(source: MistakeSource) {
  if (source !== "speaking_club") return RESPONSE_SCHEMA;
  return {
    ...RESPONSE_SCHEMA,
    properties: {
      ...RESPONSE_SCHEMA.properties,
      mistakes: {
        ...RESPONSE_SCHEMA.properties.mistakes,
        description: `The most important distinct mistakes in the transcript, most important first, at most ${MAX_LOGGED_MISTAKES}. One entry per distinct mistake (identical repeats of the exact same slip only once).`,
      },
      ielts_report: IELTS_REPORT_SCHEMA,
    },
    required: [...RESPONSE_SCHEMA.required, "ielts_report"],
  };
}

// Two near-identical system instructions — kept separate (not one prompt
// with an if/else inside it) because "conversation practice with a
// partner" vs "an AI examiner interview" are different enough contexts
// that collapsing them into one generic wording would blur the
// pronunciation-flagging caveat and the overall tone for both.
const SPEAKING_CLUB_SYSTEM_INSTRUCTION = [
  "You are an English speaking coach for LingoCraft's Speaking Club, reviewing a transcript of a student's live conversation practice with a partner.",
  "The transcript was produced by automatic speech recognition running on the student's own device, so expect occasional transcription noise (misheard words, odd punctuation or capitalisation) — don't treat that noise itself as a student mistake.",
  "Write a short, encouraging overall summary of how the student did, then list every genuine mistake you find as a separate item, each tagged with exactly one category: grammar, vocabulary, pronunciation (only flag this if the transcript's word choice/spelling clearly implies a mispronunciation, since you cannot hear audio), fluency, or coherence.",
  "For each mistake, copy the student's EXACT words from the transcript into `original` (the shortest stretch that shows the mistake, but with enough words to be clear — usually the clause or sentence), give the corrected version of that same stretch in `correction`, and put a short plain-English reason in `description` (e.g. 'past simple needed for a finished action'). `original` must be copied character-for-character from the transcript — never paraphrase, fix or invent it.",
  "Only include real mistakes; a short or simple correct sentence is not a mistake.",
].join("\n");

// Gap-fix (topic_title/cue_card_questions in sql/schema.sql): appended to
// the base instruction above ONLY when the row actually has a real topic
// to check against (see buildSpeakingClubTopicNote below) — a plain
// 'Free talk' day has nothing to be "off-topic" from, so the base
// instruction is used unmodified in that case, exactly as before this
// gap-fix.
const SPEAKING_CLUB_TOPIC_CHECK_INSTRUCTION = [
  "The student was given a topic and a pool of cue-card discussion questions for this session (provided below, after the transcript) — a mentor set these so the pair would have something structured to talk about instead of an unstructured hour.",
  "Judge for yourself, from the actual conversation, whether it stayed reasonably close to that topic — occasional tangents are completely normal in real conversation practice and are not a problem on their own.",
  "Only if the conversation was substantially about something else for most of its length, say so plainly as the LAST sentence of feedback_summary (e.g. naming what they actually talked about instead) — this is on-topic feedback for the mentor, not a mistake, so never add it as one of the mistakes items.",
  "If the conversation was on-topic (or only briefly wandered before returning to it), do not mention the topic at all in feedback_summary — say nothing about topic adherence rather than praising it.",
].join("\n");

const MOCK_TEST_SYSTEM_INSTRUCTION = [
  "You are an English speaking coach for LingoCraft's Mock Test, reviewing a transcript of a student's speaking test with an AI examiner.",
  "The transcript was captured by an AI voice examiner session, so expect occasional transcription noise (misheard words, missing punctuation) — don't treat that noise itself as a student mistake, and don't count the examiner's own turns as the student's mistakes.",
  "Write a short, encouraging overall summary of how the student did, then list every genuine mistake you find as a separate item, each tagged with exactly one category: grammar, vocabulary, pronunciation (only flag this if the transcript's word choice/spelling clearly implies a mispronunciation, since you cannot hear audio), fluency, or coherence.",
  "For each mistake, copy the student's EXACT words from the transcript into `original` (the shortest stretch that shows the mistake, but with enough words to be clear — usually the clause or sentence), give the corrected version of that same stretch in `correction`, and put a short plain-English reason in `description` (e.g. 'past simple needed for a finished action'). `original` must be copied character-for-character from the transcript — never paraphrase, fix or invent it.",
  "Only include real mistakes; a short or simple correct sentence is not a mistake.",
  "This is a SEPARATE, additional output from the teacher's own manual band-score feedback on this attempt — you are not producing a band score, only a categorized mistake list for mentors.",
].join("\n");

/**
 * Gives back any row an earlier, abandoned run left stranded at 'processing' (see the claimed_at
 * column comment in sql/schema.sql) so it gets a normal, fresh attempt. Once per run, best-effort:
 * if claimed_at isn't there yet (migration not run) this is silently skipped.
 */
async function reclaimStaleSpeakingRows(): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();
  const { error: reclaimError } = await supabaseServer
    .from("speaking_feedback")
    .update({ status: "pending" })
    .eq("status", "processing")
    .lt("claimed_at", staleCutoff);
  if (reclaimError && !/claimed_at/i.test(reclaimError.message ?? "")) {
    console.error("[speaking-feedback-worker] could not reclaim stale processing rows", reclaimError);
  }
}

/**
 * Claims up to `limit` pending speaking_feedback rows by flipping them to
 * 'processing' and bumping each row's own attempt_count. `drained` is true when there was
 * nothing pending at all (as opposed to "a candidate was taken by another run first").
 *
 * Safe if two runs overlap: each row is claimed with an update that only matches while the row
 * is still 'pending' (no SELECT ... FOR UPDATE SKIP LOCKED needed), so the second run skips a row
 * the first run already took instead of sending it to Gemini twice.
 */
async function claimSpeakingFeedbackBatch(limit: number): Promise<{ items: ClaimedItem[]; drained: boolean }> {
  if (limit <= 0) return { items: [], drained: false };

  const selectResult = await supabaseServer
    .from("speaking_feedback")
    .select("id, shift_id, student_username, transcript, attempt_count, topic_title, cue_card_questions")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  const { data: candidates, error: selectError } = selectResult;

  if (selectError) throw selectError;
  if (!candidates || candidates.length === 0) return { items: [], drained: true };

  // Individual updates (not a single bulk .update().in()) because each
  // row needs its OWN attempt_count + 1, not the same value applied to
  // all of them — capped at BATCH_SIZE, so a handful of small, cheap
  // writes, not a real cost concern.
  const claimed: ClaimedItem[] = [];
  for (const row of candidates as {
    id: string;
    shift_id: string | null;
    student_username: string;
    transcript: string | null;
    attempt_count: number;
    topic_title: string | null;
    cue_card_questions: string[] | null;
  }[]) {
    const nextAttemptCount = row.attempt_count + 1;
    // Only claim a row that is STILL pending: if two runs overlap, the second one's update
    // matches nothing and it skips the row instead of sending it to Gemini twice.
    let { data: claimedRows, error: claimError } = await supabaseServer
      .from("speaking_feedback")
      .update({ status: "processing", attempt_count: nextAttemptCount, claimed_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");
    if (claimError && /claimed_at/i.test(claimError.message ?? "")) {
      // claimed_at migration not run yet — claim the old way so the worker
      // keeps working (stale-row recovery just stays off until it is run).
      ({ data: claimedRows, error: claimError } = await supabaseServer
        .from("speaking_feedback")
        .update({ status: "processing", attempt_count: nextAttemptCount })
        .eq("id", row.id)
        .eq("status", "pending")
        .select("id"));
    }
    if (claimError) throw claimError;
    if (!claimedRows || claimedRows.length === 0) continue; // another run already took this row
    if (row.transcript && row.transcript.trim()) {
      claimed.push({
        source: "speaking_club",
        id: row.id,
        studentUsername: row.student_username,
        transcript: row.transcript ?? "",
        attemptCount: nextAttemptCount,
        topicTitle: row.topic_title ?? undefined,
        cueCardQuestions: row.cue_card_questions ?? undefined,
        shiftId: row.shift_id ?? undefined,
      });
    } else {
      // Shouldn't happen — Phase C rejects empty transcripts before ever
      // creating a row — but if it does, don't send an empty prompt to
      // Gemini; just mark it done-with-nothing so it stops being reclaimed.
      console.error(`[speaking-feedback-worker] speaking_feedback ${row.id} claimed with no transcript — marking done with 0 mistakes`);
      void supabaseServer.from("speaking_feedback").update({ status: "done", feedback_summary: null, mistake_count: 0, processed_at: new Date().toISOString() }).eq("id", row.id);
    }
  }

  return { items: claimed, drained: false };
}

/**
 * Claims up to `limit` unprocessed, completed mock_test_attempts rows
 * with a transcript and remaining retry budget. Unlike speaking_feedback
 * above, there's no 'processing' status to set here — see the
 * mistake_log_attempt_count column comment in sql/schema.sql for why a
 * simpler "just bump the attempt counter" claim is sufficient for this
 * table (no pending/processing handoff between separate phases to
 * coordinate, unlike Speaking Club's Phase C -> D split).
 */
async function claimMockTestBatch(limit: number): Promise<ClaimedItem[]> {
  if (limit <= 0) return [];

  const { data: candidates, error: selectError } = await supabaseServer
    .from("mock_test_attempts")
    .select("id, transcript, mistake_log_attempt_count, students(user_email)")
    .not("completed_at", "is", null)
    .is("mistake_log_processed_at", null)
    .not("transcript", "is", null)
    .lt("mistake_log_attempt_count", MAX_ATTEMPTS)
    .order("completed_at", { ascending: true })
    .limit(limit);

  if (selectError) throw selectError;
  if (!candidates || candidates.length === 0) return [];

  const claimed: ClaimedItem[] = [];
  for (const row of candidates as { id: string; transcript: string | null; mistake_log_attempt_count: number; students?: { user_email?: string | null } | null }[]) {
    const studentUsername = row.students?.user_email;
    if (!row.transcript || !row.transcript.trim() || !studentUsername) {
      // No transcript (shouldn't pass the .not("transcript","is",null)
      // filter, but be defensive) or no linked account email to attribute
      // mistake_logs rows to — mark processed so this doesn't get
      // reselected every run without ever being able to actually produce
      // anything.
      console.error(`[speaking-feedback-worker] mock_test_attempts ${row.id} unusable (missing transcript or student email) — marking processed with 0 mistakes`);
      void supabaseServer.from("mock_test_attempts").update({ mistake_log_processed_at: new Date().toISOString() }).eq("id", row.id);
      continue;
    }

    const nextAttemptCount = row.mistake_log_attempt_count + 1;
    // Only claim if the attempt counter is still what we read: an overlapping run that got here
    // first has already bumped it, so this update then matches nothing and we skip the row.
    const { data: claimedRows, error: claimError } = await supabaseServer
      .from("mock_test_attempts")
      .update({ mistake_log_attempt_count: nextAttemptCount })
      .eq("id", row.id)
      .eq("mistake_log_attempt_count", row.mistake_log_attempt_count)
      .select("id");
    if (claimError) throw claimError;
    if (!claimedRows || claimedRows.length === 0) continue; // another run already took this attempt
    claimed.push({ source: "mock_test", id: row.id, studentUsername, transcript: row.transcript, attemptCount: nextAttemptCount });
  }

  return claimed;
}

// Builds the "Topic of the day: ...\nCue-card questions offered: ..." block
// appended after the transcript in the user content, and reports whether
// there was a real topic at all — 'Free talk' rows (topicTitle undefined,
// per the null-storage rule in createPendingSpeakingFeedback) have
// nothing to check the conversation against, so both the extra system
// instruction and this block are skipped entirely in that case, same
// prompt shape as before this gap-fix.
function buildSpeakingClubTopicNote(topicTitle?: string, cueCardQuestions?: string[]): string | null {
  if (!topicTitle) return null;
  const lines = [`Topic of the day: ${topicTitle}`];
  if (cueCardQuestions && cueCardQuestions.length > 0) {
    lines.push("Cue-card questions offered during this session:");
    for (const q of cueCardQuestions) lines.push(`- ${q}`);
  }
  return lines.join("\n");
}

/**
 * Total seconds this student spent in the shift's call (sum of their speaking_turn_usage reports —
 * a reconnect can mean more than one row). null = unknown (no report, or the lookup failed), in which
 * case the band rule falls back to the word count alone.
 */
async function getCallSeconds(shiftId: string | undefined, studentUsername: string): Promise<number | null> {
  if (!shiftId) return null;
  try {
    const { data, error } = await supabaseServer
      .from("speaking_turn_usage")
      .select("call_duration_seconds")
      .eq("shift_id", shiftId)
      .eq("username", studentUsername);
    if (error || !data || data.length === 0) return null;
    return data.reduce((sum, r) => sum + (Number((r as { call_duration_seconds: number }).call_duration_seconds) || 0), 0);
  } catch {
    return null;
  }
}

/** Sends one transcript to Gemini and parses the structured JSON response. Throws on any failure — the caller decides retry vs terminal-fail. */
async function callGeminiForFeedback(
  ai: GoogleGenAI,
  transcript: string,
  source: MistakeSource,
  topicTitle?: string,
  cueCardQuestions?: string[],
  callSeconds?: number | null
): Promise<GeminiFeedbackResult> {
  // The stored text may end with pronunciation notes under a marker line (see submit-transcript). The spoken
  // words are what gets judged and counted; the notes are only hints for the pronunciation mistakes.
  const split = source === "speaking_club" ? splitPronunciationNotes(transcript) : { spoken: transcript, notes: [] as string[] };
  transcript = split.spoken;
  const pronunciationNotes = split.notes;

  const topicNote = source === "speaking_club" ? buildSpeakingClubTopicNote(topicTitle, cueCardQuestions) : null;

  const baseInstruction = source === "speaking_club" ? SPEAKING_CLUB_SYSTEM_INSTRUCTION : MOCK_TEST_SYSTEM_INSTRUCTION;
  const systemInstruction = [
    baseInstruction,
    MISTAKE_CATEGORY_INSTRUCTION,
    source === "speaking_club" ? MISTAKE_LIMIT_INSTRUCTION : null,
    source === "speaking_club" ? IELTS_EXAMINER_INSTRUCTION : null,
    topicNote ? SPEAKING_CLUB_TOPIC_CHECK_INSTRUCTION : null,
    pronunciationNotes.length > 0 ? PRONUNCIATION_NOTES_INSTRUCTION : null,
  ]
    .filter(Boolean)
    .join("\n");

  const transcriptBlock = `Transcript:\n\n${transcript}`;
  const notesBlock =
    pronunciationNotes.length > 0
      ? `Pronunciation notes (hints from the model that listened to the audio):\n${pronunciationNotes.map((n) => `- ${n}`).join("\n")}`
      : null;
  const userText = [transcriptBlock, notesBlock, topicNote].filter(Boolean).join("\n\n");

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: userText }] }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: responseSchemaFor(source),
    },
  });

  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini");

  const parsed = JSON.parse(text) as GeminiFeedbackResult;
  if (typeof parsed.feedback_summary !== "string" || !Array.isArray(parsed.mistakes)) {
    throw new Error("Malformed Gemini response shape");
  }
  // Defense-in-depth beyond the responseSchema enum above — belt and
  // braces against the model ever emitting a category outside the
  // mistake_logs `check` constraint (sql/schema.sql), which would
  // otherwise fail the insert below for the whole row.
  const validMistakes = parsed.mistakes
    .filter((m) => ALLOWED_CATEGORIES.includes(m?.category) && typeof m?.description === "string" && m.description.trim())
    .map((m) => {
      // Only keep the quote if it really appears in the transcript (loosely: case/punctuation ignored),
      // so a made-up "exact words" never reaches a student. The mistake itself is kept either way and
      // the UI falls back to the description.
      const original = typeof m.original === "string" ? m.original.trim().slice(0, MAX_QUOTE_CHARS) : "";
      const correction = typeof m.correction === "string" ? m.correction.trim().slice(0, MAX_QUOTE_CHARS) : "";
      const quoteOk = original && correction && quoteInTranscript(original, transcript);
      return { ...m, original: quoteOk ? original : null, correction: quoteOk ? correction : null };
    });
  // Speaking Club sessions are long: keep only the first (most important) ones. Mock Test is short and unchanged.
  const mistakes = source === "speaking_club" ? validMistakes.slice(0, MAX_LOGGED_MISTAKES) : validMistakes;

  // Speaking Club: turn the examiner report into the text students read. If the model's report is
  // missing or malformed, fall back to the plain summary (the mistakes list is unaffected either way).
  let feedbackSummary = parsed.feedback_summary;
  if (source === "speaking_club") {
    const report = parseIeltsReport(parsed.ielts_report, transcript);
    if (report) feedbackSummary = formatIeltsFeedback(parsed.feedback_summary, report, transcript, callSeconds, pronunciationNotes);
    else console.error("[speaking-feedback-worker] ielts_report missing/malformed — storing the plain summary only");
  }

  return { feedback_summary: feedbackSummary, mistakes };
}

async function insertMistakeLogs(item: ClaimedItem, result: GeminiFeedbackResult) {
  if (result.mistakes.length === 0) return;
  const rows = result.mistakes.map((m) => ({
    student_username: item.studentUsername,
    source: item.source,
    source_ref_id: item.id,
    category: m.category,
    description: m.description.trim(),
    original_text: m.original ?? null,
    corrected_text: m.correction ?? null,
  }));
  const { error } = await supabaseServer.from("mistake_logs").insert(rows);
  if (error) {
    // The source table's own "done" write (see markSpeakingClubDone /
    // markMockTestDone) already succeeded by the time this runs — the
    // student's feedback (Speaking Club) or the teacher's scoring flow
    // (Mock Test) is unaffected either way. A failure here just means
    // the mentor-facing log undercounts this session; log it loudly
    // rather than throwing and re-marking a genuinely successful row.
    console.error(`[speaking-feedback-worker] ${item.source} ${item.id} done, but mistake_logs insert failed`, error);
  }
}

async function markSpeakingClubDone(item: ClaimedItem, result: GeminiFeedbackResult) {
  const { error } = await supabaseServer
    .from("speaking_feedback")
    .update({ feedback_summary: result.feedback_summary, mistake_count: result.mistakes.length, status: "done", processed_at: new Date().toISOString() })
    .eq("id", item.id);
  if (error) throw error;
  await insertMistakeLogs(item, result);
}

async function markSpeakingClubFailedOrRetry(item: ClaimedItem, reason?: string) {
  const terminal = item.attemptCount >= MAX_ATTEMPTS;
  const base = terminal ? { status: "failed", processed_at: new Date().toISOString() } : { status: "pending" };
  // Keep WHY it failed on the row (Supabase table editor -> speaking_feedback.last_error),
  // so a "Feedback couldn't be generated" doesn't need server logs to diagnose.
  // last_error is a newer column: if the migration hasn't been run, fall back
  // to the plain status update instead of breaking the failure bookkeeping.
  let { error } = await supabaseServer
    .from("speaking_feedback")
    .update(reason ? { ...base, last_error: reason.slice(0, 500) } : base)
    .eq("id", item.id);
  if (error && /last_error/i.test(error.message ?? "")) {
    ({ error } = await supabaseServer.from("speaking_feedback").update(base).eq("id", item.id));
  }
  if (error) throw error;
}

// §7.1: no feedback_summary is stored anywhere for Mock Test (the plan's
// schema only added mistake_log_processed_at/mistake_log_attempt_count,
// no summary column) — the teacher's own manual feedback on
// mock_test_attempts.feedback remains the only student-facing summary
// text for this source. This worker's job for Mock Test is only to
// populate mistake_logs for mentors, per §7.1 step 6's "additive, not a
// replacement" framing.
async function markMockTestDone(item: ClaimedItem, result: GeminiFeedbackResult) {
  const { error } = await supabaseServer.from("mock_test_attempts").update({ mistake_log_processed_at: new Date().toISOString() }).eq("id", item.id);
  if (error) throw error;
  await insertMistakeLogs(item, result);
}

async function markMockTestFailedOrRetry(item: ClaimedItem) {
  // Nothing to write here at all: claimMockTestBatch already persisted
  // the bumped mistake_log_attempt_count when it claimed this row, and
  // mistake_log_processed_at is simply left null. The next run's WHERE
  // clause (mistake_log_attempt_count < MAX_ATTEMPTS) already handles
  // "retry" vs "give up" on its own — see that function's comment.
  void item;
}

// Updates one row; if the update fails only because an OPTIONAL (newer) column isn't in the
// database yet (migration not run), drops that column and retries, so bookkeeping never takes
// the worker down over it.
async function updateRowDroppingMissingColumns(table: string, id: string, patch: Record<string, unknown>, optional: string[]): Promise<void> {
  const current = { ...patch };
  for (let i = 0; i <= optional.length; i++) {
    const { error } = await supabaseServer.from(table).update(current).eq("id", id);
    if (!error) return;
    const missing = optional.find((c) => c in current && new RegExp(c, "i").test(error.message ?? ""));
    if (!missing) throw error;
    delete current[missing];
  }
}

// Gives a claimed-but-never-started item back to the queue, undoing the
// attempt-count bump its claim made (it didn't actually get an attempt).
async function releaseUnstarted(item: ClaimedItem) {
  try {
    if (item.source === "speaking_club") {
      // claimed_at back to null so a row that never ran doesn't count against the per-minute budget.
      await updateRowDroppingMissingColumns("speaking_feedback", item.id, { status: "pending", attempt_count: Math.max(0, item.attemptCount - 1), claimed_at: null }, ["claimed_at"]);
    } else {
      await supabaseServer
        .from("mock_test_attempts")
        .update({ mistake_log_attempt_count: Math.max(0, item.attemptCount - 1) })
        .eq("id", item.id);
    }
  } catch (err) {
    console.error(`[speaking-feedback-worker] could not release ${item.source} ${item.id}`, err);
  }
}

// ---- Gemini 429 handling ------------------------------------------------------------------

export type RateLimitInfo = { cooldownMs: number; reason: string };

/**
 * Recognises a Gemini "slow down / quota used up" error (HTTP 429, RESOURCE_EXHAUSTED) and works out
 * how long to pause. Returns null for every other error (those stay normal failed attempts).
 */
export function classifyRateLimit(err: unknown): RateLimitInfo | null {
  const e = (err ?? {}) as { status?: unknown; code?: unknown; message?: unknown };
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : typeof e.message === "string" ? e.message : "";
  const status = Number(e.status ?? e.code);
  const isRateLimit = status === 429 || /RESOURCE_EXHAUSTED|"code"\s*:\s*429|\b429\b|rate.?limit|quota/i.test(message);
  if (!isRateLimit) return null;

  const daily = /PerDay|per day|daily/i.test(message);
  const delay = message.match(/retry(?:Delay)?["'\s:]*(?:in\s*)?(\d+(?:\.\d+)?)\s*s/i);
  const suggestedMs = delay ? Math.round(Number(delay[1]) * 1000) + 2_000 : 60_000;
  // Daily quota: nothing helps until it resets, so probe only every 30 minutes. Otherwise follow
  // Gemini's own "retry in Ns" hint, kept between 20 seconds and 10 minutes.
  const cooldownMs = daily ? 30 * 60_000 : Math.min(10 * 60_000, Math.max(20_000, suggestedMs));
  return { cooldownMs, reason: `Gemini rate limit (429)${daily ? ", daily quota" : ""} — will retry automatically` };
}

/**
 * Puts a 429'd row back in the queue WITHOUT using up one of its attempts, and pauses the whole
 * queue: the row's claimed_at is set to a moment in the FUTURE, which speakingClubCapacity() reads
 * as "cooling down until then" for every run (no extra table or column needed).
 */
async function markRateLimited(item: ClaimedItem, info: RateLimitInfo) {
  if (item.source === "speaking_club") {
    await updateRowDroppingMissingColumns(
      "speaking_feedback",
      item.id,
      {
        status: "pending",
        attempt_count: Math.max(0, item.attemptCount - 1),
        claimed_at: new Date(Date.now() + info.cooldownMs).toISOString(),
        last_error: info.reason,
      },
      ["last_error", "claimed_at"],
    );
  } else {
    await supabaseServer
      .from("mock_test_attempts")
      .update({ mistake_log_attempt_count: Math.max(0, item.attemptCount - 1) })
      .eq("id", item.id);
  }
}

/**
 * How many more Speaking Club calls may START right now, counted from the database so that
 * overlapping cron runs share one budget:
 *   0                      while the queue is cooling down after a 429,
 *   RPM  - started last 60s,
 *   CONC - calls in flight (processing, claimed within the call timeout + 30s).
 * If the counts can't be read (claimed_at migration not run, DB hiccup) it falls back to the
 * per-run concurrency, so the worker still works, just paced per run only.
 */
async function speakingClubCapacity(): Promise<{ capacity: number; cooling: boolean }> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const minuteAgo = new Date(now - 60_000).toISOString();
  const flightCutoff = new Date(now - (CALL_TIMEOUT_MS + 30_000)).toISOString();
  const count = (q: { count: number | null; error: unknown }) => q.count ?? 0;

  const [cooling, started, inFlight] = await Promise.all([
    supabaseServer.from("speaking_feedback").select("id", { count: "exact", head: true }).eq("status", "pending").gt("claimed_at", nowIso),
    supabaseServer.from("speaking_feedback").select("id", { count: "exact", head: true }).gte("claimed_at", minuteAgo).lte("claimed_at", nowIso),
    supabaseServer.from("speaking_feedback").select("id", { count: "exact", head: true }).eq("status", "processing").gte("claimed_at", flightCutoff),
  ]);
  if (cooling.error || started.error || inFlight.error) {
    console.error("[speaking-feedback-worker] could not read the rate budget — pacing per run only", cooling.error ?? started.error ?? inFlight.error);
    return { capacity: WORKER_CONCURRENCY, cooling: false };
  }
  if (count(cooling) > 0) return { capacity: 0, cooling: true };
  return { capacity: Math.max(0, Math.min(SPEAKING_RPM - count(started), WORKER_CONCURRENCY - count(inFlight))), cooling: false };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type WorkerRunSummary = {
  deferred?: number; // claimed but handed back unstarted (run time budget reached)
  rateLimited?: number; // sent back to the queue after a Gemini 429, attempt not used
  claimed: number;
  claimedSpeakingClub: number;
  claimedMockTest: number;
  succeeded: number;
  failedTerminally: number;
  retrying: number;
  skippedNoApiKey: boolean;
};

/**
 * One cron run. Mock Test rows are claimed as one small batch (own key, low volume). Speaking
 * Club rows are PULLED one at a time by up to WORKER_CONCURRENCY lanes, each pull gated by the
 * shared per-minute / in-flight budget (speakingClubCapacity), so a burst of ~100 transcripts
 * drains at a steady free-tier-safe pace over several runs instead of all at once.
 * Safe to call repeatedly (e.g. once a minute); with nothing pending it's a fast no-op.
 */
export async function processPendingSpeakingFeedbackBatch(): Promise<WorkerRunSummary> {
  const speakingClubApiKey = process.env.GEMINI_SPEAKING_FEEDBACK_API_KEY;
  const mockTestApiKey = process.env.GEMINI_MOCK_TEST_FEEDBACK_API_KEY;

  if (!speakingClubApiKey && !mockTestApiKey) {
    // Graceful degrade, same posture as every other optional-feature key
    // in this codebase (RESEND_API_KEY, GOOGLE_PLACES_API_KEY, etc):
    // don't crash the cron route, just log and leave rows unprocessed
    // for whenever a key gets configured.
    console.error("[speaking-feedback-worker] neither GEMINI_SPEAKING_FEEDBACK_API_KEY nor GEMINI_MOCK_TEST_FEEDBACK_API_KEY is set — skipping this run.");
    return { claimed: 0, claimedSpeakingClub: 0, claimedMockTest: 0, succeeded: 0, failedTerminally: 0, retrying: 0, skippedNoApiKey: true };
  }
  if (!speakingClubApiKey) console.error("[speaking-feedback-worker] GEMINI_SPEAKING_FEEDBACK_API_KEY is not set — Speaking Club rows will sit unprocessed this run.");
  if (!mockTestApiKey) console.error("[speaking-feedback-worker] GEMINI_MOCK_TEST_FEEDBACK_API_KEY is not set — Mock Test rows will sit unprocessed this run.");

  // Two independent clients, one per source's own key — never shared. The timeout cuts off one
  // stuck call (counted as a normal failed attempt) long before Vercel would kill the whole run.
  const httpOptions = { timeout: CALL_TIMEOUT_MS };
  const aiBySource: Partial<Record<MistakeSource, GoogleGenAI>> = {};
  if (speakingClubApiKey) aiBySource.speaking_club = new GoogleGenAI({ apiKey: speakingClubApiKey, httpOptions });
  if (mockTestApiKey) aiBySource.mock_test = new GoogleGenAI({ apiKey: mockTestApiKey, httpOptions });

  let claimedSpeakingClub = 0;
  let succeeded = 0;
  let failedTerminally = 0;
  let retrying = 0;
  let deferred = 0;
  let rateLimited = 0;
  const runStartedAt = Date.now();
  const outOfTime = () => Date.now() - runStartedAt > RUN_TIME_BUDGET_MS;
  const rateLimitedSources = new Set<MistakeSource>(); // a 429 stops new calls for that source for the rest of this run

  const claimedMockTest = mockTestApiKey ? await claimMockTestBatch(BATCH_SIZE) : [];

  async function processItem(item: ClaimedItem) {
    try {
      const ai = aiBySource[item.source]!; // present: the item was only claimed because its source's key exists
      const callSeconds = item.source === "speaking_club" ? await getCallSeconds(item.shiftId, item.studentUsername) : null;
      const result = await callGeminiForFeedback(ai, item.transcript, item.source, item.topicTitle, item.cueCardQuestions, callSeconds);
      if (item.source === "speaking_club") await markSpeakingClubDone(item, result);
      else await markMockTestDone(item, result);
      succeeded++;
    } catch (err) {
      const limit = classifyRateLimit(err);
      if (limit) {
        console.error(`[speaking-feedback-worker] ${item.source} ${item.id} hit a Gemini rate limit — back in the queue, pausing ${Math.round(limit.cooldownMs / 1000)}s`, err instanceof Error ? err.message : err);
        rateLimitedSources.add(item.source);
        rateLimited++;
        try {
          await markRateLimited(item, limit);
        } catch (writeErr) {
          console.error(`[speaking-feedback-worker] could not requeue ${item.source} ${item.id} after a rate limit`, writeErr);
        }
        return;
      }
      console.error(`[speaking-feedback-worker] attempt ${item.attemptCount}/${MAX_ATTEMPTS} failed for ${item.source} ${item.id}`, err);
      try {
        if (item.source === "speaking_club") {
          await markSpeakingClubFailedOrRetry(item, err instanceof Error ? err.message : String(err));
        } else await markMockTestFailedOrRetry(item);
      } catch (writeErr) {
        // If even the failure-bookkeeping write fails, the row may be
        // stuck (e.g. Speaking Club stuck at 'processing') until
        // manually reset — log loudly so it shows up in Phase G
        // monitoring rather than silently vanishing.
        console.error(`[speaking-feedback-worker] could not update status after failure for ${item.source} ${item.id}`, writeErr);
      }
      if (item.attemptCount >= MAX_ATTEMPTS) failedTerminally++;
      else retrying++;
    }
  }

  // --- Speaking Club: lanes pull rows one by one, gated by the shared budget -------------------
  const startTimes: number[] = []; // this run's own call starts, a second guard next to the DB count
  let nextCapacityCheckAt = 0; // when the budget is used up, ONE check per few seconds is shared by all lanes
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = lock.then(fn, fn);
    lock = next.catch(() => undefined);
    return next;
  };

  /** Next row to process, or null when this lane should stop (queue empty, out of time, or cooling down). */
  async function pullSpeakingClubItem(): Promise<ClaimedItem | null> {
    for (;;) {
      if (outOfTime() || rateLimitedSources.has("speaking_club")) return null;
      const pulled = await exclusive(async () => {
        if (Date.now() < nextCapacityCheckAt) return "wait" as const;
        const recent = startTimes.filter((t) => Date.now() - t < 60_000).length;
        const budget = await speakingClubCapacity();
        // Queue is cooling down after a 429 (in an earlier run): nothing to do until it ends.
        if (budget.cooling) return "empty" as const;
        if (Math.min(SPEAKING_RPM - recent, budget.capacity) <= 0) {
          nextCapacityCheckAt = Date.now() + CAPACITY_RECHECK_MS;
          return "wait" as const;
        }
        const { items, drained } = await claimSpeakingFeedbackBatch(1);
        if (drained) return "empty" as const;
        if (items.length === 0) return "again" as const; // lost the race for that row, or it had no transcript — look again
        startTimes.push(Date.now());
        claimedSpeakingClub++;
        return items[0];
      });
      if (pulled === "empty") return null;
      if (pulled === "wait") {
        await sleep(Math.max(250, nextCapacityCheckAt - Date.now()));
        continue;
      }
      if (pulled === "again") continue;
      return pulled;
    }
  }

  const speakingLane = async () => {
    for (;;) {
      const item = await pullSpeakingClubItem();
      if (!item) return;
      await processItem(item);
    }
  };

  const speakingLanes = speakingClubApiKey
    ? (async () => {
        await reclaimStaleSpeakingRows();
        await Promise.all(Array.from({ length: WORKER_CONCURRENCY }, speakingLane));
      })()
    : Promise.resolve();

  // --- Mock Test: the small pre-claimed batch, two at a time -------------------------------------
  const mockTestPool = runPool(claimedMockTest, 2, processItem, {
    // Checked before each row is STARTED: out of time (or rate limited) -> hand the row back untouched.
    shouldStop: (item) => outOfTime() || rateLimitedSources.has(item.source),
    onSkipped: async (item) => {
      await releaseUnstarted(item);
      deferred++;
    },
  });

  await Promise.all([speakingLanes, mockTestPool]);

  const claimed = claimedSpeakingClub + claimedMockTest.length;
  return {
    claimed,
    claimedSpeakingClub,
    claimedMockTest: claimedMockTest.length,
    succeeded,
    failedTerminally,
    retrying,
    deferred,
    rateLimited,
    skippedNoApiKey: false,
  };
}
