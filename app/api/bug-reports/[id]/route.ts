// app/api/bug-reports/[id]/route.js
//
// Full detail for one of the signed-in user's own reports (the list
// endpoint deliberately omits description/developer_notes/page_url to
// keep the list payload light — this fills those in once a report is
// selected on /dashboard/report-bug).
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { getDb } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requireUser();
  if (!user) return response!;

  const db = await getDb();
  const res = await db.execute({
    sql: `SELECT id, title, description, severity, page_url, status, developer_notes, created_at, updated_at
          FROM bug_reports WHERE id = ? AND user_id = ?`,
    args: [params.id, user.id],
  });
  const report = res.rows[0];
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  return NextResponse.json({ report });
}
