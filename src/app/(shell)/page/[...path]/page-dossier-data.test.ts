import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * page-dossier-data.test.ts (BEACON_500 item 54) - loader COMPOSITION tests.
 * Every underlying source is mocked, so these pin the join/filter behavior:
 * the dossier picks out exactly the one page's slice from each tenant-wide
 * loader, matches paths across URL formats, survives any single source
 * failing, and reports honest emptiness when nothing knows the page.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
  currentTenantSlug: vi.fn(async () => "iranopedia"),
}));
vi.mock("@/domains/proof-gsc/daily-series", () => ({
  loadDailyClicksByPathsForTenant: vi.fn(async () => new Map()),
}));
vi.mock("@/domains/recommendation-intelligence/gsc-page-signals", () => ({
  loadGscPageSignalsForTenant: vi.fn(async () => new Map()),
}));
vi.mock("@/domains/recommendation-intelligence/clarity-page-signals", () => ({
  loadClarityPageSignalsForTenant: vi.fn(async () => new Map()),
}));
vi.mock("@/domains/recommendation-intelligence/page-freshness", () => ({
  loadPageContentSnapshot: vi.fn(async () => null),
}));
vi.mock("@/domains/ai-visibility/load-crawl-citation-funnel", () => ({
  loadCrawlCitationFunnel: vi.fn(async () => null),
}));
vi.mock("@/domains/language-gap/language-gap-store", () => ({
  loadLanguageGaps: vi.fn(async () => []),
}));
vi.mock("@/domains/proof-gsc/load-ledger", () => ({
  loadProofLedgerCached: vi.fn(async () => []),
}));
vi.mock("../../changes-data", () => ({
  loadChangesView: vi.fn(async () => null),
}));
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  getAcceptedPlan: vi.fn(async () => null),
  getLatestPreviewPlan: vi.fn(async () => null),
}));

import { loadPageDossier, pathFromSegments, labelFromPath } from "./page-dossier-data";
import { loadDailyClicksByPathsForTenant } from "@/domains/proof-gsc/daily-series";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { loadPageContentSnapshot } from "@/domains/recommendation-intelligence/page-freshness";
import { loadCrawlCitationFunnel } from "@/domains/ai-visibility/load-crawl-citation-funnel";
import { loadLanguageGaps } from "@/domains/language-gap/language-gap-store";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { loadChangesView } from "../../changes-data";
import { getAcceptedPlan, getLatestPreviewPlan } from "@/domains/experiments/daily-experiment-plan-store";

const PATH = "/cities";

function ledgerRecord(over: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    page: "https://iranopedia.com/cities",
    path: "/cities",
    actionType: "edit_title",
    before: "Old title",
    after: "New title",
    shippedAt: "2026-06-20T10:00:00Z",
    baseline: { clicks: 10, impressions: 100, ctr: 0.1, position: 8, windowDays: 28 },
    targetQueries: ["iran cities"],
    controlPages: [],
    windows: [{ day: 7, checkOn: "2026-06-27", ran: true, treatedDelta: 3, controlDelta: 1, adjustedLift: 2, treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0 }],
    verdict: "won",
    confidence: "medium",
    measuredAt: "2026-06-27T10:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pathFromSegments", () => {
  it("joins segments into a normalized lowercase path", () => {
    expect(pathFromSegments(["cities"])).toBe("/cities");
    expect(pathFromSegments(["Iran", "Cities"])).toBe("/iran/cities");
  });

  it("decodes URI-encoded segments", () => {
    expect(pathFromSegments(["persian%20names"])).toBe("/persian names");
  });

  it("returns root for empty segments", () => {
    expect(pathFromSegments([])).toBe("/");
  });
});

describe("labelFromPath", () => {
  it("title-cases the final slug", () => {
    expect(labelFromPath("/persian-boy-names")).toBe("Persian Boy Names");
  });
  it("falls back for the root path", () => {
    expect(labelFromPath("/")).toBe("Home page");
  });
});

describe("loadPageDossier composition", () => {
  it("is honestly empty when no source knows the page", async () => {
    const d = await loadPageDossier(PATH);
    expect(d.hasAnyData).toBe(false);
    expect(d.chart.daily).toEqual([]);
    expect(d.queries.topQueries).toEqual([]);
    expect(d.teamReads.demand).toBeNull();
    expect(d.teamReads.friction).toBeNull();
    expect(d.teamReads.funnel).toBeNull();
    expect(d.teamReads.languageGaps).toEqual([]);
    expect(d.history).toEqual([]);
    expect(d.currentMove).toBeNull();
    expect(d.currentPlanPick).toBeNull();
    expect(d.pageLabel).toBe("Cities");
    expect(d.liveUrl).toBeNull();
    expect(d.content).toBeNull();
    // No source resolved a live URL, so the content loader must not even run.
    expect(loadPageContentSnapshot).not.toHaveBeenCalled();
  });

  it("passes the dossier path straight to the daily-clicks loader and keys the chart off it", async () => {
    vi.mocked(loadDailyClicksByPathsForTenant).mockResolvedValue(
      new Map([[PATH, [{ date: "2026-06-01", clicks: 5 }, { date: "2026-06-02", clicks: 7 }]]]),
    );
    const d = await loadPageDossier(PATH);
    expect(loadDailyClicksByPathsForTenant).toHaveBeenCalledWith("tenant-test", [PATH]);
    expect(d.chart.daily).toHaveLength(2);
    expect(d.hasAnyData).toBe(true);
  });

  it("matches the GSC signal whose full URL normalizes to the dossier path (www + trailing slash folded)", async () => {
    vi.mocked(loadGscPageSignalsForTenant).mockResolvedValue(
      new Map([
        ["https://www.iranopedia.com/cities/", { page: "https://www.iranopedia.com/cities/", clicks90d: 120, impressions90d: 4000, ctr90d: 0.03, position90d: 6.5, topQueries: [{ query: "iran cities", clicks: 50, impressions: 900, ctr: 0.05, position: 5.2 }] }],
        ["https://www.iranopedia.com/other", { page: "https://www.iranopedia.com/other", clicks90d: 1, impressions90d: 10, ctr90d: 0.1, position90d: 3, topQueries: [] }],
      ]),
    );
    const d = await loadPageDossier(PATH);
    expect(d.teamReads.demand).toEqual({ clicks90d: 120, impressions90d: 4000, ctr90d: 0.03, position90d: 6.5 });
    expect(d.queries.topQueries).toHaveLength(1);
    expect(d.queries.topQueries[0].query).toBe("iran cities");
    // The GSC signal's own canonical URL is the best-known live URL.
    expect(d.liveUrl).toBe("https://www.iranopedia.com/cities/");
  });

  it("fetches the content snapshot for the resolved live URL and surfaces it as-is", async () => {
    vi.mocked(loadGscPageSignalsForTenant).mockResolvedValue(
      new Map([["https://iranopedia.com/cities", { page: "https://iranopedia.com/cities", clicks90d: 10, impressions90d: 100, ctr90d: 0.1, position90d: 5, topQueries: [] }]]),
    );
    vi.mocked(loadPageContentSnapshot).mockResolvedValue({
      title: "Cities of Iran",
      metaDescription: "A tour of Iran's major cities.",
      h1: "Cities of Iran",
      wordCount: 1200,
      fetchedAt: "2026-06-30T00:00:00Z",
    });
    const d = await loadPageDossier(PATH);
    expect(loadPageContentSnapshot).toHaveBeenCalledWith("tenant-test", "https://iranopedia.com/cities");
    expect(d.content?.title).toBe("Cities of Iran");
    expect(d.content?.wordCount).toBe(1200);
    expect(d.hasAnyData).toBe(true);
  });

  it("filters the ledger to this page only and sorts newest first, deriving ship markers", async () => {
    vi.mocked(loadProofLedgerCached).mockResolvedValue([
      ledgerRecord({ id: "a", shippedAt: "2026-06-01T00:00:00Z" }),
      ledgerRecord({ id: "other-page", path: "/food", page: "https://iranopedia.com/food" }),
      ledgerRecord({ id: "b", shippedAt: "2026-06-20T00:00:00Z" }),
    ] as never);
    const d = await loadPageDossier(PATH);
    expect(d.history.map((r) => r.id)).toEqual(["b", "a"]);
    expect(d.chart.shipMarkers).toEqual(["2026-06-01", "2026-06-20"]);
  });

  it("finds the current worklist move by pagePath and carries its plain fields", async () => {
    vi.mocked(loadChangesView).mockResolvedValue({
      changes: [
        { id: "c1", pagePath: "/cities", pageUrl: "https://iranopedia.com/cities", pageLabel: "Cities of Iran", opportunityType: "Capture clicks", recommendation: "Rewrite the headline", status: "ready", evidenceStrength: "strong", estimatedEffortMinutes: 10, measurementHeadline: null },
        { id: "c2", pagePath: "/food", pageUrl: "https://iranopedia.com/food", pageLabel: "Food", opportunityType: "Win AI citations", recommendation: "Add an answer", status: "todo", evidenceStrength: "tracking", estimatedEffortMinutes: 15, measurementHeadline: null },
      ],
    } as never);
    const d = await loadPageDossier(PATH);
    expect(d.currentMove?.id).toBe("c1");
    expect(d.currentMove?.recommendation).toBe("Rewrite the headline");
    expect(d.pageLabel).toBe("Cities of Iran");
  });

  it("prefers the accepted plan over the preview for the plan pick", async () => {
    vi.mocked(getAcceptedPlan).mockResolvedValue({
      id: "plan-a",
      selected: [{ id: "p1", url: "https://iranopedia.com/cities", canonicalUrl: "https://iranopedia.com/cities", pageLabel: "Cities", lever: "meta_description", targetQuery: "iran cities", whyNow: "Position 6 with real demand." }],
    } as never);
    vi.mocked(getLatestPreviewPlan).mockResolvedValue({
      id: "plan-b",
      selected: [{ id: "p2", url: "https://iranopedia.com/cities", canonicalUrl: "https://iranopedia.com/cities", pageLabel: "Cities", lever: "title", targetQuery: "x", whyNow: "preview" }],
    } as never);
    const d = await loadPageDossier(PATH);
    expect(d.currentPlanPick?.id).toBe("p1");
    expect(d.currentPlanPick?.isAccepted).toBe(true);
  });

  it("filters language gaps and the funnel to this page", async () => {
    vi.mocked(loadLanguageGaps).mockResolvedValue([
      { page: "https://iranopedia.com/cities", gapKind: "no_native_content", impressions: 900, topVariants: ["شهرهای ایران"], sentence: "People search this in Farsi 900 times and the page has no Farsi." },
      { page: "https://iranopedia.com/food", gapKind: "no_native_content", impressions: 100, topVariants: [], sentence: "other" },
    ] as never);
    vi.mocked(loadCrawlCitationFunnel).mockResolvedValue({
      hasData: true,
      pages: [
        { pagePath: "/cities", stage: "crawled_not_cited", bottleneckSentence: "AI crawlers fetched this page 4 times but no AI answer cites it yet.", crawled: { count: 4, lastAt: null, bots: [] }, cited: { count: 0, prompts: 0, lastAt: null }, aiClicks: { sessions: 0, keyEvents: 0, topSource: null }, demand: 100 },
        { pagePath: "/food", stage: "converting", bottleneckSentence: "x", crawled: { count: 1, lastAt: null, bots: [] }, cited: { count: 1, prompts: 1, lastAt: null }, aiClicks: { sessions: 2, keyEvents: 0, topSource: null }, demand: 5 },
      ],
      stalled: [],
      feeds: { crawl: true, cited: true, clicks: true, crawledPageCount: 2 },
      stageCounts: { not_crawled: 0, crawled_not_cited: 1, cited_no_clicks: 0, converting: 1, no_signal: 0 },
    } as never);
    const d = await loadPageDossier(PATH);
    expect(d.teamReads.languageGaps).toHaveLength(1);
    expect(d.teamReads.funnel?.stage).toBe("crawled_not_cited");
  });

  it("survives every source rejecting (fail-soft to an honest empty dossier)", async () => {
    vi.mocked(loadDailyClicksByPathsForTenant).mockRejectedValue(new Error("boom"));
    vi.mocked(loadGscPageSignalsForTenant).mockRejectedValue(new Error("boom"));
    vi.mocked(loadClarityPageSignalsForTenant).mockRejectedValue(new Error("boom"));
    vi.mocked(loadLanguageGaps).mockRejectedValue(new Error("boom"));
    vi.mocked(loadProofLedgerCached).mockRejectedValue(new Error("boom"));
    vi.mocked(loadChangesView).mockRejectedValue(new Error("boom"));
    vi.mocked(getAcceptedPlan).mockRejectedValue(new Error("boom"));
    vi.mocked(getLatestPreviewPlan).mockRejectedValue(new Error("boom"));
    vi.mocked(loadCrawlCitationFunnel).mockRejectedValue(new Error("boom"));
    vi.mocked(loadPageContentSnapshot).mockRejectedValue(new Error("boom"));
    const d = await loadPageDossier(PATH);
    expect(d.hasAnyData).toBe(false);
    expect(d.pageLabel).toBe("Cities");
    expect(d.content).toBeNull();
  });
});
