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
/**
 * Written under the transcript when the transcript came from a model that LISTENED to the audio (BYOK), even if it
 * noted no mispronounced word. Without it "no notes" would be ambiguous: "spoke clearly" or "nobody listened". Only
 * a listened session may get a pronunciation band estimate.
 */
export const LISTENED_MARKER = "===AUDIO LISTENED===";

const MAX_NOTE_CHARS = 160;
/** Most notes one chunk (~25 s) may carry. */
export const MAX_NOTES_PER_CHUNK = 8;
/** Most notes kept for a whole call (distinct lines; a long call can hold a few hundred words). */
export const MAX_NOTES_PER_CALL = 300;

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
  return text.split(PRON_MARKER).join(" ").split(LISTENED_MARKER).join(" ").replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * The text stored in the database: the transcript, then (if it was listened to) the "listened" marker, then (if any)
 * the notes under their marker line.
 */
export function joinPronunciationNotes(transcript: string, notes: readonly string[], listened = false): string {
  const clean = cleanNoteLines(notes);
  const body = stripMarker(transcript);
  let out = body;
  if (listened) out += `\n\n${LISTENED_MARKER}`;
  if (clean.length > 0) out += `\n\n${PRON_MARKER}\n${clean.map((n) => `- ${n}`).join("\n")}`;
  return out;
}

/** The reverse of joinPronunciationNotes, for the feedback worker. A text without a marker comes back unchanged. */
export function splitPronunciationNotes(stored: string): { spoken: string; notes: string[]; listened: boolean } {
  const pronAt = stored.indexOf(PRON_MARKER);
  const listenedAt = stored.indexOf(LISTENED_MARKER);
  const cuts = [pronAt, listenedAt].filter((i) => i >= 0);
  if (cuts.length === 0) return { spoken: stored, notes: [], listened: false };
  return {
    spoken: stored.slice(0, Math.min(...cuts)).trim(),
    notes: pronAt >= 0 ? cleanNoteLines(stored.slice(pronAt + PRON_MARKER.length).split("\n")) : [],
    listened: listenedAt >= 0,
  };
}

// ---- structured notes: "word | heard: x | sound: th /θ/ | note: ..." ------------------------------------------
//
// New notes are written as one line with four parts so the student's feedback screen can group the
// words by SOUND ("th /θ/: think, three, thought"), the way an IELTS speaking report does. Older free-text
// notes ("think: heard as 'sink' (th pronounced as s)") still work: they are kept under "Other".
export type ParsedNote = { word: string; heard: string; sound: string; note: string };
export type SoundGroup = { sound: string; words: ParsedNote[] };

const OTHER_SOUND = "Other";

/** Reads one note line in the structured form, or the older free-text form. Returns null for an unusable line. */
export function parseNote(line: string): ParsedNote | null {
  const clean = line.replace(/^[\s\-*•]+/, "").trim();
  if (!clean) return null;
  if (clean.includes("|")) {
    const parts = clean.split("|").map((p) => p.trim());
    const word = parts[0].replace(/^[\"'“”]+|[\"'“”]+$/g, "").trim();
    const field = (key: string) => {
      const hit = parts.slice(1).find((p) => p.toLowerCase().startsWith(`${key}:`));
      return hit ? hit.slice(key.length + 1).trim() : "";
    };
    if (!word) return null;
    return { word, heard: field("heard"), sound: field("sound") || OTHER_SOUND, note: field("note") };
  }
  // older style: "word: heard as 'x' (problem)"
  const colon = clean.indexOf(":");
  if (colon > 0) {
    const word = clean.slice(0, colon).trim();
    const rest = clean.slice(colon + 1).trim();
    const heard = /heard as\s+['"“/]?([^'"”/()]+)/i.exec(rest)?.[1]?.trim() ?? "";
    const note = /\(([^)]+)\)/.exec(rest)?.[1]?.trim() ?? rest;
    return word ? { word, heard, sound: OTHER_SOUND, note } : null;
  }
  return { word: clean, heard: "", sound: OTHER_SOUND, note: "" };
}

/**
 * Groups notes by sound, biggest group first ("Other" always last). The same word is listed once per sound.
 * Only what the listening model actually wrote is used: nothing is added or guessed here.
 */
export function groupNotesBySound(notes: readonly string[]): SoundGroup[] {
  const groups = new Map<string, SoundGroup>();
  const seen = new Set<string>();
  for (const line of notes) {
    const n = parseNote(line);
    if (!n) continue;
    const label = n.sound.replace(/\s+/g, " ").slice(0, 24) || OTHER_SOUND;
    const key = label.toLowerCase();
    const wordKey = `${key}|${n.word.toLowerCase()}`;
    if (seen.has(wordKey)) continue;
    seen.add(wordKey);
    const g = groups.get(key) ?? { sound: label, words: [] };
    g.words.push({ ...n, sound: label });
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.sound === OTHER_SOUND) return 1;
    if (b.sound === OTHER_SOUND) return -1;
    return b.words.length - a.words.length;
  });
}
