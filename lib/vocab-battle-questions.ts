// lib/vocab-battle-questions.ts
//
// Shared by both Vocab Battle modes:
//   - /api/vocab-battle/round        (Solo Challenge)
//   - /api/vocab-battle/live/*       (Live Multiplayer)
//
// Extracted so a live match can generate one shared question set and know
// both players are racing through the *exact same* words/options/correct
// answers — duplicating this logic in two places would risk them drifting
// apart (e.g. a distractor-pool tweak applied to only one route).
//
// A round is a MIX of question kinds, not one repeated format — all built
// from fields the vocab_words bank already has, so no new content is needed:
//   meaning : show the word          -> pick its definition
//   word    : show the definition    -> pick the word
//   blank   : show an example        -> pick the word that fits the gap
//             sentence with the word    (only for words whose example
//             blanked out                 sentence really contains them)
//   synonym : show the word          -> pick its synonym
//                                       (only for words with a synonym)
// Kinds a word can't support are simply never picked for it, and the picker
// avoids showing the same kind twice in a row when it has any choice.

import { getDb } from "@/lib/db";

// 20 (was 10): ten questions was over before it got interesting. A round is
// now roughly 4 minutes. Both modes read this one constant.
export const VOCAB_BATTLE_ROUND_SIZE = 20;
const OPTION_COUNT = 4;

export type VocabBattleQuestionKind = "meaning" | "word" | "blank" | "synonym";

export type VocabBattleQuestion = {
  wordId: number;
  /** The word this question is about (also what older clients render as the heading). */
  word: string;
  kind: VocabBattleQuestionKind;
  /** The big text shown to the player: the word, the definition, or the gapped sentence, depending on kind. */
  prompt: string;
  options: string[];
  correctIndex: number;
  // Shown on the post-round review for missed words.
  meaning: string;
  pronunciation: string | null;
  example: string | null;
};

export type BankWord = {
  id: number;
  word: string;
  meaning: string;
  pronunciation: string | null;
  synonyms: string[];
  examples: string[];
};

// Relative likelihood of each kind when several are possible for a word.
const KIND_WEIGHTS: Record<VocabBattleQuestionKind, number> = {
  meaning: 3,
  word: 2,
  blank: 3,
  synonym: 2,
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * First example sentence that actually contains the word (allowing endings,
 * so "run" matches "running"), with that occurrence replaced by a gap.
 * Null when no example works — the word then can't get a "blank" question.
 */
export function blankOutExample(word: string, examples: string[]): string | null {
  const re = new RegExp(`\\b${escapeRegExp(word.trim())}\\w*`, "i");
  for (const example of examples) {
    if (example && re.test(example)) return example.replace(re, "_____");
  }
  return null;
}

function eligibleKinds(w: BankWord): VocabBattleQuestionKind[] {
  const kinds: VocabBattleQuestionKind[] = ["meaning", "word"];
  if (blankOutExample(w.word, w.examples)) kinds.push("blank");
  if (w.synonyms.length > 0) kinds.push("synonym");
  return kinds;
}

function pickKind(
  eligible: VocabBattleQuestionKind[],
  previous: VocabBattleQuestionKind | null
): VocabBattleQuestionKind {
  const pool = eligible.length > 1 && previous ? eligible.filter((k) => k !== previous) : eligible;
  const total = pool.reduce((sum, k) => sum + KIND_WEIGHTS[k], 0);
  let roll = Math.random() * total;
  for (const k of pool) {
    roll -= KIND_WEIGHTS[k];
    if (roll <= 0) return k;
  }
  return pool[pool.length - 1];
}

/** `count` distinct option texts (case-insensitive) drawn from `candidates`, none equal to any string in `avoid`. */
function pickDistractors(candidates: string[], count: number, avoid: string[]): string[] {
  const blocked = new Set(avoid.map((a) => a.trim().toLowerCase()));
  const out: string[] = [];
  for (const c of shuffle(candidates)) {
    const key = c.trim().toLowerCase();
    if (!key || blocked.has(key)) continue;
    blocked.add(key);
    out.push(c);
    if (out.length === count) break;
  }
  return out;
}

/** Pure question builder — split from the DB read so it can be tested with a fake bank. */
export function buildQuestionsFromBank(bank: BankWord[], size: number = VOCAB_BATTLE_ROUND_SIZE): VocabBattleQuestion[] {
  if (bank.length < OPTION_COUNT) {
    throw new Error("Not enough vocabulary words yet to start a battle.");
  }

  const roundWords = shuffle(bank).slice(0, Math.min(size, bank.length));
  const questions: VocabBattleQuestion[] = [];
  let previousKind: VocabBattleQuestionKind | null = null;

  for (const w of roundWords) {
    const others = bank.filter((b) => b.id !== w.id);
    let kind = pickKind(eligibleKinds(w), previousKind);

    let prompt: string;
    let correctText: string;
    let distractors: string[];

    for (;;) {
      if (kind === "meaning") {
        prompt = w.word;
        correctText = w.meaning;
        distractors = pickDistractors(others.map((o) => o.meaning), OPTION_COUNT - 1, [w.meaning]);
      } else if (kind === "word") {
        prompt = w.meaning;
        correctText = w.word;
        distractors = pickDistractors(others.map((o) => o.word), OPTION_COUNT - 1, [w.word]);
      } else if (kind === "blank") {
        prompt = blankOutExample(w.word, w.examples) as string;
        correctText = w.word;
        distractors = pickDistractors(others.map((o) => o.word), OPTION_COUNT - 1, [w.word]);
      } else {
        prompt = w.word;
        correctText = w.synonyms[Math.floor(Math.random() * w.synonyms.length)];
        // Other words' own words as distractors — but never the target's
        // word or any of its synonyms, or the question would have two
        // right answers.
        distractors = pickDistractors(others.map((o) => o.word), OPTION_COUNT - 1, [w.word, ...w.synonyms]);
      }
      if (distractors.length === OPTION_COUNT - 1) break;
      // Not enough distinct distractors for this kind (tiny/duplicate-heavy
      // bank): fall back to the always-possible plain format.
      if (kind === "meaning") throw new Error("Not enough vocabulary words yet to start a battle.");
      kind = "meaning";
    }

    const options = shuffle([
      { text: correctText, correct: true },
      ...distractors.map((d) => ({ text: d, correct: false })),
    ]);

    questions.push({
      wordId: w.id,
      word: w.word,
      kind,
      prompt,
      options: options.map((o) => o.text),
      correctIndex: options.findIndex((o) => o.correct),
      meaning: w.meaning,
      pronunciation: w.pronunciation,
      example: w.examples[0] ?? null,
    });
    previousKind = kind;
  }

  return questions;
}

/**
 * Builds one round of `size` questions from the vocab_words bank.
 * Throws if there aren't enough words with a usable meaning to fill even
 * one question's options — callers should catch this and surface it as a
 * 409, same as the existing solo round route does.
 */
export async function buildVocabBattleRound(
  size: number = VOCAB_BATTLE_ROUND_SIZE
): Promise<VocabBattleQuestion[]> {
  const db = await getDb();
  const res = await db.execute(
    `SELECT id, word, meaning_en, pronunciation, synonym_1, synonym_2, example_1_en, example_2_en
     FROM vocab_words
     WHERE meaning_en IS NOT NULL AND trim(meaning_en) != ''`
  );

  const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const bank: BankWord[] = res.rows.map((r) => ({
    id: r.id as number,
    word: clean(r.word),
    meaning: clean(r.meaning_en),
    pronunciation: clean(r.pronunciation) || null,
    synonyms: [clean(r.synonym_1), clean(r.synonym_2)].filter(Boolean),
    examples: [clean(r.example_1_en), clean(r.example_2_en)].filter(Boolean),
  }));

  return buildQuestionsFromBank(bank.filter((b) => b.word), size);
}
