// app/api/speaking-club/feedback/[id]/route.ts
//
// One of the signed-in student's OWN Speaking Club feedback rows, in full, for the
// "View AI Feedback" screen: the structured report (bands, fixes, plan) and the transcript.
// Loaded only when the student opens the screen, so the Performance list stays light.
// The row is matched on the student's own email, so nobody can open someone else's.
import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/api-auth";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const { data, error } = await supabaseServer
    .from("speaking_feedback")
    .select("id, created_at, status, feedback_summary, mistake_count, report_json, transcript")
    .eq("id", params.id)
    .eq("student_username", user.email)
    .maybeSingle();

  // report_json is a newer column; if its migration hasn't run yet, serve the text-only version.
  if (error && /report_json/i.test(error.message ?? "")) {
    const retry = await supabaseServer
      .from("speaking_feedback")
      .select("id, created_at, status, feedback_summary, mistake_count, transcript")
      .eq("id", params.id)
      .eq("student_username", user.email)
      .maybeSingle();
    if (retry.error) return NextResponse.json({ error: "Could not load this feedback." }, { status: 500 });
    if (!retry.data) return NextResponse.json({ error: "Feedback not found." }, { status: 404 });
    return NextResponse.json({ feedback: { ...retry.data, report_json: null } });
  }
  if (error) return NextResponse.json({ error: "Could not load this feedback." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Feedback not found." }, { status: 404 });
  return NextResponse.json({ feedback: data });
}
