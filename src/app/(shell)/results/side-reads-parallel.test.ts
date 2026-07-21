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
 *
 * AMPUTATION P3 L2 (2026-07-21): the batch is no longer awaited as ONE bundle. The
 * loader returns INDEPENDENT per-field promise handles, so the answer-first strip
 * (which reads only `shockWindows`) resolves the instant that fast field settles
 * instead of blocking on the slowest read (contamination). The third pin below locks
 * that decoupling property directly.
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

  it("ANSWER-FIRST: the fast shockWindows handle resolves without waiting on a wedged contamination handle", async () => {
    vi.useFakeTimers();
    // Model the decoupled handles the loader now returns: each field is its OWN
    // promise, started eagerly and independently awaitable. shockWindows is a fast
    // read; contamination is wedged (only its deadline can settle it).
    const handles = {
      shockWindows: valueWithDeadline(Promise.resolve(["shock"]), ["fallback"], DEADLINE),
      contaminationById: valueWithDeadline(
        new Promise<Map<string, string>>(() => {}),
        new Map<string, string>(),
        DEADLINE,
      ),
    };

    // The answer-first strip awaits ONLY shockWindows. It must resolve on microtasks
    // alone - NO timer advance, so the wedged contamination read is provably still
    // pending when the answer is ready. Under the old single-Promise.all bundle this
    // await would have blocked a full DEADLINE on contamination.
    await expect(handles.shockWindows).resolves.toEqual(["shock"]);

    let contaminationSettled = false;
    void handles.contaminationById.then(() => {
      contaminationSettled = true;
    });
    await Promise.resolve();
    expect(contaminationSettled).toBe(false);

    // And the slow field still settles fail-soft to its fallback at its own deadline.
    await vi.advanceTimersByTimeAsync(DEADLINE + 1);
    await expect(handles.contaminationById).resolves.toEqual(new Map());
  });
});
