// lib/community-db.ts
//
// Data-access layer for the Community "Doubts & Q&A" board. Kept in one
// file (same pattern as lib/speaking-club-db.ts) so every API route under
// app/api/community/* calls a named function here instead of building its
// own Supabase queries — the query shapes (esp. the vote-toggle and
// accept-answer logic, which each touch two tables) only need to be
// correct in one place.
import { supabaseServer } from "@/lib/supabase";

export type CommunityAuthor = {
  userEmail: string;
  authorName: string;
  authorAvatarUrl: string | null;
};

export type CommunityQuestion = {
  id: string;
  userEmail: string;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  body: string;
  topic: string | null;
  status: "open" | "solved";
  acceptedAnswerId: string | null;
  upvotes: number;
  answerCount: number;
  createdAt: string;
  updatedAt: string;
  hasVoted?: boolean;
};

export type CommunityAnswer = {
  id: string;
  questionId: string;
  userEmail: string;
  authorName: string;
  authorAvatarUrl: string | null;
  body: string;
  isAccepted: boolean;
  upvotes: number;
  createdAt: string;
  hasVoted?: boolean;
};

function mapQuestion(row: any): CommunityQuestion {
  return {
    id: row.id,
    userEmail: row.user_email,
    authorName: row.author_name,
    authorAvatarUrl: row.author_avatar_url,
    title: row.title,
    body: row.body,
    topic: row.topic,
    status: row.status,
    acceptedAnswerId: row.accepted_answer_id,
    upvotes: row.upvotes,
    answerCount: row.answer_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAnswer(row: any): CommunityAnswer {
  return {
    id: row.id,
    questionId: row.question_id,
    userEmail: row.user_email,
    authorName: row.author_name,
    authorAvatarUrl: row.author_avatar_url,
    body: row.body,
    isAccepted: row.is_accepted,
    upvotes: row.upvotes,
    createdAt: row.created_at,
  };
}

export type QuestionFilter = {
  search?: string;
  topic?: string;
  status?: "open" | "solved";
  mineOnly?: boolean;
  viewerEmail?: string; // whose "hasVoted" / "mine" this is resolved against
  sort?: "recent" | "top" | "unanswered";
  limit?: number;
};

export async function listQuestions(filter: QuestionFilter): Promise<CommunityQuestion[]> {
  let query = supabaseServer.from("community_questions").select("*");

  if (filter.status) query = query.eq("status", filter.status);
  if (filter.topic) query = query.eq("topic", filter.topic);
  if (filter.mineOnly && filter.viewerEmail) query = query.eq("user_email", filter.viewerEmail);
  if (filter.search) {
    const term = filter.search.replace(/[%_]/g, "");
    query = query.or(`title.ilike.%${term}%,body.ilike.%${term}%`);
  }

  if (filter.sort === "top") {
    query = query.order("upvotes", { ascending: false }).order("created_at", { ascending: false });
  } else if (filter.sort === "unanswered") {
    query = query.eq("answer_count", 0).order("created_at", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  query = query.limit(filter.limit ?? 50);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const questions = (data ?? []).map(mapQuestion);
  if (!filter.viewerEmail || questions.length === 0) return questions;

  return attachHasVoted(questions, "question", filter.viewerEmail);
}

export async function getQuestion(
  id: string,
  viewerEmail?: string | null
): Promise<CommunityQuestion | null> {
  const { data, error } = await supabaseServer
    .from("community_questions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const question = mapQuestion(data);
  if (!viewerEmail) return question;
  const [withVote] = await attachHasVoted([question], "question", viewerEmail);
  return withVote;
}

export async function listAnswers(
  questionId: string,
  viewerEmail?: string | null
): Promise<CommunityAnswer[]> {
  const { data, error } = await supabaseServer
    .from("community_answers")
    .select("*")
    // Accepted answer first, then oldest-first so the thread reads like a
    // conversation — matches how the question detail page renders it.
    .eq("question_id", questionId)
    .order("is_accepted", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const answers = (data ?? []).map(mapAnswer);
  if (!viewerEmail || answers.length === 0) return answers;
  return attachHasVoted(answers, "answer", viewerEmail);
}

async function attachHasVoted<T extends { id: string }>(
  items: T[],
  targetType: "question" | "answer",
  viewerEmail: string
): Promise<(T & { hasVoted: boolean })[]> {
  const { data, error } = await supabaseServer
    .from("community_votes")
    .select("target_id")
    .eq("user_email", viewerEmail)
    .eq("target_type", targetType)
    .in("target_id", items.map((i) => i.id));
  if (error) throw new Error(error.message);

  const votedIds = new Set((data ?? []).map((v) => v.target_id));
  return items.map((item) => ({ ...item, hasVoted: votedIds.has(item.id) }));
}

export async function createQuestion(input: {
  author: CommunityAuthor;
  title: string;
  body: string;
  topic?: string | null;
}): Promise<CommunityQuestion> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new Error("Title is required.");
  if (!body) throw new Error("Question details are required.");
  if (title.length > 200) throw new Error("Title is too long (200 characters max).");
  if (body.length > 5000) throw new Error("Question is too long (5000 characters max).");

  const { data, error } = await supabaseServer
    .from("community_questions")
    .insert({
      user_email: input.author.userEmail,
      author_name: input.author.authorName,
      author_avatar_url: input.author.authorAvatarUrl,
      title,
      body,
      topic: input.topic?.trim() || null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return mapQuestion(data);
}

export async function createAnswer(input: {
  author: CommunityAuthor;
  questionId: string;
  body: string;
}): Promise<CommunityAnswer> {
  const body = input.body.trim();
  if (!body) throw new Error("Reply can't be empty.");
  if (body.length > 5000) throw new Error("Reply is too long (5000 characters max).");

  const { data: question, error: qError } = await supabaseServer
    .from("community_questions")
    .select("id")
    .eq("id", input.questionId)
    .maybeSingle();
  if (qError) throw new Error(qError.message);
  if (!question) throw new Error("Question not found.");

  const { data, error } = await supabaseServer
    .from("community_answers")
    .insert({
      question_id: input.questionId,
      user_email: input.author.userEmail,
      author_name: input.author.authorName,
      author_avatar_url: input.author.authorAvatarUrl,
      body,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // answer_count on the question is kept in sync by a DB trigger (see
  // sql/schema.sql) that recounts community_answers on every insert/
  // delete, so it's already correct as of the insert above — no
  // read-modify-write needed here, and it can't drift even if a row is
  // ever added outside this function (e.g. seeded by hand).
  await supabaseServer
    .from("community_questions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", input.questionId);

  return mapAnswer(data);
}

/**
 * Toggles the current user's upvote on a question or answer. Returns the
 * new upvote count and whether the viewer now has an active vote.
 */
export async function toggleVote(
  userEmail: string,
  targetType: "question" | "answer",
  targetId: string
): Promise<{ upvotes: number; hasVoted: boolean }> {
  const table = targetType === "question" ? "community_questions" : "community_answers";

  const { data: existing, error: existingError } = await supabaseServer
    .from("community_votes")
    .select("id")
    .eq("user_email", userEmail)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const { data: target, error: targetError } = await supabaseServer
    .from(table)
    .select("id")
    .eq("id", targetId)
    .maybeSingle();
  if (targetError) throw new Error(targetError.message);
  if (!target) throw new Error("Not found.");

  if (existing) {
    // Already voted — remove it.
    const { error: deleteError } = await supabaseServer
      .from("community_votes")
      .delete()
      .eq("id", existing.id);
    if (deleteError) throw new Error(deleteError.message);
  } else {
    const { error: insertError } = await supabaseServer
      .from("community_votes")
      .insert({ user_email: userEmail, target_type: targetType, target_id: targetId });
    if (insertError) throw new Error(insertError.message);
  }

  // upvotes is kept in sync by a DB trigger (see sql/schema.sql) that
  // recounts community_votes on every insert/delete — reading it back
  // fresh here (rather than computing target.upvotes ± 1 ourselves, like
  // before) means it can never drift, even if two people vote on the
  // same thing at the same instant, or a row is ever added by hand
  // outside this function.
  const { data: updated, error: updatedError } = await supabaseServer
    .from(table)
    .select("upvotes")
    .eq("id", targetId)
    .single();
  if (updatedError) throw new Error(updatedError.message);

  return { upvotes: updated.upvotes, hasVoted: !existing };
}

/**
 * Marks an answer as the accepted one for its question. Only the question's
 * original poster may do this (checked by the caller comparing
 * requesterEmail against the question's user_email before calling, and
 * again here as defense in depth). Also flips the question's status to
 * 'solved' and clears is_accepted on any previously-accepted answer for
 * the same question, since only one answer can be accepted at a time.
 */
export async function acceptAnswer(
  requesterEmail: string,
  questionId: string,
  answerId: string
): Promise<CommunityQuestion> {
  const { data: question, error: qError } = await supabaseServer
    .from("community_questions")
    .select("*")
    .eq("id", questionId)
    .maybeSingle();
  if (qError) throw new Error(qError.message);
  if (!question) throw new Error("Question not found.");
  if (question.user_email !== requesterEmail) {
    throw new Error("Only the person who asked can mark an answer as accepted.");
  }

  const { data: answer, error: aError } = await supabaseServer
    .from("community_answers")
    .select("id, question_id")
    .eq("id", answerId)
    .maybeSingle();
  if (aError) throw new Error(aError.message);
  if (!answer || answer.question_id !== questionId) throw new Error("Reply not found.");

  if (question.accepted_answer_id && question.accepted_answer_id !== answerId) {
    await supabaseServer
      .from("community_answers")
      .update({ is_accepted: false })
      .eq("id", question.accepted_answer_id);
  }

  await supabaseServer.from("community_answers").update({ is_accepted: true }).eq("id", answerId);

  const { data: updated, error: updateError } = await supabaseServer
    .from("community_questions")
    .update({
      accepted_answer_id: answerId,
      status: "solved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", questionId)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);

  return mapQuestion(updated);
}
