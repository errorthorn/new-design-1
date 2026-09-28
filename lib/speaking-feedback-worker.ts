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
import { GoogleGenAI, Type } from "@google/genai";
import { supabaseServer } from "@/lib/supabase";

const MODEL = "gemini-2.5-flash-lite"; // plan §3: "Gemini Flash-Lite free tier"

// Plan §3: "a safe processing rate of 10 requests/minute (deliberately
// under the 15 RPM floor, for margin)". The cron route runs once a
// minute. Now applied PER SOURCE (see the separate-keys note above) —
// each source can claim up to this many rows a minute against its own
// key's own RPM ceiling, independent of the other source's volume.
const BATCH_SIZE = 10;

// Plan §5 step 6 (Speaking Club) / §7.1 gap-fix (Mock Test, see the
// mistake_log_attempt_count column comment in sql/schema.sql): 3 total
// attempts before giving up on a row.
const MAX_ATTEMPTS = 3;

const ALLOWED_CATEGORIES = ["grammar", "vocabulary", "pronunciation", "fluency", "coherence"] as const;
type Category = (typeof ALLOWED_CATEGORIES)[number];

type MistakeSource = "speaking_club" | "mock_test";

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
};

type GeminiFeedbackResult = {
  feedback_summary: string;
  mistakes: { category: Category; description: string }[];
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
          description: {
            type: Type.STRING,
            description:
              "The specific mistake, described in general teaching terms (e.g. 'confused past simple and present perfect when describing a finished action') — NOT a verbatim quote from the transcript.",
          },
        },
        required: ["category", "description"],
      },
    },
  },
  required: ["feedback_summary", "mistakes"],
};

// Two near-identical system instructions — kept separate (not one prompt
// with an if/else inside it) because "conversation practice with a
// partner" vs "an AI examiner interview" are different enough contexts
// that collapsing them into one generic wording would blur the
// pronunciation-flagging caveat and the overall tone for both.
const SPEAKING_CLUB_SYSTEM_INSTRUCTION = [
  "You are an English speaking coach for LingoCraft's Speaking Club, reviewing a transcript of a student's live conversation practice with a partner.",
  "The transcript was captured by the browser's own speech recognition, so expect occasional transcription noise (misheard words, missing punctuation) — don't treat that noise itself as a student mistake.",
  "Write a short, encouraging overall summary of how the student did, then list every genuine mistake you find as a separate item, each tagged with exactly one category: grammar, vocabulary, pronunciation (only flag this if the transcript's word choice/spelling clearly implies a mispronunciation, since you cannot hear audio), fluency, or coherence.",
  "Describe each mistake in general, reusable teaching terms — never quote the transcript verbatim.",
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
  "Describe each mistake in general, reusable teaching terms — never quote the transcript verbatim.",
  "Only include real mistakes; a short or simple correct sentence is not a mistake.",
  "This is a SEPARATE, additional output from the teacher's own manual band-score feedback on this attempt — you are not producing a band score, only a categorized mistake list for mentors.",
].join("\n");

/**
 * Claims up to `limit` pending speaking_feedback rows by flipping them to
 * 'processing' and bumping each row's own attempt_count.
 *
 * NOT protected against a concurrent second worker invocation racing
 * this one (no SELECT ... FOR UPDATE SKIP LOCKED here) — acceptable
 * given the plan's own model of this worker (§3/§6 Phase D: one
 * scheduler hitting one cron route once a minute), the same
 * single-writer assumption the rest of this feature's throttling math
 * already relies on. Revisit if the scheduler is ever configured to
 * overlap invocations.
 */
async function claimSpeakingFeedbackBatch(limit: number): Promise<ClaimedItem[]> {
  if (limit <= 0) return [];

  const { data: candidates, error: selectError } = await supabaseServer
    .from("speaking_feedback")
    .select("id, student_username, transcript, attempt_count, topic_title, cue_card_questions")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (selectError) throw selectError;
  if (!candidates || candidates.length === 0) return [];

  // Individual updates (not a single bulk .update().in()) because each
  // row needs its OWN attempt_count + 1, not the same value applied to
  // all of them — capped at BATCH_SIZE, so a handful of small, cheap
  // writes, not a real cost concern.
  const claimed: ClaimedItem[] = [];
  for (const row of candidates as {
    id: string;
    student_username: string;
    transcript: string | null;
    attempt_count: number;
    topic_title: string | null;
    cue_card_questions: string[] | null;
  }[]) {
    const nextAttemptCount = row.attempt_count + 1;
    const { error: claimError } = await supabaseServer
      .from("speaking_feedback")
      .update({ status: "processing", attempt_count: nextAttemptCount })
      .eq("id", row.id);
    if (claimError) throw claimError;
    if (row.transcript && row.transcript.trim()) {
      claimed.push({
        source: "speaking_club",
        id: row.id,
        studentUsername: row.student_username,
        transcript: row.transcript,
        attemptCount: nextAttemptCount,
        topicTitle: row.topic_title ?? undefined,
        cueCardQuestions: row.cue_card_questions ?? undefined,
      });
    } else {
      // Shouldn't happen — Phase C rejects empty transcripts before ever
      // creating a row — but if it does, don't send an empty prompt to
      // Gemini; just mark it done-with-nothing so it stops being reclaimed.
      console.error(`[speaking-feedback-worker] speaking_feedback ${row.id} claimed with no transcript — marking done with 0 mistakes`);
      void supabaseServer.from("speaking_feedback").update({ status: "done", feedback_summary: null, mistake_count: 0, processed_at: new Date().toISOString() }).eq("id", row.id);
    }
  }

  return claimed;
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
    const { error: claimError } = await supabaseServer.from("mock_test_attempts").update({ mistake_log_attempt_count: nextAttemptCount }).eq("id", row.id);
    if (claimError) throw claimError;
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

/** Sends one transcript to Gemini and parses the structured JSON response. Throws on any failure — the caller decides retry vs terminal-fail. */
async function callGeminiForFeedback(
  ai: GoogleGenAI,
  transcript: string,
  source: MistakeSource,
  topicTitle?: string,
  cueCardQuestions?: string[]
): Promise<GeminiFeedbackResult> {
  const topicNote = source === "speaking_club" ? buildSpeakingClubTopicNote(topicTitle, cueCardQuestions) : null;

  const baseInstruction = source === "speaking_club" ? SPEAKING_CLUB_SYSTEM_INSTRUCTION : MOCK_TEST_SYSTEM_INSTRUCTION;
  const systemInstruction = topicNote ? `${baseInstruction}\n${SPEAKING_CLUB_TOPIC_CHECK_INSTRUCTION}` : baseInstruction;

  const userText = topicNote ? `Transcript:\n\n${transcript}\n\n${topicNote}` : `Transcript:\n\n${transcript}`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: userText }] }],
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
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
  const mistakes = parsed.mistakes.filter((m) => ALLOWED_CATEGORIES.includes(m?.category) && typeof m?.description === "string" && m.description.trim());

  return { feedback_summary: parsed.feedback_summary, mistakes };
}

async function insertMistakeLogs(item: ClaimedItem, result: GeminiFeedbackResult) {
  if (result.mistakes.length === 0) return;
  const rows = result.mistakes.map((m) => ({
    student_username: item.studentUsername,
    source: item.source,
    source_ref_id: item.id,
    category: m.category,
    description: m.description.trim(),
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

async function markSpeakingClubFailedOrRetry(item: ClaimedItem) {
  const terminal = item.attemptCount >= MAX_ATTEMPTS;
  const { error } = await supabaseServer
    .from("speaking_feedback")
    .update(terminal ? { status: "failed", processed_at: new Date().toISOString() } : { status: "pending" })
    .eq("id", item.id);
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

export type WorkerRunSummary = {
  claimed: number;
  claimedSpeakingClub: number;
  claimedMockTest: number;
  succeeded: number;
  failedTerminally: number;
  retrying: number;
  skippedNoApiKey: boolean;
};

/**
 * Processes one batch of pending rows from Speaking Club and one from
 * Mock Test — each against its own Gemini API key (see the separate-keys
 * note in the file header), so neither source's volume can starve the
 * other's quota. Safe to call repeatedly (e.g. once a minute) — a run
 * with nothing pending in either source, or with no keys configured at
 * all, is a fast no-op.
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

  // Each source claims against its own full BATCH_SIZE — no more
  // borrow/give-back split, since there's no shared quota to divide
  // anymore (see file header). A source with no key configured simply
  // doesn't claim anything this run, rather than claiming rows it can't
  // actually process.
  const claimedSpeakingClub = speakingClubApiKey ? await claimSpeakingFeedbackBatch(BATCH_SIZE) : [];
  const claimedMockTest = mockTestApiKey ? await claimMockTestBatch(BATCH_SIZE) : [];

  const claimed = [...claimedSpeakingClub, ...claimedMockTest];
  if (claimed.length === 0) {
    return { claimed: 0, claimedSpeakingClub: 0, claimedMockTest: 0, succeeded: 0, failedTerminally: 0, retrying: 0, skippedNoApiKey: false };
  }

  // Two independent clients, one per source's own key — never shared.
  const aiBySource: Partial<Record<MistakeSource, GoogleGenAI>> = {};
  if (speakingClubApiKey) aiBySource.speaking_club = new GoogleGenAI({ apiKey: speakingClubApiKey });
  if (mockTestApiKey) aiBySource.mock_test = new GoogleGenAI({ apiKey: mockTestApiKey });

  let succeeded = 0;
  let failedTerminally = 0;
  let retrying = 0;

  // Still sequential, even across two different keys/clients — simplest
  // way to keep each source's own throttling predictable (BATCH_SIZE
  // rows against BATCH_SIZE-per-minute headroom) without the two loops
  // racing each other via concurrent requests on top of each key's own
  // rate limit.
  for (const item of claimed) {
    try {
      const ai = aiBySource[item.source]!; // guaranteed present: this item was only claimed because its source's key exists
      const result = await callGeminiForFeedback(ai, item.transcript, item.source, item.topicTitle, item.cueCardQuestions);
      if (item.source === "speaking_club") await markSpeakingClubDone(item, result);
      else await markMockTestDone(item, result);
      succeeded++;
    } catch (err) {
      console.error(`[speaking-feedback-worker] attempt ${item.attemptCount}/${MAX_ATTEMPTS} failed for ${item.source} ${item.id}`, err);
      try {
        if (item.source === "speaking_club") await markSpeakingClubFailedOrRetry(item);
        else await markMockTestFailedOrRetry(item);
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

  return {
    claimed: claimed.length,
    claimedSpeakingClub: claimedSpeakingClub.length,
    claimedMockTest: claimedMockTest.length,
    succeeded,
    failedTerminally,
    retrying,
    skippedNoApiKey: false,
  };
}

