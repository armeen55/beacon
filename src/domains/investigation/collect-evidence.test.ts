/**
 * collect-evidence (2026-07-02, master plan item 53) - fail-soft + bounded
 * collector matrix. Every collector must: (1) never throw regardless of what
 * its dependency does, (2) respect its documented bound (MAX_LIVE_FETCHES
 * pages, MAX_SERP_QUERIES queries), (3) parse the pure HTML/id helpers
 * correctly in isolation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── polite-fetch ─────────────────────────────────────────────────────
const fetchPageHtmlMock = vi.fn();
vi.mock("@/domains/competitor-intel/polite-fetch", () => ({
  fetchPageHtml: (...args: unknown[]) => fetchPageHtmlMock(...args),
}));

// ── serp-history ─────────────────────────────────────────────────────
const rankSeriesForMock = vi.fn();
const computeRankDeltaMock = vi.fn();
vi.mock("@/domains/serp/serp-history", () => ({
  rankSeriesFor: (...args: unknown[]) => rankSeriesForMock(...args),
  computeRankDelta: (...args: unknown[]) => computeRankDeltaMock(...args),
}));

// ── gsc-page-queries (top queries) ───────────────────────────────────
const loadTopQueriesForPagesMock = vi.fn();
vi.mock("@/domains/recommendation-intelligence/gsc-page-queries", () => ({
  loadTopQueriesForPages: (...args: unknown[]) => loadTopQueriesForPagesMock(...args),
}));

// ── push ledger ───────────────────────────────────────────────────────
const readPushLedgerForTenantMock = vi.fn();
vi.mock("@/domains/push/caps", () => ({
  readPushLedgerForTenant: (...args: unknown[]) => readPushLedgerForTenantMock(...args),
}));

// ── algorithm weather ─────────────────────────────────────────────────
const readAlgorithmWeatherSummaryMock = vi.fn();
vi.mock("@/domains/proof-gsc/algorithm-weather-store", () => ({
  readAlgorithmWeatherSummary: (...args: unknown[]) => readAlgorithmWeatherSummaryMock(...args),
}));

import {
  collectIndexabilityEvidence,
  collectSerpEvidence,
  collectRecentChangeEvidence,
  collectWeatherEvidence,
  parseLiveNoindexSignals,
  describeChange,
  MAX_LIVE_FETCHES,
  MAX_SERP_QUERIES,
} from "./collect-evidence";

beforeEach(() => {
  fetchPageHtmlMock.mockReset();
  rankSeriesForMock.mockReset();
  computeRankDeltaMock.mockReset();
  loadTopQueriesForPagesMock.mockReset();
  readPushLedgerForTenantMock.mockReset();
  readAlgorithmWeatherSummaryMock.mockReset();
});

const NOW = new Date("2026-06-21T00:00:00.000Z");

describe("parseLiveNoindexSignals - pure HTML parsing", () => {
  it("detects a noindex meta tag", () => {
    const html = '<html><head><meta name="robots" content="noindex, nofollow"></head></html>';
    expect(parseLiveNoindexSignals(html, "https://example.com/cheetah").noindex).toBe(true);
  });

  it("detects the none shorthand as noindex", () => {
    const html = '<html><head><meta name="robots" content="none"></head></html>';
    expect(parseLiveNoindexSignals(html, "https://example.com/cheetah").noindex).toBe(true);
  });

  it("does not flag a plain index directive as noindex", () => {
    const html = '<html><head><meta name="robots" content="index, follow"></head></html>';
    expect(parseLiveNoindexSignals(html, "https://example.com/cheetah").noindex).toBe(false);
  });

  it("no robots meta at all is not noindex", () => {
    const html = "<html><head></head></html>";
    expect(parseLiveNoindexSignals(html, "https://example.com/cheetah").noindex).toBe(false);
  });

  it("detects a canonical mismatch pointing elsewhere", () => {
    const html = '<html><head><link rel="canonical" href="https://example.com/other-page"></head></html>';
    expect(parseLiveNoindexSignals(html, "https://example.com/cheetah").canonicalMismatch).toBe(true);
  });

  it("a self-referencing canonical is not a mismatch", () => {
    const html = '<html><head><link rel="canonical" href="https://example.com/cheetah"></head></html>';
    expect(parseLiveNoindexSignals(html, "https://example.com/cheetah").canonicalMismatch).toBe(false);
  });
});

describe("describeChange - pure id humanization", () => {
  it.each([
    ["edit_meta_description_123", "meta description"],
    ["edit_title_abc", "title tag"],
    ["edit_h1_xyz", "H1 heading"],
    ["add_answer_block_1", "answer block"],
    ["faq_schema_9", "answer block"],
    ["add_schema_5", "structured data"],
    ["add_internal_link_2", "internal links"],
    ["fix_canonical_7", "canonical tag"],
    ["remove_noindex_4", "robots settings"],
    ["totally_unknown_thing", "page content"],
  ])("maps %s to %s", (editId, expected) => {
    expect(describeChange(editId)).toBe(expected);
  });
});

describe("collectIndexabilityEvidence - bounded + fail-soft", () => {
  it("never fetches more than MAX_LIVE_FETCHES pages", async () => {
    fetchPageHtmlMock.mockResolvedValue({ ok: true, html: "<html></html>", status: 200 });
    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/page-${i}`);
    await collectIndexabilityEvidence(urls, NOW);
    expect(fetchPageHtmlMock).toHaveBeenCalledTimes(MAX_LIVE_FETCHES);
  });

  it("returns a noindex finding when the live HTML has a noindex tag", async () => {
    fetchPageHtmlMock.mockResolvedValue({ ok: true, html: '<meta name="robots" content="noindex">', status: 200 });
    const out = await collectIndexabilityEvidence(["https://example.com/cheetah"], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.noindexNow).toBe(true);
    expect(out[0]!.badStatusNow).toBe(false);
  });

  it("returns a bad-status finding when the fetch failed with an http_NNN detail", async () => {
    fetchPageHtmlMock.mockResolvedValue({ ok: false, reason: "fetch_failed", detail: "http_500" });
    const out = await collectIndexabilityEvidence(["https://example.com/cheetah"], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.badStatusNow).toBe(true);
    expect(out[0]!.liveStatus).toBe(500);
  });

  it("a transient network failure (no http_NNN detail) produces no finding, not a guess", async () => {
    fetchPageHtmlMock.mockResolvedValue({ ok: false, reason: "fetch_failed", detail: "AbortError: timeout" });
    const out = await collectIndexabilityEvidence(["https://example.com/cheetah"], NOW);
    expect(out).toEqual([]);
  });

  it("a robots-blocked result is reported as blockedByRobots", async () => {
    fetchPageHtmlMock.mockResolvedValue({ ok: false, reason: "robots_blocked" });
    const out = await collectIndexabilityEvidence(["https://example.com/cheetah"], NOW);
    expect(out[0]!.blockedByRobots).toBe(true);
  });

  it("one page throwing never blocks the others", async () => {
    fetchPageHtmlMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true, html: "<html></html>", status: 200 });
    const out = await collectIndexabilityEvidence(["https://example.com/a", "https://example.com/b"], NOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.url).toBe("https://example.com/b");
  });

  it("empty url list short-circuits without calling the fetcher", async () => {
    const out = await collectIndexabilityEvidence([], NOW);
    expect(out).toEqual([]);
    expect(fetchPageHtmlMock).not.toHaveBeenCalled();
  });
});

describe("collectSerpEvidence - bounded + fail-soft", () => {
  it("never queries more than MAX_SERP_QUERIES distinct queries", async () => {
    const manyQueries = Array.from({ length: 20 }, (_, i) => ({ query: `q${i}`, clicks: 1, impressions: 100 - i }));
    loadTopQueriesForPagesMock.mockResolvedValue(new Map([["https://example.com/cheetah", manyQueries]]));
    rankSeriesForMock.mockResolvedValue([{ capturedAt: "2026-06-15T00:00:00.000Z", ownRank: 3, ownUrl: null }]);
    computeRankDeltaMock.mockReturnValue({ fromRank: 3, toRank: 8, fromAt: "2026-06-10", toAt: "2026-06-20", direction: "down" });
    await collectSerpEvidence("tenant-1", ["https://example.com/cheetah"], "2026-06-20");
    expect(rankSeriesForMock.mock.calls.length).toBeLessThanOrEqual(MAX_SERP_QUERIES);
  });

  it("returns [] when the tenant has no queries at all", async () => {
    loadTopQueriesForPagesMock.mockResolvedValue(new Map());
    const out = await collectSerpEvidence("tenant-1", ["https://example.com/cheetah"], "2026-06-20");
    expect(out).toEqual([]);
  });

  it("fails soft to [] when the query loader throws", async () => {
    loadTopQueriesForPagesMock.mockRejectedValue(new Error("boom"));
    const out = await collectSerpEvidence("tenant-1", ["https://example.com/cheetah"], "2026-06-20");
    expect(out).toEqual([]);
  });

  it("empty page list short-circuits without calling anything", async () => {
    const out = await collectSerpEvidence("tenant-1", [], "2026-06-20");
    expect(out).toEqual([]);
    expect(loadTopQueriesForPagesMock).not.toHaveBeenCalled();
  });
});

describe("collectRecentChangeEvidence - fail-soft + windowed", () => {
  it("only includes pushed changes to the family's own pages inside the lookback window", async () => {
    readPushLedgerForTenantMock.mockResolvedValue([
      { id: "1", tenant_id: "t", edit_id: "edit_meta_1", target_url: "https://example.com/cheetah", adapter: "wix", pushed_at: "2026-06-19T00:00:00.000Z", day: "2026-06-19", result: "pushed", detail: null },
      { id: "2", tenant_id: "t", edit_id: "edit_title_2", target_url: "https://example.com/other", adapter: "wix", pushed_at: "2026-06-19T00:00:00.000Z", day: "2026-06-19", result: "pushed", detail: null },
      { id: "3", tenant_id: "t", edit_id: "edit_h1_3", target_url: "https://example.com/cheetah", adapter: "wix", pushed_at: "2026-01-01T00:00:00.000Z", day: "2026-01-01", result: "pushed", detail: null },
    ]);
    const out = await collectRecentChangeEvidence("t", ["https://example.com/cheetah"], "2026-06-20");
    expect(out).toHaveLength(1);
    expect(out[0]!.description).toBe("meta description");
  });

  it("matches across host variants (ledger canonical vs GSC raw www form)", async () => {
    readPushLedgerForTenantMock.mockResolvedValue([
      { id: "1", tenant_id: "t", edit_id: "edit_meta_1", target_url: "https://example.com/cheetah", adapter: "wix", pushed_at: "2026-06-19T00:00:00.000Z", day: "2026-06-19", result: "pushed", detail: null },
    ]);
    const out = await collectRecentChangeEvidence("t", ["https://www.example.com/cheetah/"], "2026-06-20");
    expect(out).toHaveLength(1);
  });

  it("excludes reserved and push_failed ledger entries", async () => {
    readPushLedgerForTenantMock.mockResolvedValue([
      { id: "1", tenant_id: "t", edit_id: "edit_meta_1", target_url: "https://example.com/cheetah", adapter: "wix", pushed_at: "2026-06-19T00:00:00.000Z", day: "2026-06-19", result: "push_failed", detail: "err" },
      { id: "2", tenant_id: "t", edit_id: "edit_meta_2", target_url: "https://example.com/cheetah", adapter: "wix", pushed_at: "2026-06-19T00:00:00.000Z", day: "2026-06-19", result: "reserved", detail: null },
    ]);
    const out = await collectRecentChangeEvidence("t", ["https://example.com/cheetah"], "2026-06-20");
    expect(out).toEqual([]);
  });

  it("fails soft to [] when the ledger read throws", async () => {
    readPushLedgerForTenantMock.mockRejectedValue(new Error("boom"));
    const out = await collectRecentChangeEvidence("t", ["https://example.com/cheetah"], "2026-06-20");
    expect(out).toEqual([]);
  });

  it("empty page list short-circuits without calling the ledger", async () => {
    const out = await collectRecentChangeEvidence("t", [], "2026-06-20");
    expect(out).toEqual([]);
    expect(readPushLedgerForTenantMock).not.toHaveBeenCalled();
  });
});

// A collapse date deliberately far from every real CONFIRMED_GOOGLE_UPDATES
// entry (google-updates.ts is real operator-maintained data, not a test
// fixture) so these tests only exercise the MOCKED suspected changepoint,
// never an incidental overlap with a real seeded update.
const QUIET_COLLAPSE_DATE = "2026-01-15";

describe("collectWeatherEvidence - fail-soft", () => {
  it("returns a shock window overlapping the collapse week", async () => {
    readAlgorithmWeatherSummaryMock.mockResolvedValue({
      tenant_id: "t",
      computed_at: "2026-01-16T00:00:00.000Z",
      anchor_date: QUIET_COLLAPSE_DATE,
      clicksChangepoints: [{ date: "2026-01-14", direction: "down", magnitude: 0.6 }],
      impressionsChangepoints: [],
    });
    const out = await collectWeatherEvidence("t", QUIET_COLLAPSE_DATE);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("suspected");
  });

  it("returns [] when there is no weather summary at all", async () => {
    readAlgorithmWeatherSummaryMock.mockResolvedValue(null);
    const out = await collectWeatherEvidence("t", QUIET_COLLAPSE_DATE);
    expect(out).toEqual([]);
  });

  it("fails soft to [] when the store read throws", async () => {
    readAlgorithmWeatherSummaryMock.mockRejectedValue(new Error("boom"));
    const out = await collectWeatherEvidence("t", QUIET_COLLAPSE_DATE);
    expect(out).toEqual([]);
  });
});
