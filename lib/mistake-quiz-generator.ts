// lib/mistake-quiz-generator.ts
//
// Gap-fix requested after the admin feedback viewer (see
// app/admin/speaking-club/page.tsx "Feedback" tab / lib/speaking-feedback-db.ts):
// admin wanted a quiz that stays tied to what Speaking Club students are
// actually getting wrong, rather than a fixed hand-written set — i.e.
// "analyze everyone's mistake_logs, turn the common ones into professional
// quiz questions, and keep doing that on a schedule."
//
// This is the SAME shape as lib/speaking-feedback-worker.ts (one Gemini
// call, structured JSON output, a dedicated cron route hits a
// process*() export on a timer) but for a completely different table —
// deliberately its own file rather than folded into the feedback worker,
// since "read mistake_logs, write quizzes/quiz_questions" shares no
// tables with "read speaking_feedback, write speaking_feedback +
// mistake_logs".
//
// One NEW quiz row per day. Each daily run reads the last 24 hours of
// Speaking Club mistake_logs (all students), has Gemini turn the common
// patterns into fresh MCQs, and publishes that day's quiz automatically
// (identified by quizzes.auto_source = 'speaking_club_mistakes', see
// sql/schema.sql, never by title). Earlier days' quizzes are left alone, so
// students' attempts, scores and Mistake Log entries stay valid and every
// day's quiz can be taken once. When a new day's quiz is published, the
// earlier auto quizzes are unpublished (not deleted), so students only ever
// see the newest one. Re-running on the same (Asia/Dhaka) day
// regenerates THAT day's questions in place, unless a student has already
// attempted it - then the run is skipped so nobody's answers are
// orphaned. An admin can still unpublish/rename any quiz in the admin UI.
import { GoogleGenAI, Type } from "@google/genai";
import { supabaseServer } from "@/lib/supabase";

// Same model/tier (and the same GEMINI_TEXT_MODEL override) as speaking-feedback-worker.ts.
const MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3.1-flash-lite";

// How far back to pull mistake_logs from on each run: "today's" mistakes.
// The cron runs once a day, so a rolling 24 hours means each daily quiz is
// built from what students got wrong since the previous run.
const LOOKBACK_HOURS = 24;

// Defensive cap on how many mistake_logs rows go into the prompt — this
// codebase's existing precedent (MAX_TRANSCRIPT_CHARS in
// speaking-feedback-db.ts) is "truncate rather than reject," same idea
// here: a very active day just analyzes its most recent 600, not all of them.
const MAX_MISTAKES_FOR_PROMPT = 600;

// Below this many mistakes in the window, there isn't enough signal for
// "common mistakes" to mean anything — skip the run entirely rather than
// generating a thin/repetitive quiz from a handful of data points.
const MIN_MISTAKES_REQUIRED = 8;

// 300 students sharing one quiz needs real breadth, not a quick 12-item
// check — 45 gives each of the four core categories below a solid dozen
// without any single one dominating the whole quiz.
const TARGET_QUESTION_COUNT = 45;

const AUTO_SOURCE = "speaking_club_mistakes";
const QUIZ_TITLE_PREFIX = "Speaking Club: Common Mistakes";

// Asia/Dhaka is UTC+6 all year (no DST) - the app's "day" boundary.
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
function startOfTodayDhaka(now = Date.now()): Date {
  const shifted = now + DHAKA_OFFSET_MS;
  const dayStartShifted = shifted - (shifted % (24 * 60 * 60 * 1000));
  return new Date(dayStartShifted - DHAKA_OFFSET_MS);
}
function dhakaDateLabel(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", year: "numeric" }).format(now);
}

// The four skill areas Speaking Club mistakes actually get tagged with
// day to day (mirrors ALLOWED_CATEGORIES in speaking-feedback-worker.ts
// minus "coherence," which is real but rare in practice and folds
// naturally into fluency-style linking-word questions when it does show
// up). The quiz always covers all four, regardless of which categories
// happen to dominate this particular window's raw mistake counts — see
// MIN_QUESTIONS_PER_CORE_CATEGORY below.
const CORE_CATEGORIES = ["grammar", "vocabulary", "pronunciation", "fluency"] as const;
const MIN_QUESTIONS_PER_CORE_CATEGORY = Math.floor(TARGET_QUESTION_COUNT / CORE_CATEGORIES.length); // 11

const ALLOWED_CATEGORIES = ["grammar", "vocabulary", "pronunciation", "fluency", "coherence"] as const;
type Category = (typeof ALLOWED_CATEGORIES)[number];

type GeneratedQuestion = {
  category: Category;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      description: `${TARGET_QUESTION_COUNT} multiple-choice questions, at least ${MIN_QUESTIONS_PER_CORE_CATEGORY} from each of grammar/vocabulary/pronunciation/fluency, weighted beyond that toward whichever specific patterns show up most often in the mistake list.`,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, enum: [...ALLOWED_CATEGORIES] },
          question: {
            type: Type.STRING,
            description: "A standalone MCQ testing the underlying rule behind one common mistake pattern — never a direct copy of any student's own sentence.",
          },
          options: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Exactly 4 answer options.",
          },
          correctIndex: { type: Type.INTEGER, description: "0-based index into options of the correct answer." },
          explanation: { type: Type.STRING, description: "1-2 sentences on why the correct answer is right, teaching the rule." },
        },
        required: ["category", "question", "options", "correctIndex", "explanation"],
      },
    },
  },
  required: ["questions"],
};

const SYSTEM_INSTRUCTION = [
  "You are writing a professional English-practice quiz for LingoCraft, an IELTS-prep platform.",
  `You will be given a list of real mistakes (category + description) drawn from many different students' Speaking Club sessions over the last ${LOOKBACK_HOURS} hours.`,
  "First, silently identify the mistake PATTERNS that recur most often across the list — don't treat every line as equally important, some will repeat the same underlying issue in different words.",
  `Then write exactly ${TARGET_QUESTION_COUNT} original multiple-choice questions covering those recurring patterns. This quiz is shared by around 300 students, so it must have real breadth: you MUST include at least ${MIN_QUESTIONS_PER_CORE_CATEGORY} questions for EACH of these four core categories — grammar, vocabulary, pronunciation, fluency — even if one category's mistakes are rarer than the others in the data (fall back to that category's most common general Speaking-Club-level pitfalls if a category is thin on real data). Beyond that per-category minimum, weight the remaining questions by how often each specific pattern actually recurs. Only use the "coherence" category, and only a few questions of it, if the data shows a clear, recurring coherence problem (e.g. missing linking words/discourse markers) — never invent coherence questions just to fill a quota.`,
  "Each question must be a standalone, general English-practice question — never a direct quote or thin rewrite of any single student's mistake. Write it as a professional test-prep item (clear stem, 4 plausible options, one clearly correct answer, a short teaching explanation), the same quality bar as a published IELTS practice book.",
  "Avoid near-duplicate questions — even within the same category, each question should test a distinct rule or word/sound, not the same point reworded.",
].join("\n");

export type MistakeQuizGenerationResult =
  | { generated: true; quizId: string; questionCount: number; mistakesAnalyzed: number }
  | { generated: false; reason: "no_api_key" | "not_enough_data" | "already_taken"; mistakesAnalyzed: number };

type TodaysQuiz = { id: string; isNew: boolean; needsPublish: boolean };

// Today's (Asia/Dhaka) auto quiz: reuse it if a run already created one
// today, otherwise create a fresh one. New rows start UNPUBLISHED and are
// published only after their questions are in (see the caller), so students
// never see an empty quiz. `auto_mistakes_analyzed` is only written at the
// very end of a successful run, so null means "a previous run died midway"
// and this run should still publish it.
async function findOrCreateTodaysQuiz(): Promise<TodaysQuiz> {
  const since = startOfTodayDhaka().toISOString();
  const { data: found, error: findError } = await supabaseServer
    .from("quizzes")
    .select("id, auto_mistakes_analyzed, published")
    .eq("auto_source", AUTO_SOURCE)
    .gte("auto_generated_at", since)
    .order("auto_generated_at", { ascending: false })
    .limit(1);
  if (findError) throw findError;
  const existing = found?.[0];
  if (existing) {
    return { id: existing.id, isNew: false, needsPublish: existing.auto_mistakes_analyzed == null && !existing.published };
  }

  const now = new Date();
  const { data: created, error: createError } = await supabaseServer
    .from("quizzes")
    .insert({
      title: `${QUIZ_TITLE_PREFIX} \u2014 ${dhakaDateLabel(now)}`,
      description: "Auto-generated from today's Speaking Club mistakes.",
      published: false,
      // Negative epoch seconds: the student list sorts by position ascending,
      // so the newest daily quiz shows first (manual quizzes keep 0..n).
      position: -Math.floor(now.getTime() / 1000),
      auto_source: AUTO_SOURCE,
      auto_generated_at: now.toISOString(),
    })
    .select("id")
    .single();
  if (createError) throw createError;
  return { id: created.id, isNew: true, needsPublish: true };
}

async function callGeminiForQuiz(ai: GoogleGenAI, mistakeLines: string[]): Promise<GeneratedQuestion[]> {
  const userText = `Mistakes (one per line, "category: description"):\n\n${mistakeLines.join("\n")}`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: userText }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini");

  const parsed = JSON.parse(text) as { questions: GeneratedQuestion[] };
  if (!Array.isArray(parsed.questions)) throw new Error("Malformed Gemini response shape");

  // Defense-in-depth, same posture as speaking-feedback-worker.ts's
  // ALLOWED_CATEGORIES filter: drop anything that wouldn't satisfy the
  // quiz_questions table's own constraints rather than let one bad item
  // fail the whole insert.
  const validated = parsed.questions.filter(
    (q) =>
      ALLOWED_CATEGORIES.includes(q?.category) &&
      typeof q?.question === "string" &&
      q.question.trim() &&
      Array.isArray(q?.options) &&
      q.options.length >= 2 &&
      q.options.every((o) => typeof o === "string" && o.trim()) &&
      Number.isInteger(q?.correctIndex) &&
      q.correctIndex >= 0 &&
      q.correctIndex < q.options.length &&
      typeof q?.explanation === "string"
  );

  // Best-effort check, not enforced — Gemini can still fall short of the
  // per-category minimum stated in SYSTEM_INSTRUCTION despite the
  // schema-level nudge. Logged so a thin category is visible in cron
  // logs rather than only discoverable by an admin scrolling the quiz.
  for (const cat of CORE_CATEGORIES) {
    const count = validated.filter((q) => q.category === cat).length;
    if (count < MIN_QUESTIONS_PER_CORE_CATEGORY) {
      console.warn(
        `[mistake-quiz-generator] "${cat}" only got ${count}/${MIN_QUESTIONS_PER_CORE_CATEGORY} target questions this run.`
      );
    }
  }

  return validated;
}

/**
 * Pulls recent speaking_club mistake_logs, has Gemini synthesize them
 * into a fresh batch of quiz questions, and replaces the standing
 * "mistake review" quiz's question set with that batch. Safe to call
 * repeatedly (cron or an admin's manual "Regenerate" click) — a run with
 * too little new mistake data is a no-op that reports why.
 */
export async function generateMistakeReviewQuiz(): Promise<MistakeQuizGenerationResult> {
  // Deliberately its OWN key/project — separate from
  // GEMINI_SPEAKING_FEEDBACK_API_KEY (speaking-feedback-worker.ts) and
  // GEMINI_MOCK_TEST_FEEDBACK_API_KEY (same file, Mock Test's mistake
  // logging). Three features, three independent free-tier quotas — see
  // .env.example. This one barely needs it (≈1 call/day), but sharing a
  // key here would mean a very active feedback-processing day could
  // starve this quiz's key of its daily request budget for no reason.
  const apiKey = process.env.GEMINI_MISTAKE_QUIZ_API_KEY;
  if (!apiKey) {
    console.error("[mistake-quiz-generator] GEMINI_MISTAKE_QUIZ_API_KEY is not set — skipping.");
    return { generated: false, reason: "no_api_key", mistakesAnalyzed: 0 };
  }

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const { data: mistakeRows, error } = await supabaseServer
    .from("mistake_logs")
    .select("category, description")
    .eq("source", "speaking_club")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_MISTAKES_FOR_PROMPT);
  if (error) throw error;

  const mistakes = (mistakeRows ?? []) as { category: string; description: string }[];
  if (mistakes.length < MIN_MISTAKES_REQUIRED) {
    return { generated: false, reason: "not_enough_data", mistakesAnalyzed: mistakes.length };
  }

  const mistakeLines = mistakes.map((m) => `${m.category}: ${m.description}`);

  const ai = new GoogleGenAI({ apiKey });
  const questions = await callGeminiForQuiz(ai, mistakeLines);
  if (questions.length === 0) {
    // Gemini returned something, but nothing survived validation —
    // treat as "nothing to update" rather than wiping the existing quiz
    // down to zero questions.
    return { generated: false, reason: "not_enough_data", mistakesAnalyzed: mistakes.length };
  }

  const quiz = await findOrCreateTodaysQuiz();

  // If a student already took today's quiz (a same-day re-run), replacing
  // its questions would orphan their answers - leave it as is.
  if (!quiz.isNew) {
    const { count: attemptCount, error: attemptsError } = await supabaseServer
      .from("quiz_attempts")
      .select("id", { count: "exact", head: true })
      .eq("quiz_id", quiz.id);
    if (attemptsError) throw attemptsError;
    if ((attemptCount ?? 0) > 0) {
      return { generated: false, reason: "already_taken", mistakesAnalyzed: mistakes.length };
    }
  }

  // Wholesale replace (see file header) — delete this quiz's existing
  // questions, then insert the fresh batch. Two statements, not a
  // transaction: quiz_questions has no unique constraint this could
  // violate, and a failure between the delete and the insert just means
  // the next scheduled run (or the admin's next "Regenerate" click)
  // repopulates it — same "worst case is next run fixes it" tolerance
  // the rest of this feature's pipeline already relies on.
  const { error: deleteError } = await supabaseServer.from("quiz_questions").delete().eq("quiz_id", quiz.id);
  if (deleteError) throw deleteError;

  const rows = questions.map((q, i) => ({
    quiz_id: quiz.id,
    question: q.question.trim(),
    options: q.options.map((o) => o.trim()),
    correct_index: q.correctIndex,
    explanation: q.explanation.trim(),
    position: i,
  }));
  const { error: insertError } = await supabaseServer.from("quiz_questions").insert(rows);
  if (insertError) throw insertError;

  // Publish only now that the questions are in. An already-published quiz
  // (same-day re-run) keeps whatever the admin set - published is only
  // switched on for a brand-new (or half-finished) quiz.
  const { error: updateError } = await supabaseServer
    .from("quizzes")
    .update({
      description: `Auto-generated from ${mistakes.length} Speaking Club mistakes logged in the last ${LOOKBACK_HOURS} hours.`,
      auto_generated_at: new Date().toISOString(),
      auto_mistakes_analyzed: mistakes.length,
      ...(quiz.needsPublish ? { published: true } : {}),
    })
    .eq("id", quiz.id);
  if (updateError) throw updateError;

  // Today's quiz just went live -> retire the earlier days' auto quizzes so
  // students only see the newest one. They're unpublished, not deleted, so
  // past attempts, scores and Mistake Log entries stay intact. Only
  // auto-generated quizzes are touched; manually-created ones are left alone.
  if (quiz.needsPublish) {
    const { error: retireError } = await supabaseServer
      .from("quizzes")
      .update({ published: false })
      .eq("auto_source", AUTO_SOURCE)
      .neq("id", quiz.id)
      .eq("published", true);
    if (retireError) throw retireError;
  }

  return { generated: true, quizId: quiz.id, questionCount: rows.length, mistakesAnalyzed: mistakes.length };
}
