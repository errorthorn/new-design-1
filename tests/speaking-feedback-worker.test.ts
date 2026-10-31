import { beforeEach, describe, expect, it, vi } from "vitest";

// End-to-end through the real worker with Gemini and Supabase faked: what the model returns must
// end up as (1) the feedback text the student reads and (2) rows in mistake_logs, with the
// instructions Gemini receives still carrying the mistake-log rules.

type Call = { table: string; op: string; payload?: unknown };
const calls: Call[] = [];
let pendingRow: Record<string, unknown> | null = null;
// The worker now pulls rows one by one until the queue is empty, so the fake queue hands the row out once.
let pendingServed = false;
let geminiReply: unknown = null;
const geminiRequests: { config: Record<string, unknown>; contents: { parts: { text: string }[] }[] }[] = [];

vi.mock("@google/genai", async () => {
  const actual = await vi.importActual<typeof import("@google/genai")>("@google/genai");
  class GoogleGenAI {
    models = {
      generateContent: async (req: (typeof geminiRequests)[number]) => {
        geminiRequests.push(req);
        return { text: JSON.stringify(geminiReply) };
      },
    };
  }
  return { ...actual, GoogleGenAI };
});

vi.mock("@/lib/supabase", () => {
  const builder = (table: string) => {
    const state: { op: string; payload?: unknown; returning: boolean; head: boolean } = { op: "select", returning: false, head: false };
    const api: Record<string, unknown> = {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        if (state.op === "update") state.returning = true;
        if (opts?.head) state.head = true;
        return api;
      },
      update: (payload: unknown) => {
        state.op = "update";
        state.payload = payload;
        return api;
      },
      insert: (payload: unknown) => {
        state.op = "insert";
        state.payload = payload;
        return api;
      },
      eq: () => api,
      lt: () => api,
      gt: () => api,
      gte: () => api,
      lte: () => api,
      in: () => api,
      order: () => api,
      limit: () => api,
      then: (resolve: (v: unknown) => unknown) => {
        calls.push({ table, op: state.op, payload: state.payload });
        let result: unknown = { data: null, error: null };
        if (table === "speaking_feedback" && state.op === "select" && state.head) {
          result = { data: null, count: 0, error: null }; // the worker's rate-budget counts: nothing in flight, nothing cooling down
        } else if (table === "speaking_feedback" && state.op === "select") {
          const served = pendingServed ? [] : pendingRow ? [pendingRow] : [];
          if (served.length > 0) pendingServed = true;
          result = { data: served, error: null };
        } else if (state.op === "update" && state.returning) {
          result = { data: [{ id: "row-1" }], error: null };
        }
        return Promise.resolve(result).then(resolve);
      },
    };
    return api;
  };
  return { supabaseServer: { from: builder } };
});

import { processPendingSpeakingFeedbackBatch } from "@/lib/speaking-feedback-worker";
import { MAX_LOGGED_MISTAKES, MISTAKE_CATEGORY_INSTRUCTION, MISTAKE_LIMIT_INSTRUCTION, PRONUNCIATION_NOTES_INSTRUCTION } from "@/lib/speaking-ielts-feedback";
import { joinPronunciationNotes } from "@/lib/speaking-club/pronunciation-notes";

const crit = (band: number) => ({
  band,
  what_worked: "Kept talking.",
  to_improve: [{ example: "I go yesterday", issue: "needs past", better: "I went yesterday", type: "tense", how_to_improve: "Use past simple." }],
});

const modelReply = () => ({
  feedback_summary: "Good effort overall.",
  mistakes: [
    { category: "grammar", original: "word word word", correction: "words words words", description: "used present simple for a finished past action" },
    { category: "vocabulary", original: "never said this", correction: "made up quote", description: "repeated the basic adjective 'good' instead of a precise one" },
    { category: "pronunciation", description: "the th sound in words like think is pronounced as s" },
    { category: "spelling", description: "not an allowed category, must be dropped" },
  ],
  ielts_report: {
    fluency_coherence: crit(6),
    lexical_resource: crit(6),
    grammatical_range_accuracy: crit(5.5),
    better_version: { original: "I go yesterday.", improved: "I went yesterday." },
    pronunciation_tips: [{ word: "think", issue: "th sounded like s", how_to_fix: "Tongue between the teeth." }],
    improvement_plan: [{ skill: "Past simple", why_it_matters: "Tense errors cost band score", exercise: "Retell yesterday." }],
    final_message: "Nice work.",
  },
});

const longSpeech = Array(150).fill("word").join(" ");

describe("speaking feedback worker: feedback text and mistake log", () => {
  beforeEach(() => {
    calls.length = 0;
    geminiRequests.length = 0;
    pendingServed = false;
    process.env.GEMINI_SPEAKING_FEEDBACK_API_KEY = "test-key";
    delete process.env.GEMINI_MOCK_TEST_FEEDBACK_API_KEY;
    geminiReply = modelReply();
    pendingRow = {
      id: "row-1",
      shift_id: null,
      student_username: "student@example.com",
      transcript: joinPronunciationNotes(longSpeech, ["think: heard as 'sink' (th pronounced as s)"]),
      attempt_count: 0,
      topic_title: null,
      cue_card_questions: null,
    };
  });

  it("stores the full coach feedback and writes the mistakes to mistake_logs", async () => {
    const summary = await processPendingSpeakingFeedbackBatch();
    expect(summary).toMatchObject({ claimed: 1, succeeded: 1, failedTerminally: 0 });

    const done = calls.find((c) => c.table === "speaking_feedback" && (c.payload as { status?: string })?.status === "done");
    const stored = done!.payload as { feedback_summary: string; mistake_count: number };
    expect(stored.feedback_summary).toContain("Estimated IELTS Speaking band");
    expect(stored.feedback_summary).toContain("WHAT TO PRACTISE");
    expect(stored.feedback_summary).toContain("✘ think — th sounded like s");
    expect(stored.mistake_count).toBe(3); // the invalid 'spelling' entry is dropped

    const inserted = calls.find((c) => c.table === "mistake_logs" && c.op === "insert");
    expect(inserted!.payload).toEqual([
      { student_username: "student@example.com", source: "speaking_club", source_ref_id: "row-1", category: "grammar", description: "used present simple for a finished past action", original_text: "word word word", corrected_text: "words words words" },
      // quote not found in the transcript -> mistake kept, but the made-up quote is dropped
      { student_username: "student@example.com", source: "speaking_club", source_ref_id: "row-1", category: "vocabulary", description: "repeated the basic adjective 'good' instead of a precise one", original_text: null, corrected_text: null },
      { student_username: "student@example.com", source: "speaking_club", source_ref_id: "row-1", category: "pronunciation", description: "the th sound in words like think is pronounced as s", original_text: null, corrected_text: null },
    ]);
  });

  it("still asks Gemini for the mistakes list, with the category rules and the no-quote rule", async () => {
    await processPendingSpeakingFeedbackBatch();
    const req = geminiRequests[0];
    const instruction = String(req.config.systemInstruction);
    expect(instruction).toContain(MISTAKE_CATEGORY_INSTRUCTION);
    expect(instruction).toContain("copy the student's EXACT words from the transcript into `original`"); // base rule for the mistakes list
    expect(instruction).toContain("Keep this report consistent with the mistakes list");
    expect(instruction).toContain(PRONUNCIATION_NOTES_INSTRUCTION); // the transcript carried notes
    const schema = req.config.responseSchema as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required).toEqual(expect.arrayContaining(["feedback_summary", "mistakes", "ielts_report"]));
    expect(Object.keys(schema.properties)).toContain("mistakes");
    // the model sees the spoken words and the notes separately, and the notes never count as speech
    const userText = req.contents[0].parts[0].text;
    expect(userText).toContain("Pronunciation notes (hints from the model that listened to the audio):");
    expect(userText).toContain("- think: heard as 'sink'");
    expect(userText.split("Pronunciation notes")[0]).not.toContain("think: heard");
  });

  it("without pronunciation notes the pronunciation instruction and tips are left out", async () => {
    pendingRow!.transcript = longSpeech;
    await processPendingSpeakingFeedbackBatch();
    expect(String(geminiRequests[0].config.systemInstruction)).not.toContain(PRONUNCIATION_NOTES_INSTRUCTION);
    const done = calls.find((c) => c.table === "speaking_feedback" && (c.payload as { status?: string })?.status === "done");
    const text = (done!.payload as { feedback_summary: string }).feedback_summary;
    expect(text).not.toContain("th sounded like s"); // the model's tip is ignored without notes
    expect(text).toContain("PRONUNCIATION — No clear pronunciation mistakes were picked up from your audio");
  });

  it("a malformed report still saves the plain summary and the mistake log", async () => {
    geminiReply = { ...modelReply(), ielts_report: { fluency_coherence: "oops" } };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await processPendingSpeakingFeedbackBatch();
    const done = calls.find((c) => c.table === "speaking_feedback" && (c.payload as { status?: string })?.status === "done");
    expect((done!.payload as { feedback_summary: string }).feedback_summary).toBe("Good effort overall.");
    expect(calls.some((c) => c.table === "mistake_logs" && c.op === "insert")).toBe(true);
  });

  it(`logs at most ${MAX_LOGGED_MISTAKES} mistakes per session, keeping the most important (first) ones`, async () => {
    const many = Array.from({ length: MAX_LOGGED_MISTAKES + 20 }, (_, i) => ({ category: "grammar", description: `mistake number ${i + 1}` }));
    geminiReply = { ...modelReply(), mistakes: many };
    await processPendingSpeakingFeedbackBatch();

    const rows = calls.find((c) => c.table === "mistake_logs" && c.op === "insert")!.payload as { description: string }[];
    expect(rows).toHaveLength(MAX_LOGGED_MISTAKES);
    expect(rows[0].description).toBe("mistake number 1");
    expect(rows[MAX_LOGGED_MISTAKES - 1].description).toBe(`mistake number ${MAX_LOGGED_MISTAKES}`);
    const done = calls.find((c) => c.table === "speaking_feedback" && (c.payload as { status?: string })?.status === "done");
    expect((done!.payload as { mistake_count: number }).mistake_count).toBe(MAX_LOGGED_MISTAKES);

    const req = geminiRequests[0];
    expect(String(req.config.systemInstruction)).toContain(MISTAKE_LIMIT_INSTRUCTION);
    const schema = req.config.responseSchema as { properties: { mistakes: { description: string } } };
    expect(schema.properties.mistakes.description).toContain(`at most ${MAX_LOGGED_MISTAKES}`);
  });
});

