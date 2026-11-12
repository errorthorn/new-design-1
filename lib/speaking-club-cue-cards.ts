import { supabaseServer } from "@/lib/supabase";

// See the big comment above the speaking_club_topic_of_day table in
// sql/schema.sql for the full rationale — admin sets one topic + a pool of
// cue-card questions each day; the call room (app/speaking-club/room/[code]/page.tsx)
// rotates through them and keeps both participants in sync client-side.

export type CueCard = { id: string; questionText: string; orderIndex: number };

export type TopicOfDay = {
  topicTitle: string;
  rotationMinutes: number;
  cards: CueCard[];
};

export async function getTopicOfDay(): Promise<TopicOfDay> {
  const [{ data: topicRow }, { data: cardRows }] = await Promise.all([
    supabaseServer
      .from("speaking_club_topic_of_day")
      .select("topic_title, rotation_minutes")
      .eq("id", 1)
      .maybeSingle(),
    supabaseServer
      .from("speaking_club_cue_cards")
      .select("id, question_text, order_index")
      .order("order_index", { ascending: true }),
  ]);

  return {
    topicTitle: topicRow?.topic_title || "Free talk",
    rotationMinutes: topicRow?.rotation_minutes ?? 8,
    cards: (cardRows ?? []).map((r) => ({ id: r.id, questionText: r.question_text, orderIndex: r.order_index })),
  };
}

// Insert-then-delete (flipped from the original delete-then-insert), by
// design — see the comment on speaking_club_cue_cards in sql/schema.sql:
// admin sets a fresh day's set each time, there's no history to preserve.
// questions is the ordered list of card text; empty strings are dropped so
// a blank textarea in the admin form doesn't create an empty card.
//
// Fix: the old delete-then-insert order left a real (if brief) window
// where the table was completely empty — a student's GET /cue-cards
// landing in that window would see zero cards for the rest of that call
// (the room page reads it once, not on a poll). Capturing the OLD ids
// first and inserting the NEW rows before removing those specific old
// ones means a reader mid-save sees old+new cards together for an
// instant at worst, never an empty set.
export async function setTopicOfDay(input: {
  topicTitle: string;
  rotationMinutes: number;
  questions: string[];
}): Promise<void> {
  const cleanQuestions = input.questions.map((q) => q.trim()).filter(Boolean);

  const { error: topicError } = await supabaseServer
    .from("speaking_club_topic_of_day")
    .update({
      topic_title: input.topicTitle.trim() || "Free talk",
      rotation_minutes: input.rotationMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (topicError) throw new Error(topicError.message);

  const { data: oldRows, error: oldRowsError } = await supabaseServer
    .from("speaking_club_cue_cards")
    .select("id");
  if (oldRowsError) throw new Error(oldRowsError.message);
  const oldIds = (oldRows ?? []).map((r) => r.id as string);

  if (cleanQuestions.length > 0) {
    const { error: insertError } = await supabaseServer.from("speaking_club_cue_cards").insert(
      cleanQuestions.map((q, i) => ({ question_text: q, order_index: i }))
    );
    if (insertError) throw new Error(insertError.message);
  }

  if (oldIds.length > 0) {
    const { error: deleteError } = await supabaseServer
      .from("speaking_club_cue_cards")
      .delete()
      .in("id", oldIds); // only the rows that existed before this save — never the ones just inserted above
    if (deleteError) throw new Error(deleteError.message);
  }
}
