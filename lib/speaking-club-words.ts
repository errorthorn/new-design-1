// lib/speaking-club-words.ts
//
// Server-only helpers behind the shared "New words I learned" notes (see
// the speaking_learned_words table in sql/schema.sql). Same supabaseServer
// (service role) pattern as lib/speaking-club-db.ts — never import this
// into a client component.
//
// Visibility rule, everywhere: a student can see a word only if they wrote
// it OR they were in the room when it was written (`shared_with`). Only the
// author can delete it.
import { supabaseServer } from "@/lib/supabase";
import { getDisplayNamesByEmails } from "@/lib/speaking-club-users";

export const MAX_WORD_LENGTH = 120;
export const MAX_MEANING_LENGTH = 300;
// Per student, per SESSION (shift + day) — an abuse guard, far above what
// anyone would note in one ~1 hour call.
export const MAX_WORDS_PER_SESSION = 200;
export const MAX_ROOM_CODE_LENGTH = 40;

export type LearnedWord = {
  id: string;
  word: string;
  meaning: string | null;
  shiftId: string | null;
  roomCode: string | null;
  shiftNumber: number | null;
  /** Asia/Dhaka calendar day of the session, "YYYY-MM-DD". */
  sessionDate: string;
  createdAt: string;
  /** Display name of whoever wrote it ("You" for the requesting student). */
  authorName: string;
  isMine: boolean;
};

type Row = {
  id: string;
  username: string;
  shift_id: string | null;
  room_code: string | null;
  shift_number: number | null;
  session_date: string;
  shared_with: string[] | null;
  word: string;
  meaning: string | null;
  created_at: string;
};

const COLUMNS =
  "id, username, shift_id, room_code, shift_number, session_date, shared_with, word, meaning, created_at";

/** Today's calendar date in Asia/Dhaka (no DST there, so a fixed +6h is exact) as "YYYY-MM-DD". */
export function dhakaToday(): string {
  return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Lower-cased, whitespace-collapsed — what "same word" means for de-duplication. */
export function normalizeWordKey(word: string): string {
  return word.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

/** Turns raw rows into API objects, resolving author display names in one lookup. */
async function toWords(rows: Row[], me: string): Promise<LearnedWord[]> {
  const others = Array.from(new Set(rows.filter((r) => r.username !== me).map((r) => r.username)));
  const names = others.length > 0 ? await getDisplayNamesByEmails(others) : {};
  return rows.map((r) => ({
    id: r.id,
    word: r.word,
    meaning: r.meaning,
    shiftId: r.shift_id,
    roomCode: r.room_code,
    shiftNumber: r.shift_number,
    sessionDate: r.session_date,
    createdAt: r.created_at,
    isMine: r.username === me,
    authorName: r.username === me ? "You" : names[r.username] ?? "Your partner",
  }));
}

function canSee(row: Row, me: string): boolean {
  return row.username === me || (row.shared_with ?? []).includes(me);
}

/**
 * Everything noted in ONE session (this shift, today) that this student may
 * see — their own words plus their partner's. Newest first.
 *
 * With no shiftId (the dev ?as= test path, which has no real shift) it falls
 * back to the student's own words for this room today, so the panel still
 * behaves like a normal session.
 */
export async function listSessionWords(params: {
  username: string;
  shiftId: string | null;
  roomCode: string | null;
}): Promise<LearnedWord[]> {
  let query = supabaseServer
    .from("speaking_learned_words")
    .select(COLUMNS)
    .eq("session_date", dhakaToday())
    .order("created_at", { ascending: false })
    .limit(500);

  if (params.shiftId) {
    query = query.eq("shift_id", params.shiftId);
  } else {
    query = query.is("shift_id", null).eq("username", params.username);
    query = params.roomCode ? query.eq("room_code", params.roomCode) : query.is("room_code", null);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = ((data ?? []) as Row[]).filter((r) => canSee(r, params.username));
  return toWords(rows, params.username);
}

/**
 * The student's full history across all sessions: words they wrote plus
 * words their partners wrote while they were in the room. Newest first.
 * Deliberately independent of the shift rows (no join), so it keeps working
 * after a shift is deleted or reassigned.
 */
export async function listWordHistory(username: string, limit = 300): Promise<LearnedWord[]> {
  const cap = Math.min(Math.max(limit, 1), 500);
  const [mine, shared] = await Promise.all([
    supabaseServer
      .from("speaking_learned_words")
      .select(COLUMNS)
      .eq("username", username)
      .order("created_at", { ascending: false })
      .limit(cap),
    supabaseServer
      .from("speaking_learned_words")
      .select(COLUMNS)
      .contains("shared_with", [username])
      .order("created_at", { ascending: false })
      .limit(cap),
  ]);
  if (mine.error) throw mine.error;
  if (shared.error) throw shared.error;

  const byId = new Map<string, Row>();
  for (const r of [...((mine.data ?? []) as Row[]), ...((shared.data ?? []) as Row[])]) byId.set(r.id, r);
  const rows = Array.from(byId.values())
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, cap);
  return toWords(rows, username);
}

export type AddWordResult =
  | { ok: true; word: LearnedWord; duplicate: boolean }
  | { ok: false; reason: "limit_reached" };

/**
 * Saves a word for this student in today's session. Idempotent: adding the
 * same word again in the same session returns the existing row
 * (`duplicate: true`) instead of erroring, so a double-tap or a second open
 * tab is harmless. Duplicates are checked per student and per session, so
 * the same word can be saved again on another day (or by the partner).
 */
export async function addLearnedWord(params: {
  username: string;
  shiftId: string | null;
  roomCode: string | null;
  shiftNumber: number | null;
  /** Other people in the room right now — they'll be able to see this word. */
  sharedWith: string[];
  word: string;
  meaning: string | null;
}): Promise<AddWordResult> {
  const wordKey = normalizeWordKey(params.word);
  const sessionDate = dhakaToday();

  // Narrows any query on the table to "this student, this session".
  function inSession<T extends { eq: any; is: any }>(q: T): T {
    let out: any = q.eq("username", params.username).eq("session_date", sessionDate);
    out = params.shiftId ? out.eq("shift_id", params.shiftId) : out.is("shift_id", null);
    if (!params.shiftId) out = params.roomCode ? out.eq("room_code", params.roomCode) : out.is("room_code", null);
    return out;
  }

  async function findExisting(): Promise<Row | null> {
    const { data, error } = await inSession(
      supabaseServer.from("speaking_learned_words").select(COLUMNS).eq("word_key", wordKey).limit(1) as any
    );
    if (error) throw error;
    return data && data.length > 0 ? (data[0] as Row) : null;
  }

  const existing = await findExisting();
  if (existing) {
    const [word] = await toWords([existing], params.username);
    return { ok: true, word, duplicate: true };
  }

  const { count, error: countError } = await inSession(
    supabaseServer.from("speaking_learned_words").select("id", { count: "exact", head: true }) as any
  );
  if (countError) throw countError;
  if ((count ?? 0) >= MAX_WORDS_PER_SESSION) return { ok: false, reason: "limit_reached" };

  const { data, error } = await supabaseServer
    .from("speaking_learned_words")
    .insert({
      username: params.username,
      shift_id: params.shiftId,
      room_code: params.roomCode,
      shift_number: params.shiftNumber,
      session_date: sessionDate,
      shared_with: params.sharedWith,
      word: params.word,
      word_key: wordKey,
      meaning: params.meaning,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    // 23505 = unique_violation: lost a race with a parallel insert of the
    // same word — treat it exactly like the "already saved" case above.
    if ((error as { code?: string }).code === "23505") {
      const raced = await findExisting();
      if (raced) {
        const [word] = await toWords([raced], params.username);
        return { ok: true, word, duplicate: true };
      }
    }
    throw error;
  }
  const [word] = await toWords([data as Row], params.username);
  return { ok: true, word, duplicate: false };
}

/** Deletes one of THIS student's words (the username filter is the ownership check). Returns whether a row was removed. */
export async function deleteLearnedWord(username: string, id: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("speaking_learned_words")
    .delete()
    .eq("id", id)
    .eq("username", username)
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}
