// app/api/vocab-battle/round/route.ts
//
// Powers /dashboard/vocab-battle/solo. Builds one round of the Solo
// Challenge: up to 20 words (unseen ones first) from the same vocab_words bank used by
// /dashboard/vocab, each turned into a 4-option MCQ of a mixed kind (pick
// the meaning, pick the word, fill the gap, pick the synonym — see
// lib/vocab-battle-questions.ts) with 3 distractors pulled from other words.
//
// This is a casual speed-practice game (not a graded assessment like the
// Quiz feature), so — unlike /api/quiz — the correct option index is sent
// to the browser up front. That's what lets the UI reveal the right answer
// instantly on click or on timeout instead of round-tripping to the server
// per word, which is what the reference UX (instant green highlight) needs.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { buildSoloRound } from "@/lib/vocab-battle-questions";
import { clearSeen, loadSeen } from "@/lib/vocab-battle-seen";

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  try {
    // Words this student already answered in earlier rounds come last: a round is
    // built from unseen words first. When fewer than a full round of unseen words
    // is left, the list is cleared and a new cycle starts.
    const db = await getDb();
    const seen = await loadSeen(db, user.id);
    const { questions, cycleReset } = await buildSoloRound(seen);
    if (cycleReset && seen.size > 0) await clearSeen(db, user.id);
    return NextResponse.json({ questions });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Not enough vocabulary words yet to start a battle." },
      { status: 409 }
    );
  }
}
