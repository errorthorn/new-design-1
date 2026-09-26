import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// Only the admin question-editor UI reads this list — the actual test
// session (gemini-session/route.ts) queries mock_test_questions directly
// via supabaseServer, it doesn't call this HTTP route. So there's no
// legitimate public use for GET here, and leaving it open would let anyone
// see every question in advance, defeating the point of a spontaneous
// speaking test.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data, error } = await supabaseServer
    .from("mock_test_questions")
    .select("id, question, part, position")
    .eq("active", true)
    .order("part", { ascending: true })
    .order("position", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ questions: data });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  const { question, part, position } = await req.json();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  const partNum = Number(part);
  if (![1, 2, 3].includes(partNum)) {
    return NextResponse.json({ error: "part must be 1, 2, or 3" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("mock_test_questions")
    .insert({ question, part: partNum, position: position ?? 0 })
    .select("id, question, part, position")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ question: data });
}

export async function DELETE(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { error } = await supabaseServer
    .from("mock_test_questions")
    .update({ active: false })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
