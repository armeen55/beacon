/**
 * consolidation-golden-pins (Core 100K lane P, 2026-07-21).
 *
 * Byte-for-byte behavior pins captured BEFORE the proof-gsc consolidation
 * (readers unified, reliability extras merged) and required to stay green
 * AFTER it. Every snapshot below is the module output on a representative
 * fixture, covering won / lost / too-early / quarantined verdict paths and
 * every reader's shaping, window, and fail-soft semantics. Only the import
 * lines in this file may change during the consolidation; the fixtures and
 * snapshots must not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Row = {
  page?: string;
  query?: string;
  clicks?: number;
  impressions?: number;
  position?: number;
};

const windowRows = new Map<string, Row[]>();
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
let rpcRows: Array<{ page: string; clicks: number | string }> = [];
let throwOnRead: Error | null = null;
let hardThrowOnRead: Error | null = null;

function windowKey(start: string, end: string): string {
  return `${start}..${end}`;
}

function chainFor() {
  const state: { start?: string; end?: string } = {};
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in"]) chain[m] = vi.fn(() => chain);
  chain.gte = vi.fn((_col: string, v: string) => {
    state.start = v;
    return chain;
  });
  chain.lt = vi.fn((_col: string, v: string) => {
    state.end = v;
    return chain;
  });
  chain.range = vi.fn((from: number) => {
    if (hardThrowOnRead) return Promise.reject(hardThrowOnRead);
    if (throwOnRead) return Promise.resolve({ data: null, error: { message: throwOnRead.message } });
    if (from > 0) return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: windowRows.get(windowKey(state.start ?? "", state.end ?? "")) ?? [], error: null });
  });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from: () => chainFor(),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve({ data: rpcRows, error: null });
    },
  }),
}));

const dailySeriesByPage = new Map<string, Array<{ date: string; clicks: number }>>();
vi.mock("@/domains/recommendation-intelligence/gsc-page-queries", () => ({
  loadDailyClicksByPagesForTenant: vi.fn(async (_tenant: string, pages: string[]) => {
    const out = new Map<string, Array<{ date: string; clicks: number }>>();
    for (const p of pages) {
      const s = dailySeriesByPage.get(p);
      if (s) out.set(p, s);
    }
    return out;
  }),
}));

import {
  buildTargetQueryReads,
  targetQuerySentence,
  withWwwVariant,
  readTargetQueryWindow,
  computeQueryPanelOutcome,
  buildQueryPanelOutcome,
  type QueryPanelWindow,
  computeQueryBreadth,
  buildQueryBreadth,
} from "./gsc-query-reads";
import {
  resolveTargetQuery,
  pickWasRank,
  windowAlreadyRechecked,
  nextRecheckableWindow,
  runRankRecheck,
} from "./rank-recheck";
import { loadDailyClicksByPathsForTenant } from "./daily-series";
import {
  bayesianCtrRead,
  bayesianClicksRead,
  buildBayesianRead,
  bayesianSentence,
  bayesianAgreesWithVerdict,
  selectHeadlineSentence,
  standardNormalCdf,
  buildPermutationNull,
  percentileOf,
  hasEnoughNullPages,
  permutationSentence,
  permutationSentenceFromCounts,
  type PermutationNull,
  winPValue,
  benjaminiHochbergSignificant,
  computeFdrCautions,
  fdrCautionSentence,
  attachFdrToLedger,
  computeEquivalence,
  computeNoveltyDecay,
  computeEarlySignal,
} from "./reliability-extras";
import { gradeFromPresentation } from "./verdict-reliability";
import { addDays } from "./measure";
import type { SerpRankPoint } from "@/domains/serp/serp-history";

const PRE = { start: "2026-05-01", end: "2026-05-29" };
const POST = { start: "2026-05-29", end: "2026-06-05" };

beforeEach(() => {
  windowRows.clear();
  rpcCalls.length = 0;
  rpcRows = [];
  throwOnRead = null;
  hardThrowOnRead = null;
  dailySeriesByPage.clear();
});

describe("golden: target-query-read", () => {
  it("withWwwVariant both directions and malformed input", () => {
    expect({
      bare: withWwwVariant("https://iranopedia.com/singers"),
      www: withWwwVariant("https://www.iranopedia.com/singers"),
      malformed: withWwwVariant("not a url"),
    }).toMatchSnapshot();
  });

  it("full diff-in-diff with control, www trap, thin query, and missing query", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://www.site.com/treated", query: "persian singers", clicks: 20, impressions: 200, position: 7.9 },
      { page: "https://site.com/control", query: "persian singers", clicks: 20, impressions: 200, position: 8 },
      { page: "https://www.site.com/treated", query: "thin query", clicks: 1, impressions: 10, position: 9 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://www.site.com/treated", query: "persian singers", clicks: 32, impressions: 200, position: 6.1 },
      { page: "https://site.com/control", query: "persian singers", clicks: 22, impressions: 200, position: 7.8 },
      { page: "https://www.site.com/treated", query: "thin query", clicks: 20, impressions: 200, position: 5 },
    ]);
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: ["https://site.com/control"],
      targetQueries: ["persian singers", "thin query", "never ranked", "  ", "persian singers"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toMatchSnapshot();
  });

  it("readTargetQueryWindow folds variants onto the canonical key", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://www.site.com/a", query: "q1", clicks: 3, impressions: 30, position: 5 },
      { page: "https://site.com/a", query: "q1", clicks: 2, impressions: 20, position: 7 },
      { page: "https://site.com/a", query: "q2", clicks: 1, impressions: 10, position: 9 },
    ]);
    const out = await readTargetQueryWindow("tenant-x", ["https://site.com/a"], ["q1", "q2"], PRE.start, PRE.end);
    expect(
      [...out.entries()].map(([page, byQ]) => [page, [...byQ.entries()]]),
    ).toMatchSnapshot();
  });

  it("fail-soft: read error resolves to [] and empty inputs never read", async () => {
    throwOnRead = new Error("boom");
    const errored = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: ["q"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    throwOnRead = null;
    const noQueries = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: [],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    hardThrowOnRead = new Error("network down");
    const thrown = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: ["q"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect({ errored, noQueries, thrown }).toMatchSnapshot();
  });

  it("sentence shapes: both metrics, ctr only, decline, silence", () => {
    const both = targetQuerySentence({
      query: "persian singers",
      ctrDelta: 0.012,
      positionDelta: 1.8,
      treatedPre: { clicks: 20, impressions: 200, ctr: 0.1, position: 7.9 },
      treatedPost: { clicks: 32, impressions: 200, ctr: 0.16, position: 6.1 },
    });
    const ctrOnly = targetQuerySentence({
      query: "q",
      ctrDelta: 0.01,
      positionDelta: 0,
      treatedPre: { clicks: 20, impressions: 200, ctr: 0.1, position: 0 },
      treatedPost: { clicks: 22, impressions: 200, ctr: 0.11, position: 0 },
    });
    const down = targetQuerySentence({
      query: "q",
      ctrDelta: -0.02,
      positionDelta: 0,
      treatedPre: { clicks: 40, impressions: 200, ctr: 0.2, position: 0 },
      treatedPost: { clicks: 36, impressions: 200, ctr: 0.18, position: 0 },
    });
    const silent = targetQuerySentence({
      query: "q",
      ctrDelta: 0,
      positionDelta: 0,
      treatedPre: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      treatedPost: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    });
    expect({ both, ctrOnly, down, silent }).toMatchSnapshot();
  });
});

describe("golden: query-panel", () => {
  const win = (clicks: number, impressions: number, position = 5): QueryPanelWindow => ({
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position,
  });

  it("pure matrix: disagree both ways, agree, thin pre, thin pct", () => {
    const base = { queriesInPanel: 3, windowDays: 7, preWindowDays: 28 };
    expect({
      panelUpPageDown: computeQueryPanelOutcome({
        ...base,
        panelPre: win(40, 400),
        panelPost: win(14, 100),
        pagePreClicks: 400,
        pagePostClicks: 80,
      }),
      panelDownPageUp: computeQueryPanelOutcome({
        ...base,
        panelPre: win(80, 800),
        panelPost: win(10, 100),
        pagePreClicks: 100,
        pagePostClicks: 40,
      }),
      agree: computeQueryPanelOutcome({
        ...base,
        panelPre: win(40, 400),
        panelPost: win(14, 100),
        pagePreClicks: 100,
        pagePostClicks: 35,
      }),
      thinPre: computeQueryPanelOutcome({
        ...base,
        panelPre: win(2, 20),
        panelPost: win(50, 300),
        pagePreClicks: 100,
        pagePostClicks: 40,
      }),
      thinPct: computeQueryPanelOutcome({
        ...base,
        panelPre: win(4, 400),
        panelPost: win(9, 100),
        pagePreClicks: 100,
        pagePostClicks: 25,
      }),
      zeroQueries: computeQueryPanelOutcome({
        ...base,
        queriesInPanel: 0,
        panelPre: win(40, 400),
        panelPost: win(14, 100),
        pagePreClicks: 100,
        pagePostClicks: 25,
      }),
    }).toMatchSnapshot();
  });

  it("buildQueryPanelOutcome reads the frozen set through the shared window reader", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://www.site.com/treated", query: "a", clicks: 30, impressions: 300, position: 6 },
      { page: "https://www.site.com/treated", query: "b", clicks: 10, impressions: 100, position: 8 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://www.site.com/treated", query: "a", clicks: 14, impressions: 90, position: 5 },
      { page: "https://www.site.com/treated", query: "b", clicks: 2, impressions: 30, position: 8 },
    ]);
    const out = await buildQueryPanelOutcome({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      targetQueries: ["a", "b"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
      windowDays: 7,
      preWindowDays: 28,
      pagePreClicks: 400,
      pagePostClicks: 80,
    });
    expect(out).toMatchSnapshot();
  });
});

describe("golden: query-breadth", () => {
  it("pure matrix: broader, deeper, flat, absence", () => {
    expect({
      broader: computeQueryBreadth({ beforeQueries: 40, afterQueries: 58, beforeClicks: 100, afterClicks: 110, windowDays: 7 }),
      deeper: computeQueryBreadth({ beforeQueries: 40, afterQueries: 41, beforeClicks: 100, afterClicks: 130, windowDays: 7 }),
      flat: computeQueryBreadth({ beforeQueries: 40, afterQueries: 41, beforeClicks: 100, afterClicks: 101, windowDays: 7 }),
      absence: computeQueryBreadth({ beforeQueries: 0, afterQueries: 0, beforeClicks: 0, afterClicks: 0, windowDays: 7 }),
      singular: computeQueryBreadth({ beforeQueries: 1, afterQueries: 5, beforeClicks: 2, afterClicks: 3, windowDays: 7 }),
    }).toMatchSnapshot();
  });

  it("buildQueryBreadth counts distinct impressed queries per window (both host forms)", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://www.site.com/treated", query: "a", clicks: 3, impressions: 30 },
      { page: "https://www.site.com/treated", query: "b", clicks: 2, impressions: 20 },
      { page: "https://www.site.com/treated", query: "zero", clicks: 0, impressions: 0 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://www.site.com/treated", query: "a", clicks: 4, impressions: 30 },
      { page: "https://www.site.com/treated", query: "b", clicks: 2, impressions: 20 },
      { page: "https://www.site.com/treated", query: "c", clicks: 1, impressions: 10 },
      { page: "https://www.site.com/treated", query: "d", clicks: 1, impressions: 10 },
      { page: "https://www.site.com/treated", query: "e", clicks: 1, impressions: 10 },
    ]);
    const out = await buildQueryBreadth({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
      windowDays: 7,
    });
    expect(out).toMatchSnapshot();
  });

  it("fail-soft: a read error resolves to null", async () => {
    throwOnRead = new Error("boom");
    const out = await buildQueryBreadth({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
      windowDays: 7,
    });
    expect(out).toBeNull();
  });
});

describe("golden: rank-recheck", () => {
  const points: SerpRankPoint[] = [
    { capturedAt: "2026-06-01T10:00:00Z", ownRank: 9 } as SerpRankPoint,
    { capturedAt: "2026-06-03T10:00:00Z", ownRank: 8 } as SerpRankPoint,
  ];

  it("pure pieces: target query, was rank, idempotency, due window", () => {
    expect({
      target: resolveTargetQuery({ targetQueries: ["  ", "persian singers", "other"] }),
      noTarget: resolveTargetQuery({ targetQueries: [] }),
      was: pickWasRank(points, "2026-06-01"),
      wasNone: pickWasRank(points, "2026-06-10"),
      already: windowAlreadyRechecked(points, "2026-06-02"),
      notYet: windowAlreadyRechecked(points, "2026-06-09"),
      due: nextRecheckableWindow(
        { shippedAt: "2026-06-01", windows: [] },
        points,
        new Date("2026-06-16T00:00:00Z"),
      ),
    }).toMatchSnapshot();
  });

  it("runRankRecheck win / hold / fell-out / idempotent-skip", async () => {
    const change = { shippedAt: "2026-06-01", targetQueries: ["persian singers"], windows: [] };
    const deps = (fresh: Array<{ rank: number; domain: string; url: string }>) => ({
      now: () => new Date("2026-06-09T12:00:00Z"),
      fetchSeries: async () => points,
      fetchFresh: async () => ({ status: "ok", snapshot: { results: fresh } }),
      tenantDomain: async () => "iranopedia.com",
    });
    const win = await runRankRecheck("tenant-x", change, 7, deps([
      { rank: 4, domain: "iranopedia.com", url: "https://iranopedia.com/singers" },
    ]));
    const hold = await runRankRecheck("tenant-x", change, 7, deps([
      { rank: 9, domain: "iranopedia.com", url: "https://iranopedia.com/singers" },
    ]));
    const fellOut = await runRankRecheck("tenant-x", change, 7, deps([
      { rank: 1, domain: "other.com", url: "https://other.com/x" },
    ]));
    const idempotent = await runRankRecheck("tenant-x", change, 7, {
      ...deps([]),
      fetchSeries: async () => [
        ...points,
        { capturedAt: "2026-06-08T10:00:00Z", ownRank: 5 } as SerpRankPoint,
      ],
    });
    expect({ win, hold, fellOut, idempotent }).toMatchSnapshot();
  });
});

describe("golden: daily-series", () => {
  it("resolves ledger paths to the highest-clicks GSC page variant and keys by original path", async () => {
    rpcRows = [
      { page: "https://www.site.com/cities", clicks: 40 },
      { page: "https://site.com/cities", clicks: 10 },
      { page: "https://site.com/other", clicks: 5 },
    ];
    dailySeriesByPage.set("https://www.site.com/cities", [
      { date: "2026-06-01", clicks: 3 },
      { date: "2026-06-02", clicks: 5 },
    ]);
    const out = await loadDailyClicksByPathsForTenant("tenant-golden-a", ["/cities", "/missing"]);
    expect([...out.entries()]).toMatchSnapshot();
  });
});

describe("golden: bayesian-read", () => {
  it("ctr and clicks reads across win, loss, flat, and small-sample", () => {
    expect({
      ctrWin: bayesianCtrRead({ preClicks: 100, preImpressions: 2000, postClicks: 60, postImpressions: 700, postWindowDays: 7 }),
      ctrLoss: bayesianCtrRead({ preClicks: 200, preImpressions: 2000, postClicks: 30, postImpressions: 700, postWindowDays: 7 }),
      ctrSmall: bayesianCtrRead({ preClicks: 2, preImpressions: 20, postClicks: 3, postImpressions: 25, postWindowDays: 7 }),
      clicksWin: bayesianClicksRead({ preClicks: 280, preDays: 28, postClicks: 120, postDays: 7 }),
      clicksFlat: bayesianClicksRead({ preClicks: 280, preDays: 28, postClicks: 70, postDays: 7 }),
      clicksSmall: bayesianClicksRead({ preClicks: 3, preDays: 28, postClicks: 2, postDays: 7 }),
      routedCtr: buildBayesianRead({
        metric: "ctr",
        treatedPre: { clicks: 100, impressions: 2000 },
        treatedPost: { clicks: 60, impressions: 700 },
        preWindowDays: 28,
        postWindowDays: 7,
      }),
      routedClicks: buildBayesianRead({
        metric: "clicks",
        treatedPre: { clicks: 280, impressions: 2000 },
        treatedPost: { clicks: 120, impressions: 700 },
        preWindowDays: 28,
        postWindowDays: 7,
      }),
      routedPosition: buildBayesianRead({
        metric: "position",
        treatedPre: { clicks: 280, impressions: 2000 },
        treatedPost: { clicks: 120, impressions: 700 },
        preWindowDays: 28,
        postWindowDays: 7,
      }),
    }).toMatchSnapshot();
  });

  it("sentence bands and headline selection", () => {
    expect({
      sure: bayesianSentence(0.97, 5, 40, false),
      likely: bayesianSentence(0.8, 5, 40, false),
      hurt: bayesianSentence(0.02, -40, -5, false),
      probablyHurt: bayesianSentence(0.25, -40, 5, false),
      coinFlip: bayesianSentence(0.5, -10, 10, false),
      small: bayesianSentence(0.8, 5, 40, true),
      point: bayesianSentence(0.8, 7, 7, false),
      agreeWon: bayesianAgreesWithVerdict("won", { pWin: 0.8 }),
      disagreeWon: bayesianAgreesWithVerdict("won", { pWin: 0.6 }),
      agreeLost: bayesianAgreesWithVerdict("lost", { pWin: 0.2 }),
      neverMeasuring: bayesianAgreesWithVerdict("measuring", { pWin: 0.99 }),
      headlineUpgraded: selectHeadlineSentence("won", { pWin: 0.9, sentence: "bayes wins" }, "floor sentence"),
      headlineKept: selectHeadlineSentence("won", { pWin: 0.5, sentence: "bayes wins" }, "floor sentence"),
      headlineNoRead: selectHeadlineSentence("won", null, "floor sentence"),
      cdf: [standardNormalCdf(-2), standardNormalCdf(0), standardNormalCdf(1.6448536269514722)],
    }).toMatchSnapshot();
  });
});

describe("golden: permutation-null", () => {
  it("buildPermutationNull with injected context, ledger, and windows", async () => {
    const gscByUrl = new Map<string, { impressions90d: number }>();
    const snapshotByCanon = new Map<string, unknown>();
    for (let i = 0; i < 30; i++) {
      const url = `https://site.com/p${i}`;
      gscByUrl.set(url, { impressions90d: 10_000 - i * 10 });
      snapshotByCanon.set(url, {});
    }
    const pre = new Map<string, { clicks: number; impressions: number; ctr: number; position: number }>();
    const post = new Map<string, { clicks: number; impressions: number; ctr: number; position: number }>();
    for (let i = 0; i < 30; i++) {
      const url = `https://site.com/p${i}`;
      pre.set(url, { clicks: 100 + i, impressions: 1000, ctr: 0.1, position: 5 });
      post.set(url, { clicks: 25 + (i % 3), impressions: 250, ctr: 0.1, position: 5 });
    }
    const nullDist = await buildPermutationNull(
      {
        tenantId: "tenant-x",
        shipDate: "2026-06-01",
        windowDays: 7,
        excludePaths: new Set(["/p0"]),
      },
      {
        loadContext: async () => ({ gscByUrl, snapshotByCanon }) as never,
        loadLedger: async () => [{ path: "/p1", controlPages: ["/p2"] }],
        readWindow: async ({ start }) => (start === "2026-06-01" ? post : pre),
      },
    );
    expect({
      shipDate: nullDist.shipDate,
      windowDays: nullDist.windowDays,
      pageCount: nullDist.pages.length,
      firstFive: nullDist.pages.slice(0, 5),
      percentile: percentileOf(6, nullDist),
      enough: hasEnoughNullPages(nullDist),
      sentence: permutationSentence(6, nullDist),
    }).toMatchSnapshot();
  });

  it("sentences from counts across none, one, strong, weak, empty", () => {
    expect({
      none: permutationSentenceFromCounts(0, 40),
      one: permutationSentenceFromCounts(1, 40),
      strong: permutationSentenceFromCounts(2, 40),
      weak: permutationSentenceFromCounts(10, 40),
      empty: permutationSentenceFromCounts(0, 0),
      emptyDist: percentileOf(5, { pages: [], shipDate: "2026-06-01", windowDays: 7 } as PermutationNull),
    }).toMatchSnapshot();
  });
});

describe("golden: fdr-adjust", () => {
  it("p-values, step-up survivors, cautions, and the ledger pass", () => {
    const rows = [
      { id: "a", p: 0.001 },
      { id: "b", p: 0.02 },
      { id: "c", p: 0.09 },
      { id: "d", p: 0.5 },
    ];
    const ledger = [
      {
        id: "won-strong",
        verdict: "won",
        windows: [{ day: 28, ran: true, adjustedLift: 80 }],
        baseline: { clicks: 400, windowDays: 28 },
        permutationRead: { nGreater: 0, nTotal: 40 },
      },
      {
        id: "won-close",
        verdict: "won",
        windows: [{ day: 28, ran: true, adjustedLift: 10 }],
        baseline: { clicks: 400, windowDays: 28 },
        permutationRead: { nGreater: 3, nTotal: 40 },
      },
      {
        id: "won-immature",
        verdict: "won",
        windows: [{ day: 7, ran: true, adjustedLift: 10 }],
        baseline: { clicks: 400, windowDays: 28 },
      },
      {
        id: "lost-row",
        verdict: "lost",
        windows: [{ day: 28, ran: true, adjustedLift: -30 }],
        baseline: { clicks: 400, windowDays: 28 },
      },
    ];
    expect({
      pFromPerm: winPValue({ permutationRead: { nGreater: 2, nTotal: 40 }, adjustedLift: 30, expectedWindowClicks: 100 }),
      pFallback: winPValue({ permutationRead: null, adjustedLift: 30, expectedWindowClicks: 100 }),
      survivors: [...benjaminiHochbergSignificant(rows)].sort(),
      cautions: [...computeFdrCautions(rows).entries()],
      sentence: fdrCautionSentence(12),
      ledgerPass: attachFdrToLedger(ledger),
      singleton: attachFdrToLedger([ledger[0]]),
    }).toMatchSnapshot();
  });
});

describe("golden: equivalence", () => {
  it("proven neutral, not proven, small sample, no baseline", () => {
    expect({
      proven: computeEquivalence({ ci90Low: -6, ci90High: 4, smallSample: false, baselineMonthlyClicks: 400 }),
      notProven: computeEquivalence({ ci90Low: -6, ci90High: 25, smallSample: false, baselineMonthlyClicks: 400 }),
      tightBand: computeEquivalence({ ci90Low: -3, ci90High: 2, smallSample: false, baselineMonthlyClicks: 100 }),
      smallSample: computeEquivalence({ ci90Low: -1, ci90High: 1, smallSample: true, baselineMonthlyClicks: 400 }),
      noBaseline: computeEquivalence({ ci90Low: -1, ci90High: 1, smallSample: false, baselineMonthlyClicks: 0 }),
      allNegative: computeEquivalence({ ci90Low: -8, ci90High: -2, smallSample: false, baselineMonthlyClicks: 400 }),
    }).toMatchSnapshot();
  });
});

function series(shipDate: string, preDays: number, dailyByWeek: [number, number, number, number], baselineDaily: number) {
  const out: Array<{ date: string; clicks: number }> = [];
  const start = addDays(shipDate, -preDays);
  for (let i = 0; i < preDays; i++) out.push({ date: addDays(start, i), clicks: baselineDaily });
  for (let w = 0; w < 4; w++) {
    for (let d = 0; d < 7; d++) out.push({ date: addDays(shipDate, w * 7 + d), clicks: dailyByWeek[w] });
  }
  return out;
}

describe("golden: novelty-decay", () => {
  it("decay fired, sustained win, incomplete coverage", () => {
    expect({
      decayed: computeNoveltyDecay({
        series: series("2026-06-01", 28, [15, 12, 11, 10.5], 10),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-06-28",
      }),
      decayedToZero: computeNoveltyDecay({
        series: series("2026-06-01", 28, [16, 12, 11, 10], 10),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-06-28",
      }),
      sustained: computeNoveltyDecay({
        series: series("2026-06-01", 28, [15, 15, 15, 15], 10),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-06-28",
      }),
      windowOpen: computeNoveltyDecay({
        series: series("2026-06-01", 28, [15, 12, 11, 10.5], 10),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-06-20",
      }),
      baselineUncovered: computeNoveltyDecay({
        series: series("2026-06-01", 28, [15, 12, 11, 10.5], 10),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-20",
        lastFinalizedDate: "2026-06-28",
      }),
    }).toMatchSnapshot();
  });
});

describe("golden: early-signal", () => {
  const flatBaseline = (shipDate: string, postDaily: number[], baselineDaily = 10) => {
    const out: Array<{ date: string; clicks: number }> = [];
    const start = addDays(shipDate, -28);
    for (let i = 0; i < 28; i++) out.push({ date: addDays(start, i), clicks: baselineDaily });
    postDaily.forEach((c, i) => out.push({ date: addDays(shipDate, i), clicks: c }));
    return out;
  };

  it("decisive up, decisive down, futile, quiet, and honest absence", () => {
    expect({
      decisiveUp: computeEarlySignal({
        series: flatBaseline("2026-06-01", [25, 25, 25, 25, 25, 25, 25]),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-06-07",
      }),
      decisiveDown: computeEarlySignal({
        series: flatBaseline("2026-06-01", [0, 0, 0, 0, 0, 0, 0]),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-06-07",
      }),
      futile: computeEarlySignal({
        series: flatBaseline("2026-06-01", Array(14).fill(10)),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-06-14",
      }),
      shortRun: computeEarlySignal({
        series: flatBaseline("2026-06-01", [10, 10, 10, 10, 25, 25, 25]),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-06-07",
      }),
      noPostDays: computeEarlySignal({
        series: flatBaseline("2026-06-01", []),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-01",
        lastFinalizedDate: "2026-05-31",
      }),
      baselineUncovered: computeEarlySignal({
        series: flatBaseline("2026-06-01", [25, 25, 25, 25, 25, 25, 25]),
        shipDate: "2026-06-01",
        knownFrom: "2026-05-20",
        lastFinalizedDate: "2026-06-07",
      }),
    }).toMatchSnapshot();
  });
});

describe("golden: gradeFromPresentation (the protected verdict grade path)", () => {
  const cleanPres = {
    maturity: "mature_result",
    basisDay: 28,
    recrawlPending: false,
    controlContaminationFlagged: false,
    weakComparisonFlagged: false,
    weatherQuarantined: false,
    seasonalInflectionFlagged: false,
    attributionQuality: "clean",
  } as const;
  const deepSample = { controlsUsed: 4, baselineImpressions: 5000 };

  it("won / lost / too-early / quarantined and every extras branch", () => {
    expect({
      wonSolidNoPermutation: gradeFromPresentation(cleanPres, deepSample),
      wonSolidPermutationAgrees: gradeFromPresentation(cleanPres, deepSample, { nGreater: 1, nTotal: 40 }),
      wonShakyPermutationNoise: gradeFromPresentation(cleanPres, deepSample, { nGreater: 10, nTotal: 40 }),
      tooEarlyScheduled: gradeFromPresentation({ ...cleanPres, maturity: "scheduled", basisDay: null }, deepSample),
      tooEarlyRecrawl: gradeFromPresentation({ ...cleanPres, maturity: "collecting", basisDay: null, recrawlPending: true }, deepSample),
      tooEarlyNoCheckpoint: gradeFromPresentation({ ...cleanPres, maturity: "collecting", basisDay: null }, deepSample),
      quarantinedWeather: gradeFromPresentation({ ...cleanPres, weatherQuarantined: true }, deepSample),
      shakyContamination: gradeFromPresentation({ ...cleanPres, controlContaminationFlagged: true }, deepSample),
      shakyWeakComparison: gradeFromPresentation({ ...cleanPres, weakComparisonFlagged: true }, deepSample),
      shakySeasonal: gradeFromPresentation({ ...cleanPres, seasonalInflectionFlagged: true }, deepSample),
      shakySharedAttribution: gradeFromPresentation({ ...cleanPres, attributionQuality: "limited" as never }, deepSample),
      shakyThinSample: gradeFromPresentation(cleanPres, { controlsUsed: 1, baselineImpressions: 100 }),
      shakyInterference: gradeFromPresentation(cleanPres, deepSample, null, true),
      shakyPanelDisagrees: gradeFromPresentation(cleanPres, deepSample, null, false, { panelDisagrees: true }),
      shakyNoveltyDecay: gradeFromPresentation(cleanPres, deepSample, null, false, { noveltyDecay: true }),
      decentInterim: gradeFromPresentation({ ...cleanPres, maturity: "collecting", basisDay: 7 }, deepSample),
      decentEarlyDecisive: gradeFromPresentation({ ...cleanPres, maturity: "collecting", basisDay: 7 }, deepSample, null, false, { earlyDecisive: true }),
      decentAdequateNotDeep: gradeFromPresentation(cleanPres, { controlsUsed: 2, baselineImpressions: 500 }),
      decentFdrCaution: gradeFromPresentation(cleanPres, deepSample, null, false, { fdrCaution: true, fdrPoolSize: 12 }),
      decentFdrCautionNoPool: gradeFromPresentation(cleanPres, deepSample, null, false, { fdrCaution: true }),
      decentBehaviorContradicts: gradeFromPresentation(cleanPres, deepSample, null, false, { behaviorContradictsWin: true }),
      solidProvenNeutral: gradeFromPresentation({ ...cleanPres, maturity: "inconclusive" as never }, deepSample, null, false, { provenNeutral: true }),
      provenNeutralWrongDay: gradeFromPresentation({ ...cleanPres, maturity: "collecting", basisDay: 14 as never }, deepSample, null, false, { provenNeutral: true }),
    }).toMatchSnapshot();
  });
});
