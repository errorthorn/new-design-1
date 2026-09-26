import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { requireActiveMember } from "@/lib/api-auth";

// GET is used two ways: the admin panel reads it (x-admin-secret, to
// prefill the input) and the student session page reads it (signed-in
// active member, to show the Part 1 card). This is deliberately NOT the
// same thing as mock_test_questions (which stays hidden from the client
// to keep the test spontaneous) — the topic is a friendly heads-up the
// admin writes on purpose, not exam content.
export async function GET(req: NextRequest) {
  const isAdmin = requireAdmin(req) === null;
  if (!isAdmin) {
    const { user, response } = await requireActiveMember();
    if (!user) return response!;
  }

  const { data, error } = await supabaseServer
    .from("mock_test_topic")
    .select("topic, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The Part 2 cue card the student sees on the session page is the same
  // one the examiner is instructed to read out — the teacher-authored
  // Part 2 question (see /admin/questions), not something generated on
  // the fly. Only the first active Part 2 question is used, matching
  // /api/mock-test/gemini-session's part2[0].
  const { data: part2Rows } = await supabaseServer
    .from("mock_test_questions")
    .select("question")
    .eq("active", true)
    .eq("part", 2)
    .order("position", { ascending: true })
    .limit(1);

  return NextResponse.json({
    topic: data?.topic ?? "",
    part2CueCard: part2Rows?.[0]?.question ?? "",
  });
}

// PUT is admin-only — sets this week's topic.
export async function PUT(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { topic } = await req.json();
  if (typeof topic !== "string") {
    return NextResponse.json({ error: "topic must be a string" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("mock_test_topic")
    .upsert({ id: 1, topic: topic.trim(), updated_at: new Date().toISOString() })
    .select("topic, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ topic: data.topic });
}
