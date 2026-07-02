/**
 * load-query-spikes mapping (2026-07-02, master plan item 14): the pure row
 * mapper the bounded loader feeds computeQuerySpikes with, plus the loader's
 * bound constants (the "never read 60d unbounded" contract).
 */
import { describe, expect, it } from "vitest";

import { normalizeSpikeRows, SPIKE_TOP_QUERIES, SPIKE_WINDOW_DAYS } from "./load-query-spikes";

describe("normalizeSpikeRows", () => {
  it("maps raw Supabase rows to the lean spike shape", () => {
    const out = normalizeSpikeRows([
      { date: "2026-06-28", query: "chaharshanbe suri", page: "https://x.com/p", clicks: 3, impressions: 40 },
    ]);
    expect(out).toEqual([
      { date: "2026-06-28", query: "chaharshanbe suri", page: "https://x.com/p", clicks: 3, impressions: 40 },
    ]);
  });

  it("coerces string numerics and null-safe pages", () => {
    const out = normalizeSpikeRows([
      { date: "2026-06-28", query: "q", page: null, clicks: "5" as unknown as number, impressions: "12" as unknown as number },
    ]);
    expect(out[0]).toMatchObject({ clicks: 5, impressions: 12, page: null });
  });

  it("slices long ISO timestamps to the day grain", () => {
    const out = normalizeSpikeRows([
      { date: "2026-06-28T00:00:00+00:00", query: "q", page: null, clicks: 0, impressions: 1 },
    ]);
    expect(out[0]!.date).toBe("2026-06-28");
  });

  it("drops rows missing a date or a query, and trims queries", () => {
    const out = normalizeSpikeRows([
      { date: "", query: "q", clicks: 1, impressions: 1 },
      { date: "2026-06-28", query: "   ", clicks: 1, impressions: 1 },
      { date: "2026-06-28", query: "  keep me  ", clicks: 1, impressions: 1 },
      { date: null, query: null, clicks: null, impressions: null },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.query).toBe("keep me");
  });

  it("defaults unusable numerics to 0 instead of NaN", () => {
    const out = normalizeSpikeRows([
      { date: "2026-06-28", query: "q", clicks: "abc" as unknown as number, impressions: undefined },
    ]);
    expect(out[0]).toMatchObject({ clicks: 0, impressions: 0 });
  });
});

describe("bound constants", () => {
  it("watches ~200 top queries over a 5-week window plus finalization headroom", () => {
    expect(SPIKE_TOP_QUERIES).toBe(200);
    expect(SPIKE_WINDOW_DAYS).toBe(42);
  });
});
