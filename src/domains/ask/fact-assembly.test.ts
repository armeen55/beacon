import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ask/fact-assembly.test.ts (BEACON_500 item 59) - every underlying loader is mocked, so
 * these pin the COMPOSITION contract: each question class calls the right loader(s),
 * every fact carries {value, source, href}, and one loader throwing never blanks the
 * whole dossier (fail-soft, matches page-dossier-data.test.ts's own discipline). The
 * page_specific class reuses loadPageDossier wholesale (item 54) rather than re-reading
 * its underlying sources, so it is mocked at that boundary instead of re-mocking GSC/
 * Clarity/funnel directly.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
}));
vi.mock("@/app/(shell)/page/[...path]/page-dossier-data", () => ({
  loadPageDossier: vi.fn(async () => ({
    path: "/cheetah",
    pageLabel: "Cheetah",
    hasAnyData: false,
    chart: { daily: [], shipMarkers: [] },
    queries: { topQueries: [] },
    teamReads: { demand: null, friction: null, funnel: null, languageGaps: [] },
    history: [],
    currentMove: null,
    currentPlanPick: null,
  })),
}));
vi.mock("@/domains/recommendation-intelligence/gsc-page-queries", () => ({
  loadDailyTotalsForTenant: vi.fn(async () => []),
}));
vi.mock("@/domains/proof-gsc/load-ledger", () => ({
  loadProofLedgerCached: vi.fn(async () => []),
}));
vi.mock("@/domains/answer-intelligence/store", () => ({
  getAnswerIntelligenceIndex: vi.fn(async () => null),
}));
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  getAcceptedPlan: vi.fn(async () => null),
  getLatestPreviewPlan: vi.fn(async () => null),
}));
vi.mock("@/domains/ai-visibility/native-intel-loader", () => ({
  loadNativeIntel: vi.fn(async () => ({
    recurringDomains: [],
    recurringPages: [],
    presence: { rows: [], totals: { promptsChecked: 0, present: 0, absent: 0 } },
    nativeQuestions: [],
    rowsScanned: 0,
    enginesSeen: [],
  })),
}));
vi.mock("@/domains/research/keyword-library", () => ({
  loadKeywordLibrary: vi.fn(async () => ({ rows: [], volumeCoverage: 0, total: 0, bySource: {} })),
}));
vi.mock("@/domains/ops/cron-health-view", () => ({
  loadCronHealthView: vi.fn(async () => []),
}));
vi.mock("@/domains/ops/pipeline-health-store", () => ({
  readPipelineHealth: vi.fn(async () => null),
}));
vi.mock("@/domains/push/publish-canary-store", () => ({
  readPublishHealth: vi.fn(async () => null),
}));
vi.mock("@/domains/ownership/registry-loader", () => ({
  loadOwnershipRegistryForTenant: vi.fn(async () => ({
    byQuery: new Map(),
    conflicts: [],
    coverage: { totalQueries: 0, gscBasisCount: 0, serpClusterBasisCount: 0, unresolvedCount: 0 },
  })),
}));

import { assembleAskDossier } from "./fact-assembly";
import { loadOwnershipRegistryForTenant } from "@/domains/ownership/registry-loader";
import { loadPageDossier } from "@/app/(shell)/page/[...path]/page-dossier-data";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { getAnswerIntelligenceIndex } from "@/domains/answer-intelligence/store";
import { getAcceptedPlan } from "@/domains/experiments/daily-experiment-plan-store";
import { loadNativeIntel } from "@/domains/ai-visibility/native-intel-loader";
import { loadKeywordLibrary } from "@/domains/research/keyword-library";
import { loadCronHealthView } from "@/domains/ops/cron-health-view";
import { readPipelineHealth } from "@/domains/ops/pipeline-health-store";
import { readPublishHealth } from "@/domains/push/publish-canary-store";
import type { RoutedQuestion } from "./router";

beforeEach(() => {
  vi.clearAllMocks();
});

function routed(over: Partial<RoutedQuestion> = {}): RoutedQuestion {
  return { questionClass: "page_specific", pagePath: "/cheetah", speaker: "gsc", ...over };
}

describe("ask/fact-assembly - page_specific", () => {
  // D8: even a page with zero GSC/Clarity/Profound data still gets ONE honest fact - that
  // it has no open recommendation and no plan pick - so "why isn't this page in the plan"
  // is never met with total silence. hasData is true because that absence IS real,
  // sourced information, not a gap to hide.
  it("names the missing recommendation/plan when the dossier has no other data", async () => {
    const dossier = await assembleAskDossier(routed());
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts).toHaveLength(1);
    expect(dossier.facts[0]!.value).toContain("no open recommendation and no plan pick");
    expect(dossier.pagePath).toBe("/cheetah");
  });

  it("builds a demand fact with the page href when GSC data exists", async () => {
    vi.mocked(loadPageDossier).mockResolvedValueOnce({
      path: "/cheetah",
      pageLabel: "Cheetah",
      hasAnyData: true,
      chart: { daily: [], shipMarkers: [] },
      queries: { topQueries: [] },
      teamReads: {
        demand: { clicks90d: 412, impressions90d: 9800, ctr90d: 0.042, position90d: 8.1 },
        friction: null,
        funnel: null,
        languageGaps: [],
      },
      history: [],
      currentMove: null,
      currentPlanPick: null,
    } as never);
    const dossier = await assembleAskDossier(routed());
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.length).toBeGreaterThan(0);
    const demandFact = dossier.facts.find((f) => f.value.includes("412"));
    expect(demandFact).toBeDefined();
    expect(demandFact!.source).toBe("gsc");
    expect(demandFact!.href).toBe("/page/cheetah");
  });

  it("N2: cites the ownership registry's owner when it agrees with this page", async () => {
    vi.mocked(loadPageDossier).mockResolvedValueOnce({
      path: "/cheetah",
      pageLabel: "Cheetah",
      hasAnyData: true,
      chart: { daily: [], shipMarkers: [] },
      queries: { topQueries: [{ query: "iranian cheetah facts", clicks: 40 }] },
      teamReads: { demand: null, friction: null, funnel: null, languageGaps: [] },
      history: [],
      currentMove: null,
      currentPlanPick: null,
    } as never);
    vi.mocked(loadOwnershipRegistryForTenant).mockResolvedValueOnce({
      byQuery: new Map([["iranian cheetah facts", { key: "iranian cheetah facts", owner: "/cheetah", basis: "gsc_ranks", contenders: [], confidence: "high", reason: "" }]]),
      conflicts: [],
      coverage: { totalQueries: 1, gscBasisCount: 1, serpClusterBasisCount: 0, unresolvedCount: 0 },
    } as never);
    const dossier = await assembleAskDossier(routed());
    const registryFact = dossier.facts.find((f) => f.value.includes("ownership registry"));
    expect(registryFact?.value).toContain("confirms /cheetah owns");
  });

  it("N2: flags (never hides) when a DIFFERENT page owns this page's top query", async () => {
    vi.mocked(loadPageDossier).mockResolvedValueOnce({
      path: "/cheetah",
      pageLabel: "Cheetah",
      hasAnyData: true,
      chart: { daily: [], shipMarkers: [] },
      queries: { topQueries: [{ query: "iranian cheetah facts", clicks: 40 }] },
      teamReads: { demand: null, friction: null, funnel: null, languageGaps: [] },
      history: [],
      currentMove: null,
      currentPlanPick: null,
    } as never);
    vi.mocked(loadOwnershipRegistryForTenant).mockResolvedValueOnce({
      byQuery: new Map([["iranian cheetah facts", { key: "iranian cheetah facts", owner: "/wildlife", basis: "serp_cluster", contenders: [], confidence: "medium", reason: "" }]]),
      conflicts: [],
      coverage: { totalQueries: 1, gscBasisCount: 0, serpClusterBasisCount: 1, unresolvedCount: 0 },
    } as never);
    const dossier = await assembleAskDossier(routed());
    const registryFact = dossier.facts.find((f) => f.value.includes("ownership registry"));
    expect(registryFact?.value).toContain("/wildlife owns");
    expect(registryFact?.value).toContain("not /cheetah");
  });

  it("N2: an ownership-registry read failure never blanks the rest of the dossier", async () => {
    vi.mocked(loadPageDossier).mockResolvedValueOnce({
      path: "/cheetah",
      pageLabel: "Cheetah",
      hasAnyData: true,
      chart: { daily: [], shipMarkers: [] },
      queries: { topQueries: [{ query: "iranian cheetah facts", clicks: 40 }] },
      teamReads: { demand: null, friction: null, funnel: null, languageGaps: [] },
      history: [],
      currentMove: null,
      currentPlanPick: null,
    } as never);
    vi.mocked(loadOwnershipRegistryForTenant).mockRejectedValueOnce(new Error("boom"));
    const dossier = await assembleAskDossier(routed());
    expect(dossier.facts.some((f) => f.value.includes("Top searches"))).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("ownership registry"))).toBe(false);
  });

  it("returns an empty dossier (never throws) when loadPageDossier rejects", async () => {
    vi.mocked(loadPageDossier).mockRejectedValueOnce(new Error("boom"));
    const dossier = await assembleAskDossier(routed());
    expect(dossier.hasData).toBe(false);
    expect(dossier.facts).toEqual([]);
  });

  it("returns an empty dossier when routed with no pagePath (should not happen from the router, but stays safe)", async () => {
    const dossier = await assembleAskDossier(routed({ pagePath: null }));
    expect(dossier.hasData).toBe(false);
  });
});

describe("ask/fact-assembly - site_trend", () => {
  it("calls loadDailyTotalsForTenant and returns clicks facts", async () => {
    const days = Array.from({ length: 21 }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, clicks: 100 + i, impressions: 1000 }));
    vi.mocked(loadDailyTotalsForTenant).mockResolvedValueOnce(days);
    const dossier = await assembleAskDossier(routed({ questionClass: "site_trend", pagePath: null }));
    expect(loadDailyTotalsForTenant).toHaveBeenCalledWith("tenant-test", 90);
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts[0]!.source).toBe("gsc");
    expect(dossier.facts[0]!.href).toBe("/");
  });

  it("returns no facts when there is no daily data", async () => {
    const dossier = await assembleAskDossier(routed({ questionClass: "site_trend", pagePath: null }));
    expect(dossier.hasData).toBe(false);
  });

  it("fails soft when the loader throws", async () => {
    vi.mocked(loadDailyTotalsForTenant).mockRejectedValueOnce(new Error("boom"));
    const dossier = await assembleAskDossier(routed({ questionClass: "site_trend", pagePath: null }));
    expect(dossier.hasData).toBe(false);
    expect(dossier.facts).toEqual([]);
  });
});

describe("ask/fact-assembly - ai_visibility", () => {
  it("builds facts from the answer-intelligence index", async () => {
    vi.mocked(getAnswerIntelligenceIndex).mockResolvedValueOnce({
      built_at: "2026-07-01T00:00:00Z",
      brand_name: "Iranopedia",
      owned_domain: "iranopedia.com",
      total_observations: 500,
      total_with_answer_text: 420,
      brand_positioning: [
        { topic: "cheetah", mention_count: 40, total_observations: 50, mention_rate: 0.8, citation_rate: 0.5, brand_descriptors: [], top_co_appearing_competitors: [], avg_position_when_mentioned: 1.2, typical_list_size: 4 },
      ],
      visibility_cells: [],
      co_citation: { owned_domain: "iranopedia.com", total_answers_with_owned: 10, total_answers_without_owned: 5, competitors: [{ domain: "rival.com", when_owned_present: 2, when_owned_absent: 8, total_answer_appearances: 10, displacement_ratio: 0.8 }], by_topic: [] },
      narrative_shifts: [],
      topic_platform_summary: {},
      tenant_id: "tenant-test",
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "ai_visibility", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.source === "profound")).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("rival.com"))).toBe(true);
  });

  it("returns no facts when the index is null", async () => {
    const dossier = await assembleAskDossier(routed({ questionClass: "ai_visibility", pagePath: null }));
    expect(dossier.hasData).toBe(false);
  });

  // D8: "who does AI recommend instead of me" should also draw on the native 4-engine
  // poll (recurring domains + presence matrix), not just the borrowed Profound index.
  it("adds native-intel recurring domains and absence count to the competitor class", async () => {
    vi.mocked(loadNativeIntel).mockResolvedValueOnce({
      recurringDomains: [{ domain: "rival2.com", distinctPrompts: 4, citationCount: 9, engines: ["chatgpt", "perplexity"], examplePrompts: [] }],
      recurringPages: [],
      presence: { rows: [], totals: { promptsChecked: 12, present: 8, absent: 4 } },
      nativeQuestions: [],
      rowsScanned: 50,
      enginesSeen: ["chatgpt", "perplexity"],
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "competitor", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("rival2.com"))).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("4 of them"))).toBe(true);
  });

  it("fails soft when native-intel throws, keeping any answer-intelligence facts", async () => {
    vi.mocked(loadNativeIntel).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(getAnswerIntelligenceIndex).mockResolvedValueOnce({
      built_at: "2026-07-01T00:00:00Z",
      brand_name: "Iranopedia",
      owned_domain: "iranopedia.com",
      total_observations: 500,
      total_with_answer_text: 420,
      brand_positioning: [],
      visibility_cells: [],
      co_citation: { owned_domain: "iranopedia.com", total_answers_with_owned: 1, total_answers_without_owned: 1, competitors: [{ domain: "rival.com", when_owned_present: 1, when_owned_absent: 1, total_answer_appearances: 2, displacement_ratio: 0.5 }], by_topic: [] },
      narrative_shifts: [],
      topic_platform_summary: {},
      tenant_id: "tenant-test",
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "competitor", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("rival.com"))).toBe(true);
  });
});

describe("ask/fact-assembly - measurement", () => {
  it("builds facts from the proof ledger", async () => {
    vi.mocked(loadProofLedgerCached).mockResolvedValueOnce([
      { id: "1", page: "https://x/cheetah", path: "/cheetah", actionType: "edit_title", before: "a", after: "b", shippedAt: new Date().toISOString(), baseline: { clicks: 1, impressions: 1, ctr: 1, position: 1, windowDays: 28 }, targetQueries: [], controlPages: [], windows: [], verdict: "won", confidence: "medium", measuredAt: null } as never,
    ]);
    const dossier = await assembleAskDossier(routed({ questionClass: "measurement", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.source === "proof")).toBe(true);
    expect(dossier.facts.every((f) => f.href === "/results")).toBe(true);
    // FP4: internal action-type keys never leak into rendered answers; the
    // plain name ("title rewrite") replaces "edit_title".
    expect(dossier.facts.some((f) => f.value.includes("title rewrite"))).toBe(true);
    expect(dossier.facts.every((f) => !f.value.includes("edit_title"))).toBe(true);
  });

  // D8: reliability depth - confidence, dollar value, and permutation-null read should
  // all surface so "what did my last batch of changes do" answers with real weight.
  it("names confidence, dollar value, and the permutation-null read when present", async () => {
    vi.mocked(loadProofLedgerCached).mockResolvedValueOnce([
      {
        id: "1", page: "https://x/cheetah", path: "/cheetah", actionType: "edit_title", before: "a", after: "b",
        shippedAt: new Date().toISOString(),
        baseline: { clicks: 1, impressions: 1, ctr: 1, position: 1, windowDays: 28 },
        targetQueries: [], controlPages: [], windows: [], verdict: "won", confidence: "high", measuredAt: null,
        dollarValue: { usdPerMonth: 42, basisSentence: "At your rate, this is worth about 42 dollars a month.", confidence: "medium" },
        permutationRead: { percentile: 0.04, nGreater: 2, nTotal: 50 },
      } as never,
    ]);
    const dossier = await assembleAskDossier(routed({ questionClass: "measurement", pagePath: null }));
    expect(dossier.facts.some((f) => f.value.includes("confidence: high"))).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("42 dollars a month"))).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("2 of 50 untouched pages"))).toBe(true);
  });

  it("returns no facts when the ledger is empty", async () => {
    const dossier = await assembleAskDossier(routed({ questionClass: "measurement", pagePath: null }));
    expect(dossier.hasData).toBe(false);
  });
});

describe("ask/fact-assembly - plan", () => {
  it("builds facts from the accepted plan", async () => {
    vi.mocked(getAcceptedPlan).mockResolvedValueOnce({
      version: 1,
      id: "plan-1",
      tenantId: "tenant-test",
      date: "2026-07-02",
      status: "accepted",
      createdAt: "2026-07-01T22:00:00Z",
      expiresAt: "2026-07-03T00:00:00Z",
      selected: [{ id: "p1", pageLabel: "Cheetah", lever: "meta", targetQuery: "cheetah facts", whyNow: "demand is rising" }],
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "plan", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.every((f) => f.href === "/changes")).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("cheetah facts"))).toBe(true);
    // FP4: the plan lever ("meta") reads as a plain name, not a raw key.
    expect(dossier.facts.some((f) => f.value.includes("meta description change"))).toBe(true);
  });

  it("returns no facts when there is no plan", async () => {
    const dossier = await assembleAskDossier(routed({ questionClass: "plan", pagePath: null }));
    expect(dossier.hasData).toBe(false);
  });
});

describe("ask/fact-assembly - keyword_next (D8)", () => {
  it("surfaces the highest-volume keyword with no owner or a weak position", async () => {
    vi.mocked(loadKeywordLibrary).mockResolvedValueOnce({
      rows: [
        { keyword: "persian cat facts", searchesPerMo: 800, timesShownPerMo: 500, clicks: 10, yourPosition: null, difficulty: 40, trend: null, ownerPage: null, ownerPageHref: null, competitorOwners: [], relatedQuestions: [], sources: ["dataforseo_demand"], lastChecked: "2026-07-01" },
        { keyword: "iranian cheetah", searchesPerMo: 200, timesShownPerMo: 300, clicks: 50, yourPosition: 2, difficulty: 20, trend: null, ownerPage: "/cheetah", ownerPageHref: "/page/cheetah", competitorOwners: [], relatedQuestions: [], sources: ["gsc"], lastChecked: "2026-07-01" },
      ],
      volumeCoverage: 2,
      total: 2,
      bySource: {} as never,
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "keyword_next", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("persian cat facts"))).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("iranian cheetah"))).toBe(false);
    expect(dossier.facts[0]!.source).toBe("dataforseo");
  });

  it("names the library's own coverage line when every high-volume keyword is already owned and ranking", async () => {
    vi.mocked(loadKeywordLibrary).mockResolvedValueOnce({
      rows: [{ keyword: "iranian cheetah", searchesPerMo: 200, timesShownPerMo: 300, clicks: 50, yourPosition: 2, difficulty: 20, trend: null, ownerPage: "/cheetah", ownerPageHref: "/page/cheetah", competitorOwners: [], relatedQuestions: [], sources: ["gsc"], lastChecked: "2026-07-01" }],
      volumeCoverage: 1,
      total: 1,
      bySource: {} as never,
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "keyword_next", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts[0]!.value).toContain("already has an owning page");
  });

  it("returns no facts when the library is empty", async () => {
    const dossier = await assembleAskDossier(routed({ questionClass: "keyword_next", pagePath: null }));
    expect(dossier.hasData).toBe(false);
  });

  it("fails soft when the keyword library throws", async () => {
    vi.mocked(loadKeywordLibrary).mockRejectedValueOnce(new Error("boom"));
    const dossier = await assembleAskDossier(routed({ questionClass: "keyword_next", pagePath: null }));
    expect(dossier.hasData).toBe(false);
    expect(dossier.facts).toEqual([]);
  });
});

describe("ask/fact-assembly - system_health (D8)", () => {
  it("names a cron failure streak", async () => {
    vi.mocked(loadCronHealthView).mockResolvedValueOnce([
      {
        job: "nightly-sync", label: "Nightly sync", nextScheduledAtIso: null,
        lastRun: { startedAt: "2026-07-01T08:00:00Z", ok: false, durationMs: 100 },
        headline: "I showed up 3 of 7 nights this week.",
        perSourceThisWeek: [],
        failureStreaks: [{ tenantId: "tenant-test", provider: "google_gsc", label: "Search Console", consecutiveFailures: 4, lastFailureDetail: "token expired" }],
      },
    ] as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "system_health", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("Search Console") && f.value.includes("4 nights"))).toBe(true);
  });

  it("names a pipeline invariant violation", async () => {
    vi.mocked(readPipelineHealth).mockResolvedValueOnce({
      tenant_id: "tenant-test",
      checked_at: "2026-07-01T00:00:00Z",
      violations: [{ stage: "gsc" as never, expected: "recent rows", actual: "none", sentence: "I have not seen a fresh Search Console row in 9 days." }],
      summary: { gscRecentRows: 0, ga4RecentRows: null, profoundRecentRows: null, planCandidates: null, graphNodes: null, graphMoves: null },
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "system_health", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("fresh Search Console row"))).toBe(true);
  });

  it("names a failed publish canary check", async () => {
    vi.mocked(readPublishHealth).mockResolvedValueOnce({
      tenant_id: "tenant-test", whenIso: "2026-07-01T00:00:00Z", tokenOk: false, urlMapOk: null, dryRunOk: null,
      fixHint: "Reconnect Wix from Settings to restore publishing.",
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "system_health", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("Reconnect Wix"))).toBe(true);
    expect(dossier.facts.some((f) => f.source === "wix")).toBe(true);
  });

  it("says everything is clean when all three checks pass", async () => {
    vi.mocked(loadCronHealthView).mockResolvedValueOnce([
      { job: "nightly-sync", label: "Nightly sync", nextScheduledAtIso: null, lastRun: { startedAt: "2026-07-01T08:00:00Z", ok: true, durationMs: 100 }, headline: "I showed up 7 of 7 nights this week.", perSourceThisWeek: [], failureStreaks: [] },
    ] as never);
    vi.mocked(readPipelineHealth).mockResolvedValueOnce({
      tenant_id: "tenant-test", checked_at: "2026-07-01T00:00:00Z", violations: [],
      summary: { gscRecentRows: 10, ga4RecentRows: 10, profoundRecentRows: 10, planCandidates: 5, graphNodes: 5, graphMoves: 5 },
    } as never);
    vi.mocked(readPublishHealth).mockResolvedValueOnce({
      tenant_id: "tenant-test", whenIso: "2026-07-01T00:00:00Z", tokenOk: true, urlMapOk: true, dryRunOk: true,
    } as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "system_health", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts[0]!.value).toContain("came back clean");
  });

  it("gives an honest no-check-yet answer when nothing has ever run", async () => {
    const dossier = await assembleAskDossier(routed({ questionClass: "system_health", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts[0]!.value).toContain("do not have a recent health check yet");
  });

  // PIN (ground-truth finding): loadCronHealthView() always returns one entry per job in
  // the static CRON_SCHEDULE_MAP, even for a tenant that has never run a single cron -
  // cronJobs.length > 0 alone must NOT read as "checked and clean" for that tenant.
  it("does not claim 'clean' when cron-health-view returns jobs with no real lastRun", async () => {
    vi.mocked(loadCronHealthView).mockResolvedValueOnce([
      { job: "sync-connectors", label: "Nightly data sync", nextScheduledAtIso: "2026-07-03T09:00:00Z", lastRun: null, headline: "I have not run yet.", perSourceThisWeek: [], failureStreaks: [] },
      { job: "publish-canary", label: "Wix connection check", nextScheduledAtIso: "2026-07-03T08:51:00Z", lastRun: null, headline: "I have not run yet.", perSourceThisWeek: [], failureStreaks: [] },
    ] as never);
    const dossier = await assembleAskDossier(routed({ questionClass: "system_health", pagePath: null }));
    expect(dossier.facts[0]!.value).toContain("do not have a recent health check yet");
    expect(dossier.facts[0]!.value).not.toContain("came back clean");
  });

  it("fails soft when every health source throws", async () => {
    vi.mocked(loadCronHealthView).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(readPipelineHealth).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(readPublishHealth).mockRejectedValueOnce(new Error("boom"));
    const dossier = await assembleAskDossier(routed({ questionClass: "system_health", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts[0]!.value).toContain("do not have a recent health check yet");
  });
});

describe("ask/fact-assembly - bounds", () => {
  it("caps the total facts returned at 10", async () => {
    const days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, clicks: 100, impressions: 1000 }));
    vi.mocked(loadDailyTotalsForTenant).mockResolvedValueOnce(days);
    const dossier = await assembleAskDossier(routed({ questionClass: "site_trend", pagePath: null }));
    expect(dossier.facts.length).toBeLessThanOrEqual(10);
  });
});
