import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { createNotification } from "@/lib/notifications";

// Powers the teacher scoring panel (/admin/scoring). Only completed
// attempts are returned — an in-progress attempt has no transcript yet to
// grade. ?status=pending filters to score == null; ?status=scored to the
// opposite; anything else (or omitted) returns all completed attempts.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const status = req.nextUrl.searchParams.get("status");

  // Typed as `any` (rather than left to be inferred from the first
  // .select() call) because reassigning this on the conditional filters
  // below made TypeScript try to recompute the full chained query-builder
  // type on every reassignment, which blew past its recursion limit
  // ("Type instantiation is excessively deep"). This doesn't change what
  // runs — same Supabase client, same methods, same order, same data
  // shape returned — it just stops the type-checker from over-analyzing
  // an internal variable that was never part of this route's public
  // contract anyway.
  let query: any = supabaseServer
    .from("mock_test_attempts")
    .select(
      "id, started_at, completed_at, transcript, score, feedback, scored_at, audio_path, students(name, phone, user_email)"
    )
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: false });

  if (status === "pending") query = query.is("score", null);
  if (status === "scored") query = query.not("score", "is", null);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ attempts: data ?? [] });
}

// Saves (or clears) a teacher's score + written feedback for one attempt.
export async function PATCH(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { attemptId, score, feedback } = await req.json();
  if (!attemptId) {
    return NextResponse.json({ error: "attemptId is required" }, { status: 400 });
  }

  // score is nullable (a teacher may want to clear it), but if present it
  // must be a real number on the 0–9 IELTS-style band scale used elsewhere
  // in the app (see MAX_BAND in app/mock-test/page.tsx).
  let scoreValue: number | null = null;
  if (score !== null && score !== undefined && score !== "") {
    scoreValue = Number(score);
    if (Number.isNaN(scoreValue) || scoreValue < 0 || scoreValue > 9) {
      return NextResponse.json({ error: "Score must be between 0 and 9." }, { status: 400 });
    }
  }

  const { error } = await supabaseServer
    .from("mock_test_attempts")
    .update({
      score: scoreValue,
      feedback: feedback ?? null,
      scored_at: new Date().toISOString(),
    })
    .eq("id", attemptId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Notify the student their result is ready — only for an actual score
  // being set (not a teacher clearing one back to null). Looked up
  // separately rather than trusting a value from the request body, since
  // the student's email lives on the linked `students` row, not on this
  // attempt.
  if (scoreValue !== null) {
    const { data: attemptRow } = await supabaseServer
      .from("mock_test_attempts")
      .select("students(user_email)")
      .eq("id", attemptId)
      .maybeSingle();
    const studentEmail = (attemptRow as { students?: { user_email?: string } } | null)?.students?.user_email;
    if (studentEmail) {
      await createNotification({
        userEmail: studentEmail,
        type: "mock_test_scored",
        title: "Your Mock Test result is ready",
        body: `You scored Band ${scoreValue.toFixed(1)}.${feedback ? " Feedback is attached." : ""}`,
        link: "/mock-test",
      });
    }
  }

  return NextResponse.json({ ok: true });
}
