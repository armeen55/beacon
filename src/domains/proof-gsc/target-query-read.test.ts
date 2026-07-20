/**
 * target-query-read.test.ts (master plan item 68, 2026-07-02).
 *
 * Pins:
 *   - www-variant safety: gsc_daily_rows rows stored under the raw www. host
 *     still match a canonicalized (bare-host) page/control input.
 *   - thin-data silence: a target query with < 50 impressions in either
 *     window is honestly dropped, never reported off a sliver of data.
 *   - control adjustment: ctrDelta/positionDelta subtract the mean control
 *     movement, mirroring measure.ts's own diff-in-diff shape.
 *   - missing target queries -> [] without any read attempted.
 *   - paging discipline mirrors auto-record-on-ship.ts's proven pattern.
 *   - the plain-English sentence names the exact query and both numbers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { buildTargetQueryReads, targetQuerySentence, MIN_QUERY_IMPRESSIONS } from "./target-query-read";
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

  it("blank/whitespace-only target queries are filtered out before any read", async () => {
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://site.com/treated",
      controlPages: [],
      targetQueries: ["  ", ""],
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

  it("drops a query with < 50 impressions in the POST window", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://site.com/treated", query: "thin query", clicks: 20, impressions: 200, position: 9 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://site.com/treated", query: "thin query", clicks: 1, impressions: 10, position: 5 },
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

  it("matches a www-canonicalized control page against a bare-host stored row", async () => {
    windowRows.set(windowKey(PRE.start, PRE.end), [
      { page: "https://iranopedia.com/treated", query: "q", clicks: 20, impressions: 200, position: 8 },
      { page: "https://www.iranopedia.com/control", query: "q", clicks: 20, impressions: 200, position: 8 },
    ]);
    windowRows.set(windowKey(POST.start, POST.end), [
      { page: "https://iranopedia.com/treated", query: "q", clicks: 40, impressions: 200, position: 4 },
      { page: "https://www.iranopedia.com/control", query: "q", clicks: 20, impressions: 200, position: 8 },
    ]);
    const reads = await buildTargetQueryReads({
      tenantId: "tenant-x",
      page: "https://iranopedia.com/treated",
      controlPages: ["https://iranopedia.com/control"], // canonicalized bare host
      targetQueries: ["q"],
      preStart: PRE.start,
      preEnd: PRE.end,
      postStart: POST.start,
      postEnd: POST.end,
    });
    expect(reads).toHaveLength(1);
    expect(reads[0].controlsUsed).toBe(1);
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

  it("a thrown read resolves to [] AND logs the failure (never a silent empty read)", async () => {
    hardThrowOnRead = new Error("network down");
    vi.mocked(log.warn).mockClear();
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
    // The read failure is logged (readTargetQueryWindow fail-softs per window
    // with its own log; the orchestrator's catch is a defensive backstop), so a
    // read failure is never a silent empty result.
    expect(vi.mocked(log.warn)).toHaveBeenCalled();
    expect(
      vi.mocked(log.warn).mock.calls.some((c) => String(c[0]).includes("target-query-read")),
    ).toBe(true);
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

  it("names only CTR when position data is missing (no fabricated rank)", () => {
    const s = targetQuerySentence({
      query: "q",
      ctrDelta: 0.01,
      positionDelta: 0,
      treatedPre: { clicks: 20, impressions: 200, ctr: 0.1, position: 0 },
      treatedPost: { clicks: 22, impressions: 200, ctr: 0.11, position: 0 },
    });
    expect(s).toContain("click rate");
    expect(s).not.toContain("position");
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

  it("reads a CTR decline as down, not up", () => {
    const s = targetQuerySentence({
      query: "q",
      ctrDelta: -0.02,
      positionDelta: 0,
      treatedPre: { clicks: 40, impressions: 200, ctr: 0.2, position: 0 },
      treatedPost: { clicks: 36, impressions: 200, ctr: 0.18, position: 0 },
    });
    expect(s).toContain("click rate down");
  });

  it("never contains an em or en dash", () => {
    const s = targetQuerySentence({
      query: "persian singers",
      ctrDelta: 0.012,
      positionDelta: 1.8,
      treatedPre: { clicks: 20, impressions: 200, ctr: 0.1, position: 7.9 },
      treatedPost: { clicks: 32, impressions: 200, ctr: 0.16, position: 6.1 },
    });
    expect(s).not.toMatch(/[–—]/);
  });
});

describe("dash guard (hard rule)", () => {
  it("target-query-read.ts contains no em or en dashes", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(path.join(__dirname, "target-query-read.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
