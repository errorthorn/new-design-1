import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock test slot picker stays wired up (same idea as the "stays wired up" part
// of tests/admin-access.test.ts): the two-step picker (day -> time -> Confirm)
// must not silently go back to the old "book on the first tap" picker, and it
// must still be what the mock-test session page shows. It checks the source
// files, not the browser, so it only catches the feature being removed or
// rewired, not visual changes.
// ---------------------------------------------------------------------------

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, "..", p), "utf8");
const exists = (p: string) => fs.existsSync(path.resolve(__dirname, "..", p));

describe("mock test slot picker stays wired up", () => {
  const picker = () => read("app/mock-test/session/slot-picker.tsx");

  it("has the picker component and the slot routes", () => {
    expect(exists("app/mock-test/session/slot-picker.tsx")).toBe(true);
    expect(picker()).toContain("export function SlotPicker");
    expect(exists("app/api/mock-test/slot/route.ts")).toBe(true);
    expect(exists("app/api/mock-test/slot/options/route.ts")).toBe(true);
    expect(exists("app/api/admin/mock-test-slot-settings/route.ts")).toBe(true);
  });

  it("is what the session page shows, and booking goes through the confirm callback", () => {
    const page = read("app/mock-test/session/page.tsx");
    expect(page).toContain('import { SlotPicker } from "./slot-picker"');
    expect(page).toMatch(/<SlotPicker[\s\S]*?onConfirm=\{chooseSlot\}/);
  });

  it("books only from the Confirm button, never from tapping a day or a time", () => {
    const src = picker();
    // onConfirm is called exactly once in the whole file...
    expect((src.match(/onConfirm\(/g) ?? []).length).toBe(1);
    // ...and that call sits in the confirm button's onClick, guarded by a selected slot.
    expect(src).toMatch(/onClick=\{\(\) => selected && onConfirm\(selected\.slotStart\)\}/);
  });

  it("keeps the Saturday-first week and the Morning / Afternoon / Evening groups", () => {
    const src = picker();
    expect(src).toContain('const WEEKDAYS = ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"]');
    for (const id of ["morning", "afternoon", "evening"]) expect(src).toContain(`id: "${id}"`);
  });

  it("keeps the admin slot settings on the mock-test admin page", () => {
    const admin = read("app/admin/mock-test/page.tsx");
    expect(admin).toContain("/api/admin/mock-test-slot-settings");
    expect(admin).toContain("capacity_per_slot");
    expect(admin).toContain("slot_minutes");
  });
});
