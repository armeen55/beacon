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
    // Item 60 deps - explicit no-op stubs so unit tests never touch real I/O.
    readCachedDifficulty: vi.fn(async () => new Map()),
    readTeardownCache: vi.fn(async () => new Map()),
    auditPage: vi.fn(async () => ({ fetchStatus: "fetch_failed" as const, facts: null })),
    writeBriefs: vi.fn(async () => {}),
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

describe("produceKeywordGaps - item 60 clone-and-beat briefs", () => {
  // Rows WITH a ranking URL so money-page aggregation has something to find.
  const rowWithUrl = (keyword: string, domain: string, url: string, over: Partial<KeywordGapRow> = {}): KeywordGapRow => ({
    keyword,
    volume: 1200,
    competitorDomain: domain,
    competitorRank: 3,
    ownRank: null,
    cpcUsd: null,
    source: "ranked_keywords",
    rankingUrl: url,
    ...over,
  });

  it("finds money pages from the SAME rows and builds bounded briefs (no extra Labs calls)", async () => {
    const d = deps({
      runRanked: vi.fn(async (dom: string) => labsResult("ok", [rowWithUrl(uniqueTopic(dom), dom, `https://${dom}/money-page`)], LABS_COST_USD)),
      auditPage: vi.fn(async () => ({ fetchStatus: "ok" as const, facts: null })),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("ok");
    expect(r.moneyPagesFound).toBeGreaterThan(0);
    expect(r.cloneBriefs.length).toBeGreaterThan(0);
    expect(r.cloneBriefs.length).toBeLessThanOrEqual(5); // MAX_BRIEF_TEARDOWNS
    // no NEW Labs calls beyond the same 6 (3 competitors x 2 endpoints) - the
    // teardown rides the polite fetcher, not another paid Labs call.
    expect(r.calls).toHaveLength(6);
    expect(vi.mocked(d.writeBriefs!)).toHaveBeenCalledTimes(1);
    expect(r.message).toContain("clone-and-beat brief");
  });

  it("reuses a fresh cached teardown instead of fetching again", async () => {
    const auditPage = vi.fn(async () => ({ fetchStatus: "ok" as const, facts: null }));
    const d = deps({
      runRanked: vi.fn(async (dom: string) => labsResult("ok", [rowWithUrl(uniqueTopic(dom), dom, `https://${dom}/money-page`)], LABS_COST_USD)),
      readTeardownCache: vi.fn(async () => new Map([
        ["https://a-comp.com/money-page", { fetchStatus: "ok" as const, facts: null, auditedAt: "2026-07-01T00:00:00Z" }],
      ])),
      auditPage,
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("ok");
    // a-comp.com's page came from the fresh cache - never re-fetched.
    expect(auditPage).not.toHaveBeenCalledWith("https://a-comp.com/money-page");
  });

  it("labels gaps with a cached winnability verdict when the cache has one", async () => {
    const d = deps({
      readCachedDifficulty: vi.fn(async () => new Map([[uniqueTopic("a-comp.com"), 95]])),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    const labeled = r.gaps.find((g) => g.keyword === uniqueTopic("a-comp.com"));
    expect(labeled?.winnability?.band).toBe("reject");
    // an un-cached gap stays honestly unlabeled, never silently rejected.
    const unlabeled = r.gaps.find((g) => g.keyword === uniqueTopic("b-comp.com"));
    expect(unlabeled?.winnability).toBeNull();
  });

  it("never drops a gap because it is unwinnable - labeling only", async () => {
    const d = deps({
      readCachedDifficulty: vi.fn(async () => new Map([[uniqueTopic("a-comp.com"), 99]])),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.gaps.some((g) => g.keyword === uniqueTopic("a-comp.com"))).toBe(true);
  });

  it("a brief-build failure never drops the gaps (fail-soft)", async () => {
    const d = deps({
      runRanked: vi.fn(async (dom: string) => labsResult("ok", [rowWithUrl(uniqueTopic(dom), dom, `https://${dom}/money-page`)], LABS_COST_USD)),
      readTeardownCache: vi.fn(async () => {
        throw new Error("store down");
      }),
      auditPage: vi.fn(async () => {
        throw new Error("fetch exploded");
      }),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.status).toBe("ok");
    expect(r.gapsFound).toBeGreaterThan(0);
    // teardown fetch failures degrade the brief to "not_read", never throw.
    expect(r.cloneBriefs.every((b) => b.teardownStatus === "not_read")).toBe(true);
  });

  it("no money pages (no rankingUrl on any row) -> zero briefs, gaps unaffected", async () => {
    const d = deps(); // default fixture rows carry no rankingUrl
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(r.moneyPagesFound).toBe(0);
    expect(r.cloneBriefs).toEqual([]);
    expect(vi.mocked(d.writeBriefs!)).not.toHaveBeenCalled();
    expect(r.gapsFound).toBeGreaterThan(0);
  });

  it("brief summaries and receipts NEVER contain an em or en dash", async () => {
    const d = deps({
      runRanked: vi.fn(async (dom: string) => labsResult("ok", [rowWithUrl(uniqueTopic(dom), dom, `https://${dom}/money-page`)], LABS_COST_USD)),
      auditPage: vi.fn(async () => ({ fetchStatus: "ok" as const, facts: null })),
    });
    const r = await produceKeywordGaps("tenant-iranopedia", d);
    expect(/[–—]/.test(r.message)).toBe(false);
    for (const b of r.cloneBriefs) {
      expect(/[–—]/.test(b.summary)).toBe(false);
      if (b.buildPointer) expect(/[–—]/.test(b.buildPointer.reason)).toBe(false);
    }
  });
});
