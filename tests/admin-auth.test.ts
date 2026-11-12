import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type StaffRow = { id: string; sections: string[]; active: boolean; last_used_at: string | null };

let staffRow: StaffRow | null = null;
let lookupError: { message: string } | null = null;
const lookups: string[] = [];
const touched: string[] = [];

vi.mock("@/lib/supabase", () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: (_col: string, hash: string) => {
          lookups.push(hash);
          return { maybeSingle: async () => ({ data: lookupError ? null : staffRow, error: lookupError }) };
        },
        order: async () => ({ data: [], error: null }),
      }),
      update: () => ({
        eq: async (_c: string, id: string) => {
          touched.push(id);
          return { error: null };
        },
      }),
    }),
  },
}));

import { hashStaffKey, requireAdmin } from "@/lib/admin-auth";
import { GET as listStaff } from "@/app/api/admin/staff/route";

const OWNER = "owner-secret-value";
const STAFF_KEY = "lcs_test-key-1234";
const req = (key?: string) =>
  new NextRequest("http://localhost/api/admin/x", { headers: key ? { "x-admin-secret": key } : {} });

describe("requireAdmin", () => {
  beforeEach(() => {
    process.env.ADMIN_SECRET = OWNER;
    staffRow = { id: "s1", sections: ["quiz", "scoring"], active: true, last_used_at: null };
    lookupError = null;
    lookups.length = 0;
    touched.length = 0;
  });

  it("rejects a request with no key, without touching the database", async () => {
    expect((await requireAdmin(req(), "quiz"))?.status).toBe(401);
    expect(lookups).toHaveLength(0);
  });

  it("lets the owner into every section and owner-only routes, without a database lookup", async () => {
    expect(await requireAdmin(req(OWNER), "speaking-club")).toBeNull();
    expect(await requireAdmin(req(OWNER))).toBeNull();
    expect(lookups).toHaveLength(0);
  });

  it("lets a staff key into a section it was granted", async () => {
    expect(await requireAdmin(req(STAFF_KEY), "quiz")).toBeNull();
    expect(lookups).toEqual([hashStaffKey(STAFF_KEY)]); // looked up by hash, never the raw key
  });

  it("blocks a staff key from a section it was not granted (403)", async () => {
    const res = await requireAdmin(req(STAFF_KEY), "speaking-club");
    expect(res?.status).toBe(403);
    expect((await res!.json()).error).toMatch(/Speaking Club/);
  });

  it("keeps owner-only routes (no section) closed to staff, even with every section", async () => {
    staffRow!.sections = ["scoring", "questions", "speaking-club", "mock-test", "quiz"];
    expect((await requireAdmin(req(STAFF_KEY)))?.status).toBe(403);
  });

  it("rejects a key that is switched off or unknown (401)", async () => {
    staffRow!.active = false;
    expect((await requireAdmin(req(STAFF_KEY), "quiz"))?.status).toBe(401);
    staffRow = null;
    expect((await requireAdmin(req("lcs_nobody"), "quiz"))?.status).toBe(401);
  });

  it("fails closed for staff if the staff list cannot be read, but the owner still gets in", async () => {
    lookupError = { message: "relation admin_staff does not exist" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await requireAdmin(req(STAFF_KEY), "quiz"))?.status).toBe(503);
    expect(await requireAdmin(req(OWNER), "quiz")).toBeNull();
  });

  it("records last-used at most every few minutes", async () => {
    await requireAdmin(req(STAFF_KEY), "quiz");
    expect(touched).toEqual(["s1"]);
    touched.length = 0;
    staffRow!.last_used_at = new Date().toISOString();
    await requireAdmin(req(STAFF_KEY), "quiz");
    expect(touched).toHaveLength(0);
  });

  it("a staff key cannot manage staff, the owner can", async () => {
    staffRow!.sections = ["scoring", "questions", "speaking-club", "mock-test", "quiz"];
    const asStaff = await listStaff(req(STAFF_KEY));
    expect(asStaff.status).toBe(403);
    const asOwner = await listStaff(req(OWNER));
    expect(asOwner.status).toBe(200);
  });
});
