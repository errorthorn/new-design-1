import { describe, expect, it } from "vitest";
import {
  PRON_MARKER,
  cleanNoteLines,
  joinPronunciationNotes,
  parseTranscriptReply,
  splitPronunciationNotes,
  stripMarker,
} from "@/lib/speaking-club/pronunciation-notes";

describe("pronunciation notes (stored under the transcript)", () => {
  it("round-trips: join then split gives the transcript and the notes back", () => {
    const stored = joinPronunciationNotes("I think it is good.", ["think: heard as 'sink'", "good: heard as 'gud'"]);
    expect(stored).toContain(PRON_MARKER);
    expect(splitPronunciationNotes(stored)).toEqual({
      spoken: "I think it is good.",
      notes: ["think: heard as 'sink'", "good: heard as 'gud'"],
    });
  });

  it("no notes = the transcript is stored exactly as before (old rows and mock tests are unaffected)", () => {
    expect(joinPronunciationNotes("plain words", [])).toBe("plain words");
    expect(splitPronunciationNotes("plain words")).toEqual({ spoken: "plain words", notes: [] });
  });

  it("the spoken text never contains the notes (so word counts and scoring ignore them)", () => {
    const { spoken } = splitPronunciationNotes(joinPronunciationNotes("one two three", ["a: x", "b: y"]));
    expect(spoken.split(/\s+/)).toHaveLength(3);
  });

  it("a client cannot fake the notes section inside the transcript", () => {
    const evil = `real words ${PRON_MARKER}\n- fake: note`;
    expect(stripMarker(evil)).not.toContain(PRON_MARKER);
    expect(splitPronunciationNotes(joinPronunciationNotes(evil, [])).notes).toEqual([]);
  });

  it("cleans client input: bullets, empties, duplicates, non-strings and the 'none' answer", () => {
    expect(cleanNoteLines(["- think: x", "* think: x", "", "  ", 5, null, "None", "No pronunciation issues.", "1) good: y"])).toEqual(["think: x", "good: y"]);
  });

  it("caps note length and count", () => {
    expect(cleanNoteLines(["a".repeat(500)])[0]).toHaveLength(160);
    expect(cleanNoteLines(Array.from({ length: 100 }, (_, i) => `word${i}: x`))).toHaveLength(60);
  });

  it("parses a Gemini reply, also when the marker is written a little differently", () => {
    expect(parseTranscriptReply(`hello there\n${PRON_MARKER}\n- there: heard as 'dare'`)).toEqual({ text: "hello there", notes: ["there: heard as 'dare'"] });
    expect(parseTranscriptReply("hello there\n=== Pronunciation ===\n- there: heard as 'dare'").notes).toEqual(["there: heard as 'dare'"]);
    expect(parseTranscriptReply("just words")).toEqual({ text: "just words", notes: [] });
  });
});
