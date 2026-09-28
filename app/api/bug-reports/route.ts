// app/api/bug-reports/route.js
//
// Powers the list on /dashboard/report-bug. Each student only ever sees
// their own reports — there's no "browse other people's bugs" view, so
// this is a simple owned-rows list, no search/sort params needed yet.
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";

const VALID_SEVERITIES = new Set(["low", "medium", "high"]);
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 4000;

export async function GET() {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT id, title, severity, status, created_at, updated_at
          FROM bug_reports WHERE user_id = ? ORDER BY created_at DESC`,
    args: [user.id],
  });

  return NextResponse.json({ reports: res.rows });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  let body: { title?: string; description?: string; severity?: string; pageUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = (body.title || "").trim();
  const description = (body.description || "").trim();
  const severity = VALID_SEVERITIES.has(body.severity || "") ? body.severity! : "medium";
  const pageUrl = (body.pageUrl || "").trim().slice(0, 300) || null;

  if (!title) {
    return NextResponse.json({ error: "Give the bug a short title." }, { status: 400 });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: "Title is too long." }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json({ error: "Describe what happened." }, { status: 400 });
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return NextResponse.json({ error: "Description is too long." }, { status: 400 });
  }

  const db = await getDb();
  const result = await db.execute({
    sql: `INSERT INTO bug_reports (user_id, title, description, severity, page_url)
          VALUES (?, ?, ?, ?, ?)`,
    args: [user.id, title, description, severity, pageUrl],
  });

  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
