import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const generate = vi.fn();
const waitUntil = vi.fn();
let unauthorized: Response | null = null;

vi.mock("@/lib/mistake-quiz-generator", () => ({ generateMistakeReviewQuiz: () => generate() }));
vi.mock("@/lib/admin-auth", () => ({ requireCron: () => unauthorized }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => waitUntil(p) }));

import { GET } from "@/app/api/cron/mistake-quiz-generator/route";

const req = (qs = "") => new NextRequest(`http://localhost/api/cron/mistake-quiz-generator${qs}`);

describe("mistake-quiz-generator cron route", () => {
  beforeEach(() => {
    generate.mockReset();
    waitUntil.mockReset();
    unauthorized = null;
  });

  it("answers 202 straight away and builds the quiz in the background", async () => {
    let finish!: (v: unknown) => void;
    generate.mockReturnValue(new Promise((r) => (finish = r)));
    const res = await GET(req()); // resolves although the quiz is still being built
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, started: true });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    finish({ generated: true });
    await waitUntil.mock.calls[0][0];
  });

  it("a failed background run does not crash the route", async () => {
    generate.mockRejectedValue(new Error("gemini down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req());
    expect(res.status).toBe(202);
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });

  it("?wait=1 runs in the foreground and returns the result", async () => {
    generate.mockResolvedValue({ generated: true, mistakesAnalyzed: 12 });
    const res = await GET(req("?wait=1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, generated: true, mistakesAnalyzed: 12 });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("rejects a request without the cron secret before doing any work", async () => {
    unauthorized = new Response("no", { status: 401 });
    generate.mockResolvedValue({});
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
