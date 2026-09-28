// app/api/admin/bug-reports/route.js
//
// Admin list view for /admin/bug-reports — mirrors the shared-secret
// pattern every other /admin/* API route uses (see lib/admin-auth.ts).
// Joins users so the panel can show who reported it without a second
// round trip per row.
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const db = await getDb();
  const res = await db.execute(
    `SELECT b.id, b.title, b.description, b.severity, b.page_url, b.status,
            b.developer_notes, b.created_at, b.updated_at,
            u.name AS reporter_name, u.email AS reporter_email
     FROM bug_reports b
     JOIN users u ON u.id = b.user_id
     ORDER BY
       CASE b.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
       b.created_at DESC
     LIMIT 200`
  );

  return NextResponse.json({ reports: res.rows });
}
