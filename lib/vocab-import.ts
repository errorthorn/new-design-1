// lib/vocab-import.ts
//
// Turns text an admin pasted (prepared by any AI, in the format the student page shows) into
// ready-to-save vocab words: word, pronunciation, part of speech, meaning, two synonyms and
// two example sentences with their Bangla translation. Pure functions (no browser, server or
// database imports) so the admin page can preview live and the tests can run in plain Node.
//
// The one format we ask the AI for is VOCAB_SAMPLE_BLOCK below, but the parser is tolerant on
// purpose because AIs drift: bold labels, bullets, numbering, code fences, labels in a different
// order or spelled a bit differently ("IPA", "POS", "Definition"), examples written as a list,
// JSON, and tables (a pasted spreadsheet or a markdown table). Whatever it cannot place is
// reported as a warning or an error, never silently guessed, so the admin sees exactly what will
// be saved before anything is.

export type VocabDraft = {
  word: string;
  pronunciation: string;
  partOfSpeech: string;
  meaningEn: string;
  synonym1: string;
  synonym2: string;
  example1En: string;
  example1Bn: string;
  example2En: string;
  example2Bn: string;
};

export type ParsedVocab = {
  draft: VocabDraft;
  /** Problems that stop this word from being saved (a word and its meaning are required). */
  errors: string[];
  /** Things worth a look, but the word can still be saved. */
  warnings: string[];
  /** The same word appears earlier in this paste. */
  duplicateInPaste: boolean;
};

export type ParseResult = {
  items: ParsedVocab[];
  /** Batch-level `Topic:` / `Date:` lines found above the words, if any. */
  topic: string | null;
  date: string | null; // YYYY-MM-DD
  /** Anything about the paste as a whole (nothing recognised, a date that could not be read...). */
  notes: string[];
};

export const MAX_IMPORT_WORDS = 200;
export const FIELD_MAX = { word: 80, pronunciation: 80, partOfSpeech: 40, meaningEn: 500, synonym: 80, example: 400 } as const;

// ---------------------------------------------------------------------------
// small text helpers
// ---------------------------------------------------------------------------

const BN_CHAR = /[ঀ-৿]/;

/** More Bangla-script characters than Latin letters. */
export function isBangla(s: string): boolean {
  const bn = s.match(/[\u0980-\u09FF]/g)?.length ?? 0;
  const latin = s.match(/[A-Za-z]/g)?.length ?? 0;
  return bn > 0 && bn > latin;
}

/** Removes markdown noise (bold, code ticks), normalises spaces and strips one pair of wrapping quotes. */
function cleanInline(s: string): string {
  let t = s
    .replace(/\*\*|__|`/g, "")
    .replace(/[ ​‌‍﻿]/g, (c) => (c === " " ? " " : c === "‌" || c === "‍" ? c : ""))
    .replace(/\s+/g, " ")
    .trim();
  const pairs: [string, string][] = [
    ['"', '"'],
    ["“", "”"],
    ["‘", "’"],
    ["'", "'"],
  ];
  for (const [a, b] of pairs) {
    if (t.length > 1 && t.startsWith(a) && t.endsWith(b) && !t.slice(1, -1).includes(a)) {
      t = t.slice(1, -1).trim();
      break;
    }
  }
  return t.replace(/^\*+|\*+$/g, "").trim();
}

/** Drops a leading bullet ("- ", "• ") or number ("1.", "2)"). */
function stripBullet(s: string): string {
  return s.replace(/^\s*(?:[-*•–—]\s+|\d{1,3}[.)]\s+)/, "").trim();
}

const POS_MAP: Record<string, string> = {
  n: "noun",
  noun: "noun",
  v: "verb",
  verb: "verb",
  vb: "verb",
  adj: "adjective",
  adjective: "adjective",
  adv: "adverb",
  adverb: "adverb",
  prep: "preposition",
  preposition: "preposition",
  conj: "conjunction",
  conjunction: "conjunction",
  pron: "pronoun",
  pronoun: "pronoun",
  interj: "interjection",
  interjection: "interjection",
  exclamation: "interjection",
  det: "determiner",
  determiner: "determiner",
  phr: "phrase",
  phrase: "phrase",
};

function normalizePos(raw: string): string {
  const t = cleanInline(raw).toLowerCase().replace(/[.\s]+$/g, "");
  if (!t) return "";
  if (POS_MAP[t]) return POS_MAP[t];
  // "noun / verb", "noun, verb": keep, just tidy
  const parts = t.split(/\s*[/,&]\s*|\s+and\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => POS_MAP[p.replace(/\./g, "")])) return parts.map((p) => POS_MAP[p.replace(/\./g, "")]).join(" / ");
  return t;
}

/** "/əˈsweɪd/" form: slashes added when missing, [brackets] turned into slashes. */
function normalizePronunciation(raw: string): string {
  let t = cleanInline(raw);
  if (!t) return "";
  const slashGroup = /\/[^/]{1,60}\//.exec(t);
  const bracketGroup = /\[[^\]]{1,60}\]/.exec(t);
  if (slashGroup && t.split("/").length > 3) return slashGroup[0]; // "US /a/ UK /b/": keep the first
  if (slashGroup && /^[A-Za-z ]{0,12}[:\s]*\/[^/]+\/$/.test(t)) return slashGroup[0];
  if (t.startsWith("/") && t.endsWith("/") && t.length > 2) return t;
  if (bracketGroup && /^[A-Za-z ]{0,12}[:\s]*\[[^\]]+\]$/.test(t)) return `/${bracketGroup[0].slice(1, -1)}/`;
  t = t.replace(/^[/\[(]+|[/\])]+$/g, "").trim();
  return t ? `/${t}/` : "";
}

function splitList(s: string): string[] {
  return s
    .split(/\s*[,;،、|]\s*|\s+\/\s+|\s+or\s+(?=[A-Za-z])/)
    .map((x) => cleanInline(stripBullet(x)))
    .filter(Boolean);
}

/** Separates "English sentence (বাংলা)" / "English – বাংলা" / "English বাংলা" into its two languages. */
function splitEnBn(text: string): { en: string; bn: string } {
  const at = text.search(BN_CHAR);
  if (at < 0) return { en: text, bn: "" };
  if (at === 0) return { en: "", bn: text };
  const left = text.slice(0, at).replace(/[\s(（\-–—|/:]+$/, "").trim();
  let right = text.slice(at).trim();
  const hadParen = /[(（]\s*$/.test(text.slice(0, at));
  if (hadParen) right = right.replace(/[)）]\s*$/, "").trim();
  if (left.length >= 2 && /[A-Za-z]/.test(left) && isBangla(right)) return { en: left, bn: right };
  return isBangla(text) ? { en: "", bn: text } : { en: text, bn: "" };
}

// ---------------------------------------------------------------------------
// which field does a label belong to?
// ---------------------------------------------------------------------------

type Slot =
  | { kind: "word" }
  | { kind: "pron" }
  | { kind: "pos" }
  | { kind: "meaning" }
  | { kind: "synonyms"; n?: number }
  | { kind: "example"; n?: number; bn: boolean }
  | { kind: "topic" }
  | { kind: "date" }
  | { kind: "ignore"; why: string };

const BN_KEY = ["bangla", "bengali", "bn", "ben", "translation", "translations", "translated", "বাংলা", "বাংলায়", "অনুবাদ", "মানে"];

export function classifyKey(raw: string): Slot | null {
  const k = raw
    .replace(/([a-z])([A-Z])/g, "$1 $2") // meaningEn, partOfSpeech
    .toLowerCase()
    .replace(/([a-zঀ-৿])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zঀ-৿])/g, "$1 $2")
    .replace(/[()\[\]{}_\-–—.,/#:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!k) return null;
  const tokens = k.split(" ");
  const has = (...w: string[]) => tokens.some((t) => w.includes(t));
  const numTok = tokens.find((t) => /^\d$/.test(t));
  const n = numTok ? Number(numTok) : undefined;
  const bn = has(...BN_KEY);

  if (has("topic", "theme")) return { kind: "topic" };
  if (has("date") && !has("example", "examples")) return { kind: "date" };
  if (has("example", "examples", "sentence", "sentences", "eg", "usage", "ex")) return { kind: "example", n, bn };
  if (has("synonym", "synonyms", "similar")) return { kind: "synonyms", n };
  if (bn && has("meaning", "definition", "def", "meanings")) return { kind: "ignore", why: "A Bangla meaning is not saved (only the English meaning and the Bangla example translations are)." };
  if (bn) return { kind: "example", n, bn: true };
  if (has("pronunciation", "pronounced", "pronounce", "ipa", "pron", "phonetic", "phonetics")) return { kind: "pron" };
  if (has("pos") || (has("part") && has("speech")) || k === "word class" || has("wordclass", "grammar") || k === "type" || k === "class") return { kind: "pos" };
  if (has("meaning", "meanings", "definition", "definitions", "def")) return { kind: "meaning" };
  if (has("word", "vocabulary", "vocab", "term", "headword")) return { kind: "word" };
  return null;
}

// ---------------------------------------------------------------------------
// one word, collected from any input shape, then checked
// ---------------------------------------------------------------------------

type RawWord = {
  word: string;
  pron: string;
  pos: string;
  meaning: string;
  synonyms: string[];
  synonymSlots: string[]; // "Synonym 1:", "Synonym 2:" given separately
  examples: { en: string; bn: string }[];
  notes: string[];
};

const newRaw = (): RawWord => ({ word: "", pron: "", pos: "", meaning: "", synonyms: [], synonymSlots: [], examples: [], notes: [] });

// A label only counts with its delimiter ("Bangla: ...", "(Bangla) ..."), so an English sentence that merely
// starts with the word "Translation" is left alone.
const BN_LABEL = /^\(?\s*(?:bangla|bengali|bn|translation|বাংলা|বাংলায়|অনুবাদ)\s*(?:\)\s*[:：\-–—]?|[:：\-–—])\s*/i;

function applyExample(raw: RawWord, slot: Extract<Slot, { kind: "example" }>, lines: string[]) {
  const idx = slot.n !== undefined ? Math.max(0, slot.n - 1) : undefined;
  const ensure = (i: number) => {
    while (raw.examples.length <= i) raw.examples.push({ en: "", bn: "" });
    return raw.examples[i];
  };
  const setBn = (text: string, at?: number) => {
    if (at !== undefined) {
      ensure(at).bn = text;
      return;
    }
    // unnumbered Bangla belongs to the latest English example that has none yet
    for (let i = raw.examples.length - 1; i >= 0; i--) {
      if (raw.examples[i].en && !raw.examples[i].bn) {
        raw.examples[i].bn = text;
        return;
      }
    }
    if (raw.examples.length > 0 && !raw.examples[raw.examples.length - 1].bn) raw.examples[raw.examples.length - 1].bn = text;
    else raw.examples.push({ en: "", bn: text });
  };

  lines.forEach((line, i) => {
    let text = cleanInline(stripBullet(line));
    if (!text) return;
    let labelledBn = false;
    const label = BN_LABEL.exec(text);
    if (label && label[0].trim()) {
      labelledBn = true;
      text = cleanInline(text.slice(label[0].length));
      if (!text) return;
    }
    const pair = splitEnBn(text);
    const at = i === 0 ? idx : undefined; // only the first line of a keyed entry takes the number
    if (pair.en && pair.bn) {
      if (at !== undefined) {
        const e = ensure(at);
        e.en = pair.en;
        e.bn = pair.bn;
      } else {
        raw.examples.push({ en: pair.en, bn: pair.bn });
      }
    } else if (slot.bn || labelledBn || isBangla(text)) {
      setBn(text, at);
    } else if (at !== undefined) {
      ensure(at).en = text;
    } else {
      raw.examples.push({ en: text, bn: "" });
    }
  });
}

function applyField(raw: RawWord, slot: Slot, lines: string[]) {
  const joined = cleanInline(lines.map((l) => stripBullet(l)).join(" "));
  switch (slot.kind) {
    case "word":
      raw.word = cleanInline(stripBullet(lines[0] ?? ""));
      return;
    case "pron":
      raw.pron = joined;
      return;
    case "pos":
      raw.pos = joined;
      return;
    case "meaning":
      raw.meaning = joined;
      return;
    case "synonyms":
      if (slot.n !== undefined) raw.synonymSlots[slot.n - 1] = joined;
      else raw.synonyms.push(...splitList(lines.map((l) => stripBullet(l)).join(", ")));
      return;
    case "example":
      applyExample(raw, slot, lines);
      return;
    case "ignore":
      raw.notes.push(slot.why);
      return;
    default:
      return;
  }
}

function check(slice: string, max: number, label: string, warnings: string[]): string {
  if (slice.length > max) {
    warnings.push(`${label} was cut to ${max} characters.`);
    return slice.slice(0, max).trim();
  }
  return slice;
}

function finalize(raw: RawWord): ParsedVocab {
  const errors: string[] = [];
  const warnings: string[] = [...new Set(raw.notes)];

  let word = cleanInline(raw.word);
  let pron = raw.pron;
  let pos = raw.pos;

  // "ameliorate /əˈmiːliəreɪt/" or "ameliorate (verb)" written on the word line
  if (word) {
    const slash = /\s*(\/[^/]{1,60}\/)\s*/.exec(word);
    if (slash && !pron) {
      pron = slash[1];
      word = word.replace(slash[0], " ").trim();
    }
    const paren = /\s*[(（]\s*([A-Za-z.]{1,14})\s*[)）]\s*$/.exec(word);
    if (paren && POS_MAP[paren[1].toLowerCase().replace(/\./g, "")] && !pos) {
      pos = paren[1];
      word = word.replace(paren[0], "").trim();
    }
  }

  const syn = [...raw.synonyms, ...raw.synonymSlots.filter(Boolean).flatMap((s) => splitList(s))];
  const seen = new Set<string>([word.toLowerCase()]);
  const synonyms = syn.filter((s) => {
    const key = s.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const examples = raw.examples.filter((e) => e.en || e.bn);

  const draft: VocabDraft = {
    word,
    pronunciation: normalizePronunciation(pron),
    partOfSpeech: normalizePos(pos),
    meaningEn: cleanInline(raw.meaning),
    synonym1: synonyms[0] ?? "",
    synonym2: synonyms[1] ?? "",
    example1En: examples[0]?.en ?? "",
    example1Bn: examples[0]?.bn ?? "",
    example2En: examples[1]?.en ?? "",
    example2Bn: examples[1]?.bn ?? "",
  };

  if (!draft.word) errors.push("The word is missing.");
  else if (draft.word.length > FIELD_MAX.word || /\n/.test(draft.word)) errors.push("The word line is too long — the text may be mixed up.");
  if (!draft.meaningEn) errors.push("The meaning is missing.");
  else if (draft.meaningEn.length > FIELD_MAX.meaningEn) errors.push(`The meaning is longer than ${FIELD_MAX.meaningEn} characters.`);

  if (draft.meaningEn && isBangla(draft.meaningEn)) warnings.push("The meaning looks like Bangla, but this field is for the English meaning.");
  if (!draft.pronunciation) warnings.push("No pronunciation.");
  if (!draft.partOfSpeech) warnings.push("No part of speech.");
  if (synonyms.length === 0) warnings.push("No synonyms.");
  else if (synonyms.length === 1) warnings.push("Only 1 synonym.");
  else if (synonyms.length > 2) warnings.push(`Only 2 synonyms are saved (kept ${synonyms[0]}, ${synonyms[1]}).`);
  if (examples.length === 0) warnings.push("No example sentences.");
  else if (examples.length === 1) warnings.push("Only 1 example sentence.");
  else if (examples.length > 2) warnings.push("Only 2 example sentences are saved (the first two were kept).");
  examples.slice(0, 2).forEach((e, i) => {
    if (!e.en && e.bn) warnings.push(`Example ${i + 1} has a Bangla translation but no English sentence, so it will not be shown.`);
    else if (e.en && !e.bn) warnings.push(`Example ${i + 1} has no Bangla translation.`);
  });

  draft.pronunciation = check(draft.pronunciation, FIELD_MAX.pronunciation, "The pronunciation", warnings);
  draft.partOfSpeech = check(draft.partOfSpeech, FIELD_MAX.partOfSpeech, "The part of speech", warnings);
  draft.synonym1 = check(draft.synonym1, FIELD_MAX.synonym, "Synonym 1", warnings);
  draft.synonym2 = check(draft.synonym2, FIELD_MAX.synonym, "Synonym 2", warnings);
  draft.example1En = check(draft.example1En, FIELD_MAX.example, "Example 1", warnings);
  draft.example1Bn = check(draft.example1Bn, FIELD_MAX.example, "Example 1 (Bangla)", warnings);
  draft.example2En = check(draft.example2En, FIELD_MAX.example, "Example 2", warnings);
  draft.example2Bn = check(draft.example2Bn, FIELD_MAX.example, "Example 2 (Bangla)", warnings);

  return { draft, errors, warnings, duplicateInPaste: false };
}

// ---------------------------------------------------------------------------
// input shapes
// ---------------------------------------------------------------------------

type Batch = { topic: string | null; date: string | null; notes: string[] };

/** "2026-11-02", "02/11/2026", "2-11-2026" (day first, as written in Bangladesh) -> "2026-11-02". */
export function parseBatchDate(raw: string): string | null {
  const t = raw.trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (hit) {
    y = +hit[1];
    m = +hit[2];
    d = +hit[3];
  } else if ((hit = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t))) {
    d = +hit[1];
    m = +hit[2];
    y = +hit[3];
  } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function setBatch(batch: Batch, slot: Slot, value: string) {
  const v = cleanInline(value);
  if (!v) return;
  if (slot.kind === "topic" && !batch.topic) batch.topic = v.slice(0, 120);
  if (slot.kind === "date" && !batch.date) {
    const iso = parseBatchDate(v);
    if (iso) batch.date = iso;
    else batch.notes.push(`Could not read the date "${v}" (use YYYY-MM-DD).`);
  }
}

type KeyLine = { slot: Slot; value: string };

function keyLine(line: string): KeyLine | null {
  let s = line.trim().replace(/\*\*|__|`/g, "");
  s = s.replace(/^#{1,6}\s*/, "");
  s = s.replace(/^(?:[-*•–]\s+|\d{1,3}[.)]\s+)/, "");
  const m = /^([^:：]{1,45}?)\s*[:：]\s*(.*)$/.exec(s);
  if (!m) return null;
  const slot = classifyKey(m[1]);
  return slot ? { slot, value: m[2] } : null;
}

function fromJson(text: string, batch: Batch): RawWord[] | null {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  if (!t.startsWith("[") && !t.startsWith("{")) return null;
  let data: unknown;
  try {
    data = JSON.parse(t);
  } catch {
    return null;
  }
  let list: unknown = data;
  if (!Array.isArray(data) && data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      const slot = classifyKey(k);
      if (slot && (slot.kind === "topic" || slot.kind === "date") && typeof v === "string") setBatch(batch, slot, v);
    }
    list = Object.values(obj).find((v) => Array.isArray(v)) ?? [obj];
  }
  if (!Array.isArray(list)) return null;
  const out: RawWord[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const raw = newRaw();
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      const slot = classifyKey(key);
      if (!slot) continue;
      if (slot.kind === "example" && Array.isArray(value)) {
        value.forEach((ex, i) => {
          if (typeof ex === "string") applyExample(raw, { kind: "example", n: i + 1, bn: slot.bn }, [ex]);
          else if (ex && typeof ex === "object") {
            const o = ex as Record<string, unknown>;
            const en = Object.entries(o).find(([k]) => /^(en|english|sentence|example|text)$/i.test(k))?.[1];
            const bn = Object.entries(o).find(([k]) => /^(bn|bangla|bengali|translation)$/i.test(k) || BN_CHAR.test(k))?.[1];
            const e = (raw.examples[i] ??= { en: "", bn: "" });
            if (typeof en === "string") e.en = cleanInline(en);
            if (typeof bn === "string") e.bn = cleanInline(bn);
          }
        });
      } else if (slot.kind === "synonyms" && Array.isArray(value)) {
        raw.synonyms.push(...value.filter((x): x is string => typeof x === "string").map(cleanInline).filter(Boolean));
      } else if (typeof value === "string" || typeof value === "number") {
        applyField(raw, slot, [String(value)]);
      }
    }
    out.push(raw);
  }
  return out;
}

function fromTable(lines: string[]): RawWord[] | null {
  const rows = lines
    .filter((l) => l.trim() && !/^\s*\|?[\s:|-]+\|?\s*$/.test(l)) // drop |---|---| rows
    .map((l) => {
      const piped = l.includes("|");
      const cells = (piped ? l.trim().replace(/^\||\|$/g, "").split("|") : l.split("\t")).map((c) => cleanInline(c));
      return cells;
    })
    .filter((c) => c.length >= 3);
  if (rows.length < 2) return null;
  const headerAt = rows.findIndex((r) => r.filter((c) => classifyKey(c)).length >= 3);
  if (headerAt < 0) return null;
  const slots = rows[headerAt].map((c) => classifyKey(c));
  if (!slots.some((s) => s?.kind === "word")) return null;
  const out: RawWord[] = [];
  for (const row of rows.slice(headerAt + 1)) {
    const raw = newRaw();
    row.forEach((cell, i) => {
      const slot = slots[i];
      if (slot && cell) applyField(raw, slot, [cell]);
    });
    out.push(raw);
  }
  return out;
}

function fromBlocks(lines: string[], batch: Batch): RawWord[] {
  type Entry = { slot: Slot; lines: string[] };
  type Block = { entries: Entry[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let entry: Entry | null = null;

  const nextKeyed = (from: number): boolean => {
    for (let j = from + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      const k = keyLine(lines[j]);
      return !!k && k.slot.kind !== "topic" && k.slot.kind !== "date";
    }
    return false;
  };

  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    if (/^([-*_=~]\s*){3,}$/.test(t)) {
      cur = null;
      entry = null;
      return;
    }
    const k = keyLine(line);
    if (k) {
      if (k.slot.kind === "topic" || k.slot.kind === "date") {
        setBatch(batch, k.slot, k.value);
        entry = null;
        return;
      }
      if (!cur || (k.slot.kind === "word" && cur.entries.some((e) => e.slot.kind === "word"))) {
        cur = { entries: [] };
        blocks.push(cur);
      }
      entry = { slot: k.slot, lines: k.value.trim() ? [k.value] : [] };
      cur.entries.push(entry);
      return;
    }
    // a heading that is just the word: "## ameliorate" or "1. ameliorate" right after a separator
    const isHash = /^#{1,6}\s+\S/.test(t);
    if ((isHash || (!cur && /^\**\s*\d{1,3}[.)]\s+\S/.test(t))) && t.length <= 70 && nextKeyed(i)) {
      cur = { entries: [{ slot: { kind: "word" }, lines: [t.replace(/^#{1,6}\s+/, "").replace(/^\**\s*\d{1,3}[.)]\s+/, "")] }] };
      blocks.push(cur);
      entry = null;
      return;
    }
    if (entry) entry.lines.push(t);
    // text before the first word (the AI's "Here are your words:") is ignored
  });

  return blocks.map((b) => {
    const raw = newRaw();
    for (const e of b.entries) applyField(raw, e.slot, e.lines);
    return raw;
  });
}

// ---------------------------------------------------------------------------
// public entry point
// ---------------------------------------------------------------------------

export function parseVocabText(input: string): ParseResult {
  const batch: Batch = { topic: null, date: null, notes: [] };
  const text = (input ?? "").replace(/\r\n?/g, "\n").normalize("NFC");
  const lines = text.split("\n").filter((l) => !/^\s*```/.test(l));

  let raws: RawWord[] | null = fromJson(text, batch);
  if (!raws && lines.filter((l) => l.includes("|") || l.includes("\t")).length >= 2) raws = fromTable(lines);
  if (!raws) raws = fromBlocks(lines, batch);

  const items = raws.map(finalize);
  const first = new Map<string, number>();
  items.forEach((it, i) => {
    const key = it.draft.word.toLowerCase();
    if (!key) return;
    if (first.has(key)) it.duplicateInPaste = true;
    else first.set(key, i);
  });

  const notes = [...batch.notes];
  if (text.trim() && items.length === 0) notes.push("No words were found. Check that each word starts with a \"Word:\" line (see the format below).");
  if (items.length > MAX_IMPORT_WORDS) notes.push(`Only the first ${MAX_IMPORT_WORDS} words can be added at once.`);
  return { items: items.slice(0, MAX_IMPORT_WORDS), topic: batch.topic, date: batch.date, notes };
}

// ---------------------------------------------------------------------------
// server side: never trust the browser's copy
// ---------------------------------------------------------------------------

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Validates one word received by the API. Returns null when it is not usable (no word or no meaning). */
export function sanitizeVocabDraft(v: unknown): VocabDraft | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const draft: VocabDraft = {
    word: str(o.word, FIELD_MAX.word),
    pronunciation: str(o.pronunciation, FIELD_MAX.pronunciation),
    partOfSpeech: str(o.partOfSpeech, FIELD_MAX.partOfSpeech),
    meaningEn: str(o.meaningEn, FIELD_MAX.meaningEn),
    synonym1: str(o.synonym1, FIELD_MAX.synonym),
    synonym2: str(o.synonym2, FIELD_MAX.synonym),
    example1En: str(o.example1En, FIELD_MAX.example),
    example1Bn: str(o.example1Bn, FIELD_MAX.example),
    example2En: str(o.example2En, FIELD_MAX.example),
    example2Bn: str(o.example2Bn, FIELD_MAX.example),
  };
  return draft.word && draft.meaningEn ? draft : null;
}

// ---------------------------------------------------------------------------
// the format we ask the AI for (shown on the admin page, and used by the tests)
// ---------------------------------------------------------------------------

export const VOCAB_SAMPLE_BLOCK = `Word: ameliorate
Pronunciation: /əˈmiːliəreɪt/
Part of speech: verb
Meaning: to make a bad situation better
Synonym 1: improve
Synonym 2: enhance
Example 1: The new policy helped to ameliorate living conditions in the city.
Example 1 (Bangla): নতুন নীতি শহরের জীবনযাত্রার মান উন্নত করতে সাহায্য করেছে।
Example 2: Doctors tried to ameliorate the patient's pain.
Example 2 (Bangla): ডাক্তাররা রোগীর ব্যথা কমানোর চেষ্টা করেছিলেন।`;

export function buildVocabPrompt(opts: { count?: number; topic?: string; date?: string } = {}): string {
  const count = Math.min(Math.max(Math.floor(opts.count ?? 10) || 10, 1), MAX_IMPORT_WORDS);
  const topic = (opts.topic ?? "").trim();
  const head = [
    topic ? `Topic: ${topic}` : "Topic: <the topic of this set>",
    opts.date ? `Date: ${opts.date}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `Create ${count} English vocabulary words${topic ? ` about "${topic}"` : ""} for IELTS learners whose first language is Bangla.

Write the answer in EXACTLY the format below, as plain text, and nothing else: no introduction, no numbering, no bold, no markdown, no code block, no table.

Start with these lines:
${head}

Then write every word as one block with these labels, in this order. Put a line containing only --- between words.
- Word: the word itself, lower case.
- Pronunciation: IPA between slashes, like /əˈmiːliəreɪt/.
- Part of speech: one lower-case word (noun, verb, adjective, adverb...).
- Meaning: one short, simple English sentence. English only.
- Synonym 1 and Synonym 2: exactly two single words or short phrases.
- Example 1 and Example 2: two natural English sentences that use the word.
- Example 1 (Bangla) and Example 2 (Bangla): the Bangla translation of each example sentence, written in Bangla script.

Example of one block:
${VOCAB_SAMPLE_BLOCK}`;
}
