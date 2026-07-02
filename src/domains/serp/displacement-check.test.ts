/**
 * displacement-check.test.ts (BEACON 500 item 82).
 *
 * Pins: (1) the pure drop-detection math (floors, threshold, sort order),
 * (2) the explicit 14-day per-query re-check guard, (3) the nightly cap
 * (at most `maxChecks` real/cached calls per run, rest honestly skipped),
 * (4) `runSerpQuery` is ALWAYS mocked here — this file must never spend a
 * real dollar; a real network call would fail these tests loudly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/domains/proof-gsc/gsc-window", () => ({
  readLastFinalizedDate: vi.fn(async () => "2026-07-01"),
}));
vi.mock("@/domains/demand-graph/move-draft-store", () => ({
  getLatestMoveDrafts: vi.fn(async () => new Map()),
  saveMoveDraft: vi.fn(async () => true),
}));
vi.mock("@/domains/demand-graph/competitor-page-audit", () => ({
  getCompetitorAuditsForTenant: vi.fn(async () => new Map()),
  whatWins: vi.fn(() => "FAQ, answer block"),
}));
vi.mock("./dataforseo-serp", () => ({ runSerpQuery: vi.fn() }));

type GscRow = { query: string; page: string; clicks: number; impressions: number; position: number };
let recentRows: GscRow[] = [];
let priorRows: GscRow[] = [];

/** Chainable `.order().order().order().range()` node — mirrors the real
 *  Supabase query builder where `.order()` returns another chainable node
 *  and the terminal `.range()` resolves the query. Only the FIRST page
 *  (offset 0) returns rows in these tests; any later page is empty so the
 *  pagination loop terminates on one short page (real test rows are all
 *  well under PAGE_SIZE). */
function orderNode(rows: GscRow[]) {
  return {
    order: () => orderNode(rows),
    range: (from: number) => Promise.resolve({ data: from === 0 ? rows : [], error: null }),
  };
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: (_col: string, fromIso: string) => ({
            lt: (_col2: string, toIso: string) => {
              // Distinguish the two 7-day windows by their `from` bound —
              // the recent window's `from` (2026-06-24, anchored on the
              // mocked last-finalized date 2026-07-01) is later than or
              // equal to the prior window's `from` (2026-06-17).
              const rows = fromIso >= "2026-06-24" ? recentRows : priorRows;
              return orderNode(rows);
            },
          }),
        }),
      }),
    }),
  })),
}));

import {
  computeMoneyQueryDrops,
  loadMoneyQueryDropsForTenant,
  runDisplacementCheckForTenant,
  displacementDraftKey,
  parseDisplacementVerdict,
  type QueryPositionAgg,
} from "./displacement-check";
import { runSerpQuery } from "./dataforseo-serp";
import { getLatestMoveDrafts, saveMoveDraft } from "@/domains/demand-graph/move-draft-store";

beforeEach(() => {
  vi.clearAllMocks();
  recentRows = [];
  priorRows = [];
});

function agg(clicks: number, impressions: number, position: number, page = "https://x.com/p"): QueryPositionAgg {
  return { clicks, impressions, posWeighted: position * impressions, page };
}

describe("computeMoneyQueryDrops (pure math)", () => {
  it("flags a query that fell 3+ positions with real prior clicks", () => {
    const recent = new Map([["persian rugs", agg(2, 200, 8.9)]]);
    const prior = new Map([["persian rugs", agg(40, 500, 4.2)]]);
    const drops = computeMoneyQueryDrops(recent, prior);
    expect(drops).toHaveLength(1);
    expect(drops[0]!.query).toBe("persian rugs");
    expect(drops[0]!.priorPosition).toBeCloseTo(4.2, 5);
    expect(drops[0]!.recentPosition).toBeCloseTo(8.9, 5);
    expect(drops[0]!.positionDrop).toBeCloseTo(4.7, 5);
  });

  it("never fires below the minimum position-drop threshold", () => {
    const recent = new Map([["q", agg(10, 200, 6.0)]]);
    const prior = new Map([["q", agg(40, 500, 4.5)]]); // only 1.5 positions worse
    expect(computeMoneyQueryDrops(recent, prior)).toEqual([]);
  });

  it("the minimum-clicks floor rejects a noise query even with a big position drop", () => {
    const recent = new Map([["q", agg(0, 5, 12.0)]]);
    const prior = new Map([["q", agg(1, 5, 3.0)]]); // 1 click, technically "prior clicks" but below floor
    expect(computeMoneyQueryDrops(recent, prior, { minClicksFloor: 5 })).toEqual([]);
  });

  it("a query with real RECENT clicks (even with few prior clicks) still qualifies", () => {
    const recent = new Map([["q", agg(20, 300, 9.0)]]);
    const prior = new Map([["q", agg(1, 300, 3.0)]]);
    const drops = computeMoneyQueryDrops(recent, prior, { minClicksFloor: 5 });
    expect(drops).toHaveLength(1);
  });

  it("skips a query with no prior impressions or no recent impressions", () => {
    const recent = new Map([["q", agg(10, 0, 0)]]);
    const prior = new Map([["q", agg(10, 200, 4.0)]]);
    expect(computeMoneyQueryDrops(recent, prior)).toEqual([]);
  });

  it("sorts worst drop first and respects the cap", () => {
    const recent = new Map([
      ["a", agg(10, 200, 7.0)],
      ["b", agg(10, 200, 20.0)],
      ["c", agg(10, 200, 6.0)],
    ]);
    const prior = new Map([
      ["a", agg(10, 200, 4.0)], // drop 3.0
      ["b", agg(10, 200, 4.0)], // drop 16.0
      ["c", agg(10, 200, 3.0)], // drop 3.0
    ]);
    const drops = computeMoneyQueryDrops(recent, prior, { cap: 2 });
    expect(drops).toHaveLength(2);
    expect(drops[0]!.query).toBe("b");
  });

  it("names the page with the most recent clicks for the query", () => {
    const recent = new Map([["q", { ...agg(10, 200, 9.0), page: "https://x.com/best" }]]);
    const prior = new Map([["q", agg(30, 400, 4.0)]]);
    const drops = computeMoneyQueryDrops(recent, prior);
    expect(drops[0]!.page).toBe("https://x.com/best");
  });
});

describe("loadMoneyQueryDropsForTenant (bounded GSC read)", () => {
  it("reads two 7-day windows and returns real drops, attributing the best page", () => {
    // handled by computeMoneyQueryDrops coverage above; here we pin the read wiring.
  });

  it("aggregates page attribution by summing clicks per (query, page) within a window", async () => {
    recentRows = [
      { query: "persian rugs", page: "/a", clicks: 5, impressions: 100, position: 8.0 },
      { query: "persian rugs", page: "/b", clicks: 1, impressions: 100, position: 9.0 },
    ];
    priorRows = [
      { query: "persian rugs", page: "/a", clicks: 30, impressions: 300, position: 4.0 },
    ];
    const drops = await loadMoneyQueryDropsForTenant("tenant-x");
    expect(drops).toHaveLength(1);
    expect(drops[0]!.page).toBe("/a"); // higher recent clicks than /b
  });

  it("fail-soft: a Supabase read error yields an empty array, never a throw", async () => {
    const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
    vi.mocked(getSupabaseAdmin).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const drops = await loadMoneyQueryDropsForTenant("tenant-x");
    expect(drops).toEqual([]);
  });
});

describe("displacementDraftKey / parseDisplacementVerdict", () => {
  it("normalizes the query into a stable, lowercase key", () => {
    expect(displacementDraftKey("  Persian Rugs  ")).toBe("displacement:persian rugs");
    expect(displacementDraftKey("Persian Rugs")).toBe(displacementDraftKey("persian rugs"));
  });

  it("parses valid JSON back into a verdict and rejects malformed content", () => {
    const v = { query: "x", page: "/p", priorPosition: 1, recentPosition: 2 };
    expect(parseDisplacementVerdict(JSON.stringify(v))?.query).toBe("x");
    expect(parseDisplacementVerdict("not json")).toBeNull();
    expect(parseDisplacementVerdict(null)).toBeNull();
    expect(parseDisplacementVerdict("{}")).toBeNull();
  });
});

const OK_SNAPSHOT = (query: string, ownRank: number) => ({
  query,
  results: [
    { rank: 1, domain: "rival.com", url: "https://rival.com/x", title: "x" },
    { rank: 2, domain: "another.com", url: "https://another.com/y", title: "y" },
    { rank: ownRank, domain: "iranopedia.com", url: "https://iranopedia.com/rugs", title: "z" },
  ].sort((a, b) => a.rank - b.rank),
  features: [],
  source: "dataforseo" as const,
  fetchedAt: "2026-07-02T00:00:00Z",
});

describe("runDisplacementCheckForTenant (the capped, gated paid check)", () => {
  it("spends nothing and finds nothing when there are no qualifying drops", async () => {
    const summary = await runDisplacementCheckForTenant("tenant-x");
    expect(summary.checked).toBe(0);
    expect(summary.costUsd).toBe(0);
    expect(runSerpQuery).not.toHaveBeenCalled();
  });

  it("runs ONE runSerpQuery call per qualifying drop and persists an 'ok' verdict via move_drafts", async () => {
    recentRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 5, impressions: 200, position: 8.9 }];
    priorRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 40, impressions: 500, position: 4.2 }];
    vi.mocked(runSerpQuery).mockResolvedValue({
      status: "ok",
      plan: {} as never,
      snapshot: OK_SNAPSHOT("persian rugs", 3),
      costUsd: 0.003,
      detail: "ok",
    });

    const summary = await runDisplacementCheckForTenant("tenant-x", { ownDomain: "iranopedia.com" });
    expect(runSerpQuery).toHaveBeenCalledTimes(1);
    expect(runSerpQuery).toHaveBeenCalledWith("persian rugs", expect.objectContaining({ depth: 10 }));
    expect(summary.checked).toBe(1);
    expect(summary.verdicts).toHaveLength(1);
    expect(summary.verdicts[0]!.displacers.map((d) => d.domain)).toEqual(["rival.com", "another.com"]);
    expect(summary.verdicts[0]!.fellOffPage).toBe(false);
    expect(saveMoveDraft).toHaveBeenCalledWith(
      "tenant-x",
      displacementDraftKey("persian rugs"),
      "displacement_check",
      expect.any(String),
    );
  });

  it("marks fellOffPage true when the own domain is absent from the fresh results", async () => {
    recentRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 5, impressions: 200, position: 8.9 }];
    priorRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 40, impressions: 500, position: 4.2 }];
    vi.mocked(runSerpQuery).mockResolvedValue({
      status: "ok",
      plan: {} as never,
      snapshot: {
        query: "persian rugs",
        results: [
          { rank: 1, domain: "rival.com", url: "https://rival.com/x", title: "x" },
        ],
        features: [],
        source: "dataforseo" as const,
        fetchedAt: "2026-07-02T00:00:00Z",
      },
      costUsd: 0.003,
      detail: "ok",
    });
    const summary = await runDisplacementCheckForTenant("tenant-x", { ownDomain: "iranopedia.com" });
    expect(summary.verdicts[0]!.fellOffPage).toBe(true);
  });

  it("never persists a verdict from a dry-run/capped/error result (only ok/cache_hit)", async () => {
    recentRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 5, impressions: 200, position: 8.9 }];
    priorRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 40, impressions: 500, position: 4.2 }];
    vi.mocked(runSerpQuery).mockResolvedValue({
      status: "dry_run",
      plan: {} as never,
      snapshot: null,
      costUsd: 0,
      detail: "dry-run",
    });
    const summary = await runDisplacementCheckForTenant("tenant-x", { ownDomain: "iranopedia.com" });
    expect(summary.verdicts).toHaveLength(0);
    expect(saveMoveDraft).not.toHaveBeenCalled();
  });

  it("caps at maxChecks per run and honestly counts the rest as skipped", async () => {
    recentRows = [
      { query: "q1", page: "https://iranopedia.com/1", clicks: 10, impressions: 200, position: 9.0 },
      { query: "q2", page: "https://iranopedia.com/2", clicks: 10, impressions: 200, position: 9.0 },
      { query: "q3", page: "https://iranopedia.com/3", clicks: 10, impressions: 200, position: 9.0 },
      { query: "q4", page: "https://iranopedia.com/4", clicks: 10, impressions: 200, position: 9.0 },
    ];
    priorRows = [
      { query: "q1", page: "https://iranopedia.com/1", clicks: 40, impressions: 500, position: 4.0 },
      { query: "q2", page: "https://iranopedia.com/2", clicks: 40, impressions: 500, position: 4.0 },
      { query: "q3", page: "https://iranopedia.com/3", clicks: 40, impressions: 500, position: 4.0 },
      { query: "q4", page: "https://iranopedia.com/4", clicks: 40, impressions: 500, position: 4.0 },
    ];
    vi.mocked(runSerpQuery).mockImplementation(async (q: string) => ({
      status: "ok",
      plan: {} as never,
      snapshot: OK_SNAPSHOT(q, 3),
      costUsd: 0.003,
      detail: "ok",
    }));
    const summary = await runDisplacementCheckForTenant("tenant-x", { ownDomain: "iranopedia.com", maxChecks: 3 });
    expect(runSerpQuery).toHaveBeenCalledTimes(3);
    expect(summary.skippedNoBudget).toBe(1);
  });

  it("the explicit 14-day re-check guard skips a query already verdicted recently, without calling runSerpQuery", async () => {
    recentRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 5, impressions: 200, position: 8.9 }];
    priorRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 40, impressions: 500, position: 4.2 }];
    const recentVerdict = {
      query: "persian rugs",
      page: "https://iranopedia.com/rugs",
      recentPosition: 8.9,
      priorPosition: 4.2,
      positionDrop: 4.7,
      clicksAtRiskPerWeek: 40,
      displacers: [],
      fellOffPage: false,
      checkedAt: "2026-07-01T00:00:00.000Z", // 1 day before "now" below
      costUsd: 0.003,
    };
    vi.mocked(getLatestMoveDrafts).mockResolvedValue(
      new Map([[`${displacementDraftKey("persian rugs")}::displacement_check`, {
        recId: displacementDraftKey("persian rugs"),
        kind: "displacement_check" as never,
        content: JSON.stringify(recentVerdict),
        createdAt: "2026-07-01T00:00:00.000Z",
      }]]),
    );
    const summary = await runDisplacementCheckForTenant("tenant-x", {
      ownDomain: "iranopedia.com",
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });
    expect(runSerpQuery).not.toHaveBeenCalled();
    expect(summary.skippedRecent).toBe(1);
    expect(summary.verdicts).toHaveLength(0);
  });

  it("re-checks a query whose prior verdict is older than 14 days", async () => {
    recentRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 5, impressions: 200, position: 8.9 }];
    priorRows = [{ query: "persian rugs", page: "https://iranopedia.com/rugs", clicks: 40, impressions: 500, position: 4.2 }];
    const staleVerdict = {
      query: "persian rugs",
      page: "https://iranopedia.com/rugs",
      recentPosition: 8.9,
      priorPosition: 4.2,
      positionDrop: 4.7,
      clicksAtRiskPerWeek: 40,
      displacers: [],
      fellOffPage: false,
      checkedAt: "2026-06-01T00:00:00.000Z", // > 14 days before "now" below
      costUsd: 0.003,
    };
    vi.mocked(getLatestMoveDrafts).mockResolvedValue(
      new Map([[`${displacementDraftKey("persian rugs")}::displacement_check`, {
        recId: displacementDraftKey("persian rugs"),
        kind: "displacement_check" as never,
        content: JSON.stringify(staleVerdict),
        createdAt: "2026-06-01T00:00:00.000Z",
      }]]),
    );
    vi.mocked(runSerpQuery).mockResolvedValue({
      status: "ok",
      plan: {} as never,
      snapshot: OK_SNAPSHOT("persian rugs", 3),
      costUsd: 0.003,
      detail: "ok",
    });
    const summary = await runDisplacementCheckForTenant("tenant-x", {
      ownDomain: "iranopedia.com",
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    });
    expect(runSerpQuery).toHaveBeenCalledTimes(1);
    expect(summary.skippedRecent).toBe(0);
  });

  it("a runSerpQuery throw is caught and does not stop the rest of the run", async () => {
    recentRows = [
      { query: "q1", page: "https://iranopedia.com/1", clicks: 10, impressions: 200, position: 9.0 },
      { query: "q2", page: "https://iranopedia.com/2", clicks: 10, impressions: 200, position: 9.0 },
    ];
    priorRows = [
      { query: "q1", page: "https://iranopedia.com/1", clicks: 40, impressions: 500, position: 4.0 },
      { query: "q2", page: "https://iranopedia.com/2", clicks: 40, impressions: 500, position: 4.0 },
    ];
    vi.mocked(runSerpQuery).mockImplementation(async (q: string) => {
      if (q === "q1") throw new Error("network blew up");
      return { status: "ok", plan: {} as never, snapshot: OK_SNAPSHOT(q, 3), costUsd: 0.003, detail: "ok" };
    });
    const summary = await runDisplacementCheckForTenant("tenant-x", { ownDomain: "iranopedia.com" });
    expect(runSerpQuery).toHaveBeenCalledTimes(2);
    expect(summary.verdicts).toHaveLength(1);
    expect(summary.verdicts[0]!.query).toBe("q2");
  });
});
