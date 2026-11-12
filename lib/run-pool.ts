// lib/run-pool.ts
//
// Runs `handle` over `items` with at most `concurrency` in flight at once,
// starting items in order. Used by the feedback worker so several Gemini calls
// can overlap inside one cron run.
//
// - `shouldStop(item)` is checked before each item is STARTED (never mid-flight): when it
//   returns true the item is handed to `onSkipped` instead (e.g. "release the row").
// - A throwing `handle` never abandons the rest: callers do their own bookkeeping.
export async function runPool<T>(
  items: T[],
  concurrency: number,
  handle: (item: T) => Promise<void>,
  opts: { shouldStop?: (item: T) => boolean; onSkipped?: (item: T) => Promise<void> } = {},
): Promise<void> {
  const lanes = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      try {
        if (opts.shouldStop?.(item)) await opts.onSkipped?.(item);
        else await handle(item);
      } catch {
        // handled (and logged) by the caller; keep going with the remaining items
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
}
