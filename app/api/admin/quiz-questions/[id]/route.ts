import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { question, options, correct_index, explanation, position, passage } = await req.json();
  const updates: Record<string, unknown> = {};

  if (question !== undefined) updates.question = String(question).trim();

  let optionCount: number | undefined;
  if (options !== undefined) {
    if (!Array.isArray(options) || options.length < 2) {
      return NextResponse.json({ error: "at least 2 options are required" }, { status: 400 });
    }
    const cleanOptions = options.map((o) => String(o).trim());
    if (cleanOptions.some((o) => !o)) {
      return NextResponse.json({ error: "options cannot be empty" }, { status: 400 });
    }
    updates.options = cleanOptions;
    optionCount = cleanOptions.length;
  }

  if (correct_index !== undefined) {
    const correctIdx = Number(correct_index);
    if (!Number.isInteger(correctIdx) || correctIdx < 0 || (optionCount !== undefined && correctIdx >= optionCount)) {
      return NextResponse.json({ error: "correct_index is out of range" }, { status: 400 });
    }
    updates.correct_index = correctIdx;
  }

  if (explanation !== undefined) updates.explanation = explanation ? String(explanation).trim() : null;
  if (position !== undefined) updates.position = position;
  if (passage !== undefined) updates.passage = passage && String(passage).trim() ? String(passage).trim() : null;

  const { data, error } = await supabaseServer
    .from("quiz_questions")
    .update(updates)
    .eq("id", params.id)
    .select("id, quiz_id, question, options, correct_index, explanation, position, passage")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ question: data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { error } = await supabaseServer.from("quiz_questions").delete().eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
