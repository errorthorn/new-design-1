// app/api/admin/bug-reports/[id]/route.js
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

const VALID_STATUSES = new Set(["open", "in_progress", "resolved", "wont_fix"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { status, developerNotes }: { status?: string; developerNotes?: string } = await req.json();

  const updates: string[] = [];
  const args: (string | number | null)[] = [];

  if (status !== undefined) {
    if (!VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
    updates.push("status = ?");
    args.push(status);
  }
  if (developerNotes !== undefined) {
    updates.push("developer_notes = ?");
    args.push(developerNotes.trim() || null);
  }
  if (!updates.length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  updates.push("updated_at = datetime('now')");

  const db = await getDb();
  args.push(params.id);
  const result = await db.execute({
    sql: `UPDATE bug_reports SET ${updates.join(", ")} WHERE id = ?`,
    args,
  });

  if (result.rowsAffected === 0) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
