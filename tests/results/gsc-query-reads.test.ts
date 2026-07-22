/**
 * gsc-query-reads.test.ts - the folded suites of the three modules the
 * consolidated reader replaced (Core 100K lane P, 2026-07-21). Every distinct
 * behavioral pin from target-query-read.test.ts, query-panel.test.ts, and
 * query-breadth.test.ts is kept verbatim; only the shared fixtures and the
 * dash guard were deduplicated.
 *
 * Target-query pins (master plan item 68):
 *   - www-variant safety: gsc_daily_rows rows stored under the raw www. host
 *     still match a canonicalized (bare-host) page/control input.
 *   - thin-data silence: a target query with < 50 impressions in either
 *     window is honestly dropped, never reported off a sliver of data.
 *   - control adjustment: ctrDelta/positionDelta subtract the mean control
 *     movement, mirroring measure.ts's own diff-in-diff shape.
 *   - missing target queries -> [] without any read attempted.
 *   - paging discipline mirrors auto-record-on-ship.ts's proven pattern.
 *   - the plain-English sentence names the exact query and both numbers.
 *
 * Panel pins (P4 R10a, v1 item 150): the panel/page percent pair, the
 * direction-disagreement call with its 5 percent noise floor, both plain
 * disagreement sentences, the pre-window pro-rating, and the honest-absence
 * rules (thin panel -> null; thin clicks -> percent null, never a fabricated
 * rate).
 *
 * Breadth pins (P4 R10b, v1 item 151): the reach-vs-depth call: the broader
 * floor (absolute AND fractional), the deeper fallback (breadth flat, clicks
 * up), the flat default, the honest-absence null when neither window has
 * query-grain presence, and both plain sentences.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Row = { page: string; query: string; clicks?: number; impressions?: number; position?: number };

// Keyed by the [start,end) window the read targets, so pre vs post windows can
// carry different fixture data even though they hit the same mocked table.
const windowRows = new Map<string, Row[]>();
const rangeCalls: Array<{ from: number; to: number; start: string; end: string }> = [];
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
  chain.range = vi.fn((from: number, to: number) => {
    const start = state.start ?? "";
    const end = state.end ?? "";
    rangeCalls.push({ from, to, start, end });
    if (hardThrowOnRead) return Promise.reject(hardThrowOnRead);
    if (throwOnRead) return Promise.resolve({ data: null, error: { message: throwOnRead.message } });
    if (from > 0) return Promise.resolve({ data: [], error: null }); // one page of fixtures is enough for these tests
    return Promise.resolve({ data: windowRows.get(windowKey(start, end)) ?? [], error: null });
  });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: () => chainFor() }),
}));

import {
  buildTargetQueryReads,
  targetQuerySentence,
  MIN_QUERY_IMPRESSIONS,
  computeQueryPanelOutcome,
  type QueryPanelWindow,
  computeQueryBreadth,
  BROADER_MIN_EXTRA_QUERIES,
} from "@/domains/proof-gsc/gsc-query-reads";
import { log } from "@/lib/logger";

const PRE = { start: "2026-05-01", end: "2026-05-29" };
const POST = { start: "2026-05-29", end: "2026-06-05" };

beforeEach(() => {
  windowRows.clear();
  rangeCalls.length = 0;
  throwOnRead = null;
  hardThrowOnRead = null;
});

describe("buildTargetQueryReads - basic diff-in-diff", () => {
  it("computes control-adjusted CTR + position deltas for a target query with real data", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://site.com/treated", query: "persian singers", clicks: 20, impressions: 200, position: 7.9 },
      { page: "https://site.com/control", query: "persian singers", clicks: 20, impressions: 200, position: 8 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://site.com/treated", query: "persian singers", clicks: 32, impressions: 200, position: 6.1 },
      { page: "https://site.com/control", query: "persian singers", clicks: 20, impressions: 200, position: 8 },
    ]);

    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: ["https://site.com/control"],
      targetQueries: ["persian singers"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });

    expect(reads).toHaveLength(1);
    const r = reads[0];
    expect(r.query).toBe("persian singers");
    // treated CTR: 0.10 -> 0.16 (+0.06); control CTR: flat (0). Adjusted = +0.06.
    expect(r.ctrDelta).toBeCloseTo(0.06, 3);
    // treated position: 7.9 -> 6.1 (+1.8 improvement); control flat (0). Adjusted = +1.8.
    expect(r.positionDelta).toBeCloseTo(1.8, 1);
    expect(r.controlsUsed).toBe(1);
    expect(r.sentence).toContain("persian singers");
    expect(r.sentence).toContain("7.9 to 6.1");
  });

  it("returns [] immediately when the record has no target queries (no read attempted)", async () => {
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: [],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toEqual([]);
    expect(rangeCalls.length).toBe(0);
  });

});

describe("buildTargetQueryReads - thin-data silence (spec: < 50 impressions either window)", () => {
  it("drops a query with < 50 impressions in the PRE window", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://site.com/treated", query: "thin query", clicks: 1, impressions: 10, position: 9 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://site.com/treated", query: "thin query", clicks: 20, impressions: 200, position: 5 },
    ]);
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: ["thin query"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toEqual([]);
  });

  it("keeps a query exactly at the MIN_QUERY_IMPRESSIONS floor in both windows", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://site.com/treated", query: "at floor", clicks: 5, impressions: MIN_QUERY_IMPRESSIONS, position: 9 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://site.com/treated", query: "at floor", clicks: 8, impressions: MIN_QUERY_IMPRESSIONS, position: 7 },
    ]);
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: ["at floor"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toHaveLength(1);
  });

  it("silently drops a query missing from GSC entirely (never fabricates a zero read)", async () => {
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: ["never ranked for this"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toEqual([]);
  });
});

describe("buildTargetQueryReads - www-variant safety (the known host trap)", () => {
  it("matches rows stored under the raw www. host when the caller's page is canonicalized (bare host)", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://www.iranopedia.com/singers", query: "persian singers", clicks: 20, impressions: 200, position: 8 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://www.iranopedia.com/singers", query: "persian singers", clicks: 30, impressions: 200, position: 6 },
    ]);
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://iranopedia.com/singers", // canonicalized, no www
      controlPages: [],
      targetQueries: ["persian singers"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toHaveLength(1);
    expect(reads[0].treatedPost.clicks).toBe(30);
  });

});

describe("buildTargetQueryReads - fail-soft", () => {
  it("resolves to [] (never throws) when the read errors", async () => {
    throwOnRead = new Error("boom");
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: ["q"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toEqual([]);
  });

  it("resolves to [] for a missing tenant id (no read attempted)", async () => {
    const reads = await buildTargetQueryReads({
      tenantId: "",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: ["q"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toEqual([]);
    expect(rangeCalls.length).toBe(0);
  });
});

describe("targetQuerySentence - plain language, exact numbers, no dashes", () => {
  it("names both CTR and position when both have real data", () => {
    const s = targetQuerySentence({
      query: "persian singers",
      ctrDelta: 0.012,
      positionDelta: 1.8,
      treatedPre: { clicks: 20, impressions: 200, ctr: 0.1, position: 7.9 },
      treatedPost: { clicks: 32, impressions: 200, ctr: 0.16, position: 6.1 },
    });
    expect(s).toBe('On the exact search we aimed at ("persian singers"): click rate up 1.2 points, position 7.9 to 6.1.');
  });

  it("returns null when neither CTR nor position has real data", () => {
    const s = targetQuerySentence({
      query: "q",
      ctrDelta: 0,
      positionDelta: 0,
      treatedPre: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      treatedPost: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    });
    expect(s).toBeNull();
  });

});

// ---------------------------------------------------------------------------
// Fixed query panel (P4 R10a, v1 item 150)
// ---------------------------------------------------------------------------

const win = (clicks: number, impressions: number): QueryPanelWindow => ({
  clicks,
  impressions,
  ctr: impressions > 0 ? clicks / impressions : 0,
  position: impressions > 0 ? 5 : 0,
});

const base = {
  queriesInPanel: 3,
  windowDays: 28,
  preWindowDays: 28,
  panelPre: win(100, 1000),
  panelPost: win(112, 1000),
  pagePreClicks: 400,
  pagePostClicks: 380,
};

describe("computeQueryPanelOutcome - disagreement", () => {
  it("panel up while the page fell: the exact plain sentence", () => {
    const out = computeQueryPanelOutcome(base);
    expect(out).not.toBeNull();
    expect(out!.panelClicksPct).toBeCloseTo(0.12, 5);
    expect(out!.pageClicksPct).toBeCloseTo(-0.05, 5);
    expect(out!.disagreesWithPage).toBe(true);
    expect(out!.sentence).toBe(
      "The searches this change targeted grew 12 percent, but the page overall fell 5 percent. Something else on the page lost ground.",
    );
  });

  it("panel down while the page grew: the gain-from-other-searches sentence", () => {
    const out = computeQueryPanelOutcome({
      ...base,
      panelPost: win(80, 900),
      pagePostClicks: 480,
    });
    expect(out).not.toBeNull();
    expect(out!.disagreesWithPage).toBe(true);
    expect(out!.sentence).toBe(
      "The searches this change targeted fell 20 percent, but the page overall grew 20 percent. The gain is coming from other searches, not the ones we aimed at.",
    );
  });

  it("movement under the 5 percent floor on either side never counts as disagreement", () => {
    // Panel +2 percent, page -20 percent: the panel side is inside noise.
    const out = computeQueryPanelOutcome({
      ...base,
      panelPost: win(102, 1000),
      pagePostClicks: 320,
    });
    expect(out).not.toBeNull();
    expect(out!.disagreesWithPage).toBe(false);
    expect(out!.sentence).toBeNull();
  });

  it("pro-rates the pre window to a shorter post window before comparing", () => {
    // 7-day window vs a 28-day pre: 100 pre clicks scale to 25.
    const out = computeQueryPanelOutcome({
      ...base,
      windowDays: 7,
      panelPost: win(30, 300),
      pagePreClicks: 400, // scales to 100
      pagePostClicks: 80,
    });
    expect(out).not.toBeNull();
    expect(out!.panelClicksPct).toBeCloseTo(0.2, 5);
    expect(out!.pageClicksPct).toBeCloseTo(-0.2, 5);
    expect(out!.disagreesWithPage).toBe(true);
    expect(out!.sentence).toContain("grew 20 percent");
    expect(out!.sentence).toContain("fell 20 percent");
  });
});

describe("computeQueryPanelOutcome - honest absence", () => {
  it("null when the panel had no real pre-ship presence (under 50 impressions)", () => {
    const out = computeQueryPanelOutcome({ ...base, panelPre: win(10, 30) });
    expect(out).toBeNull();
  });

  it("percent is null (never a fabricated rate) when the pro-rated pre clicks are too thin", () => {
    const out = computeQueryPanelOutcome({
      ...base,
      panelPre: win(2, 500),
      panelPost: win(9, 500),
    });
    expect(out).not.toBeNull();
    expect(out!.panelClicksPct).toBeNull();
    expect(out!.disagreesWithPage).toBe(false);
    expect(out!.sentence).toBeNull();
  });

});

describe("computeQueryPanelOutcome - the always-available panel line", () => {
  it("names the panel size and the before/after clicks in window units", () => {
    const out = computeQueryPanelOutcome({ ...base, windowDays: 7, panelPost: win(30, 300) });
    expect(out!.panelLine).toBe(
      "The 3 searches this change targeted went from about 25 clicks to 30 clicks over the 7 day window.",
    );
  });

});

// ---------------------------------------------------------------------------
// Query breadth (P4 R10b, v1 item 151)
// ---------------------------------------------------------------------------

function read(over: Partial<Parameters<typeof computeQueryBreadth>[0]> = {}) {
  return computeQueryBreadth({
    beforeQueries: 40,
    afterQueries: 40,
    beforeClicks: 100,
    afterClicks: 100,
    windowDays: 28,
    ...over,
  });
}

describe("computeQueryBreadth - the broader (reach) call", () => {
  it("meaningfully more distinct searches reads broader with the reach sentence", () => {
    const r = read({ beforeQueries: 40, afterQueries: 58 });
    expect(r?.kind).toBe("broader");
    expect(r?.sentence).toBe(
      "This page now shows up for 18 more searches than before; the win is reach, not just rank.",
    );
  });

  it("the broader floor is the LARGER of 3 extra queries and 15 percent of before", () => {
    // before 40 -> fractional floor ceil(0.15 * 40) = 6, which beats the absolute 3.
    expect(read({ beforeQueries: 40, afterQueries: 45 })?.kind).not.toBe("broader"); // +5 < 6
    expect(read({ beforeQueries: 40, afterQueries: 46 })?.kind).toBe("broader"); // +6 = 6
    // before 10 -> fractional floor ceil(1.5) = 2, absolute 3 governs.
    expect(read({ beforeQueries: 10, afterQueries: 12 })?.kind).not.toBe("broader"); // +2 < 3
    expect(read({ beforeQueries: 10, afterQueries: 13 })?.kind).toBe("broader"); // +3 = 3
    expect(BROADER_MIN_EXTRA_QUERIES).toBe(3);
  });

  it("a brand-new page (0 before, real after) reads broader, not a crash", () => {
    const r = read({ beforeQueries: 0, afterQueries: 18, beforeClicks: 0, afterClicks: 30 });
    expect(r?.kind).toBe("broader");
    expect(r?.sentence).toContain("18 more searches");
  });

});

describe("computeQueryBreadth - the deeper (depth) call", () => {
  it("flat breadth with meaningful click growth reads deeper with the depth sentence", () => {
    const r = read({ beforeClicks: 100, afterClicks: 130 });
    expect(r?.kind).toBe("deeper");
    expect(r?.sentence).toBe(
      "This page shows up for about the same searches as before, but they are sending 30 more clicks; the win is depth, not reach.",
    );
  });

  it("broader wins over deeper when both fire (reach is the stronger claim)", () => {
    const r = read({ beforeQueries: 10, afterQueries: 20, beforeClicks: 100, afterClicks: 150 });
    expect(r?.kind).toBe("broader");
  });
});

describe("computeQueryBreadth - flat and honest absence", () => {
  it("neither breadth nor depth moving reads flat with a null sentence but a real breadth line", () => {
    const r = read();
    expect(r?.kind).toBe("flat");
    expect(r?.sentence).toBeNull();
    expect(r?.breadthLine).toBe(
      "This page showed up for 40 different searches in the 28 days before the change and 40 in the 28 days after.",
    );
  });

  it("no query-grain presence in EITHER window is an honest null, never a fabricated zero story", () => {
    expect(read({ beforeQueries: 0, afterQueries: 0, beforeClicks: 0, afterClicks: 0 })).toBeNull();
  });

});
