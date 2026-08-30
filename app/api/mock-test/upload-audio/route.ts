import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/api-auth";

// A generous but real cap on the reported file size at confirm time — MVP
// guard against a stuck/runaway recording quietly costing storage, not a
// hard product requirement. A ~25-30 min opus recording is well under this.
const MAX_BYTES = 40 * 1024 * 1024; // 40MB (raised from 25MB for 25-min tests)

async function checkOwnership(attemptId: string, userEmail: string) {
  const { data: attempt } = await supabaseServer
    .from("mock_test_attempts")
    .select("id, student_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (!attempt) return null;

  const { data: student } = await supabaseServer
    .from("students")
    .select("id")
    .eq("id", attempt.student_id)
    .eq("user_email", userEmail)
    .maybeSingle();

  return student ? attempt : null;
}

// Step 1 (called before the upload): mint a signed upload URL for this
// attempt's recording. The browser then PUTs the audio Blob directly to
// Supabase Storage using this URL — the recording bytes never pass through
// this Next.js function, so its request body-size limit never comes into
// play, which matters once recordings run ~25 minutes.
export async function GET(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const attemptId = req.nextUrl.searchParams.get("attemptId");
  const contentType = req.nextUrl.searchParams.get("contentType") || "audio/webm";
  if (!attemptId) {
    return NextResponse.json({ error: "attemptId missing" }, { status: 400 });
  }

  const attempt = await checkOwnership(attemptId, user.email);
  if (!attempt) {
    return NextResponse.json({ error: "Not your attempt." }, { status: 403 });
  }

  const ext = contentType.includes("mp4") ? "mp4" : "webm";
  const path = `attempts/${attemptId}.${ext}`;

  const { data, error } = await supabaseServer.storage
    .from("mock-test-audio")
    .createSignedUploadUrl(path, { upsert: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
  });
}

// Step 2 (called after the browser's direct PUT to Storage succeeds):
// confirm the upload and record the path on the attempt row. We don't
// trust the client's word alone that the file exists — a HEAD-equivalent
// check via getting the object's metadata would be ideal, but Storage's
// JS client doesn't expose a cheap one, so this stays a lightweight
// confirmation step; the important security property (only the owning
// student could have gotten a valid signed URL for this path) already
// held in the GET step above.
export async function POST(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const { attemptId, path, sizeBytes } = await req.json();
  if (!attemptId || !path) {
    return NextResponse.json({ error: "attemptId and path are required" }, { status: 400 });
  }

  const attempt = await checkOwnership(attemptId, user.email);
  if (!attempt) {
    return NextResponse.json({ error: "Not your attempt." }, { status: 403 });
  }

  if (typeof sizeBytes === "number" && sizeBytes > MAX_BYTES) {
    return NextResponse.json({ error: "Recording too large." }, { status: 413 });
  }

  const { error: updateError } = await supabaseServer
    .from("mock_test_attempts")
    .update({ audio_path: path })
    .eq("id", attemptId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
