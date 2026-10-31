import { describe, expect, it } from "vitest";
import { sessionMeta } from "./helpers";
import {
  deleteSegment,
  deleteSession,
  floatToInt16,
  int16ToFloat,
  listSessions,
  loadSegments,
  saveSegment,
  saveSession,
} from "@/lib/speaking-club/storage/segment-store";

describe("segment store (IndexedDB)", () => {
  it("stores, orders, deletes segments and whole sessions", async () => {
    await saveSession(sessionMeta("s1", { status: "capturing" }));
    for (let i = 0; i < 12; i++) await saveSegment("s1", i, Int16Array.from([i, i + 1]));
    await saveSegment("s2", 0, Int16Array.from([9]));
    await deleteSegment("s1", 3);

    const segs = await loadSegments("s1");
    expect(segs.map((s) => s[0])).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]); // chronological, #3 gone
    expect((await listSessions()).map((s) => s.sessionId)).toContain("s1");

    await deleteSession("s1");
    expect(await loadSegments("s1")).toHaveLength(0);
    expect(await loadSegments("s2")).toHaveLength(1); // other sessions untouched
    expect((await listSessions()).map((s) => s.sessionId)).not.toContain("s1");
  });
});

describe("16-bit conversion", () => {
  it("round-trips audio with negligible error", () => {
    const f = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const back = int16ToFloat(floatToInt16(f));
    f.forEach((v, i) => expect(Math.abs(v - back[i])).toBeLessThan(0.0001));
  });
});
