import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * permutation-null (2026-07-02, master plan item 37) - the null distribution
 * builder + percentile math that qualifies a treated GSC lift against every
 * untreated page with adequate traffic, sharing the treated window's exact
 * dates so the comparison is fair (same market weather).
 */

import {
  buildPermutationNull,
  percentileOf,
  hasEnoughNullPages,
  permutationSentence,
  permutationSentenceFromCounts,
  MAX_NULL_PAGES,
  MIN_NULL_PAGES,
  type PermutationNull,
} from "./permutation-null";
import type { GscWindowMetrics } from "./measure";
import type { PageSurgeonContext } from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";

const M = (clicks: number, impressions = 1000): GscWindowMetrics => ({
  clicks,
  impressions,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position: 5,
});

function ctxWith(pages: Record<string, number>): PageSurgeonContext {
  const gscByUrl = new Map<string, { impressions90d: number }>();
  const snapshotByCanon = new Map<string, { url: string }>();
  for (const [url, impr] of Object.entries(pages)) {
    gscByUrl.set(url, { impressions90d: impr });
    snapshotByCanon.set(url, { url });
  }
  return { gscByUrl, snapshotByCanon } as unknown as PageSurgeonContext;
}

/** Build a fake readWindowForPages that returns the SAME per-page metrics for
 *  every call whose end == the given pre or post boundary. Keyed by page. */
function fakeReadWindow(opts: {
  shipDate: string;
  pre: Record<string, GscWindowMetrics>;
  post: Record<string, GscWindowMetrics>;
}) {
  return async (args: { pages: readonly string[]; start: string; end: string }) => {
    const out = new Map<string, GscWindowMetrics>();
    const isPost = args.start === opts.shipDate;
    for (const p of args.pages) {
      out.set(p, (isPost ? opts.post[p] : opts.pre[p]) ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 });
    }
    return out;
  };
}

describe("buildPermutationNull - candidate selection + window sharing", () => {
  const shipDate = "2026-06-01";

  it("shares the EXACT treated window (same shipDate, same day length) for every candidate", async () => {
    const calls: Array<{ start: string; end: string }> = [];
    const readWindow = async (args: { pages: readonly string[]; start: string; end: string }) => {
      calls.push({ start: args.start, end: args.end });
      return new Map(args.pages.map((p) => [p, M(10)]));
    };
    await buildPermutationNull(
      { tenantId: "t1", shipDate, windowDays: 7 },
      {
        loadContext: async () => ctxWith({ "https://x.com/a": 5000, "https://x.com/b": 4000 }),
        loadLedger: async () => [],
        readWindow: readWindow as any,
      },
    );
    // Pre call: [shipDate-28d, shipDate); post call: [shipDate, shipDate+7d).
    expect(calls).toContainEqual({ start: "2026-05-04", end: shipDate });
    expect(calls).toContainEqual({ start: shipDate, end: "2026-06-08" });
  });

  it("excludes ledger-reserved paths and caller-supplied excludePaths", async () => {
    const result = await buildPermutationNull(
      { tenantId: "t1", shipDate, windowDays: 7, excludePaths: new Set(["/treated"]) },
      {
        loadContext: async () =>
          ctxWith({
            "https://x.com/treated": 9000,
            "https://x.com/ledger-control": 8000,
            "https://x.com/clean-a": 5000,
            "https://x.com/clean-b": 4000,
          }),
        loadLedger: async () => [{ path: "/other-treated", controlPages: ["https://x.com/ledger-control"] }],
        readWindow: fakeReadWindow({
          shipDate,
          pre: {
            "https://x.com/clean-a": M(10),
            "https://x.com/clean-b": M(10),
          },
          post: {
            "https://x.com/clean-a": M(12),
            "https://x.com/clean-b": M(9),
          },
        }) as any,
      },
    );
    const pages = result.pages.map((p) => p.page);
    expect(pages).not.toContain("https://x.com/treated");
    expect(pages).not.toContain("https://x.com/ledger-control");
    expect(pages).toContain("https://x.com/clean-a");
    expect(pages).toContain("https://x.com/clean-b");
  });

  it("is bounded to maxPages (defaults to MAX_NULL_PAGES)", async () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 100; i++) many[`https://x.com/p${i}`] = 1000 + i;
    const preAll: Record<string, GscWindowMetrics> = {};
    const postAll: Record<string, GscWindowMetrics> = {};
    for (const url of Object.keys(many)) {
      preAll[url] = M(10);
      postAll[url] = M(10);
    }
    const result = await buildPermutationNull(
      { tenantId: "t1", shipDate, windowDays: 7 },
      {
        loadContext: async () => ctxWith(many),
        loadLedger: async () => [],
        readWindow: fakeReadWindow({ shipDate, pre: preAll, post: postAll }) as any,
      },
    );
    expect(result.pages.length).toBeLessThanOrEqual(MAX_NULL_PAGES);
  });

  it("drops candidates with no real pre-window presence (can't form a fair delta)", async () => {
    const result = await buildPermutationNull(
      { tenantId: "t1", shipDate, windowDays: 7 },
      {
        loadContext: async () => ctxWith({ "https://x.com/a": 5000, "https://x.com/zero-pre": 5000 }),
        loadLedger: async () => [],
        readWindow: fakeReadWindow({
          shipDate,
          pre: { "https://x.com/a": M(10), "https://x.com/zero-pre": M(0, 0) },
          post: { "https://x.com/a": M(12), "https://x.com/zero-pre": M(5) },
        }) as any,
      },
    );
    expect(result.pages.map((p) => p.page)).not.toContain("https://x.com/zero-pre");
  });

  it("is fail-soft: a thrown context load returns an empty null, never throws", async () => {
    const result = await buildPermutationNull(
      { tenantId: "t1", shipDate, windowDays: 7 },
      {
        loadContext: async () => {
          throw new Error("supabase down");
        },
      },
    );
    expect(result.pages).toEqual([]);
  });

  it("returns empty when there is no tenantId or shipDate", async () => {
    expect((await buildPermutationNull({ tenantId: "", shipDate, windowDays: 7 })).pages).toEqual([]);
    expect((await buildPermutationNull({ tenantId: "t1", shipDate: "", windowDays: 7 })).pages).toEqual([]);
  });

  it("computes a leave-one-out pseudo-lift per page (own delta minus mean of the others)", async () => {
    const result = await buildPermutationNull(
      { tenantId: "t1", shipDate, windowDays: 7, preWindowDays: 7 }, // scale 1:1 for simple arithmetic
      {
        loadContext: async () =>
          ctxWith({ "https://x.com/a": 5000, "https://x.com/b": 4000, "https://x.com/c": 3000 }),
        loadLedger: async () => [],
        readWindow: fakeReadWindow({
          shipDate,
          pre: {
            "https://x.com/a": M(10),
            "https://x.com/b": M(10),
            "https://x.com/c": M(10),
          },
          post: {
            "https://x.com/a": M(20), // delta +10
            "https://x.com/b": M(10), // delta 0
            "https://x.com/c": M(10), // delta 0
          },
        }) as any,
      },
    );
    const a = result.pages.find((p) => p.page === "https://x.com/a")!;
    // a's pseudoLift = 10 - mean(0, 0) = 10
    expect(a.delta).toBe(10);
    expect(a.pseudoLift).toBe(10);
    const b = result.pages.find((p) => p.page === "https://x.com/b")!;
    // b's pseudoLift = 0 - mean(10, 0) = -5
    expect(b.pseudoLift).toBe(-5);
  });
});

describe("percentileOf - empirical two-sided percentile", () => {
  function nullOf(pseudoLifts: number[]): PermutationNull {
    return {
      pages: pseudoLifts.map((pseudoLift, i) => ({ page: `p${i}`, delta: pseudoLift, pseudoLift })),
      shipDate: "2026-06-01",
      windowDays: 7,
    };
  }

  it("counts pages whose |pseudoLift| >= |treated lift|", () => {
    const dist = nullOf([1, 2, 3, 20, -25, 4, 5]);
    const { percentile, nGreater, nTotal } = percentileOf(15, dist);
    expect(nTotal).toBe(7);
    expect(nGreater).toBe(2); // 20 and -25
    expect(percentile).toBeCloseTo(2 / 7, 6);
  });

  it("returns percentile 1 (no evidence) on an empty null", () => {
    const dist = nullOf([]);
    expect(percentileOf(15, dist)).toEqual({ percentile: 1, nGreater: 0, nTotal: 0 });
  });

  it("is magnitude-based (a large negative treated lift compares on absolute value)", () => {
    const dist = nullOf([1, 2, 3]);
    const { nGreater } = percentileOf(-10, dist);
    expect(nGreater).toBe(0);
  });

  it("zero-lift synthetic distribution: everything counts (percentile 1)", () => {
    const dist = nullOf([0, 0, 0, 0]);
    const { percentile } = percentileOf(0, dist);
    expect(percentile).toBe(1);
  });
});

describe("hasEnoughNullPages - the MIN_NULL_PAGES gate", () => {
  it("is false below MIN_NULL_PAGES, true at or above it", () => {
    const under: PermutationNull = {
      pages: Array.from({ length: MIN_NULL_PAGES - 1 }, (_, i) => ({ page: `p${i}`, delta: 0, pseudoLift: 0 })),
      shipDate: "2026-06-01",
      windowDays: 7,
    };
    const at: PermutationNull = {
      pages: Array.from({ length: MIN_NULL_PAGES }, (_, i) => ({ page: `p${i}`, delta: 0, pseudoLift: 0 })),
      shipDate: "2026-06-01",
      windowDays: 7,
    };
    expect(hasEnoughNullPages(under)).toBe(false);
    expect(hasEnoughNullPages(at)).toBe(true);
  });
});

describe("permutationSentence - plain English, no jargon, honest thin-sample skip", () => {
  function nullOf(n: number, greaterCount: number): PermutationNull {
    const pages = Array.from({ length: n }, (_, i) => ({
      page: `p${i}`,
      delta: i < greaterCount ? 999 : 0,
      pseudoLift: i < greaterCount ? 999 : 0,
    }));
    return { pages, shipDate: "2026-06-01", windowDays: 7 };
  }

  it("returns null when the null distribution is too thin (< MIN_NULL_PAGES)", () => {
    expect(permutationSentence(10, nullOf(MIN_NULL_PAGES - 1, 0))).toBeNull();
  });

  it("names the exact counts for a strong (low-percentile) read", () => {
    const s = permutationSentence(10, nullOf(61, 2));
    expect(s).toBe(
      "Out of 61 untouched pages, only 2 moved as much as this one did. That is strong evidence the change caused it.",
    );
  });

  it("uses singular phrasing for exactly one comparable page", () => {
    const s = permutationSentence(10, nullOf(40, 1));
    expect(s).toContain("only 1 moved as much as this one did");
  });

  it("uses none phrasing when zero untouched pages moved as much", () => {
    const s = permutationSentence(10, nullOf(30, 0));
    expect(s).toContain("none moved as much as this one did");
  });

  it("gives the honest weak read when many untouched pages move this much on their own", () => {
    const s = permutationSentence(10, nullOf(40, 20));
    expect(s).toContain("I would not call this strong evidence yet");
  });

  it("never contains lab jargon (placebo, permutation, p-value)", () => {
    const strong = permutationSentence(10, nullOf(61, 2))!;
    const weak = permutationSentence(10, nullOf(40, 20))!;
    for (const s of [strong, weak]) {
      expect(s.toLowerCase()).not.toContain("placebo");
      expect(s.toLowerCase()).not.toContain("permutation");
      expect(s.toLowerCase()).not.toContain("p-value");
      expect(s.toLowerCase()).not.toContain("null distribution");
    }
  });
});

describe("permutationSentenceFromCounts - the presentation-layer function (Results row)", () => {
  it("returns null when nTotal is 0 (no comparison pool)", () => {
    expect(permutationSentenceFromCounts(0, 0)).toBeNull();
  });

  it("agrees exactly with permutationSentence for the same counts (single source of truth)", () => {
    const fromCounts = permutationSentenceFromCounts(2, 61);
    const fromDist = permutationSentence(10, {
      pages: Array.from({ length: 61 }, (_, i) => ({ page: `p${i}`, delta: i < 2 ? 999 : 0, pseudoLift: i < 2 ? 999 : 0 })),
      shipDate: "2026-06-01",
      windowDays: 7,
    });
    expect(fromCounts).toBe(fromDist);
  });

  it("is what run-measurement attaches as permutationRead: {nGreater, nTotal} round-trips", () => {
    // The exact fixture named in the task: "Out of 61 untouched pages, only 2 moved..."
    const s = permutationSentenceFromCounts(2, 61);
    expect(s).toBe(
      "Out of 61 untouched pages, only 2 moved as much as this one did. That is strong evidence the change caused it.",
    );
  });
});

describe("dash guard (hard rule)", () => {
  it("permutation-null.ts contains no em or en dashes", () => {
    const src = readFileSync(resolve(__dirname, "permutation-null.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });

  it("no sentence produced by permutationSentence contains an em or en dash", () => {
    const dist: PermutationNull = {
      pages: Array.from({ length: 61 }, (_, i) => ({ page: `p${i}`, delta: i < 2 ? 999 : 0, pseudoLift: i < 2 ? 999 : 0 })),
      shipDate: "2026-06-01",
      windowDays: 7,
    };
    const s = permutationSentence(10, dist)!;
    expect(s).not.toMatch(/[–—]/);
  });
});
