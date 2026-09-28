import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// Teacher-side counterpart to /api/mock-test/attempts/audio — same private
// bucket, same short-lived signed URL, just authorized with ADMIN_SECRET
// instead of a student's own session.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const attemptId = req.nextUrl.searchParams.get("attemptId");
  if (!attemptId) {
    return NextResponse.json({ error: "attemptId missing" }, { status: 400 });
  }

  const { data: attempt } = await supabaseServer
    .from("mock_test_attempts")
    .select("audio_path")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt?.audio_path) {
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
