import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/api-auth";

// Issues a short-lived signed URL so a student can listen to their own
// recording from the dashboard. The bucket is private, so nothing is ever
// exposed as a permanent public link — see sql/schema.sql.
export async function GET(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const attemptId = req.nextUrl.searchParams.get("attemptId");
  if (!attemptId) {
    return NextResponse.json({ error: "attemptId missing" }, { status: 400 });
  }

  const { data: attempt } = await supabaseServer
    .from("mock_test_attempts")
    .select("id, student_id, audio_path")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  }

  const { data: student } = await supabaseServer
    .from("students")
    .select("id")
    .eq("id", attempt.student_id)
    .eq("user_email", user.email)
    .maybeSingle();

  if (!student) {
    return NextResponse.json({ error: "Not your attempt." }, { status: 403 });
  }

  if (!attempt.audio_path) {
    return NextResponse.json({ error: "There is no recording for this attempt." }, { status: 404 });
  }

  const { data: signed, error } = await supabaseServer.storage
    .from("mock-test-audio")
    .createSignedUrl(attempt.audio_path, 600); // 10 minutes

  if (error || !signed) {
    return NextResponse.json({ error: error?.message ?? "Could not create signed URL." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
