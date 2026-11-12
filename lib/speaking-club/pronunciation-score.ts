// lib/speaking-club/pronunciation-score.ts
//
// A pronunciation band ESTIMATE. A text transcript cannot show pronunciation, so the estimate only exists when a model
// listened to the audio (see LISTENED_MARKER) and the notes it wrote were checked by the dictionary rules
// (lib/speaking-club/pronunciation-rules.ts). It is deliberately conservative and always shown as an estimate:
//   - it counts DISTINCT mispronounced words that passed the check, per 100 words the student spoke
//     (confirmed = 1, plausible = 0.6, unverified = 0);
//   - the audio is judged for sounds and word stress only, not intonation or rhythm, so it never goes above 7.0;
//   - too little speech, or a session nobody listened to, gets no estimate at all.
import { MIN_WORDS_FOR_BANDS } from "@/lib/speaking-ielts-feedback";

export const PRONUNCIATION_BAND_CAP = 7;
/** [highest weighted mistakes per 100 spoken words that still earns this band, band], best first. */
const SCALE: ReadonlyArray<readonly [number, number]> = [
  [0.4, 7],
  [0.8, 6.5],
  [1.5, 6],
  [2.5, 5.5],
  [4, 5],
  [6, 4.5],
];
const FLOOR_BAND = 4;

export type PronunciationEstimate = { band: number; per100: number; confirmed: number; plausible: number };

export function estimatePronunciationBand(input: {
  spokenWords: number;
  confirmed: number;
  plausible: number;
  listened: boolean;
}): PronunciationEstimate | null {
  if (!input.listened || input.spokenWords < MIN_WORDS_FOR_BANDS) return null;
  const weighted = input.confirmed + 0.6 * input.plausible;
  const per100 = (weighted / input.spokenWords) * 100;
  const band = SCALE.find(([limit]) => per100 <= limit)?.[1] ?? FLOOR_BAND;
  return { band: Math.min(band, PRONUNCIATION_BAND_CAP), per100: Math.round(per100 * 100) / 100, confirmed: input.confirmed, plausible: input.plausible };
}
