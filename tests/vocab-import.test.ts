import { describe, expect, it } from "vitest";
import { VOCAB_SAMPLE_BLOCK, buildVocabPrompt, classifyKey, parseBatchDate, parseVocabText, sanitizeVocabDraft } from "@/lib/vocab-import";

const one = (text: string) => {
  const r = parseVocabText(text);
  expect(r.items).toHaveLength(1);
  return r.items[0];
};

describe("the format we ask the AI for", () => {
  it("parses into every field with no warnings", () => {
    const it = one(VOCAB_SAMPLE_BLOCK);
    expect(it.errors).toEqual([]);
    expect(it.warnings).toEqual([]);
    expect(it.draft).toEqual({
      word: "ameliorate",
      pronunciation: "/əˈmiːliəreɪt/",
      partOfSpeech: "verb",
      meaningEn: "to make a bad situation better",
      synonym1: "improve",
      synonym2: "enhance",
      example1En: "The new policy helped to ameliorate living conditions in the city.",
      example1Bn: "নতুন নীতি শহরের জীবনযাত্রার মান উন্নত করতে সাহায্য করেছে।",
      example2En: "Doctors tried to ameliorate the patient's pain.",
      example2Bn: "ডাক্তাররা রোগীর ব্যথা কমানোর চেষ্টা করেছিলেন।",
    });
  });

  it("the prompt itself contains the sample and the topic", () => {
    const p = buildVocabPrompt({ count: 12, topic: "Travel", date: "2026-11-02" });
    expect(p).toContain("12 English vocabulary words");
    expect(p).toContain("Topic: Travel");
    expect(p).toContain("Date: 2026-11-02");
    expect(p).toContain(VOCAB_SAMPLE_BLOCK);
  });

  it("a whole batch with Topic/Date lines and --- separators", () => {
    const r = parseVocabText(`Topic: Travel\nDate: 02/11/2026\n\n${VOCAB_SAMPLE_BLOCK}\n---\n${VOCAB_SAMPLE_BLOCK.replace("ameliorate", "itinerary")}\n`);
    expect(r.topic).toBe("Travel");
    expect(r.date).toBe("2026-11-02");
    expect(r.items.map((i) => i.draft.word)).toEqual(["ameliorate", "itinerary"]);
  });
});

describe("AI drift is tolerated", () => {
  it("bold labels, bullets, code fences, chatter before the words", () => {
    const r = parseVocabText(
      "Sure! Here are your words:\n\n```\n- **Word:** serene\n- **Pronunciation:** səˈriːn\n- **Part of Speech:** adj.\n- **Definition:** calm and peaceful\n- **Synonyms:** calm, tranquil, peaceful\n- **Example 1:** The lake was serene.\n- **Example 1 (Bangla):** হ্রদটি শান্ত ছিল।\n```",
    );
    expect(r.items).toHaveLength(1);
    const d = r.items[0].draft;
    expect(d).toMatchObject({ word: "serene", pronunciation: "/səˈriːn/", partOfSpeech: "adjective", meaningEn: "calm and peaceful", synonym1: "calm", synonym2: "tranquil", example1En: "The lake was serene.", example1Bn: "হ্রদটি শান্ত ছিল।" });
    expect(r.items[0].warnings.join(" ")).toContain("Only 2 synonyms are saved");
    expect(r.items[0].errors).toEqual([]);
  });

  it("examples written as a list, Bangla on the next line, or in brackets", () => {
    const it = one(`Word: vivid
Meaning: very clear and bright
Examples:
1. She has a vivid imagination.
   বাংলা: তার কল্পনাশক্তি খুব জীবন্ত।
2. The colours were vivid. (রংগুলো উজ্জ্বল ছিল।)`);
    expect(it.draft).toMatchObject({
      example1En: "She has a vivid imagination.",
      example1Bn: "তার কল্পনাশক্তি খুব জীবন্ত।",
      example2En: "The colours were vivid.",
      example2Bn: "রংগুলো উজ্জ্বল ছিল।",
    });
  });

  it("unnumbered Example / Bangla pairs", () => {
    const it = one(`Word: brisk\nMeaning: quick and active\nExample: He took a brisk walk.\nBangla: সে দ্রুত হাঁটল।\nExample: The wind was brisk.\nBangla: বাতাস ছিল তীব্র।`);
    expect(it.draft).toMatchObject({ example1En: "He took a brisk walk.", example1Bn: "সে দ্রুত হাঁটল।", example2En: "The wind was brisk.", example2Bn: "বাতাস ছিল তীব্র।" });
  });

  it("an English sentence that starts with 'Translation' is not mistaken for a Bangla label", () => {
    const it = one(`Word: render\nMeaning: to translate\nExample 1: Translation is a hard job.\nExample 1 (Bangla): অনুবাদ কঠিন কাজ।`);
    expect(it.draft.example1En).toBe("Translation is a hard job.");
  });

  it("word line carrying pronunciation and part of speech", () => {
    const it = one("Word: ameliorate /əˈmiːliəreɪt/ (v.)\nMeaning: to make better");
    expect(it.draft).toMatchObject({ word: "ameliorate", pronunciation: "/əˈmiːliəreɪt/", partOfSpeech: "verb" });
  });

  it("'Word of the day' is a word label, not a date", () => {
    expect(classifyKey("Word of the day")).toEqual({ kind: "word" });
  });

  it("pronunciation shapes: brackets, missing slashes, two accents", () => {
    expect(one("Word: a\nMeaning: x\nPronunciation: [eɪ]").draft.pronunciation).toBe("/eɪ/");
    expect(one("Word: a\nMeaning: x\nIPA: eɪ").draft.pronunciation).toBe("/eɪ/");
    expect(one("Word: a\nMeaning: x\nPronunciation: US /eɪ/ UK /ɛɪ/").draft.pronunciation).toBe("/eɪ/");
  });

  it("Synonym 1 / Synonym 2 given separately, and a duplicate of the word itself is dropped", () => {
    const it = one("Word: big\nMeaning: large\nSynonym 1: big\nSynonym 2: large");
    expect(it.draft.synonym1).toBe("large");
    expect(it.draft.synonym2).toBe("");
  });

  it("a Bangla meaning has nowhere to go and says so", () => {
    const it = one("Word: big\nMeaning: large\nBangla meaning: বড়");
    expect(it.warnings.join(" ")).toContain("Bangla meaning is not saved");
  });
});

describe("other shapes", () => {
  it("JSON, including a code fence", () => {
    const r = parseVocabText('```json\n[{"word":"calm","pronunciation":"/kɑːm/","partOfSpeech":"adjective","meaningEn":"peaceful","synonyms":["quiet","still"],"examples":[{"en":"A calm sea.","bn":"শান্ত সমুদ্র।"},{"en":"Stay calm.","bn":"শান্ত থাকো।"}]}]\n```');
    expect(r.items[0].draft).toMatchObject({ word: "calm", pronunciation: "/kɑːm/", synonym1: "quiet", synonym2: "still", example1En: "A calm sea.", example1Bn: "শান্ত সমুদ্র।", example2En: "Stay calm." });
    expect(r.items[0].errors).toEqual([]);
  });

  it("JSON with the field names the database uses", () => {
    const r = parseVocabText('{"topic":"Food","words":[{"word":"tasty","meaning_en":"good to eat","example_1_en":"A tasty meal.","example_1_bn":"সুস্বাদু খাবার।"}]}');
    expect(r.topic).toBe("Food");
    expect(r.items[0].draft).toMatchObject({ word: "tasty", meaningEn: "good to eat", example1En: "A tasty meal.", example1Bn: "সুস্বাদু খাবার।" });
  });

  it("a markdown table", () => {
    const r = parseVocabText(`| Word | Pronunciation | Part of speech | Meaning | Synonyms | Example 1 | Example 1 (Bangla) |
|---|---|---|---|---|---|---|
| keen | /kiːn/ | adj | eager | eager, avid | He is keen to learn. | সে শিখতে আগ্রহী। |
| dull | /dʌl/ | adj | not interesting | boring | The film was dull. | সিনেমাটা বিরক্তিকর ছিল। |`);
    expect(r.items.map((i) => i.draft.word)).toEqual(["keen", "dull"]);
    expect(r.items[0].draft).toMatchObject({ partOfSpeech: "adjective", synonym1: "eager", synonym2: "avid", example1Bn: "সে শিখতে আগ্রহী।" });
  });

  it("a pasted spreadsheet (tab separated)", () => {
    const r = parseVocabText("Word\tMeaning\tPronunciation\nkeen\teager\t/kiːn/\ndull\tnot interesting\t/dʌl/");
    expect(r.items).toHaveLength(2);
    expect(r.items[1].draft).toMatchObject({ word: "dull", meaningEn: "not interesting", pronunciation: "/dʌl/" });
  });
});

describe("problems are reported, not guessed", () => {
  it("a missing meaning or word is an error", () => {
    expect(one("Word: lonely").errors).toContain("The meaning is missing.");
    expect(one("Meaning: sad because alone").errors).toContain("The word is missing.");
  });

  it("missing optional parts are warnings only", () => {
    const it = one("Word: lonely\nMeaning: sad because alone");
    expect(it.errors).toEqual([]);
    expect(it.warnings).toEqual(expect.arrayContaining(["No pronunciation.", "No part of speech.", "No synonyms.", "No example sentences."]));
  });

  it("an example without Bangla, and Bangla without English, are flagged", () => {
    const a = one("Word: x\nMeaning: y\nExample 1: Hello there.");
    expect(a.warnings).toContain("Example 1 has no Bangla translation.");
    const b = one("Word: x\nMeaning: y\nExample 1 (Bangla): হ্যালো।");
    expect(b.warnings.join(" ")).toContain("no English sentence");
  });

  it("a repeated word is marked as a duplicate", () => {
    const r = parseVocabText("Word: a\nMeaning: one\n---\nWord: A\nMeaning: two");
    expect(r.items.map((i) => i.duplicateInPaste)).toEqual([false, true]);
  });

  it("text with no words says so; an unreadable date is reported", () => {
    expect(parseVocabText("hello there").notes.join(" ")).toContain("No words were found");
    expect(parseVocabText("Date: tomorrow\nWord: a\nMeaning: b").notes.join(" ")).toContain("Could not read the date");
    expect(parseVocabText("").items).toEqual([]);
  });

  it("dates", () => {
    expect(parseBatchDate("2026-11-02")).toBe("2026-11-02");
    expect(parseBatchDate("2/11/2026")).toBe("2026-11-02");
    expect(parseBatchDate("31/02/2026")).toBeNull();
  });
});

describe("server-side check", () => {
  it("keeps good words, trims, caps lengths, rejects incomplete ones", () => {
    expect(sanitizeVocabDraft({ word: "  hi  ", meaningEn: "a greeting", example1En: "x".repeat(900) })).toMatchObject({ word: "hi", example1En: "x".repeat(400) });
    expect(sanitizeVocabDraft({ word: "hi" })).toBeNull();
    expect(sanitizeVocabDraft(null)).toBeNull();
    expect(sanitizeVocabDraft({ word: 5, meaningEn: {} })).toBeNull();
  });
});
