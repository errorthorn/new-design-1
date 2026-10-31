import { NextResponse } from "next/server";
import { findSessionStaff } from "@/lib/admin-auth";
import { ADMIN_SECTIONS } from "@/lib/admin-sections";

// Who am I in the admin panel? Used by the profile menu ("Admin" option), the /admin home
// and the admin pages to decide what to show. It never errors for ordinary members: anyone
// who isn't staff simply gets { admin: false }. The real access check is always done again
// on the server by requireAdmin() for every admin API call.
export const dynamic = "force-dynamic";

export async function GET() {
  const { staff } = await findSessionStaff();
  if (!staff || !staff.active) return NextResponse.json({ admin: false, sections: [] });
  const granted: string[] = Array.isArray(staff.sections) ? staff.sections : [];
  const sections = ADMIN_SECTIONS.filter((s) => granted.includes(s));
  return NextResponse.json({ admin: sections.length > 0, name: staff.name ?? null, sections });
}
