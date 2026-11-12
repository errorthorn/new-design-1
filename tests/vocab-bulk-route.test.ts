// The "paste from AI" save route, run against a real (in-memory) SQLite database.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { NextRequest } from "next/server";
import { VOCAB_SAMPLE_BLOCK, parseVocabText } from "@/lib/vocab-import";

let db: Client;
vi.mock("@/lib/db", () => ({ getDb: async () => db }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => null }));

import { POST } from "@/app/api/admin/vocab-words/bulk/route";

const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/admin/vocab-words/bulk", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeAll(async () => {
  db = createClient({ url: ":memory:" });
  await db.execute(`CREATE TABLE vocab_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT NOT NULL, pronunciation TEXT, part_of_speech TEXT, meaning_en TEXT NOT NULL,
    synonym_1 TEXT, synonym_2 TEXT, example_1_en TEXT, example_1_bn TEXT, example_2_en TEXT, example_2_bn TEXT,
    daily_date TEXT, topic TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
});

describe("POST /api/admin/vocab-words/bulk", () => {
  it("saves what the paste box parsed, every field in its own column", async () => {
    const parsed = parseVocabText(`Topic: Travel\nDate: 2026-11-02\n\n${VOCAB_SAMPLE_BLOCK}`);
    const res = await post({ words: parsed.items.map((i) => i.draft), dailyDate: parsed.date, topic: parsed.topic });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: 1 });
    const row = (await db.execute("SELECT * FROM vocab_words")).rows[0];
    expect(row).toMatchObject({
      word: "ameliorate",
      pronunciation: "/əˈmiːliəreɪt/",
      part_of_speech: "verb",
      meaning_en: "to make a bad situation better",
      synonym_1: "improve",
      synonym_2: "enhance",
      example_1_bn: "নতুন নীতি শহরের জীবনযাত্রার মান উন্নত করতে সাহায্য করেছে।",
      daily_date: "2026-11-02",
      topic: "Travel",
    });
  });

  it("writes nothing when any word is unusable (all or nothing)", async () => {
    const before = (await db.execute("SELECT COUNT(*) AS n FROM vocab_words")).rows[0].n;
    const res = await post({ words: [{ word: "ok", meaningEn: "fine" }, { word: "no meaning" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Word number 2");
    expect((await db.execute("SELECT COUNT(*) AS n FROM vocab_words")).rows[0].n).toBe(before);
  });

  it("rejects an empty list, a bad date and too many words", async () => {
    expect((await post({ words: [] })).status).toBe(400);
    expect((await post({ words: [{ word: "a", meaningEn: "b" }], dailyDate: "02-11-2026" })).status).toBe(400);
    expect((await post({ words: Array.from({ length: 201 }, () => ({ word: "a", meaningEn: "b" })) })).status).toBe(400);
  });

  it("without a date the words join the general pool", async () => {
    await post({ words: [{ word: "pool", meaningEn: "a group" }] });
    const row = (await db.execute("SELECT daily_date, topic FROM vocab_words WHERE word = 'pool'")).rows[0];
    expect(row.daily_date).toBeNull();
    expect(row.topic).toBeNull();
  });
});
