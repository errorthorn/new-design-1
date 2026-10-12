// app/api/profile/export/route.ts
//
// GDPR-style "download your data" — returns everything this app has
// stored against the signed-in account as a single JSON file: the users
// row (minus password_hash), payment claims, and mock-test attempts
// (transcript/score/feedback, from Supabase via user_email). Does not
// include the raw audio recordings themselves, only their storage path —
// downloading the actual audio bytes would need signed URLs generated
// per file, which is a heavier request than this button is meant for.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase";

const NOT_LOGGED_IN = "Not logged in.";

export async function GET() {
  const { user, response } = await requireUser(NOT_LOGGED_IN);
  if (!user) return response!;

  const db = await getDb();
  const userRow = await db.execute({
    sql: "SELECT id, email, name, avatar_url, subscription_active, subscription_expires_at, email_reminders_enabled, created_at FROM users WHERE id = ?",
    args: [user.id],
  });
  const claims = await db.execute({
    sql: "SELECT method, sender_number, trx_id, amount, status, created_at FROM payment_claims WHERE user_id = ? ORDER BY created_at DESC",
    args: [user.id],
  });

  let attempts: any[] = [];
  try {
    const { data } = await supabaseServer
      .from("mock_test_attempts")
      .select(
        "id, started_at, completed_at, transcript, score, feedback, scored_at, audio_path, students!inner(user_email)"
      )
      .eq("students.user_email", user.email);
    attempts = (data ?? []).map((a: any) => ({
      id: a.id,
      started_at: a.started_at,
      completed_at: a.completed_at,
      transcript: a.transcript,
      score: a.score,
      feedback: a.feedback,
      scored_at: a.scored_at,
      audio_storage_path: a.audio_path,
    }));
  } catch (err) {
    console.error("Export: failed to fetch Supabase attempts", err);
  }

  const exportPayload = {
    exportedAt: new Date().toISOString(),
    account: userRow.rows[0] ?? null,
    paymentClaims: claims.rows,
    mockTestAttempts: attempts,
  };

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="lingocraft-data-${user.id}.json"`,
    },
  });
}
