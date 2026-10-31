import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getDb } from "@/lib/db";
import { ADMIN_SECTIONS, generateStaffKey, hashStaffKey, isAdminSection, requireAdmin } from "@/lib/admin-auth";

// Manage staff. A staff member is either an ACCOUNT (the owner types the email of someone who already
// has a LingoCraft account; that person then sees "Admin" in their profile menu, no key needed) or an
// ACCESS KEY (no account). OWNER ONLY: requireAdmin() is called with no section, so a staff
// key (even one holding every section) can never create, edit or delete staff.

const COLUMNS = "id, name, email, user_id, key_hint, sections, active, created_at, last_used_at";

function cleanSections(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const unique = Array.from(new Set(input));
  if (!unique.every(isAdminSection)) return null;
  return ADMIN_SECTIONS.filter((s) => unique.includes(s)); // canonical order
}

function cleanName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  return name.length >= 1 && name.length <= 80 ? name : null;
}

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { data, error } = await supabaseServer
    .from("admin_staff")
    .select(COLUMNS)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data ?? [] });
}

// Create. Two modes:
//   { email, sections }  -> link an existing account (no key)
//   { name, sections }   -> make an access key; it is returned ONCE here and never again.
export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => ({}));
  const sections = cleanSections(body.sections);
  if (!sections || sections.length === 0) {
    return NextResponse.json({ error: "Choose at least one section." }, { status: 400 });
  }

  // --- account mode ---
  if (typeof body.email === "string" && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    // Only an account that already exists can be linked. Linking an email nobody has
    // registered yet would let a stranger sign up with it first and walk into the panel.
    let user: { id: string; name: string | null; email: string } | null = null;
    try {
      const db = await getDb();
      const res = await db.execute({ sql: "SELECT id, name, email FROM users WHERE lower(email) = ?", args: [email] });
      const row: any = res.rows[0];
      if (row) user = { id: String(row.id), name: row.name ? String(row.name) : null, email: String(row.email) };
    } catch (err: any) {
      return NextResponse.json({ error: err?.message ?? "Could not look up that account." }, { status: 500 });
    }
    if (!user) {
      return NextResponse.json(
        { error: "No LingoCraft account uses that email. Ask them to sign up first, then add them here." },
        { status: 404 }
      );
    }
    const { data: existing, error: existingError } = await supabaseServer
      .from("admin_staff")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });
    if (existing) {
      return NextResponse.json({ error: "This account already has admin access. Edit it in the list below." }, { status: 409 });
    }
    const name = cleanName(body.name) ?? user.name ?? user.email;
    const { data, error } = await supabaseServer
      .from("admin_staff")
      .insert({ name, email: user.email, user_id: user.id, sections })
      .select(COLUMNS)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ staff: data }, { status: 201 });
  }

  // --- key mode ---
  const name = cleanName(body.name);
  if (!name) return NextResponse.json({ error: "Enter a name (up to 80 characters)." }, { status: 400 });

  const key = generateStaffKey();
  const { data, error } = await supabaseServer
    .from("admin_staff")
    .insert({ name, sections, key_hash: hashStaffKey(key), key_hint: key.slice(-4) })
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ staff: data, key }, { status: 201 });
}

// Edit name / sections / on-off, or issue a new key (the old one stops working immediately).
export async function PATCH(req: NextRequest) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = cleanName(body.name);
    if (!name) return NextResponse.json({ error: "Enter a name (up to 80 characters)." }, { status: 400 });
    update.name = name;
  }
  if (body.sections !== undefined) {
    const sections = cleanSections(body.sections);
    if (!sections) return NextResponse.json({ error: "Unknown section." }, { status: 400 });
    update.sections = sections;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "Invalid value." }, { status: 400 });
    update.active = body.active;
  }
  let newKey: string | undefined;
  if (body.regenerateKey === true) {
    newKey = generateStaffKey();
    update.key_hash = hashStaffKey(newKey);
    update.key_hint = newKey.slice(-4);
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data, error } = await supabaseServer
    .from("admin_staff")
    .update(update)
    .eq("id", body.id)
    .select(COLUMNS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  return NextResponse.json({ staff: data, ...(newKey ? { key: newKey } : {}) });
}

export async function DELETE(req: NextRequest) {
  const unauthorized = await requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => ({}));
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const { error } = await supabaseServer.from("admin_staff").delete().eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
