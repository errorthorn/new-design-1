// app/api/speaking-club/words/route.ts
//
// Shared "New words I learned" notes.
//   GET  ?shiftId=…  -> this session's words (yours + your partner's), for the in-call panel
//   GET  ?roomCode=… -> dev ?as= path (no real shift): your own words for that room today
//   GET  (no params) -> your full history (yours + words your partners noted while you were in the room)
//   POST             -> saves a word, visible to whoever else is in the room right now
// A student can only ever read words they wrote or were in the room for.
import { NextRequest, NextResponse } from "next/server";
import { requireActiveMember } from "@/lib/api-auth";
import { getShiftById } from "@/lib/speaking-club-db";
import {
  MAX_MEANING_LENGTH,
  MAX_ROOM_CODE_LENGTH,
  MAX_WORDS_PER_SESSION,
  MAX_WORD_LENGTH,
  addLearnedWord,
  cleanText,
  listSessionWords,
  listWordHistory,
} from "@/lib/speaking-club-words";

/** Loads a shift and confirms this account is on it. Returns an error response instead if not. */
async function loadAssignedShift(shiftId: string, email: string) {
  try {
    const shift = await getShiftById(shiftId);
    if (!shift) return { error: NextResponse.json({ error: "Shift not found" }, { status: 404 }) };
    const assigned = [shift.username1, shift.username2, shift.temp_username].filter(Boolean) as string[];
    if (!assigned.includes(email)) {
      return { error: NextResponse.json({ error: "You are not assigned to this shift." }, { status: 403 }) };
    }
    return { shift, assigned };
  } catch (err: any) {
    return { error: NextResponse.json({ error: err?.message ?? "Could not verify your shift" }, { status: 500 }) };
  }
}

export async function GET(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  const shiftId = req.nextUrl.searchParams.get("shiftId")?.trim() || null;
  const roomCode = cleanText(req.nextUrl.searchParams.get("roomCode"), MAX_ROOM_CODE_LENGTH) || null;
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));

  try {
    if (shiftId) {
      const loaded = await loadAssignedShift(shiftId, user.email);
      if (loaded.error) return loaded.error;
      return NextResponse.json({ words: await listSessionWords({ username: user.email, shiftId, roomCode: null }) });
    }
    if (roomCode) {
      return NextResponse.json({ words: await listSessionWords({ username: user.email, shiftId: null, roomCode }) });
    }
    return NextResponse.json({
      words: await listWordHistory(user.email, Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem loading your words" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { user, response } = await requireActiveMember();
  if (!user) return response!;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const word = cleanText(body?.word, MAX_WORD_LENGTH);
  const meaning = cleanText(body?.meaning, MAX_MEANING_LENGTH) || null;
  if (!word) {
    return NextResponse.json({ error: "Type the word or phrase first." }, { status: 400 });
  }

  // A shiftId is only accepted for a shift this account is on, so a word
  // can't be filed under someone else's session. Room code, shift number
  // and who-else-is-here all come from the shift row (server truth), never
  // from the client.
  let shiftId: string | null = null;
  let roomCode: string | null = cleanText(body?.roomCode, MAX_ROOM_CODE_LENGTH) || null;
  let shiftNumber: number | null = null;
  let sharedWith: string[] = [];
  if (typeof body?.shiftId === "string" && body.shiftId.trim()) {
    const loaded = await loadAssignedShift(body.shiftId.trim(), user.email);
    if (loaded.error) return loaded.error;
    const { shift, assigned } = loaded;
    shiftId = shift.shift_id;
    roomCode = shift.room_code ?? roomCode;
    shiftNumber = shift.shift_number ?? null;
    sharedWith = Array.from(new Set(assigned.filter((e) => e !== user.email)));
  }

  try {
    const result = await addLearnedWord({ username: user.email, shiftId, roomCode, shiftNumber, sharedWith, word, meaning });
    if (!result.ok) {
      return NextResponse.json(
        { error: `You've already saved ${MAX_WORDS_PER_SESSION} words in this session — that's plenty!` },
        { status: 409 }
      );
    }
    return NextResponse.json({ word: result.word, duplicate: result.duplicate });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "There was a problem saving your word" }, { status: 500 });
  }
}
