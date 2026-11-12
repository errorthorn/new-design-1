import { describe, expect, it } from "vitest";
import { IELTS_EXAMINER_INSTRUCTION, IELTS_REPORT_SCHEMA, MIN_CALL_MINUTES_FOR_BANDS, MIN_WORDS_FOR_BANDS, MISTAKE_CATEGORY_INSTRUCTION, PRONUNCIATION_NOTES_INSTRUCTION, formatIeltsFeedback, parseIeltsReport } from "@/lib/speaking-ielts-feedback";

const crit = (band: number) => ({
  band,
  what_worked: "Kept talking and developed ideas.",
  to_improve: [{ example: "I go there yesterday", issue: "wrong tense", better: "I went there yesterday" }],
});
const report = (a: number, b: number, c: number) => ({
  fluency_coherence: crit(a),
  lexical_resource: crit(b),
  grammatical_range_accuracy: crit(c),
  top_priorities: ["Practise past simple", "Use linking words", "Learn topic collocations"],
});
const longTranscript = Array(MIN_WORDS_FOR_BANDS + 20).fill("word").join(" ");

describe("IELTS-style feedback", () => {
  it("accepts a valid report and snaps bands to half steps within 1-9", () => {
    const r = parseIeltsReport(report(6.3, 10, 0));
    expect(r?.fluency_coherence.band).toBe(6.5);
    expect(r?.lexical_resource.band).toBe(9);
    expect(r?.grammatical_range_accuracy.band).toBe(1);
  });

  it("rejects a malformed report so the worker falls back to the plain summary", () => {
    expect(parseIeltsReport(null)).toBeNull();
    expect(parseIeltsReport({ fluency_coherence: crit(6) })).toBeNull();
    expect(parseIeltsReport({ ...report(6, 6, 6), lexical_resource: { band: "high" } })).toBeNull();
  });

  it("with a transcript, drops quotes the student never said and keeps the exact ones", () => {
    const r = {
      ...report(6, 6, 6),
      grammatical_range_accuracy: {
        ...crit(6),
        to_improve: [
          { example: "i go there yesterday", issue: "wrong tense", better: "I went there yesterday" },
          { example: "she don't likes it", issue: "made up", better: "she doesn't like it" },
        ],
      },
    };
    const parsed = parseIeltsReport(r, "Well, I go there, yesterday. It was nice.")!;
    expect(parsed.grammatical_range_accuracy.to_improve.map((f) => f.example)).toEqual(["i go there yesterday"]);
  });

  it("keeps at most 5 fixes per criterion and drops incomplete ones", () => {
    const many = { ...crit(6), to_improve: [1, 2, 3, 4, 5, 6].map((i) => ({ example: `e${i}`, issue: "i", better: "b" })).concat([{ example: "x" } as never]) };
    expect(parseIeltsReport({ ...report(6, 6, 6), fluency_coherence: many })?.fluency_coherence.to_improve).toHaveLength(5);
  });

  it("formats a category-wise report with a one-line headline first and the average computed in code", () => {
    const text = formatIeltsFeedback("Good effort overall.", parseIeltsReport(report(6, 6.5, 6))!, longTranscript);
    const lines = text.split("\n");
    expect(lines[0]).toContain("Estimated IELTS Speaking band 6.0"); // (6 + 6.5 + 6) / 3 = 6.17 -> 6.0
    expect(lines[0]).toContain("Pronunciation not scored");
    expect(text).toContain("FLUENCY & COHERENCE — Band 6.0");
    expect(text).toContain("LEXICAL RESOURCE (VOCABULARY) — Band 6.5");
    expect(text).toContain("GRAMMATICAL RANGE & ACCURACY — Band 6.0");
    expect(text).toContain("“I go there yesterday”");
    expect(text).toContain("Better: I went there yesterday");
    expect(text).toContain("PRONUNCIATION — No clear pronunciation mistakes");
    expect(text).toContain("YOUR TOP 3 NEXT STEPS");
    expect(text).toContain("3. Learn topic collocations");
    expect(text).toContain("not an official IELTS score");
  });

  it("prints no bands when the session has too little speech", () => {
    const text = formatIeltsFeedback("Short session.", parseIeltsReport(report(7, 7, 7))!, "only a few words here");
    expect(text.split("\n")[0]).toContain("Too little speech");
    expect(text).not.toMatch(/Band \d/);
    expect(text).toContain("FLUENCY & COHERENCE");
  });
});

describe("mistake categories follow the IELTS criteria", () => {
  it("defines all five log categories and maps each to its IELTS criterion", () => {
    for (const c of ["grammar", "vocabulary", "fluency", "coherence", "pronunciation"]) {
      expect(MISTAKE_CATEGORY_INSTRUCTION).toContain(`- ${c} (IELTS`);
    }
    expect(MISTAKE_CATEGORY_INSTRUCTION).toContain("Grammatical Range and Accuracy");
    expect(MISTAKE_CATEGORY_INSTRUCTION).toContain("Lexical Resource");
    expect(MISTAKE_CATEGORY_INSTRUCTION).toContain("Fluency and Coherence");
  });

  it("asks the report and the mistake list to agree", () => {
    expect(IELTS_EXAMINER_INSTRUCTION).toContain("consistent with the mistakes list");
  });

  it("prints no band when the call was shorter than the minimum, but keeps the full written feedback", () => {
    const text = formatIeltsFeedback("Short call.", parseIeltsReport(report(7, 7, 7))!, longTranscript, MIN_CALL_MINUTES_FOR_BANDS * 60 - 1);
    expect(text.split("\n")[0]).toContain("under 40 minutes");
    expect(text).not.toContain("Band 7");
    expect(text).toContain("YOUR TOP 3 NEXT STEPS");
  });

  it("prints the band once the call reaches the minimum, and when the call length is unknown", () => {
    const parsed = parseIeltsReport(report(7, 7, 7))!;
    expect(formatIeltsFeedback("ok", parsed, longTranscript, MIN_CALL_MINUTES_FOR_BANDS * 60)).toContain("Estimated IELTS Speaking band 7.0");
    expect(formatIeltsFeedback("ok", parsed, longTranscript, null)).toContain("Estimated IELTS Speaking band 7.0");
    expect(formatIeltsFeedback("ok", parsed, longTranscript)).toContain("Estimated IELTS Speaking band 7.0");
  });
});

describe("pronunciation notes in the student's feedback", () => {
  it("lists the noted words, still without any band, and warns they can be wrong", () => {
    const text = formatIeltsFeedback("ok", parseIeltsReport(report(6, 6, 6))!, longTranscript, null, ["think: heard as 'sink'", "world: heard as 'vorld'"]);
    expect(text).toContain("• think: heard as 'sink'");
    expect(text).toContain("can be wrong");
    expect(text).not.toContain("Pronunciation 6");
    expect(text).toContain("Pronunciation not scored");
  });

  it("without notes the old pronunciation line is unchanged", () => {
    const text = formatIeltsFeedback("ok", parseIeltsReport(report(6, 6, 6))!, longTranscript);
    expect(text).toContain("PRONUNCIATION — No clear pronunciation mistakes were picked up from your audio");
  });

  it("the extra instruction allows pronunciation ONLY in the mistakes list, never as a score", () => {
    expect(PRONUNCIATION_NOTES_INSTRUCTION).toMatch(/category pronunciation/);
    expect(PRONUNCIATION_NOTES_INSTRUCTION).toMatch(/do NOT give pronunciation a band/);
  });
});

// ---- the full coach report: strengths, detailed fixes, vocabulary, better version, plan, closing ----
const fullReport = () => ({
  ...report(6, 6, 6),
  top_priorities: undefined,
  fluency_coherence: {
    ...crit(6),
    to_improve: [
      {
        example: "I go there yesterday",
        issue: "the action is finished, so it needs the past",
        better: "I went there yesterday",
        type: "tense",
        how_to_improve: "Use past simple for finished actions with time words like yesterday.",
      },
    ],
  },
  better_version: { original: "I go there yesterday and it is nice.", improved: "I went there yesterday and it was lovely." },
  pronunciation_tips: [{ word: "think", issue: "the th sounded like s", correct: "the th sound with the tongue between the teeth, not s", how_to_fix: "Put the tongue tip between the teeth and blow air." }],
  improvement_plan: [
    { skill: "Past simple", why_it_matters: "Tense errors lower your grammar band", exercise: "Retell your day yesterday in 5 sentences." },
    { skill: "Linking words", why_it_matters: "They make ideas flow", exercise: "Add because / however to 5 answers." },
    { skill: "Topic vocabulary", why_it_matters: "More precise words", exercise: "Learn 5 collocations a day." },
  ],
  final_message: "Great effort today. Next time, try to use the past simple in every story.",
});

describe("full coach report", () => {
  it("prints every section in order, with the type and tip under each fix", () => {
    const text = formatIeltsFeedback("Good effort overall.", parseIeltsReport(fullReport())!, longTranscript, null, ["think: heard as 'sink'"]);
    const order = [
      "Estimated IELTS Speaking band 6.0",
      "FLUENCY & COHERENCE — Band 6.0",
      "Type: tense · Tip: Use past simple",
      "PRONUNCIATION MISTAKES",
      "A BETTER VERSION",
      "WHAT TO PRACTISE",
      "Great effort today.",
      "not an official IELTS score",
    ];
    let at = -1;
    for (const marker of order) {
      const next = text.indexOf(marker);
      expect(next, marker).toBeGreaterThan(at);
      at = next;
    }
    expect(text).not.toContain("VOCABULARY UPGRADES");
    expect(text).not.toContain("PHRASES TO PRACTISE");
    expect(text).toContain("You said: “I go there yesterday and it is nice.”");
    expect(text).toContain("Try: I went there yesterday and it was lovely.");
    expect(text).toContain("1. Past simple — Tense errors lower your grammar band\n   Practise: Retell your day");
    expect(text).not.toContain("YOUR STRENGTHS");
    expect(text).not.toContain("TOP 3 NEXT STEPS"); // the plan replaces the old list
  });

  it("shows pronunciation tips only when the audio produced notes, never from the text alone", () => {
    const parsed = parseIeltsReport(fullReport())!;
    const withNotes = formatIeltsFeedback("ok", parsed, longTranscript, null, ["think: heard as 'sink'"]);
    expect(withNotes).toContain("✘ think — the th sounded like s\n   ✔ Say: the th sound with the tongue between the teeth, not s\n   Tip: Put the tongue tip between the teeth");
    expect(withNotes).not.toContain("• think: heard as"); // the tip replaces the raw note
    const withoutNotes = formatIeltsFeedback("ok", parsed, longTranscript, null, []);
    expect(withoutNotes).not.toContain("the th sounded like s");
    expect(withoutNotes).toContain("No clear pronunciation mistakes were picked up");
  });

  it("falls back to the raw notes when the model wrote no tips", () => {
    const parsed = parseIeltsReport({ ...fullReport(), pronunciation_tips: [] })!;
    expect(formatIeltsFeedback("ok", parsed, longTranscript, null, ["think: heard as 'sink'"])).toContain("• think: heard as 'sink'");
  });

  it("drops malformed extras instead of losing the whole report", () => {
    const parsed = parseIeltsReport({
      ...fullReport(),
      better_version: { original: "only half" },
      improvement_plan: [{ why_it_matters: "no skill" }],
      final_message: 42,
    })!;
    expect(parsed.fluency_coherence.band).toBe(6);
    expect(parsed.better_version).toBeNull();
    expect(parsed.improvement_plan).toEqual([]);
    const text = formatIeltsFeedback("ok", parsed, longTranscript);
    expect(text).not.toContain("VOCABULARY UPGRADES");
    expect(text).not.toContain("A BETTER VERSION");
    expect(text).not.toContain("YOUR IMPROVEMENT PLAN");
  });

  it("asks the model for every section and never lets it score pronunciation", () => {
    for (const field of ["better_version", "pronunciation_tips", "improvement_plan", "final_message"]) {
      expect(IELTS_REPORT_SCHEMA.required).toContain(field);
      expect(IELTS_EXAMINER_INSTRUCTION).toContain(field);
    }
    expect(IELTS_EXAMINER_INSTRUCTION).toContain("expert IELTS Speaking examiner and English language coach");
    expect(IELTS_EXAMINER_INSTRUCTION).toContain("naturalness improvement");
    expect(IELTS_EXAMINER_INSTRUCTION).toContain("never score it");
    expect(PRONUNCIATION_NOTES_INSTRUCTION).toContain("pronunciation_tips");
    expect(PRONUNCIATION_NOTES_INSTRUCTION).toContain("Never invent a pronunciation problem");
  });
});
