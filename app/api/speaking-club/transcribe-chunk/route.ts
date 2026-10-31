// app/api/speaking-club/transcribe-chunk/route.ts
//
// OPT-IN cloud fallback for the in-browser transcription (see
// lib/speaking-club/transcription/cloud.ts). The browser posts ONE short chunk of the
// student's own speech (16 kHz mono 16-bit WAV, at most ~30 s); this route relays it
// to Groq's hosted Whisper and returns the text. Nothing is stored or logged here —
// not the audio and not the text.
//
// Needs GROQ_API_KEY. Without it (or with CLOUD_TRANSCRIBE_DISABLED=true) the route
// answers 503 and the browser quietly goes back to transcribing on the device.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { supabaseServer } from "@/lib/supabase";
import { getShiftById } from "@/lib/speaking-club-db";
import { parseWavInfo } from "@/lib/speaking-club/audio/wav";
import { allow } from "@/lib/speaking-club/transcription/chunk-rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MAX_BYTES = 1_200_000; // ~37 s of 16 kHz 16-bit mono
const MAX_SECONDS = 31;

// DAILY BUDGET (persistent, shared by every server instance): the real cost cap. Counted in
// BILLED seconds (hosted Whisper APIs bill at least 10 s per request). Defaults sit inside
// Groq's free tier as I read it (about 8 h of audio per day) — raise them when you move to a
// paid plan. 0 = no limit. Needs sql/migrations/2026-10-17-speaking-cloud-transcribe-budget.sql.
const MIN_BILLED_SECONDS = 10;
function limitSeconds(envName: string, defaultMinutes: number): number {
  const raw = process.env[envName];
  const n = raw === undefined || raw.trim() === "" ? defaultMinutes : Number(raw);
  return (Number.isFinite(n) && n > 0 ? n : 0) * 60;
}

export async function POST(request: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key || process.env.CLOUD_TRANSCRIBE_DISABLED === "true") {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  const { user, response } = await requireUser();
  if (!user) return response!;

  const shiftId = request.headers.get("x-shift-id")?.trim();
  if (!shiftId) return NextResponse.json({ ok: false, reason: "shift_required" }, { status: 400 });
  const shift = await getShiftById(shiftId);
  if (!shift) return NextResponse.json({ ok: false, reason: "shift_not_found" }, { status: 404 });
  const assigned = [shift.username1, shift.username2, shift.temp_username].filter(Boolean);
  if (!assigned.includes(user.email)) return NextResponse.json({ ok: false, reason: "not_assigned" }, { status: 403 });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return NextResponse.json({ ok: false, reason: "too_large" }, { status: 413 });
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) return NextResponse.json({ ok: false, reason: "too_large" }, { status: 413 });

  const info = parseWavInfo(bytes);
  if (!info || info.sampleRate !== 16000 || info.channels !== 1 || info.durationSec <= 0 || info.durationSec > MAX_SECONDS) {
    return NextResponse.json({ ok: false, reason: "bad_audio" }, { status: 400 });
  }
  if (!allow(user.email, info.durationSec)) {
    return NextResponse.json({ ok: false, reason: "quota" }, { status: 429 });
  }

  // The daily budget is checked BEFORE spending anything. When it is spent (or cannot be checked)
  // the answer is a refusal and the browser transcribes on the device instead.
  const billed = Math.max(MIN_BILLED_SECONDS, Math.ceil(info.durationSec));
  const { data: budget, error: budgetError } = await supabaseServer.rpc("consume_cloud_transcribe_budget", {
    p_email: user.email,
    p_seconds: billed,
    p_total_limit: limitSeconds("CLOUD_DAILY_BUDGET_MIN", 400),
    p_user_limit: limitSeconds("CLOUD_USER_DAILY_MIN", 40),
  });
  const decision = Array.isArray(budget) ? budget[0] : budget;
  if (budgetError || !decision) {
    return NextResponse.json({ ok: false, reason: "budget_unavailable" }, { status: 503 });
  }
  if (!decision.allowed) {
    // 403 (not 429): "stop asking for today", not "try again in a minute".
    return NextResponse.json({ ok: false, reason: String(decision.reason ?? "budget") }, { status: 403 });
  }

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/wav" }), "chunk.wav");
  form.append("model", process.env.GROQ_TRANSCRIBE_MODEL || "whisper-large-v3-turbo");
  form.append("language", "en");
  form.append("temperature", "0");
  form.append("response_format", "json");

  let upstream: Response;
  try {
    upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "upstream_unreachable" }, { status: 502 });
  }

  if (upstream.status === 429) {
    const retry = upstream.headers.get("retry-after");
    return NextResponse.json(
      { ok: false, reason: "upstream_rate_limited" },
      { status: 429, headers: retry ? { "Retry-After": retry } : undefined },
    );
  }
  if (!upstream.ok) {
    // 401/403 here means OUR key is wrong: say "unavailable", not "forbidden", so the browser does not blame the student.
    return NextResponse.json({ ok: false, reason: `upstream_${upstream.status}` }, { status: 502 });
  }
  const data = (await upstream.json().catch(() => null)) as { text?: unknown } | null;
  if (!data || typeof data.text !== "string") {
    return NextResponse.json({ ok: false, reason: "upstream_bad_response" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, text: data.text.trim() });
}
