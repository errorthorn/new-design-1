import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Admin access by ACCOUNT (docs/ADMIN-ACCESS.md).
//
// Part 1 checks the server rules: a signed-in account the owner linked is let in only for the
// sections it was given, matched by user id (never by a typed email), and everything else fails closed.
// Part 2 is a guard against the feature quietly disappearing in a later edit or zip: it checks that
// the pieces that make "Admin" show up in the profile menu are all still in the code.
// ---------------------------------------------------------------------------

type StaffRow = { id: string; name: string; sections: string[]; active: boolean; last_used_at: string | null };

let currentUser: { id: number | string; email: string } | null = null;
let staffByUserId: Record<string, StaffRow> = {};
let lookupError: { message: string } | null = null;
const eqCalls: [string, string][] = [];

vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => currentUser }));
vi.mock("@/lib/supabase", () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => {
          eqCalls.push([col, val]);
          return {
            maybeSingle: async () => ({
              data: lookupError ? null : col === "user_id" ? (staffByUserId[val] ?? null) : null,
              error: lookupError,
            }),
          };
        },
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

import { requireAdmin } from "@/lib/admin-auth";

const req = () => new NextRequest("http://localhost/api/admin/anything");
const staff = (over: Partial<StaffRow> = {}): StaffRow => ({
  id: "s1",
  name: "Rafi",
  sections: ["scoring", "quiz"],
  active: true,
  last_used_at: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  currentUser = null;
  staffByUserId = {};
  lookupError = null;
  eqCalls.length = 0;
  process.env.ADMIN_SECRET = "owner-secret";
});

describe("requireAdmin — signed-in staff account (no key)", () => {
  it("rejects when nobody is signed in", async () => {
    const res = await requireAdmin(req(), "scoring");
    expect(res?.status).toBe(401);
  });

  it("rejects a signed-in member who is not staff", async () => {
    currentUser = { id: 7, email: "member@x.com" };
    const res = await requireAdmin(req(), "scoring");
    expect(res?.status).toBe(401);
  });

  it("lets a linked account into a section it was given", async () => {
    currentUser = { id: 42, email: "rafi@x.com" };
    staffByUserId["42"] = staff();
    expect(await requireAdmin(req(), "scoring")).toBeNull();
    expect(await requireAdmin(req(), "quiz")).toBeNull();
  });

  it("matches the account by user id, not by email", async () => {
    currentUser = { id: 42, email: "rafi@x.com" };
    staffByUserId["42"] = staff();
    await requireAdmin(req(), "scoring");
    expect(eqCalls[0]).toEqual(["user_id", "42"]);
  });

  it("refuses a section that was not given (403)", async () => {
    currentUser = { id: 42, email: "rafi@x.com" };
    staffByUserId["42"] = staff();
    const res = await requireAdmin(req(), "speaking-club");
    expect(res?.status).toBe(403);
  });

  it("keeps owner-only routes (no section) closed to staff accounts", async () => {
    currentUser = { id: 42, email: "rafi@x.com" };
    staffByUserId["42"] = staff({ sections: ["scoring", "questions", "speaking-club", "mock-test", "quiz"] });
    const res = await requireAdmin(req());
    expect(res?.status).toBe(403);
  });

  it("rejects a staff account that was turned off", async () => {
    currentUser = { id: 42, email: "rafi@x.com" };
    staffByUserId["42"] = staff({ active: false });
    const res = await requireAdmin(req(), "scoring");
    expect(res?.status).toBe(401);
  });

  it("fails closed when the staff list cannot be read", async () => {
    currentUser = { id: 42, email: "rafi@x.com" };
    lookupError = { message: "column user_id does not exist" };
    const res = await requireAdmin(req(), "scoring");
    expect(res?.status).toBe(503);
  });

  it("still lets the owner key through", async () => {
    const r = new NextRequest("http://localhost/api/admin/anything", { headers: { "x-admin-secret": "owner-secret" } });
    expect(await requireAdmin(r)).toBeNull();
  });

  it("an empty key header falls back to the signed-in account", async () => {
    currentUser = { id: 42, email: "rafi@x.com" };
    staffByUserId["42"] = staff();
    const r = new NextRequest("http://localhost/api/admin/anything", { headers: { "x-admin-secret": "" } });
    expect(await requireAdmin(r, "scoring")).toBeNull();
  });
});

// ---- Part 2: the feature must stay wired up -------------------------------
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const exists = (p: string) => fs.existsSync(path.resolve(__dirname, "..", p));

describe("admin access stays wired up (guards against it disappearing)", () => {
  it("has the server pieces", () => {
    expect(exists("app/api/admin/me/route.ts")).toBe(true);
    expect(exists("hooks/use-admin-access.ts")).toBe(true);
    expect(exists("sql/migrations/2026-10-29-admin-staff-accounts.sql")).toBe(true);
    expect(read("lib/admin-auth.ts")).toContain("findSessionStaff");
    expect(read("app/api/admin/staff/route.ts")).toContain("user_id");
  });

  it("shows an Admin option in the website profile menu (desktop and mobile)", () => {
    const nav = read("components/navbar.tsx");
    expect(nav).toContain("useAdminAccess");
    expect((nav.match(/href="\/admin"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("shows an Admin entry in the dashboard (sidebar and avatar menu)", () => {
    const shell = read("components/dashboard/dashboard-shell.tsx");
    expect(shell).toContain("useAdminAccess");
    expect((shell.match(/href="\/admin"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("has the /admin home page", () => {
    expect(exists("app/admin/page.tsx")).toBe(true);
  });

  it("lets staff open each section page without a key", () => {
    for (const s of ["scoring", "questions", "speaking-club", "mock-test", "quiz"]) {
      const page = read(`app/admin/${s}/page.tsx`);
      expect(page, s).toContain(`useAdminSession("${s}")`);
    }
  });

  it("keeps the shared admin frame and a search box on every staff section", () => {
    expect(exists("components/admin/admin-shell.tsx")).toBe(true);
    expect(exists("components/admin/ui.tsx")).toBe(true);
    for (const s of ["scoring", "questions", "speaking-club", "mock-test", "quiz"]) {
      const page = read(`app/admin/${s}/page.tsx`);
      expect(page, `${s} shell`).toContain("<AdminShell");
      expect(page, `${s} search`).toContain("<SearchBox");
    }
  });
});
