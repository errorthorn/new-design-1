import { describe, expect, it } from "vitest";
import { findClosestQuote, numberedTranscript, splitTranscriptLines } from "@/lib/speaking-ielts-feedback";

const transcript = "So yesterday I goed to the market, and um I buy many fishes there. It was this this and also very crowded.";

describe("findClosestQuote", () => {
  it("returns the transcript's own words for a slightly mis-copied quote", () => {
    expect(findClosestQuote("I goed to the markets", transcript)).toBe("I goed to the market");
  });

  it("keeps the transcript's original casing and punctuation", () => {
    expect(findClosestQuote("this and also", transcript)).toBe("this and also");
    expect(findClosestQuote("this this and also", transcript)).toBe("this this and also");
  });

  it("returns null when nothing in the transcript is close", () => {
    expect(findClosestQuote("she never visited the library", transcript)).toBeNull();
    expect(findClosestQuote("", transcript)).toBeNull();
  });
});

describe("findClosestQuote with a lower threshold", () => {
  it("accepts a rougher match only when asked to", () => {
    const line = "yesterday I goed to the market and I buy many fishes there";
    expect(findClosestQuote("I goed at the markets and I buys fishes", line)).not.toBeNull();
    expect(findClosestQuote("goed at markets buys", line, 0.9)).toBeNull();
  });
});

describe("splitTranscriptLines / numberedTranscript", () => {
  it("makes one line per sentence and keeps the exact words", () => {
    const lines = splitTranscriptLines("I goed there. Why did you go? Because I wanted!");
    expect(lines).toEqual(["I goed there.", "Why did you go?", "Because I wanted!"]);
    expect(numberedTranscript(lines)).toBe("[1] I goed there.\n[2] Why did you go?\n[3] Because I wanted!");
  });

  it("cuts a long run without punctuation into lines of at most 30 words", () => {
    const lines = splitTranscriptLines(Array(65).fill("word").join(" "));
    expect(lines.map((l) => l.split(" ").length)).toEqual([30, 30, 5]);
  });

  it("starts a new line at every line break", () => {
    expect(splitTranscriptLines("first part\nsecond part")).toEqual(["first part", "second part"]);
  });
});
