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

import { getDb } from "@/lib/db";

export const VOCAB_BATTLE_ROUND_SIZE = 10;
const OPTION_COUNT = 4;

export type VocabBattleQuestion = {
  wordId: number;
  word: string;
  options: string[];
  correctIndex: number;
};

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Builds one round of `size` MCQ questions from the vocab_words bank.
 * Throws if there aren't enough words with a usable meaning to fill even
 * one question's options — callers should catch this and surface it as a
 * 409, same as the existing solo round route does.
 */
export async function buildVocabBattleRound(
  size: number = VOCAB_BATTLE_ROUND_SIZE
): Promise<VocabBattleQuestion[]> {
  const db = await getDb();
  const res = await db.execute(
    `SELECT id, word, meaning_en FROM vocab_words WHERE meaning_en IS NOT NULL AND trim(meaning_en) != ''`
  );

  const bank = res.rows.map((r) => ({
    id: r.id as number,
    word: r.word as string,
    meaning: r.meaning_en as string,
  }));

  if (bank.length < OPTION_COUNT) {
    throw new Error("Not enough vocabulary words yet to start a battle.");
  }

  const roundWords = shuffle(bank).slice(0, Math.min(size, bank.length));

  return roundWords.map((w) => {
    const distractorPool = shuffle(bank.filter((b) => b.id !== w.id)).slice(
      0,
      OPTION_COUNT - 1
    );
    const options = shuffle([
      { text: w.meaning, correct: true },
      ...distractorPool.map((d) => ({ text: d.meaning, correct: false })),
    ]);

    return {
      wordId: w.id,
      word: w.word,
      options: options.map((o) => o.text),
      correctIndex: options.findIndex((o) => o.correct),
    };
  });
}
