import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FRESH_TAIL_MAX_DAYS,
  FRESH_TAIL_NOTE,
  buildFreshTailPoints,
  freshTailWindow,
} from "./fresh-tail";
import { GSC_FINAL_LAG_DAYS } from "./ingestion-gaps";

const BANNED_DASH = /[‒–—―]/;

describe("freshTailWindow (the settling window the fresh read may cover)", () => {
  it("spans the day after the last reported day through today", () => {
    // Last final day Jun 28, today Jul 1 -> window Jun 29..Jul 1 (3 days).
    expect(freshTailWindow("2026-06-28", "2026-07-01")).toEqual({
      start: "2026-06-29",
      end: "2026-07-01",
    });
  });

  it("is null when there is no reported history yet (nothing to settle against)", () => {
    expect(freshTailWindow(null, "2026-07-01")).toBeNull();
  });

  it("is null when the chart is already current (no gap or a future edge)", () => {
    expect(freshTailWindow("2026-07-01", "2026-07-01")).toBeNull();
    expect(freshTailWindow("2026-07-02", "2026-07-01")).toBeNull();
  });

  it("is null when the gap is wider than the lag window (a sync hole, not settling)", () => {
    // FRESH_TAIL_MAX_DAYS = lag + 1 = 4. A 5-day gap is a sync problem.
    expect(FRESH_TAIL_MAX_DAYS).toBe(GSC_FINAL_LAG_DAYS + 1);
    expect(freshTailWindow("2026-06-26", "2026-07-01")).toBeNull(); // 5-day gap
    // Exactly at the cap still renders (4-day gap).
    expect(freshTailWindow("2026-06-27", "2026-07-01")).toEqual({
      start: "2026-06-28",
      end: "2026-07-01",
    });
  });

  it("is null on an unparseable reported date instead of inventing a window", () => {
    expect(freshTailWindow("not-a-date", "2026-07-01")).toBeNull();
  });
});

describe("buildFreshTailPoints (Google's early counts, always labeled settling)", () => {
  const window = { start: "2026-06-29", end: "2026-07-01" };

  it("maps date-keyed rows in the window to ascending settling points", () => {
    const points = buildFreshTailPoints(
      [
        { keys: ["2026-07-01"], clicks: 12 },
        { keys: ["2026-06-29"], clicks: 30 },
        { keys: ["2026-06-30"], clicks: 21 },
      ],
      window,
    );
    expect(points.map((p) => p.date)).toEqual(["2026-06-29", "2026-06-30", "2026-07-01"]);
    expect(points.map((p) => p.clicks)).toEqual([30, 21, 12]);
    // THE INVIOLABLE RULE: every point is marked as an early, non-final count.
    expect(points.every((p) => p.settling === true)).toBe(true);
  });

  it("drops rows outside the window and never invents a missing day as zero", () => {
    const points = buildFreshTailPoints(
      [
        { keys: ["2026-06-28"], clicks: 99 }, // before window
        { keys: ["2026-06-30"], clicks: 21 }, // in window
        { keys: ["2026-07-05"], clicks: 5 }, // after window
      ],
      window,
    );
    // Only the in-window day survives; Jun 29 and Jul 1 are simply absent, not zero.
    expect(points).toEqual([{ date: "2026-06-30", clicks: 21, settling: true }]);
  });

  it("ignores malformed keys and floors negative clicks at zero", () => {
    const points = buildFreshTailPoints(
      [
        { keys: [], clicks: 5 },
        { keys: ["garbage"], clicks: 5 },
        { keys: ["2026-06-30"], clicks: -4 },
      ],
      window,
    );
    expect(points).toEqual([{ date: "2026-06-30", clicks: 0, settling: true }]);
  });

  it("is empty-safe: no rows means no points (the chart renders exactly as before)", () => {
    expect(buildFreshTailPoints([], window)).toEqual([]);
  });
});

describe("FRESH_TAIL_NOTE (the one honest label the chart shows)", () => {
  it("names the early count and the settling period, dash-clean, no lab words", () => {
    expect(FRESH_TAIL_NOTE).toContain("early count");
    expect(FRESH_TAIL_NOTE).toContain("3 days");
    expect(BANNED_DASH.test(FRESH_TAIL_NOTE)).toBe(false);
    expect(FRESH_TAIL_NOTE).not.toMatch(/dataState|SERP|final|impressions/i);
  });
});

describe("THE INVIOLABLE RULE: the loader never touches the final daily tables", () => {
  const LOADER_SOURCE = readFileSync(resolve(__dirname, "./load-fresh-tail.ts"), "utf8");

  it("load-fresh-tail.ts never references gsc_daily_rows / gsc_daily_totals or an is_final flag", () => {
    expect(LOADER_SOURCE).not.toMatch(/gsc_daily_rows/);
    expect(LOADER_SOURCE).not.toMatch(/gsc_daily_totals/);
    expect(LOADER_SOURCE).not.toMatch(/is_final/);
  });

  it("its only persistence write is the volatile fresh-tail cache store", () => {
    // Every writeStore CALL SITE (not the import) targets the fresh-tail store,
    // never a daily one. `writeStore<` / `writeStore(` distinguishes a call
    // from the `import { ..., writeStore }` line.
    const writes = LOADER_SOURCE.match(/writeStore[<(][^;]*;/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) {
      expect(w).toContain("GSC_FRESH_TAIL_STORE");
    }
  });

  it("the fresh pull reads Google's EARLY numbers (dataState all), not final", () => {
    expect(LOADER_SOURCE).toContain('dataState: "all"');
  });
});
