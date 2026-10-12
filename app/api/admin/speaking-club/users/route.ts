import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { searchSpeakingClubUsers } from "@/lib/speaking-club-users";

// Phase 4 (plan §9) — "User search/select (existing Turso accounts)".
// GET /api/admin/speaking-club/users?q=nadia
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const users = await searchSpeakingClubUsers(q);
  return NextResponse.json({ users });
}
