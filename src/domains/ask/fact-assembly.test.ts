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

import { assembleAskDossier } from "./fact-assembly";
import { loadPageDossier } from "@/app/(shell)/page/[...path]/page-dossier-data";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadProofLedgerCached } from "@/domains/proof-gsc/load-ledger";
import { getAnswerIntelligenceIndex } from "@/domains/answer-intelligence/store";
import { getAcceptedPlan } from "@/domains/experiments/daily-experiment-plan-store";
import type { RoutedQuestion } from "./router";

beforeEach(() => {
  vi.clearAllMocks();
});

function routed(over: Partial<RoutedQuestion> = {}): RoutedQuestion {
  return { questionClass: "page_specific", pagePath: "/cheetah", speaker: "gsc", ...over };
}

describe("ask/fact-assembly - page_specific", () => {
  it("returns hasData: false and an empty fact list when the dossier is empty", async () => {
    const dossier = await assembleAskDossier(routed());
    expect(dossier.hasData).toBe(false);
    expect(dossier.facts).toEqual([]);
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
});

describe("ask/fact-assembly - measurement", () => {
  it("builds facts from the proof ledger", async () => {
    vi.mocked(loadProofLedgerCached).mockResolvedValueOnce([
      { id: "1", page: "https://x/cheetah", path: "/cheetah", actionType: "edit_title", before: "a", after: "b", shippedAt: new Date().toISOString(), baseline: { clicks: 1, impressions: 1, ctr: 1, position: 1, windowDays: 28 }, targetQueries: [], controlPages: [], windows: [], verdict: "won", confidence: "medium", measuredAt: null } as never,
    ]);
    const dossier = await assembleAskDossier(routed({ questionClass: "measurement", pagePath: null }));
    expect(dossier.hasData).toBe(true);
    expect(dossier.facts.some((f) => f.source === "proof")).toBe(true);
    expect(dossier.facts.every((f) => f.href === "/proof")).toBe(true);
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
    expect(dossier.facts.every((f) => f.href === "/worklist")).toBe(true);
    expect(dossier.facts.some((f) => f.value.includes("cheetah facts"))).toBe(true);
  });

  it("returns no facts when there is no plan", async () => {
    const dossier = await assembleAskDossier(routed({ questionClass: "plan", pagePath: null }));
    expect(dossier.hasData).toBe(false);
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
