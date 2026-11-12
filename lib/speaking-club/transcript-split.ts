// lib/speaking-club/transcript-split.ts
//
// Pure helper (no server or browser APIs) used by lib/speaking-feedback-db.ts and
// unit-tested in tests/speaking-club.
//
// One feedback row = ONE Gemini call, and the IELTS-examiner report judges the WHOLE transcript
// at once, so a normal session (a full hour is ~20-45k characters) must stay a single row.
// The mistake list is NOT capped (same as before), so one long call takes longer than the old
// 16k-character calls did; watch the call time on the first slot. Only an unusually long text (> PART_CHARS) is still split,
// each part stored as its own row, instead of being sent to Gemini as one huge request.
export const PART_CHARS = 60000;

/**
 * Splits a long transcript into parts of at most `maxChars`, cutting at a sentence
 * end (or at least a space) so no word is cut in half.
 */
export function splitTranscript(text: string, maxChars: number = PART_CHARS): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > maxChars) {
    const from = Math.max(0, maxChars - 600);
    const window = rest.slice(from, maxChars);
    const sentenceEnd = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
    let cut = maxChars;
    if (sentenceEnd >= 0) cut = from + sentenceEnd + 1;
    else {
      const space = window.lastIndexOf(" ");
      if (space >= 0) cut = from + space;
    }
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

