import { describe, expect, it } from "vitest";
import { runPool } from "@/lib/run-pool";
import { sleep } from "./helpers";

describe("runPool (feedback worker concurrency)", () => {
  it("never has more than `concurrency` items in flight, and handles all of them", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(10);
      inFlight--;
      done.push(n);
    });
    expect(maxInFlight).toBe(3);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("with concurrency 1 it is strictly sequential and in order", async () => {
    const order: number[] = [];
    await runPool([1, 2, 3], 1, async (n) => {
      await sleep(5 - n);
      order.push(n);
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it("hands items to onSkipped (never starts them) once shouldStop turns true", async () => {
    const handled: number[] = [];
    const skipped: number[] = [];
    await runPool(
      [1, 2, 3, 4, 5, 6],
      2,
      async (n) => {
        handled.push(n);
        await sleep(10);
      },
      { shouldStop: () => handled.length >= 3, onSkipped: async (n) => void skipped.push(n) },
    );
    expect(handled.length + skipped.length).toBe(6);
    expect(skipped.length).toBeGreaterThan(0);
    expect(handled.some((n) => skipped.includes(n))).toBe(false);
  });

  it("a failing item does not abandon the rest", async () => {
    const done: number[] = [];
    await runPool([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      done.push(n);
    });
    expect(done.sort()).toEqual([1, 3]);
  });

  it("copes with an empty list and nonsense concurrency", async () => {
    await runPool([], 4, async () => {});
    const done: number[] = [];
    await runPool([1, 2], Number.NaN, async (n) => void done.push(n));
    expect(done).toEqual([1, 2]);
  });
});
