// lib/vocab-battle/rules.ts
//
// Client-safe game rules shared by the Solo page and the Live panel (both
// now play through components/vocab-battle/battle-round.tsx): question
// shape, per-question time limits, scoring, and the power-up rules. Kept
// separate from lib/vocab-battle-questions.ts, which is server-only.

export type QuestionKind = "meaning" | "word" | "blank" | "synonym";

export type Question = {
  wordId: number;
  word: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  correctIndex: number;
  meaning: string;
  pronunciation: string | null;
  example: string | null;
};

/**
 * Questions as stored/served. Matches created before question kinds existed
 * (or still in progress during a deploy) have only word/options/
 * correctIndex — treat those as the original "show the word, pick the
 * meaning" question, so nothing already in flight breaks.
 */
export function normalizeQuestion(raw: any): Question {
  return {
    wordId: raw.wordId,
    word: raw.word,
    kind: raw.kind ?? "meaning",
    prompt: raw.prompt ?? raw.word,
    options: raw.options,
    correctIndex: raw.correctIndex,
    meaning: raw.meaning ?? raw.options?.[raw.correctIndex] ?? "",
    pronunciation: raw.pronunciation ?? null,
    example: raw.example ?? null,
  };
}

/** What the small label above each question says. */
export const KIND_LABEL: Record<QuestionKind, string> = {
  meaning: "What does this word mean?",
  word: "Which word matches this meaning?",
  blank: "Which word fits the gap?",
  synonym: "Pick the closest synonym",
};

export const REVEAL_PAUSE_MS = 1300;

/** Seconds allowed per question. Gap sentences take longer to read. */
export function timeLimitFor(kind: QuestionKind): number {
  return kind === "blank" ? 15 : 10;
}

/**
 * Points for a correct answer: 100 base, up to +50 for speed, plus 10 per
 * answer already in the streak. The streak part is capped at +100 — with
 * rounds now twice as long, an uncapped streak bonus would let one long
 * streak outweigh everything else.
 */
export function pointsForCorrect(params: { timeLeft: number; timeLimit: number; streakBefore: number }): number {
  const speedFraction = Math.max(0, Math.min(1, params.timeLeft / params.timeLimit));
  const speedBonus = Math.round(speedFraction * 50);
  const streakBonus = Math.min(params.streakBefore, 10) * 10;
  return 100 + speedBonus + streakBonus;
}

// ---- Power-ups -------------------------------------------------------------

export type PowerUps = { fifty: number; time: number };
export type PowerUpKind = keyof PowerUps;

export const POWER_UP_CAP = 3;
export const TIME_BOOST_SECONDS = 5;
export const STREAK_PER_POWER_UP = 3;

/**
 * Every 3rd correct answer in a row earns a power-up, alternating between
 * a 50/50 (hides two wrong options) and +5 seconds. Returns which one was
 * earned (or null) — the caller applies it via addPowerUp().
 */
export function powerUpEarned(newStreak: number): PowerUpKind | null {
  if (newStreak <= 0 || newStreak % STREAK_PER_POWER_UP !== 0) return null;
  return Math.floor(newStreak / STREAK_PER_POWER_UP) % 2 === 1 ? "fifty" : "time";
}

export function addPowerUp(current: PowerUps, kind: PowerUpKind): PowerUps {
  return { ...current, [kind]: Math.min(POWER_UP_CAP, current[kind] + 1) };
}

/** Two wrong option indices to hide for a 50/50. */
export function pickOptionsToHide(question: Question): number[] {
  const wrong = question.options.map((_, i) => i).filter((i) => i !== question.correctIndex);
  return wrong.sort(() => Math.random() - 0.5).slice(0, 2);
}

// ---- Per-answer record (for the post-round review) ---------------------------

export type AnswerRecord = {
  index: number;
  /** Which option the player picked; null = ran out of time. */
  chosen: number | null;
  correct: boolean;
};

export type RoundResult = {
  score: number;
  correctCount: number;
  bestStreak: number;
  durationSeconds: number;
  answers: AnswerRecord[];
};

/** Reactions players can send each other in a live match. */
export const REACTION_EMOJIS = ["👏", "🔥", "😅", "😎"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
export function isReactionEmoji(value: unknown): value is ReactionEmoji {
  return typeof value === "string" && (REACTION_EMOJIS as readonly string[]).includes(value);
}
