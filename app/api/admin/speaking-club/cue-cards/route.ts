import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getTopicOfDay, setTopicOfDay } from "@/lib/speaking-club-cue-cards";

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const topic = await getTopicOfDay();
  return NextResponse.json(topic);
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const topicTitle = typeof body?.topicTitle === "string" ? body.topicTitle : "";
  const rotationMinutes = Number(body?.rotationMinutes);
  const questions = Array.isArray(body?.questions) ? body.questions.filter((q: unknown) => typeof q === "string") : [];

  if (!Number.isInteger(rotationMinutes) || rotationMinutes < 1 || rotationMinutes > 60) {
    return NextResponse.json({ error: "Rotation minutes must be a whole number between 1 and 60." }, { status: 400 });
  }

  try {
    await setTopicOfDay({ topicTitle, rotationMinutes, questions });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not save the topic." }, { status: 500 });
  }

  const topic = await getTopicOfDay();
  return NextResponse.json({ ok: true, ...topic });
}
