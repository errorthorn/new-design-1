import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { supabaseServer } from "@/lib/supabase";
import { requireActiveMember } from "@/lib/api-auth";
import { computeEligibility, getWeekProgram } from "@/lib/mock-test";

const MODEL = "gemini-3.1-flash-live-preview";

export async function POST(req: NextRequest) {
  // Gate this before anything else — creating a Gemini Live token costs
  // real API quota, so it must never be reachable by a logged-out request.
  const auth = await requireActiveMember();
  if (!auth.user) return auth.response!;
  const { user } = auth;

  const { studentId } = await req.json();

  if (!studentId) {
    return NextResponse.json({ error: "studentId missing" }, { status: 400 });
  }

  // Make sure the studentId actually belongs to the signed-in account,
  // not just any id someone might pass in.
  const { data: studentRow } = await supabaseServer
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("user_email", user.email)
    .maybeSingle();

  if (!studentRow) {
    return NextResponse.json({ error: "Not your student record." }, { status: 403 });
  }

  // Enforce the weekly limit here too — not just in the check-in form.
  // This is the route that actually spends Gemini API quota, so it can't
  // rely on the client having gone through /api/mock-test/eligibility
  // first; someone calling this endpoint directly could otherwise take
  // the test as many times as they want.
  const eligibility = await computeEligibility(studentId, await getWeekProgram(user));
  if (!eligibility.eligible) {
    return NextResponse.json(
      {
        error: eligibility.inProgressAttempt
          ? "You already have a test in progress."
          : "No mock test week is unlocked for you right now.",
        nextEligibleAt: eligibility.nextEligibleAt,
      },
      { status: 403 }
    );
  }

  // Record that a test has started — this is what the weekly check reads.
  const { data: attempt, error: attemptError } = await supabaseServer
    .from("mock_test_attempts")
    .insert({ student_id: studentId })
    .select("id")
    .single();

  if (attemptError) {
    // 23505 = unique_violation. computeEligibility() above isn't atomic
    // with this insert, so a genuine double-click/double-tab could both
    // pass the check before either insert lands — idx_one_live_attempt_per_student
    // (see sql/schema.sql) is what actually stops the second one. Surface
    // it as the same friendly message eligibility already uses, not a
    // raw 500.
    if (attemptError.code === "23505") {
      return NextResponse.json(
        { error: "You already have a test in progress." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: attemptError.message }, { status: 500 });
  }

  // Pull the teacher's question list, split by IELTS-style part.
  const { data: questions } = await supabaseServer
    .from("mock_test_questions")
    .select("question, part")
    .eq("active", true)
    .order("part", { ascending: true })
    .order("position", { ascending: true });

  const part1 = (questions ?? []).filter((q) => q.part === 1).map((q) => q.question);
  const part2 = (questions ?? []).filter((q) => q.part === 2).map((q) => q.question);
  const part3 = (questions ?? []).filter((q) => q.part === 3).map((q) => q.question);
  const hasAnyQuestions = part1.length || part2.length || part3.length;

  // The client needs to reliably know when the examiner moves from one
  // part to the next (to show the student a "Part 2 starting" popup etc).
  // Parsing the model's spoken text for this would be fragile, so instead
  // the model is required to call this function right before it starts
  // the first question of a new part — the client listens for the tool
  // call, not for any particular phrase.
  const advancePartTool = {
    functionDeclarations: [
      {
        name: "advance_part",
        description:
          "Call this exactly once, right before you ask the first question of Part 2, and again right before you ask the first question of Part 3. Do not call it for Part 1 (the test already starts there). Do not call it more than once per part.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            part: {
              type: Type.INTEGER,
              description: "The part number you are about to start: 2 or 3.",
            },
          },
          required: ["part"],
        },
      },
    ],
  };

  const systemInstruction = hasAnyQuestions
    ? [
        "You are an English speaking test examiner for LingoCraft, a language school, running a simulation of the IELTS Speaking test. The test has three parts, in this exact order: Part 1 (introduction), Part 2 (cue card), Part 3 (discussion).",
        "",
        "GENERAL RULES:",
        "- Keep your own turns short — just the question or instruction, plus brief natural acknowledgements like 'okay' or 'thank you'.",
        "- Do not go off-topic, do not give the answers away, and do not skip ahead.",
        "- You MUST call the advance_part function right before the first question of Part 2, and again right before the first question of Part 3. Never call it for Part 1, and never call it more than once per part.",
        "",
        "PART 1 — Introduction (start here immediately):",
        "First, in one short natural turn: greet the student warmly, briefly introduce yourself as the examiner for this IELTS Speaking simulation, and ask them to state their full name and where they're from. Wait for their answer before moving on — this greeting happens before any of the numbered questions below and does NOT count as one of them.",
        "",
        "After that greeting exchange, continue with Part 1 proper:",
        part1.length
          ? [
              "Ask the student ONLY the following questions, one at a time, in this exact order. Wait for the student's full answer before moving to the next question.",
              ...part1.map((q, i) => `${i + 1}. ${q}`),
            ].join("\n")
          : "Ask the student 3-4 simple everyday introductory questions (name, hometown, work/studies, hobbies), one at a time.",
        "",
        "PART 2 — Cue Card:",
        part2.length
          ? [
              "Call advance_part(part=2). Then read out the following cue card topic to the student exactly as written, and tell them they have one minute to prepare and then should speak for one to two minutes. Then STOP TALKING and end your turn. The app itself is timing the one-minute preparation on its end — the student's mic is intentionally silent to you during that minute, so do not try to fill it, do not guess when a minute has passed, and do not say 'please begin' yet. You will receive a short system message telling you when the prep time is actually over and it's time to invite the student to start — only say 'please begin' after that message arrives, then listen with minimal interruption.",
              part2[0],
            ].join("\n")
          : "Call advance_part(part=2). Then give the student a simple, common IELTS-style cue card topic (e.g. 'Describe a place you like to visit. You should say: where it is, how often you go there, what you do there, and explain why you like it.'). Tell them they have one minute to prepare, then end your turn and wait — the app tells you separately, via a system message, exactly when the minute is up and it's time to say 'please begin'.",
        "",
        "PART 3 — Discussion:",
        part3.length
          ? [
              "Call advance_part(part=3). Then ask the student ONLY the following questions, one at a time, in this exact order, as a deeper discussion related to the Part 2 topic. Wait for the student's full answer before moving to the next question.",
              ...part3.map((q, i) => `${i + 1}. ${q}`),
            ].join("\n")
          : "Call advance_part(part=3). Then ask 3-4 more abstract discussion questions related to the Part 2 topic, one at a time.",
        "",
        "After the last Part 3 question, thank the student and say the test is complete.",
      ].join("\n")
    : "You are an English speaking test examiner for LingoCraft, running a short IELTS-style speaking simulation with three parts (introduction, cue card, discussion). Start with a short warm greeting — introduce yourself as the examiner and ask the student's full name and where they're from — before asking any test questions. Call the advance_part function right before Part 2 and right before Part 3. Ask a few simple questions in Part 1, give a common cue-card topic for Part 2, tell the student they have a minute to prepare, then end your turn and wait — the app times the minute itself and will send a system message telling you when to say 'please begin' — then ask a few related discussion questions for Part 3, one at a time, waiting for the student's full answer each time.";

  if (!process.env.GOOGLE_API_KEY) {
    return NextResponse.json(
      { error: "GOOGLE_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GOOGLE_API_KEY,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        // 25-min test + reconnect overhead (goAway hits ~every ~10 min,
        // so a 25-min test needs 2-3 reconnects) + a grading buffer.
        expireTime: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: `models/${MODEL}`,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            tools: [advancePartTool],
            // Removes the ~15-minute token-based content cap. Without this,
            // a long test would get its SESSION terminated (not just the
            // connection) around 15 minutes in, regardless of reconnects.
            contextWindowCompression: {
              slidingWindow: {},
            },
            // Server will send sessionResumptionUpdate messages with a
            // reconnect handle — gemini-live-client.ts uses this to
            // reconnect transparently when a goAway arrives.
            sessionResumption: {},
          },
        },
      },
    });

    return NextResponse.json({
      attemptId: attempt.id,
      token: token.name,
      model: MODEL,
    });
  } catch (err: any) {
    console.error("========== GEMINI SESSION ERROR ==========");
    console.error(err);

    // 429 RESOURCE_EXHAUSTED means the project is out of concurrent-session
    // capacity right now — distinct from an actual bug, and worth a
    // different, honest message so 120 students hitting this at once don't
    // all see a generic "something broke" error.
    const status = err?.status ?? err?.code;
    const message: string = err?.message ?? "";
    const isQuotaError =
      status === 429 ||
      status === "RESOURCE_EXHAUSTED" ||
      /RESOURCE_EXHAUSTED|429/i.test(message);

    if (isQuotaError) {
      return NextResponse.json(
        {
          error: "The server is busy right now, please try again shortly.",
          quotaExceeded: true,
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: err?.message ?? "Failed to create Gemini session token" },
      { status: 500 }
    );
  }
}