// app/api/speaking-club/submit-transcript/route.ts
//
// Phase C deliverable (SPEAKING-CLUB-AI-FEEDBACK-PLAN.md §5/§6 Phase C).
// hooks/use-speaking-club-transcript.ts (Phase B) POSTs here — via
// sendBeacon, fire-and-forget, no await before the student navigates
// away — right when the student leaves the call.
//
// This endpoint deliberately does no Gemini work itself: it only
// validates and writes a `pending` speaking_feedback row, then returns
// fast. Phase D's background worker is what actually calls Gemini,
// polling for `pending` rows on its own schedule.
//
// Auth + validation shape mirrors turn-stats/route.ts (Phase 7) exactly:
// requireUser(), look up the shift, confirm the caller is actually
// assigned to it, fail silently/non-fatally on anything else — this is
// a background report the room UI never surfaces errors from either way.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getShiftById } from "@/lib/speaking-club-db";
import { createPendingSpeakingFeedback } from "@/lib/speaking-feedback-db";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const shiftId = body?.shiftId;
  if (typeof shiftId !== "string" || !shiftId.trim()) {
    return NextResponse.json({ error: "shiftId is required" }, { status: 400 });
  }

  const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    // Nothing was actually captured (e.g. Web Speech API produced no
    // final results this session) — not an error, just nothing to do.
    return NextResponse.json({ ok: true, skipped: "empty_transcript" });
  }

  // Gap-fix (see the topic_title/cue_card_questions comment in
  // sql/schema.sql): the room page already has the day's topic + cue-card
  // pool loaded client-side (from /api/speaking-club/cue-cards) for the
  // rotating-card UI, so the transcript hook just forwards it here rather
  // than this route re-fetching it itself — both students in a room see
  // the same day-wide topic anyway, so there's nothing shift-specific to
  // look up. Untrusted client input, so re-validate the shape defensively
  // rather than trusting it — worst case this just falls back to "no
  // topic to check against" for this one row, same as never sending it.
  const topicTitle = typeof body?.topicTitle === "string" ? body.topicTitle : null;
  const cueCardQuestions = Array.isArray(body?.cueCardQuestions)
    ? body.cueCardQuestions.filter((q: unknown): q is string => typeof q === "string")
    : null;

  const shift = await getShiftById(shiftId);
  if (!shift) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  // Same eligible-set as turn-stats: username1/2 plus temp_username, so
  // an emergency 3rd participant (§4.2 of the core plan) — who had a
  // real conversation too — can still get feedback on their session.
  const assignedEmails = [shift.username1, shift.username2, shift.temp_username].filter(Boolean);
  if (!assignedEmails.includes(user.email)) {
    return NextResponse.json({ ok: false, reason: "not_assigned" }, { status: 403 });
  }

  try {
    const row = await createPendingSpeakingFeedback({
      shiftId: shift.shift_id,
      studentUsername: user.email,
      transcript,
      topicTitle,
      cueCardQuestions,
    });
    return NextResponse.json({ ok: true, id: row.id });
  } catch (err) {
    // Same graceful-degrade posture as turn-stats — a failed write here
    // must never surface as an error to a student who just finished a
    // call. That session simply doesn't get feedback (plan §6 Phase B).
    console.error("[speaking-club/submit-transcript] failed to create pending row", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
