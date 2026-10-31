// lib/speaking-club/pronunciation-notes.ts
//
// Pure helpers (no browser or server APIs), shared by the student's device and the server.
//
// A transcript only shows the words a student MEANT, not how they sounded, so a mispronounced
// word looks perfectly fine in it. The BYOK Gemini transcriber listens to the audio, so it is
// asked to write down, besides the transcript, the words that sounded wrong. Those notes travel
// separately from the transcript on the device and are stored UNDER the transcript, after a
// marker line, in the same text column (no database change). The feedback worker splits them
// again: the spoken text is what gets counted and scored, the notes are only hints.
export const PRON_MARKER = "===PRONUNCIATION NOTES===";

const MAX_NOTE_CHARS = 160;
/** Most notes one chunk (~25 s) may carry. */
export const MAX_NOTES_PER_CHUNK = 8;
/** Most notes kept for a whole call. */
export const MAX_NOTES_PER_CALL = 60;

// The model may write the marker slightly differently ("=== Pronunciation ===" ...).
const MARKER_IN_REPLY = /\n?[ \t]*={2,}[ \t]*PRONUNCIATION( NOTES)?[ \t]*={2,}[ \t]*\n?/i;

/** Tidies note lines: one short "- word: ..." line each, no bullets, no duplicates, nothing empty. */
export function cleanNoteLines(lines: readonly unknown[], max: number = MAX_NOTES_PER_CALL): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    if (typeof raw !== "string") continue;
    const line = raw
      .replace(/^[\s\-*•\d.)]+/, "") // bullet / numbering
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NOTE_CHARS);
    if (!/[A-Za-z]/.test(line)) continue;
    if (/^(none|n\/a|no (clear )?(pronunciation )?(issues?|mistakes?|notes?)( noted| found)?\.?)$/i.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

/** Splits one Gemini reply into the spoken text and the pronunciation notes written under it. */
export function parseTranscriptReply(raw: string): { text: string; notes: string[] } {
  const m = MARKER_IN_REPLY.exec(raw);
  if (!m) return { text: raw.trim(), notes: [] };
  const text = raw.slice(0, m.index).trim();
  const notes = cleanNoteLines(raw.slice(m.index + m[0].length).split("\n"), MAX_NOTES_PER_CHUNK);
  return { text, notes };
}

/** Removes any marker from text that came from a client (it must not be able to fake the notes section). */
export function stripMarker(text: string): string {
  return text.split(PRON_MARKER).join(" ").replace(/[ \t]{2,}/g, " ").trim();
}

/** The text stored in the database: the transcript, then (if any) the notes under a marker line. */
export function joinPronunciationNotes(transcript: string, notes: readonly string[]): string {
  const clean = cleanNoteLines(notes);
  const body = stripMarker(transcript);
  if (clean.length === 0) return body;
  return `${body}\n\n${PRON_MARKER}\n${clean.map((n) => `- ${n}`).join("\n")}`;
}

/** The reverse of joinPronunciationNotes, for the feedback worker. A text without a marker comes back unchanged. */
export function splitPronunciationNotes(stored: string): { spoken: string; notes: string[] } {
  const at = stored.indexOf(PRON_MARKER);
  if (at < 0) return { spoken: stored, notes: [] };
  return {
    spoken: stored.slice(0, at).trim(),
    notes: cleanNoteLines(stored.slice(at + PRON_MARKER.length).split("\n")),
  };
}
