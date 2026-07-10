/**
 * /results side-read waterfall fix (W2-B, 2026-07-10).
 *
 * The page's seven page-level side-reads (spark, control-spark, changepoints,
 * external events, seasonal inflection, recrawl clock, control contamination) plus
 * the batched owned-alignment read run as ONE `Promise.all` of
 * `valueWithDeadline(...)` calls - the exact shape used in
 * src/app/(shell)/results/page.tsx. These pins lock the two properties that shape
 * guarantees, using the REAL valueWithDeadline + fake timers:
 *
 *   1) ORDER-INDEPENDENCE: every loader is invoked synchronously when the array is
 *      built, so all reads START concurrently - a wedged read in the middle never
 *      stops the ones after it from starting.
 *   2) NO SERIALIZATION: several wedged reads all time out to their fallback within
 *      ONE deadline window (advancing time by ONE deadline settles the whole batch),
 *      not one-deadline-per-read as a sequential await chain would require.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { valueWithDeadline } from "@/lib/load-with-deadline";

const DEADLINE = 15_000;

afterEach(() => {
  vi.useRealTimers();
});

describe("/results side-read batch (Promise.all of valueWithDeadline)", () => {
  it("starts every read concurrently and one wedged read does not serialize the rest", async () => {
    vi.useFakeTimers();
    const started: string[] = [];
    const fast = <T,>(name: string, value: T): Promise<T> => {
      started.push(name);
      return Promise.resolve(value);
    };
    // A wedged read: it is INVOKED (records start) but never resolves; only its
    // deadline can settle it.
    const wedged = (name: string): Promise<string> => {
      started.push(name);
      return new Promise<string>(() => {});
    };

    const batch = Promise.all([
      valueWithDeadline(fast("spark", "S"), "fallbackS", DEADLINE),
      valueWithDeadline(fast("controlSpark", "CS"), "fallbackCS", DEADLINE),
      valueWithDeadline(wedged("changepoints"), "fallbackCP", DEADLINE),
      valueWithDeadline(fast("events", "E"), "fallbackE", DEADLINE),
      valueWithDeadline(fast("seasonal", "SE"), "fallbackSE", DEADLINE),
      valueWithDeadline(wedged("recrawl"), "fallbackRC", DEADLINE),
      valueWithDeadline(wedged("contamination"), "fallbackCT", DEADLINE),
      valueWithDeadline(fast("alignment", "AL"), "fallbackAL", DEADLINE),
    ]);

    // ORDER-INDEPENDENCE: all eight readers were invoked at array-build time, before
    // any await - even the two wedged reads before the later fast ones.
    expect(started).toEqual([
      "spark",
      "controlSpark",
      "changepoints",
      "events",
      "seasonal",
      "recrawl",
      "contamination",
      "alignment",
    ]);

    // NO SERIALIZATION: advancing time by ONE deadline settles ALL THREE wedged
    // reads at once (their timers were armed concurrently). A sequential await chain
    // would have armed only the first wedged read's timer, so the batch would still
    // be pending here.
    await vi.advanceTimersByTimeAsync(DEADLINE + 1);
    const out = await batch;

    expect(out).toEqual(["S", "CS", "fallbackCP", "E", "SE", "fallbackRC", "fallbackCT", "AL"]);
  });

  it("fast reads resolve without waiting on the deadline at all", async () => {
    vi.useFakeTimers();
    const batch = Promise.all([
      valueWithDeadline(Promise.resolve("A"), "fa", DEADLINE),
      valueWithDeadline(Promise.resolve("B"), "fb", DEADLINE),
    ]);
    // No timer advance: pure-fast batch settles on microtasks alone.
    await expect(batch).resolves.toEqual(["A", "B"]);
  });
});
