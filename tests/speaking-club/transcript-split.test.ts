import { describe, expect, it } from "vitest";
import { PART_CHARS, splitTranscript } from "@/lib/speaking-club/transcript-split";

const sentences = (n: number) => Array.from({ length: n }, (_, i) => `This is sentence number ${i} about my weekend plans.`).join(" ");

describe("splitTranscript", () => {
  it("keeps a normal transcript in one part", () => {
    expect(splitTranscript("hello world")).toEqual(["hello world"]);
    expect(splitTranscript(sentences(100))).toHaveLength(1);
    // a full hour-long call (~45k characters) is still ONE row, so it gets one whole-session report
    expect(splitTranscript(sentences(850))).toHaveLength(1);
  });

  it("splits a long call into parts <= PART_CHARS at sentence ends without losing text", () => {
    const text = sentences(3500); // ~180k chars
    const parts = splitTranscript(text);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts.every((p) => p.length <= PART_CHARS)).toBe(true);
    expect(parts.every((p) => /[.!?]$/.test(p))).toBe(true);
    expect(parts.join(" ")).toBe(text);
  });

  it("still splits text that has no sentence ends or spaces", () => {
    expect(splitTranscript("a".repeat(130000)).map((p) => p.length)).toEqual([60000, 60000, 10000]);
  });
});
