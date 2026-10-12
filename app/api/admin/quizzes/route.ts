import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// GET returns every quiz (published or not — this is the admin view) with
// its questions nested inside, plus how many attempts it's had so far.
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data: quizzes, error: quizzesError } = await supabaseServer
    .from("quizzes")
    .select("id, title, description, time_limit_minutes, published, position, created_at")
    .order("position", { ascending: true });

  if (quizzesError) {
    return NextResponse.json({ error: quizzesError.message }, { status: 500 });
  }

  const { data: questions, error: questionsError } = await supabaseServer
    .from("quiz_questions")
    .select("id, quiz_id, question, options, correct_index, explanation, position, passage")
    .order("position", { ascending: true });

  if (questionsError) {
    return NextResponse.json({ error: questionsError.message }, { status: 500 });
  }

  const { data: attempts, error: attemptsError } = await supabaseServer
    .from("quiz_attempts")
    .select("quiz_id");

  if (attemptsError) {
    return NextResponse.json({ error: attemptsError.message }, { status: 500 });
  }

  const quizzesWithQuestions = (quizzes ?? []).map((quiz) => ({
    ...quiz,
    questions: (questions ?? []).filter((q) => q.quiz_id === quiz.id),
    attemptCount: (attempts ?? []).filter((a) => a.quiz_id === quiz.id).length,
  }));

  return NextResponse.json({ quizzes: quizzesWithQuestions });
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { title, description, time_limit_minutes, position } = await req.json();
  if (!title || !String(title).trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from("quizzes")
    .insert({
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      time_limit_minutes: time_limit_minutes ? Number(time_limit_minutes) : null,
      position: position ?? 0,
    })
    .select("id, title, description, time_limit_minutes, published, position, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ quiz: { ...data, questions: [], attemptCount: 0 } });
}
