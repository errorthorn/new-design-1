// lib/speaking-ielts-feedback.ts
//
// IELTS-examiner style feedback for Speaking Club transcripts. Kept free of any database /
// Gemini-client import so it can be unit-tested on its own; lib/speaking-feedback-worker.ts
// uses it for the speaking_club source only.
//
// What the Speaking Club feedback contains (the examiner/coach prompt below asks the model for it):
//   - the whole transcript is judged like an examiner would, criterion by criterion
//     (Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy), each with an ESTIMATED
//     band, what worked, and up to 3 detailed fixes (what was said -> correction, type, why, tip);
//   - a better version of one weak stretch, a practice plan tied to the mistakes
//     plan with exercises, phrases to practise, and a short encouraging closing message;
//   - pronunciation is never scored. If the BYOK transcriber heard words pronounced wrongly while
//     listening to the audio (see lib/speaking-club/pronunciation-notes.ts), they are turned into
//     short practice tips; with no notes the section just says it cannot be judged from text.
// The existing `mistakes[]` list is untouched, so mistake_logs (and the quiz generator that
// reads it) keep working exactly as before. The 4 IELTS criteria line up with its categories:
//   fluency + coherence -> Fluency & Coherence, vocabulary -> Lexical Resource,
//   grammar -> Grammatical Range & Accuracy, pronunciation -> Pronunciation.
import { Type } from "@google/genai";

/** Below this many words there is too little speech for a band to mean anything. */
export const MIN_WORDS_FOR_BANDS = 100;
/**
 * A band estimate is only printed when the student stayed in the call at least this long
 * (speaking_turn_usage.call_duration_seconds). Shorter calls still get the summary + mistake log.
 */
export const MIN_CALL_MINUTES_FOR_BANDS = 40;

export type IeltsFix = { example: string; issue: string; better: string; type?: string; how_to_improve?: string };
export type IeltsCriterion = { band: number; what_worked: string; to_improve: IeltsFix[] };
export type BetterVersion = { original: string; improved: string };
export type PronunciationTip = { word: string; issue: string; how_to_fix: string; correct?: string };
export type PlanItem = { skill: string; why_it_matters: string; exercise: string };
export type IeltsReport = {
  fluency_coherence: IeltsCriterion;
  lexical_resource: IeltsCriterion;
  grammatical_range_accuracy: IeltsCriterion;
  better_version: BetterVersion | null;
  pronunciation_tips: PronunciationTip[];
  improvement_plan: PlanItem[];
  final_message: string;
  /** Older reports only (before the improvement plan existed); still shown if there is no plan. */
  top_priorities: string[];
};

const str = (description: string) => ({ type: Type.STRING, description });

const criterionSchema = (what: string) => ({
  type: Type.OBJECT,
  description: what,
  properties: {
    band: { type: Type.NUMBER, description: "Estimated IELTS band for this criterion, 1-9 in steps of 0.5." },
    what_worked: str("1-2 sentences: what the student did well on this criterion, specific to this transcript."),
    to_improve: {
      type: Type.ARRAY,
      description: "Up to 5 real mistakes the student made on this criterion, most impactful first. Empty array if there is nothing real to fix.",
      items: {
        type: Type.OBJECT,
        properties: {
          example: str("A SHORT phrase (max 12 words) copied word-for-word from the transcript. Never reword it; anything not found in the transcript is removed."),
          better: str("The corrected, or more natural, version."),
          type: str("The kind of mistake, e.g. tense, article, preposition, word choice, collocation, sentence structure, coherence, or 'naturalness improvement' when the sentence is correct but sounds unnatural."),
          issue: str("Why it is wrong or weak, in simple student-friendly English."),
          how_to_improve: str("The rule behind the correction in one sentence, plus ONE more correct example sentence the student can copy. Specific to this mistake, never general study advice."),
        },
        required: ["example", "better", "type", "issue", "how_to_improve"],
      },
    },
  },
  required: ["band", "what_worked", "to_improve"],
});

/** Added to the response schema's `properties` (and `required`) for speaking_club only. */
export const IELTS_REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fluency_coherence: criterionSchema("IELTS Fluency and Coherence."),
    lexical_resource: criterionSchema("IELTS Lexical Resource."),
    grammatical_range_accuracy: criterionSchema("IELTS Grammatical Range and Accuracy."),
    better_version: {
      type: Type.OBJECT,
      description: "ONE short stretch (about 2-5 sentences) where the student had real problems, rewritten naturally. Both fields empty if there is too little speech.",
      properties: {
        original: str("The student's own sentences, exactly as in the transcript."),
        improved: str("A natural, fluent version that keeps the student's meaning, opinions and personal details."),
      },
      required: ["original", "improved"],
    },
    pronunciation_tips: {
      type: Type.ARRAY,
      description: "One tip for EVERY pronunciation note provided (at most 10, most important first), ONLY from the provided notes. Empty array when no pronunciation notes were provided.",
      items: {
        type: Type.OBJECT,
        properties: {
          word: str("The word."),
          issue: str("What was heard, in simple words (quote what the student's pronunciation sounded like)."),
          correct: str("How the word should sound, in simple words or a simple respelling, e.g. 'think: the th sound with the tongue between the teeth, not s'."),
          how_to_fix: str("One short practical tip: mouth or tongue position, the stress pattern, or a contrasting word pair to practise."),
        },
        required: ["word", "issue", "correct", "how_to_fix"],
      },
    },
    improvement_plan: {
      type: Type.ARRAY,
      description: "Up to 3 things to practise, most valuable first. Each MUST fix a mistake listed above and quote the student's exact words. Fewer than 3 if the student made fewer real mistakes.",
      items: {
        type: Type.OBJECT,
        properties: {
          skill: str("The skill to work on."),
          why_it_matters: str("One short sentence naming the student's own mistake (quote their exact words) and why it matters."),
          exercise: str("One short exercise on that same mistake, e.g. say the quoted sentence correctly three times, or retell what they were describing using the correct form."),
        },
        required: ["skill", "why_it_matters", "exercise"],
      },
    },
    final_message: str("One or two supportive sentences acknowledging the effort and naming one achievable next step."),
  },
  required: [
    "fluency_coherence",
    "lexical_resource",
    "grammatical_range_accuracy",
    "better_version",
    "pronunciation_tips",
    "improvement_plan",
    "final_message",
  ],
};

/**
 * Defines the five mistake-log categories by the official IELTS Speaking criteria, so each logged
 * mistake lands in the category IELTS would penalise it under (the base prompts only named the
 * five words, leaving the choice to guesswork). Used for BOTH sources, because both write to the
 * one shared mistake_logs table. The category names themselves are unchanged.
 */
export const MISTAKE_CATEGORY_INSTRUCTION = [
  "Tag each mistake with exactly ONE category, chosen by the official IELTS Speaking criterion it would be penalised under:",
  "- grammar (IELTS Grammatical Range and Accuracy): wrong tense or verb form, subject-verb agreement, articles, prepositions, plurals, word order, broken or incomplete clause structure.",
  "- vocabulary (IELTS Lexical Resource): wrong or imprecise word choice, wrong collocation, wrong word formation (e.g. 'success' for 'successful'), repeating a basic word where a precise one was needed.",
  "- fluency (IELTS Fluency and Coherence, the fluency side): repetition of words or phrases, frequent self-correction, false starts, abandoned sentences, heavy use of fillers, answers so short or broken that speech cannot flow.",
  "- coherence (IELTS Fluency and Coherence, the coherence side): ideas in an illogical order, missing, wrong or over-repeated linking words, unclear reference, drifting away from the question, ideas stated without any development.",
  "- pronunciation (IELTS Pronunciation): only when the transcript clearly implies a mispronunciation (you cannot hear audio).",
  "If a mistake could fit two categories, use the one the descriptors above assign it to, and never list the same mistake twice.",
].join("\n");

/**
 * Most mistakes one Speaking Club session may write to mistake_logs. A long call can hold far more slips
 * than are useful to log, and an unbounded list makes the model slow and rambling. The model is asked
 * for the most important ones first, and the worker also cuts the list here as a safety net.
 */
export const MAX_LOGGED_MISTAKES = 60;

export const MISTAKE_LIMIT_INSTRUCTION = [
  `The mistakes list holds at most ${MAX_LOGGED_MISTAKES} entries for the whole session (a long session usually has around 50-${MAX_LOGGED_MISTAKES}). Keep the most important and most frequent mistakes, ordered most important first; leave out minor slips. Never add entries just to reach the limit: if there are fewer genuine mistakes, list fewer.`,
  "Write one entry per distinct mistake, using the student's exact words each time: only skip an entry when it would be the identical slip (same words, same error) already listed. Different sentences with the same kind of error are separate entries, each with its own exact quote.",
].join("\n");

/**
 * Added to the Speaking Club system instruction ONLY when the transcript came with pronunciation notes
 * (written by the BYOK transcriber, which listened to the audio). Lets pronunciation appear in the
 * mistakes list and in pronunciation_tips, and nowhere else.
 */
export const PRONUNCIATION_NOTES_INSTRUCTION = [
  "A 'Pronunciation notes' section follows the transcript. The transcript only shows the words the student MEANT; the notes were written by the speech-recognition model that actually LISTENED to the audio and heard some words pronounced wrongly.",
  "Treat the notes as hints, not proof. Use them ONLY for the clearly described problems: (a) add each one to the mistakes list with category pronunciation, with `original` = the word exactly as it is written in the transcript (the word the student meant), `correction` = what the student said versus how it should sound, in simple words (e.g. 'said “sink” — say “think” with the tongue between the teeth'), and `description` = the sound or stress problem, one entry per distinct word; (b) add each one to pronunciation_tips, at most 10, most important first, covering every clearly described note: word = the word, issue = what was heard in simple words, correct = how it should sound, how_to_fix = one short practical tip (mouth or tongue position, the stress pattern, or a contrasting word pair to practise).",
  "Never invent a pronunciation problem that is not in the notes, never treat an accent as a mistake, and never use the notes for grammar, vocabulary or fluency.",
  "This is the only exception to the rule about not commenting on pronunciation: still do NOT give pronunciation a band, and do NOT mention it inside the three scored criteria — pronunciation mistakes belong only in the mistakes list and in pronunciation_tips.",
].join("\n");

/** Appended to the Speaking Club system instruction: the examiner/coach brief, section by section. */
export const IELTS_EXAMINER_INSTRUCTION = [
  "You are an expert IELTS Speaking examiner and English language coach for LingoCraft Speaking Club. Your task is to evaluate the student's spoken English accurately, fairly, and constructively.",
  "Analyze the student's actual spoken response and give personalized feedback that helps them understand their mistakes and improve their speaking. Never give generic feedback when specific evidence is available.",
  "Your answer is a JSON object; the app turns its fields into the feedback the student reads. Fill the fields as follows.",
  "1. OVERALL: feedback_summary = 3-4 sentences on the student's current speaking ability, naming the 2-3 most important recurring mistakes by quoting the student's exact words. Do NOT write a band score in any text: the app prints the overall estimated band itself (an estimate, not an official IELTS result), computed from your three criterion bands.",
  "2. IELTS CRITERIA (fluency_coherence, lexical_resource, grammatical_range_accuracy): read the ENTIRE transcript first, then judge the student's overall performance across all of it — patterns that recur, not single slips. Use the official public IELTS Speaking band descriptors and give each criterion its own estimated band. Pronunciation is never scored (see 7).",
  "Scoring: bands run 1-9 in steps of 0.5. Be realistic and conservative, like a real examiner: most learners fall between 4.5 and 6.5, and 7 or above needs sustained range AND accuracy across the whole transcript. Never raise a number to be encouraging — encouragement belongs in feedback_summary and final_message, not in the bands. Judge each criterion on its own; a strong criterion must not lift a weak one.",
  "Fluency and Coherence: how continuously and logically the student develops ideas — answer length and development, repetition, self-correction, use of connectives and discourse markers, relevance. The transcript comes from speech recognition, so pauses and hesitations are invisible: never judge fluency by missing pauses.",
  "Lexical Resource: range and precision of vocabulary, collocations, less-common or idiomatic items, ability to paraphrase, and over-reliance on a few basic words.",
  "Grammatical Range and Accuracy: variety of structures (complex sentences, tenses, conditionals, passives), how often errors occur, and whether they get in the way of meaning.",
  "3. DETAILED MISTAKE ANALYSIS (to_improve inside each criterion, up to 5 per criterion): this is the heart of the feedback. List the student's real mistakes, each as its own entry, most impactful and most frequent first; the same mistakes must also appear in the separate mistakes list. For each one: example = the exact words the student said, copied word-for-word from the transcript (a SHORT quote, max 12 words; a quote that is not in the transcript is automatically deleted, so never reword, tidy up or combine pieces); better = that SAME phrase rewritten correctly, keeping the student's meaning; type = the kind of mistake (tense, article, preposition, word choice, collocation, sentence structure, coherence, ...); issue = why it is wrong, in simple student-friendly English; how_to_improve = the rule behind the correction in one sentence, plus ONE more correct example sentence the student can copy. Everything must be about THIS mistake: no general study advice, no tips that are not tied to a quoted mistake.",
  "Do not invent errors, misquote the student, or label acceptable English as incorrect. Tell genuine grammatical errors apart from optional stylistic improvements: if a sentence is already correct but sounds unnatural, set type to 'naturalness improvement' and do not call it a grammar mistake. Inside this report, quoting is limited to the short examples above; the separate mistakes list has its own `original` field for the student's exact words, as instructed there. Ignore speech-recognition noise and anything that is clearly a mis-transcription. If a criterion has nothing real to fix, return an empty to_improve array.",
  "4. BETTER VERSION (better_version): the transcript covers a whole conversation, so rewrite ONE short stretch (about 2-5 sentences) where the student had real problems, not the whole session. original = those exact sentences from the transcript; improved = a natural, fluent version that keeps the student's meaning, opinions and personal details. It must sound like a real person speaking, with accurate grammar, appropriate vocabulary and better connections between sentences, pitched at the student's current level and next band. Avoid unnecessarily complex words, memorised-sounding phrases and invented personal experiences, and never change the meaning just to sound more advanced. If there is too little speech, leave both fields empty.",
  "5. WHAT TO PRACTISE (improvement_plan: up to 3 items, most valuable first): every item must fix a mistake you listed above. skill = what to work on; why_it_matters = one short sentence that quotes the student's own mistake; exercise = one short exercise on that same mistake (for example, say the quoted sentence correctly three times, or retell what they were describing using the correct form). Do not add generic study advice or sentence patterns that are not tied to a listed mistake. If the student made fewer real mistakes, give fewer items.",
  "6. FINAL MESSAGE (final_message): one or two supportive sentences that acknowledge the student's effort and name one achievable next step.",
  "7. PRONUNCIATION (pronunciation_tips): pronunciation cannot be judged from a text transcript, so never score it and never invent pronunciation problems. pronunciation_tips must be an empty array unless a 'Pronunciation notes' section is provided (its own instruction follows then).",
  "Important rules: base every evaluation on the student's actual response — never invent sentences, errors or performance evidence. Do not give an artificially high band to encourage the student. Keep the feedback clear, specific, practical and easy to understand, in simple English suitable for an intermediate learner. Do not overwhelm a beginner with minor corrections: prioritise recurring, high-impact errors. If the response is too short or the evidence is insufficient, say so plainly instead of pretending to make a reliable assessment. Never confuse the improved version with the student's actual performance.",
  "This is live conversation practice with a partner, not a formal exam: adapt to that, and if a topic or cue card is given treat it as context only.",
  "Keep this report consistent with the mistakes list: the same weakness belongs to the same criterion in both (grammar = Grammatical Range and Accuracy, vocabulary = Lexical Resource, fluency and coherence = Fluency and Coherence).",
  "The goal is not merely to give a score: it is to help the student understand what they did well, what they got wrong, why it matters, and what to do next.",
].join("\n");

// ---- turning the report into the text stored in speaking_feedback.feedback_summary ----

const snapBand = (n: unknown): number | null => {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(9, Math.max(1, Math.round(n * 2) / 2));
};

const fmt = (n: number) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Lowercase, drop punctuation, collapse whitespace — so speech-recognition punctuation/capitalisation never causes a false mismatch. */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();
}

/** True when `quote` really appears in `transcript` (loosely: case and punctuation ignored). */
export function quoteInTranscript(quote: string, transcript: string): boolean {
  const q = normalizeForMatch(quote);
  return q.length > 0 && normalizeForMatch(transcript).includes(q);
}

/** Keeps only the items of `raw` that `pick` accepts (a non-empty result), at most `max`. */
function listOf<T>(raw: unknown, max: number, pick: (item: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const got = pick(item as Record<string, unknown>);
    if (got) out.push(got);
    if (out.length >= max) break;
  }
  return out;
}

const textList = (raw: unknown, max: number): string[] =>
  (Array.isArray(raw) ? raw : []).map(clean).filter(Boolean).slice(0, max);

/**
 * Light shape check: a missing or malformed criterion makes the caller fall back to the plain summary.
 * The extra sections (better version, plan, ...) are optional: whatever is
 * missing or malformed is simply left out, so one bad field never costs the student their feedback.
 */
export function parseIeltsReport(raw: unknown, transcript?: string): IeltsReport | null {
  // With a transcript, anything presented as "what the student said" must really be in it: a quote
  // the model made up or reworded is dropped, so the student only ever sees their own exact words.
  const verbatim = (quote: string) => transcript === undefined || quoteInTranscript(quote, transcript);
  const r = raw as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") return null;
  const crit = (c: unknown): IeltsCriterion | null => {
    const x = c as Partial<IeltsCriterion> | null | undefined;
    const band = snapBand(x?.band);
    if (!x || band === null || typeof x.what_worked !== "string") return null;
    const fixes = (Array.isArray(x.to_improve) ? x.to_improve : [])
      .filter((f): f is IeltsFix => !!f && typeof f.example === "string" && typeof f.issue === "string" && typeof f.better === "string")
      .filter((f) => verbatim(f.example))
      .map((f) => ({ ...f, type: clean(f.type), how_to_improve: clean(f.how_to_improve) }))
      .slice(0, 5);
    return { band, what_worked: x.what_worked.trim(), to_improve: fixes };
  };
  const fc = crit(r.fluency_coherence);
  const lr = crit(r.lexical_resource);
  const gra = crit(r.grammatical_range_accuracy);
  if (!fc || !lr || !gra) return null;

  const bv = r.better_version as Record<string, unknown> | null | undefined;
  const betterOriginal = clean(bv?.original);
  const betterImproved = clean(bv?.improved);

  return {
    fluency_coherence: fc,
    lexical_resource: lr,
    grammatical_range_accuracy: gra,
    better_version: betterOriginal && betterImproved && verbatim(betterOriginal) ? { original: betterOriginal, improved: betterImproved } : null,
    pronunciation_tips: listOf(r.pronunciation_tips, 10, (v) => {
      const word = clean(v.word);
      const issue = clean(v.issue);
      if (!word || !issue) return null;
      return { word, issue, how_to_fix: clean(v.how_to_fix), correct: clean(v.correct) };
    }),
    improvement_plan: listOf(r.improvement_plan, 3, (v) => {
      const skill = clean(v.skill);
      if (!skill) return null;
      return { skill, why_it_matters: clean(v.why_it_matters), exercise: clean(v.exercise) };
    }),
    final_message: clean(r.final_message),
    top_priorities: textList(r.top_priorities, 3),
  };
}

function fixLines(fixes: IeltsFix[]): string[] {
  return fixes.map((f) => {
    const lines = [`✘ “${f.example.trim()}” — ${f.issue.trim()}`, `   ✔ Better: ${f.better.trim()}`];
    const extra = [f.type ? `Type: ${f.type}` : "", f.how_to_improve ? `Tip: ${f.how_to_improve}` : ""].filter(Boolean);
    if (extra.length > 0) lines.push(`   ${extra.join(" · ")}`);
    return lines.join("\n");
  });
}

/**
 * The pronunciation part of the feedback: never a band. It lists the words the transcriber heard
 * mispronounced (with a practice tip for each, when the model wrote one). Tips are only ever shown
 * when there were notes, so nothing can be invented from the text alone.
 */
function pronunciationSection(notes: readonly string[], tips: readonly PronunciationTip[]): string[] {
  if (notes.length === 0) {
    return ["PRONUNCIATION — No clear pronunciation mistakes were picked up from your audio in this session (pronunciation is not given a band)."];
  }
  const intro = "PRONUNCIATION MISTAKES (heard in your audio; not given a band):";
  const outro = "These come from automatic listening and can be wrong — check them with your teacher or a dictionary's audio.";
  if (tips.length === 0) return [intro, ...notes.slice(0, 10).map((n) => `• ${n}`), outro];
  return [
    intro,
    ...tips.map((t) => {
      const lines = [`✘ ${t.word} — ${t.issue}`];
      if (t.correct) lines.push(`   ✔ Say: ${t.correct}`);
      if (t.how_to_fix) lines.push(`   Tip: ${t.how_to_fix}`);
      return lines.join("\n");
    }),
    outro,
  ];
}

/**
 * The text shown to the student (and in the admin view). The FIRST line is a one-line
 * headline because the collapsed row in the performance page shows only that line.
 * With too little speech, no bands are printed at all.
 */
export function formatIeltsFeedback(
  summary: string,
  report: IeltsReport,
  transcript: string,
  callSeconds?: number | null,
  pronunciationNotes: readonly string[] = [],
): string {
  // callSeconds null/undefined = unknown (e.g. the call-end report never arrived): don't punish the
  // student for that, fall back to the word-count rule alone.
  const callKnown = typeof callSeconds === "number" && Number.isFinite(callSeconds);
  const callTooShort = callKnown && (callSeconds as number) < MIN_CALL_MINUTES_FOR_BANDS * 60;
  const enough = countWords(transcript) >= MIN_WORDS_FOR_BANDS && !callTooShort;
  const fc = report.fluency_coherence;
  const lr = report.lexical_resource;
  const gra = report.grammatical_range_accuracy;

  // Overall = average of the 3 scored criteria, to the nearest half band (computed here, not by the model).
  const overall = Math.round(((fc.band + lr.band + gra.band) / 3) * 2) / 2;
  const headline = enough
    ? `Estimated IELTS Speaking band ${fmt(overall)} (Fluency ${fmt(fc.band)} · Vocabulary ${fmt(lr.band)} · Grammar ${fmt(gra.band)} · Pronunciation not scored)`
    : callTooShort
      ? `No band estimate this time: the call lasted under ${MIN_CALL_MINUTES_FOR_BANDS} minutes, which is too short for a reliable score — here is your feedback.`
      : "Too little speech in this session for a reliable band estimate — here is your feedback.";

  const section = (title: string, c: IeltsCriterion): string[] => [
    enough ? `${title} — Band ${fmt(c.band)}` : title,
    `✔ ${c.what_worked}`,
    ...fixLines(c.to_improve),
  ];

  const parts: string[] = [headline, "", summary.trim()];

  parts.push(
    "",
    ...section("FLUENCY & COHERENCE", fc),
    "",
    ...section("LEXICAL RESOURCE (VOCABULARY)", lr),
    "",
    ...section("GRAMMATICAL RANGE & ACCURACY", gra),
    "",
    ...pronunciationSection(pronunciationNotes, report.pronunciation_tips),
  );

  if (report.better_version) {
    parts.push("", "A BETTER VERSION (one short part of your speech)", `You said: “${report.better_version.original}”`, `Try: ${report.better_version.improved}`);
  }

  if (report.improvement_plan.length > 0) {
    parts.push(
      "",
      "WHAT TO PRACTISE (from your mistakes above)",
      ...report.improvement_plan.map((p, i) => {
        const lines = [`${i + 1}. ${p.skill}${p.why_it_matters ? ` — ${p.why_it_matters}` : ""}`];
        if (p.exercise) lines.push(`   Practise: ${p.exercise}`);
        return lines.join("\n");
      }),
    );
  } else if (report.top_priorities.length > 0) {
    parts.push("", "YOUR TOP 3 NEXT STEPS", ...report.top_priorities.map((p, i) => `${i + 1}. ${p.trim()}`));
  }

  if (report.final_message) parts.push("", report.final_message);
  parts.push("", "Your full list of exact mistakes from this session is in your Mistake Log.");
  parts.push("", "This is an estimate from a text transcript, not an official IELTS score.");
  return parts.join("\n");
}
