import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/api-auth";
import { checkAttemptOwnership } from "@/lib/mock-test";

export async function POST(req: NextRequest) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const { attemptId, transcript } = await req.json();

  if (!attemptId) {
    return NextResponse.json({ error: "attemptId missing" }, { status: 400 });
  }

  // Confirm this attempt actually belongs to the signed-in student before
  // writing to it — otherwise anyone who learns another attempt's id could
  // overwrite that student's transcript or mark their in-progress test
  // complete out from under them.
  const attempt = await checkAttemptOwnership(attemptId, user.email);
  if (!attempt) {
    return NextResponse.json({ error: "Not your attempt." }, { status: 403 });
  }

  const { error } = await supabaseServer
    .from("mock_test_attempts")
    .update({
      completed_at: new Date().toISOString(),
      transcript: transcript ?? "",
    })
    .eq("id", attemptId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
