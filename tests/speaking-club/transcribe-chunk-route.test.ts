import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { encodeWav16k } from "@/lib/speaking-club/audio/wav";

const auth = vi.hoisted(() => ({ user: { email: "student@example.com" } as { email: string } | null }));
vi.mock("@/lib/api-auth", () => ({
  requireUser: async () =>
    auth.user ? { user: auth.user, response: null } : { user: null, response: NextResponse.json({ error: "no" }, { status: 401 }) },
}));
const db = vi.hoisted(() => ({
  shift: { username1: "student@example.com", username2: "other@example.com", temp_username: null } as Record<string, unknown> | null,
}));
vi.mock("@/lib/speaking-club-db", () => ({ getShiftById: async () => db.shift }));

const budget = vi.hoisted(() => ({
  result: { data: [{ allowed: true, reason: null }], error: null } as { data: unknown; error: unknown },
  calls: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/supabase", () => ({
  supabaseServer: {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      budget.calls.push(args);
      return budget.result;
    },
  },
}));

import { POST } from "@/app/api/speaking-club/transcribe-chunk/route";
import { resetUsage } from "@/lib/speaking-club/transcription/chunk-rate-limit";

const wav = (seconds: number) => encodeWav16k(new Int16Array(Math.round(seconds * 16000)).fill(100));
const req = (body: Uint8Array | string, headers: Record<string, string> = { "x-shift-id": "shift-1" }) =>
  new Request("http://localhost/api/speaking-club/transcribe-chunk", {
    method: "POST",
    headers: { "content-type": "audio/wav", ...headers },
    body: body as BodyInit,
  });

beforeEach(() => {
  vi.stubEnv("GROQ_API_KEY", "test-key");
  auth.user = { email: "student@example.com" };
  db.shift = { username1: "student@example.com", username2: "other@example.com", temp_username: null };
  resetUsage();
  budget.result = { data: [{ allowed: true, reason: null }], error: null };
  budget.calls.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/speaking-club/transcribe-chunk", () => {
  it("answers 503 when no Groq key is configured (the browser then uses the device)", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    const res = await POST(req(wav(2)));
    expect(res.status).toBe(503);
  });

  it("answers 503 when the kill switch is on", async () => {
    vi.stubEnv("CLOUD_TRANSCRIBE_DISABLED", "true");
    expect((await POST(req(wav(2)))).status).toBe(503);
  });

  it("requires a signed-in user who is assigned to the shift", async () => {
    auth.user = null;
    expect((await POST(req(wav(2)))).status).toBe(401);
    auth.user = { email: "stranger@example.com" };
    expect((await POST(req(wav(2)))).status).toBe(403);
    auth.user = { email: "student@example.com" };
    expect((await POST(req(wav(2)), )).status).not.toBe(403);
    expect((await POST(req(wav(2), {}))).status).toBe(400); // no shift id
    db.shift = null;
    expect((await POST(req(wav(2)))).status).toBe(404);
  });

  it("rejects audio that is not a short 16 kHz mono WAV", async () => {
    expect((await POST(req("not audio at all, just text that is long enough to pass the size check............"))).status).toBe(400);
    expect((await POST(req(wav(45)))).status).toBe(413); // over the byte limit
    expect((await POST(req(wav(33)))).status).toBe(400); // under the byte limit but over 31 s
  });

  it("relays the chunk to Groq with the key and returns the trimmed text", async () => {
    const calls: { url: string; init: any }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ text: "  I went to the market yesterday.  " }), { status: 200 });
    });
    const res = await POST(req(wav(5)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, text: "I went to the market yesterday." });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("api.groq.com/openai/v1/audio/transcriptions");
    expect(calls[0].init.headers.Authorization).toBe("Bearer test-key");
    const form = calls[0].init.body as FormData;
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("en");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("passes a Groq rate limit on as 429 (with Retry-After) and hides other upstream errors as 502", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 429, headers: { "retry-after": "12" } }));
    const limited = await POST(req(wav(2)));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("12");

    vi.stubGlobal("fetch", async () => new Response("{}", { status: 401 })); // OUR key is wrong
    const bad = await POST(req(wav(2)));
    expect(bad.status).toBe(502); // never 401/403: the browser would blame the student
  });

  it("caps how much one student can send per hour", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
    let last = 200;
    for (let i = 0; i < 205; i++) last = (await POST(req(wav(1)))).status;
    expect(last).toBe(429);
  });

  it("spends from the daily budget in billed seconds (min 10 s) and refuses with 403 when it is used up, without calling Groq", async () => {
    const groq = vi.fn(async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", groq);

    expect((await POST(req(wav(3)))).status).toBe(200);
    expect(budget.calls[0]).toMatchObject({ p_email: "student@example.com", p_seconds: 10, p_total_limit: 400 * 60, p_user_limit: 40 * 60 });
    expect((await POST(req(wav(14.2)))).status).toBe(200);
    expect(budget.calls[1].p_seconds).toBe(15);

    vi.stubEnv("CLOUD_DAILY_BUDGET_MIN", "90");
    vi.stubEnv("CLOUD_USER_DAILY_MIN", "0");
    await POST(req(wav(5)));
    expect(budget.calls[2]).toMatchObject({ p_total_limit: 90 * 60, p_user_limit: 0 });

    groq.mockClear();
    budget.result = { data: [{ allowed: false, reason: "daily_budget" }], error: null };
    const res = await POST(req(wav(5)));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, reason: "daily_budget" });
    expect(groq).not.toHaveBeenCalled();
  });

  it("fails closed (503, no Groq call) when the budget cannot be checked, e.g. the migration was not run", async () => {
    const groq = vi.fn(async () => new Response(JSON.stringify({ text: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", groq);
    budget.result = { data: null, error: { message: "function does not exist" } };
    expect((await POST(req(wav(5)))).status).toBe(503);
    expect(groq).not.toHaveBeenCalled();
  });
});
