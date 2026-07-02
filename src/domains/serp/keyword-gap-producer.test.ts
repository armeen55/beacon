import { describe, it, expect, vi } from "vitest";
import {
  produceKeywordGaps,
  MAX_GAP_COMPETITORS,
  MAX_GAP_RUN_COST_USD,
  type ProduceKeywordGapsDeps,
} from "./keyword-gap-producer";
import { LABS_COST_USD, type LabsRunResult, type LabsRunStatus } from "./dataforseo-labs";
import type { KeywordGapRow } from "./keyword-gaps";

const labsResult = (status: LabsRunStatus, rows: KeywordGapRow[] = [], costUsd = 0): LabsRunResult => ({
  status,
  plan: { endpoint: "labs", cacheKey: "k", estCostUsd: LABS_COST_USD },
  rows,
  costUsd,
  detail: status,
});

const row = (keyword: string, domain: string, over: Partial<KeywordGapRow> = {}): KeywordGapRow => ({
  keyword,
  volume: 1200,
  competitorDomain: domain,
  competitorRank: 4,
  ownRank: null,
  cpcUsd: null,
  source: "ranked_keywords",
  ...over,
});

/** A graph with 5 distinct competitor domains (only the top 3 may be checked). */
const GRAPH = {
  moves: [
    { competitorUrls: ["https://a-comp.com/1", "https://b-comp.com/1", "https://c-comp.com/1"] },
    { competitorUrls: ["https://a-comp.com/2", "https://b-comp.com/2", "https://d-comp.com/1"] },
    { competitorUrls: ["https://a-comp.com/3", "https://c-comp.com/2", "https://e-comp.com/1"] },
  ],
  pageNodes: [
    { url: "https://iranopedia.com/x", isOwned: true },
    { url: "https://iranopedia.com/y", isOwned: true },
    { url: "https://a-comp.com/1", isOwned: false },
  ],
};

// Keyword fixtures deliberately avoid the competitor's own brand token (the pure
// math drops brand keywords as unwinnable, which keyword-gaps.test.ts pins).
const uniqueTopic = (d: string) => `unique topic ${d.charAt(0)}`;
const gapTopic = (d: string) => `gap topic ${d.charAt(0)}`;

function deps(over: Partial<ProduceKeywordGapsDeps> = {}): Partial<ProduceKeywordGapsDeps> {
  return {
    now: () => new Date("2026-07-02T00:00:00Z"),
    loadGraph: async () => GRAPH,
    loadOwnedQueries: async () => [],
    runRanked: vi.fn(async (d: string) => labsResult("ok", [row(uniqueTopic(d), d)], LABS_COST_USD)),
    runIntersection: vi.fn(async (d: string) => labsResult("ok", [row(gapTopic(d), d, { source: "domain_intersection" })], LABS_COST_USD)),
    writeResults: vi.fn(async () => {}),
    ...over,
  };
}

describe("produceKeywordGaps - the bounded batch", () => {
  it("hard ceiling: at most top-3 competitors x 2 calls, spend <= the documented max", async () => {
    const d = deps();
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("ok");
    expect(r.competitors).toHaveLength(MAX_GAP_COMPETITORS);
    expect(r.competitors).toEqual(["a-comp.com", "b-comp.com", "c-comp.com"]); // most-cited first
    expect(r.calls).toHaveLength(MAX_GAP_COMPETITORS * 2);
    expect(r.spentUsd).toBeLessThanOrEqual(MAX_GAP_RUN_COST_USD);
    expect(MAX_GAP_RUN_COST_USD).toBeLessThan(1); // the ~$1 per-run promise
    expect(vi.mocked(d.runRanked!)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(d.runIntersection!)).toHaveBeenCalledTimes(3);
    // intersection is called against the derived own domain
    expect(vi.mocked(d.runIntersection!).mock.calls[0][1]).toBe("iranopedia.com");
  });

  it("DRY-RUN: returns the priced plan (competitors + calls + estimate), spends nothing, persists nothing", async () => {
    const d = deps({
      runRanked: vi.fn(async () => labsResult("dry_run")),
      runIntersection: vi.fn(async () => labsResult("dry_run")),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("dry_run");
    expect(r.spentUsd).toBe(0);
    expect(r.plannedUsd).toBeCloseTo(6 * LABS_COST_USD, 5);
    expect(r.message).toContain("I spent nothing");
    expect(r.message).toContain("a-comp.com");
    expect(r.message).toContain("$0.66");
    expect(d.writeResults).not.toHaveBeenCalled();
  });

  it("cache-served re-run: $0 spend, gaps still computed + persisted, receipt says cache", async () => {
    const d = deps({
      runRanked: vi.fn(async (dom: string) => labsResult("cache_hit", [row(uniqueTopic(dom), dom)])),
      runIntersection: vi.fn(async (dom: string) => labsResult("cache_hit", [row(gapTopic(dom), dom)])),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("ok");
    expect(r.spentUsd).toBe(0);
    expect(r.cacheHits).toBe(6);
    expect(r.gapsFound).toBeGreaterThan(0);
    expect(r.message).toContain("$0.00");
    expect(r.message).toContain("30 day cache");
    expect(d.writeResults).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(d.writeResults!).mock.calls[0][0];
    expect(persisted.tenant_id).toBe("tenant-iranopedia");
    expect(persisted.spent_usd).toBe(0);
    expect(persisted.gaps.length).toBe(r.gapsFound);
  });

  it("live run persists results + reports the real spend in the receipt", async () => {
    const d = deps();
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.spentUsd).toBeCloseTo(0.66, 2);
    expect(r.message).toContain("$0.66");
    expect(r.message).toContain("keywords they win that you do not");
    expect(d.writeResults).toHaveBeenCalledTimes(1);
  });

  it("no competitor evidence -> no_competitors, no calls, honest next step", async () => {
    const d = deps({ loadGraph: async () => ({ moves: [], pageNodes: [] }) });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("no_competitors");
    expect(r.calls).toHaveLength(0);
    expect(d.runRanked).not.toHaveBeenCalled();
    expect(r.message).toContain("run this again");
  });

  it("connector off -> disabled receipt", async () => {
    const d = deps({
      runRanked: vi.fn(async () => labsResult("disabled")),
      runIntersection: vi.fn(async () => labsResult("disabled")),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("disabled");
    expect(r.message).toContain("not connected");
  });

  it("cap reached mid-run -> capped receipt, never over-spends", async () => {
    const d = deps({
      runRanked: vi.fn(async () => labsResult("capped")),
      runIntersection: vi.fn(async () => labsResult("capped")),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("capped");
    expect(r.spentUsd).toBe(0);
    expect(r.message).toContain("budget");
  });

  it("GSC-known top-10 keywords are dropped from the final gap list", async () => {
    const d = deps({
      loadOwnedQueries: async () => [{ query: uniqueTopic("a-comp.com"), position: 4 }],
      runIntersection: vi.fn(async () => labsResult("ok", [], LABS_COST_USD)),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("ok");
    const keywords = r.gaps.map((g) => g.keyword);
    expect(keywords).not.toContain(uniqueTopic("a-comp.com")); // GSC says rank 4 -> not a gap
    expect(keywords).toContain(uniqueTopic("b-comp.com")); // untouched peers survive
  });

  it("receipts NEVER contain em/en dashes (hard rule)", async () => {
    const variants: Array<Partial<ProduceKeywordGapsDeps>> = [
      deps(),
      deps({ runRanked: vi.fn(async () => labsResult("dry_run")), runIntersection: vi.fn(async () => labsResult("dry_run")) }),
      deps({ runRanked: vi.fn(async () => labsResult("disabled")), runIntersection: vi.fn(async () => labsResult("disabled")) }),
      deps({ runRanked: vi.fn(async () => labsResult("capped")), runIntersection: vi.fn(async () => labsResult("capped")) }),
      deps({ runRanked: vi.fn(async () => labsResult("error")), runIntersection: vi.fn(async () => labsResult("error")) }),
      deps({ loadGraph: async () => null }),
    ];
    for (const d of variants) {
      const r = await produceKeywordGaps("tenant-iranopedia", d);
      expect(/[–—]/.test(r.message)).toBe(false);
      for (const g of r.gaps) expect(/[–—]/.test(g.evidence)).toBe(false);
    }
  });
});
