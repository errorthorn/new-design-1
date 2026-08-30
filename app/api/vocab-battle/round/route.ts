// app/api/vocab-battle/round/route.ts
//
// Powers /dashboard/vocab-battle/solo. Builds one round of the Solo
// Challenge: up to 10 random words from the same vocab_words bank used by
// /dashboard/vocab, each turned into a 4-option MCQ ("which definition
// matches this word?") by pairing the real meaning with 3 distractor
// meanings pulled from other words.
//
// This is a casual speed-practice game (not a graded assessment like the
// Quiz feature), so — unlike /api/quiz — the correct option index is sent
// to the browser up front. That's what lets the UI reveal the right answer
// instantly on click or on timeout instead of round-tripping to the server
// per word, which is what the reference UX (instant green highlight) needs.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { buildVocabBattleRound } from "@/lib/vocab-battle-questions";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    const questions = await buildVocabBattleRound();
    return NextResponse.json({ questions });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Not enough vocabulary words yet to start a battle." },
      { status: 409 }
    );
  }
}
