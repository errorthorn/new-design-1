import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { quiz_id, question, options, correct_index, explanation, position, passage } = await req.json();

  if (!quiz_id) {
    return NextResponse.json({ error: "quiz_id is required" }, { status: 400 });
  }
  if (!question || !String(question).trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  if (!Array.isArray(options) || options.length < 2) {
    return NextResponse.json({ error: "at least 2 options are required" }, { status: 400 });
  }
  const cleanOptions = options.map((o) => String(o).trim());
  if (cleanOptions.some((o) => !o)) {
    return NextResponse.json({ error: "options cannot be empty" }, { status: 400 });
  }
  const correctIdx = Number(correct_index);
  if (!Number.isInteger(correctIdx) || correctIdx < 0 || correctIdx >= cleanOptions.length) {
    return NextResponse.json({ error: "correct_index is out of range" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("quiz_questions")
    .insert({
      quiz_id,
      question: String(question).trim(),
      options: cleanOptions,
      correct_index: correctIdx,
      explanation: explanation ? String(explanation).trim() : null,
      position: position ?? 0,
      passage: passage && String(passage).trim() ? String(passage).trim() : null,
    })
    .select("id, quiz_id, question, options, correct_index, explanation, position, passage")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ question: data });
}
