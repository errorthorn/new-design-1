// Rule-based pronunciation checking: pure functions with a tiny hand-made dictionary (ARPAbet, CMU style).
import { describe, expect, it } from "vitest";
import { analyzeNotes, groupVerified, phonemesOf, toIpa, verifyNote } from "@/lib/speaking-club/pronunciation-rules";
import { parseNote } from "@/lib/speaking-club/pronunciation-notes";
import { estimatePronunciationBand } from "@/lib/speaking-club/pronunciation-score";

const dict = {
  think: "TH IH1 NG K",
  sink: "S IH1 NG K",
  three: "TH R IY1",
  free: "F R IY1",
  very: "V EH1 R IY0",
  berry: "B EH1 R IY0",
  cat: "K AE1 T",
  cut: "K AH1 T",
  walked: "W AO1 K T",
  walk: "W AO1 K",
  photography: "F AH0 T AA1 G R AH0 F IY0",
  annoying: "AH0 N OY1 IH0 NG",
  sit: "S IH1 T",
  seat: "S IY1 T",
  read: "R EH1 D",
  red: "R EH1 D",
  strategy: "S T R AE1 T AH0 JH IY0",
} as const;

const v = (line: string) => {
  const p = parseNote(line);
  return p ? verifyNote(dict, p) : null;
};

describe("toIpa", () => {
  it("writes the standard pronunciation with the stress mark before the stressed syllable", () => {
    expect(toIpa(phonemesOf(dict, "think")!)).toBe("/θɪŋk/");
    expect(toIpa(phonemesOf(dict, "photography")!)).toBe("/fəˈtɑːɡrəfiː/");
    expect(toIpa(phonemesOf(dict, "strategy")!)).toBe("/ˈstrætədʒiː/");
  });
  it("does not know a word that is not in the dictionary", () => {
    expect(phonemesOf(dict, "zzzxq")).toBeNull();
  });
});

describe("verifyNote", () => {
  it("derives the sound from the two pronunciations, not from the model's words", () => {
    const n = v("think | heard: sink | sound: whatever | note: x")!;
    expect(n).toMatchObject({ status: "confirmed", sound: "th /θ/", saidAs: "/s/", correct: "/θɪŋk/" });
    expect(n.tip).toMatch(/tongue/i);
  });
  it("detects a vowel problem (sit heard for a word whose vowel is /iː/)", () => {
    const d2 = { ...dict, seat: "S IY1 T" };
    const p = parseNote("seat | heard: sit | sound: x | note: y")!;
    expect(verifyNote(d2, p)).toMatchObject({ status: "confirmed", sound: "/iː/", saidAs: "/ɪ/" });
  });
  it("rejects a note whose heard word sounds exactly the same", () => {
    expect(v("read | heard: red | sound: /e/ | note: x")).toBeNull();
  });
  it("rejects a note where the heard word is the word itself", () => {
    expect(v("cat | heard: cat | sound: /æ/ | note: x")).toBeNull();
  });
  it("detects a dropped final sound", () => {
    expect(v("walked | heard: walk | sound: final sound | note: x")).toMatchObject({ status: "confirmed", sound: "final sound" });
  });
  it("rejects an impossible claim (a th problem in a word with no th)", () => {
    expect(v("annoying | heard: anoying | sound: th /θ/ | note: x")).toBeNull();
  });
  it("accepts a possible claim when the heard word is not a dictionary word", () => {
    expect(v("very | heard: wery | sound: /v/ | note: v as w")).toMatchObject({ status: "plausible", sound: "/v/" });
  });
  it("needs 2+ syllables for a word-stress problem", () => {
    expect(v("cat | heard: x | sound: word stress | note: y")).toBeNull();
    expect(v("photography | heard: x | sound: word stress | note: y")).toMatchObject({ status: "plausible", sound: "word stress" });
  });
  it("keeps a word the dictionary does not know, but as unverified", () => {
    expect(v("zzzxq | heard: x | sound: /r/ | note: y")).toMatchObject({ status: "unverified" });
  });
  it("a heard word that differs by many sounds is a different word, not a mispronunciation", () => {
    expect(v("photography | heard: sink | sound: /f/ | note: y")?.status).not.toBe("confirmed");
  });
});

describe("analyzeNotes / groupVerified", () => {
  it("drops false notes and duplicates, groups the rest by sound", () => {
    const { notes, rejected } = analyzeNotes(dict, [
      "think | heard: sink | sound: th /θ/ | note: a",
      "three | heard: free | sound: th /θ/ | note: b",
      "think | heard: sink | sound: th /θ/ | note: again",
      "read | heard: red | sound: /e/ | note: false",
      "very | heard: berry | sound: /v/ | note: c",
    ]);
    expect(rejected).toBe(1);
    expect(groupVerified(notes).map((g) => [g.sound, g.words.map((w) => w.word)])).toEqual([
      ["th /θ/", ["think", "three"]],
      ["/v/", ["very"]],
    ]);
  });
});

describe("estimatePronunciationBand", () => {
  it("gives nothing when nobody listened or there is too little speech", () => {
    expect(estimatePronunciationBand({ spokenWords: 5000, confirmed: 0, plausible: 0, listened: false })).toBeNull();
    expect(estimatePronunciationBand({ spokenWords: 20, confirmed: 0, plausible: 0, listened: true })).toBeNull();
  });
  it("never goes above 7.0, even with no mistakes", () => {
    expect(estimatePronunciationBand({ spokenWords: 5000, confirmed: 0, plausible: 0, listened: true })?.band).toBe(7);
  });
  it("goes down as mistakes per 100 words go up", () => {
    const at = (c: number) => estimatePronunciationBand({ spokenWords: 5000, confirmed: c, plausible: 0, listened: true })!.band;
    expect(at(10)).toBeGreaterThan(at(100));
    expect(at(100)).toBeGreaterThan(at(300));
    expect(at(1000)).toBe(4);
  });
  it("counts a 'plausible' note for less than a confirmed one", () => {
    const a = estimatePronunciationBand({ spokenWords: 1000, confirmed: 10, plausible: 0, listened: true })!;
    const b = estimatePronunciationBand({ spokenWords: 1000, confirmed: 0, plausible: 10, listened: true })!;
    expect(b.per100).toBeLessThan(a.per100);
  });
});
