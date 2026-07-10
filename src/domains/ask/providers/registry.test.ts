import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ask/providers/registry.test (W9 slice 1) - pins the REGISTRY's own contract, mocking
 * fact-assembly.ts at its exported-function boundary (the same 9 assemblers each
 * provider wraps) rather than re-testing their internal composition logic - that is
 * already covered by fact-assembly.test.ts. This file proves: each provider is a
 * behavior-identical thin wrapper (same args in, same facts out); gatherFacts dispatches
 * only to providers registered for the routed class; one provider throwing never blanks
 * another registered for the same class (fail-soft); and tenantId is threaded through
 * unmodified so tenant A's gather never returns tenant B's facts.
 */

const mocks = vi.hoisted(() => ({
  assemblePageFacts: vi.fn(),
  assembleSiteTrendFacts: vi.fn(),
  assemblePageRankingFacts: vi.fn(),
  assembleAiVisibilityFacts: vi.fn(),
  assembleCompetitorFacts: vi.fn(),
  assembleMeasurementFacts: vi.fn(),
  assemblePlanFacts: vi.fn(),
  assembleKeywordNextFacts: vi.fn(),
  assembleSystemHealthFacts: vi.fn(),
  latestGscDailyDate: vi.fn(),
}));

vi.mock("../fact-assembly", () => mocks);

import {
  gatherFacts,
  gatherPlan,
  ALL_PROVIDERS,
  pageSpecificProvider,
  siteTrendProvider,
  pageRankingProvider,
  aiVisibilityProvider,
  competitorProvider,
  measurementProvider,
  planProvider,
  keywordNextProvider,
  systemHealthProvider,
} from "./registry";
import type { RoutedQuestion } from "../router";
import type { AskPlan } from "../planner";
import type { AskFactProvider } from "./provider-types";

function routed(over: Partial<RoutedQuestion> = {}): RoutedQuestion {
  return { questionClass: "site_trend", pagePath: null, speaker: "gsc", ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.latestGscDailyDate.mockResolvedValue(null);
});

describe("ask/providers/registry - thin-wrap behavior parity", () => {
  it("pageSpecificProvider calls assemblePageFacts with tenantId + the routed pagePath", async () => {
    mocks.assemblePageFacts.mockResolvedValueOnce([{ value: "x", source: "gsc", href: "/page/cheetah" }]);
    const facts = await pageSpecificProvider.gather("tenant-a", routed({ questionClass: "page_specific", pagePath: "/cheetah" }));
    expect(mocks.assemblePageFacts).toHaveBeenCalledWith("tenant-a", "/cheetah");
    expect(facts).toEqual([{ value: "x", source: "gsc", href: "/page/cheetah" }]);
  });

  it("pageSpecificProvider returns [] without calling the loader when no pagePath is routed", async () => {
    const facts = await pageSpecificProvider.gather("tenant-a", routed({ questionClass: "page_specific", pagePath: null }));
    expect(facts).toEqual([]);
    expect(mocks.assemblePageFacts).not.toHaveBeenCalled();
  });

  it("pageRankingProvider passes the routed rankingMetric through, defaulting to traffic", async () => {
    mocks.assemblePageRankingFacts.mockResolvedValue([]);
    await pageRankingProvider.gather("tenant-a", routed({ questionClass: "page_ranking", rankingMetric: "money" }));
    expect(mocks.assemblePageRankingFacts).toHaveBeenCalledWith("tenant-a", "money");
    await pageRankingProvider.gather("tenant-a", routed({ questionClass: "page_ranking" }));
    expect(mocks.assemblePageRankingFacts).toHaveBeenCalledWith("tenant-a", "traffic");
  });

  it("measurementProvider, planProvider, systemHealthProvider thread tenantId through unchanged", async () => {
    mocks.assembleMeasurementFacts.mockResolvedValueOnce([]);
    mocks.assemblePlanFacts.mockResolvedValueOnce([]);
    mocks.assembleSystemHealthFacts.mockResolvedValueOnce([]);
    await measurementProvider.gather("tenant-a", routed({ questionClass: "measurement" }));
    await planProvider.gather("tenant-a", routed({ questionClass: "plan" }));
    await systemHealthProvider.gather("tenant-a", routed({ questionClass: "system_health" }));
    expect(mocks.assembleMeasurementFacts).toHaveBeenCalledWith("tenant-a");
    expect(mocks.assemblePlanFacts).toHaveBeenCalledWith("tenant-a");
    expect(mocks.assembleSystemHealthFacts).toHaveBeenCalledWith("tenant-a");
  });

  it("aiVisibilityProvider, competitorProvider, keywordNextProvider thread the EXPLICIT tenantId to their assemblers (Codex P2)", async () => {
    mocks.assembleAiVisibilityFacts.mockResolvedValueOnce([]);
    mocks.assembleCompetitorFacts.mockResolvedValueOnce([]);
    mocks.assembleKeywordNextFacts.mockResolvedValueOnce([]);
    await aiVisibilityProvider.gather("tenant-a", routed({ questionClass: "ai_visibility" }));
    await competitorProvider.gather("tenant-a", routed({ questionClass: "competitor" }));
    await keywordNextProvider.gather("tenant-a", routed({ questionClass: "keyword_next" }));
    // No longer ambient: each is called WITH the explicit tenantId, never zero-arg.
    expect(mocks.assembleAiVisibilityFacts).toHaveBeenCalledWith("tenant-a");
    expect(mocks.assembleCompetitorFacts).toHaveBeenCalledWith("tenant-a");
    expect(mocks.assembleKeywordNextFacts).toHaveBeenCalledWith("tenant-a");
  });
});

describe("ask/providers/registry - explicit-tenant isolation for the formerly-ambient providers (Codex P2)", () => {
  it("tenant A's ai_visibility/competitor/keyword_next gather never returns tenant B's facts", async () => {
    mocks.assembleAiVisibilityFacts.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a"
        ? [{ value: "tenant A visibility", source: "profound", href: "/prompts" }]
        : [{ value: "tenant B visibility", source: "profound", href: "/prompts" }],
    );
    mocks.assembleCompetitorFacts.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a"
        ? [{ value: "tenant A competitor", source: "dataforseo", href: "/prompts" }]
        : [{ value: "tenant B competitor", source: "dataforseo", href: "/prompts" }],
    );
    mocks.assembleKeywordNextFacts.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a"
        ? [{ value: "tenant A keyword", source: "dataforseo", href: "/research/keywords" }]
        : [{ value: "tenant B keyword", source: "dataforseo", href: "/research/keywords" }],
    );

    const visA = await gatherFacts("tenant-a", routed({ questionClass: "ai_visibility" }));
    const compA = await gatherFacts("tenant-a", routed({ questionClass: "competitor" }));
    const kwA = await gatherFacts("tenant-a", routed({ questionClass: "keyword_next" }));

    expect(visA.map((f) => f.value)).toEqual(["tenant A visibility"]);
    expect(compA.map((f) => f.value)).toEqual(["tenant A competitor"]);
    expect(kwA.map((f) => f.value)).toEqual(["tenant A keyword"]);
    expect([...visA, ...compA, ...kwA].some((f) => f.value.includes("tenant B"))).toBe(false);
  });
});

describe("ask/providers/registry - siteTrendProvider (the Slice 1 wired intent)", () => {
  it("stamps freshnessIso/providerId/prodLive from the latest GSC daily-totals date", async () => {
    mocks.assembleSiteTrendFacts.mockResolvedValueOnce([
      { value: "Sitewide clicks over the last 7 reported days: 342.", source: "gsc", href: "/" },
    ]);
    mocks.latestGscDailyDate.mockResolvedValueOnce("2026-07-08");
    const facts = await siteTrendProvider.gather("tenant-a", routed());
    expect(mocks.assembleSiteTrendFacts).toHaveBeenCalledWith("tenant-a");
    expect(facts).toEqual([
      {
        value: "Sitewide clicks over the last 7 reported days: 342.",
        source: "gsc",
        href: "/",
        freshnessIso: "2026-07-08",
        providerId: "gsc-daily-totals",
        prodLive: true,
      },
    ]);
  });

  it("returns the plain facts unchanged when no freshness date is available", async () => {
    mocks.assembleSiteTrendFacts.mockResolvedValueOnce([{ value: "x", source: "gsc", href: "/" }]);
    mocks.latestGscDailyDate.mockResolvedValueOnce(null);
    const facts = await siteTrendProvider.gather("tenant-a", routed());
    expect(facts).toEqual([{ value: "x", source: "gsc", href: "/" }]);
  });

  it("is marked prodLive: true (gsc_daily_totals is a direct Supabase table read)", () => {
    expect(siteTrendProvider.prodLive).toBe(true);
  });
});

describe("ask/providers/registry - gatherFacts dispatch", () => {
  it("only calls providers registered for the routed class", async () => {
    mocks.assembleSiteTrendFacts.mockResolvedValueOnce([{ value: "trend", source: "gsc", href: "/" }]);
    const facts = await gatherFacts("tenant-a", routed({ questionClass: "site_trend" }));
    expect(facts).toEqual([{ value: "trend", source: "gsc", href: "/" }]);
    expect(mocks.assemblePageFacts).not.toHaveBeenCalled();
    expect(mocks.assembleMeasurementFacts).not.toHaveBeenCalled();
    expect(mocks.assemblePlanFacts).not.toHaveBeenCalled();
  });

  it("is fail-soft: one provider throwing never blanks another provider registered for the same class", async () => {
    const healthy: AskFactProvider = {
      id: "healthy",
      label: "Results so far",
      classes: ["measurement"],
      prodLive: true,
      gather: async () => [{ value: "healthy fact", source: "proof", href: "/results" }],
    };
    const throwing: AskFactProvider = {
      id: "throwing",
      label: "Results so far",
      classes: ["measurement"],
      prodLive: true,
      gather: async () => {
        throw new Error("boom - this provider is broken");
      },
    };
    const facts = await gatherFacts("tenant-a", routed({ questionClass: "measurement" }), [throwing, healthy]);
    expect(facts).toEqual([{ value: "healthy fact", source: "proof", href: "/results" }]);
  });

  it("returns [] (never throws to the caller) when the only matching provider throws", async () => {
    const throwing: AskFactProvider = {
      id: "throwing",
      label: "Results so far",
      classes: ["measurement"],
      prodLive: true,
      gather: async () => {
        throw new Error("boom");
      },
    };
    await expect(gatherFacts("tenant-a", routed({ questionClass: "measurement" }), [throwing])).resolves.toEqual([]);
  });

  it("every registered provider has a unique id (provenance must be unambiguous)", () => {
    const ids = ALL_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every one of the 9 wrapped question classes has exactly one registered provider today", () => {
    const classes = ALL_PROVIDERS.flatMap((p) => p.classes);
    expect(new Set(classes).size).toBe(9);
    expect(classes.length).toBe(9);
  });
});

describe("ask/providers/registry - two-tenant isolation", () => {
  it("threads the exact tenantId through - tenant A's gather never returns tenant B's facts", async () => {
    mocks.assemblePageFacts.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a"
        ? [{ value: "tenant A's page fact", source: "gsc", href: "/page/a" }]
        : [{ value: "tenant B's page fact", source: "gsc", href: "/page/b" }],
    );
    mocks.assembleSiteTrendFacts.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a" ? [{ value: "tenant A clicks", source: "gsc", href: "/" }] : [{ value: "tenant B clicks", source: "gsc", href: "/" }],
    );

    const pageFactsA = await gatherFacts("tenant-a", routed({ questionClass: "page_specific", pagePath: "/x" }));
    const pageFactsB = await gatherFacts("tenant-b", routed({ questionClass: "page_specific", pagePath: "/x" }));
    expect(pageFactsA.map((f) => f.value)).toEqual(["tenant A's page fact"]);
    expect(pageFactsB.map((f) => f.value)).toEqual(["tenant B's page fact"]);
    expect(pageFactsA.some((f) => f.value.includes("tenant B"))).toBe(false);
    expect(pageFactsB.some((f) => f.value.includes("tenant A"))).toBe(false);

    const trendA = await gatherFacts("tenant-a", routed({ questionClass: "site_trend" }));
    const trendB = await gatherFacts("tenant-b", routed({ questionClass: "site_trend" }));
    expect(trendA.map((f) => f.value)).toEqual(["tenant A clicks"]);
    expect(trendB.map((f) => f.value)).toEqual(["tenant B clicks"]);
    expect(trendA.some((f) => f.value.includes("tenant B"))).toBe(false);
    expect(trendB.some((f) => f.value.includes("tenant A"))).toBe(false);
  });
});

// ── W9 slice 2 (2026-07-10): gatherPlan over an already-selected multi-provider plan ─────

function plan(over: Partial<AskPlan> = {}): AskPlan {
  return {
    routed: { questionClass: "page_ranking", pagePath: null, rankingMetric: "money", speaker: "gsc" },
    selections: [
      { provider: pageRankingProvider, matchedClass: "page_ranking", reason: "primary" },
      { provider: planProvider, matchedClass: "plan", reason: "secondary_cue" },
    ],
    selectedClasses: ["page_ranking", "plan"],
    deterministic: false,
    bestEffortOnly: false,
    ...over,
  };
}

describe("ask/providers/registry - gatherPlan", () => {
  it("runs EXACTLY the plan's selected providers (never an unselected class) and stamps central provenance", async () => {
    mocks.assemblePageRankingFacts.mockResolvedValueOnce([{ value: "rank fact", source: "gsc", href: "/results" }]);
    mocks.assemblePlanFacts.mockResolvedValueOnce([{ value: "plan fact", source: "llm", href: "/changes" }]);

    const facts = await gatherPlan("tenant-a", plan());

    expect(mocks.assemblePageRankingFacts).toHaveBeenCalledWith("tenant-a", "money");
    expect(mocks.assemblePlanFacts).toHaveBeenCalledWith("tenant-a");
    expect(mocks.assembleSiteTrendFacts).not.toHaveBeenCalled();
    expect(mocks.assembleMeasurementFacts).not.toHaveBeenCalled();
    // central provenance stamp: providerId + prodLive filled from the selecting provider.
    expect(facts.find((f) => f.value === "rank fact")).toMatchObject({ providerId: "page-ranking", prodLive: true });
    expect(facts.find((f) => f.value === "plan fact")).toMatchObject({ providerId: "daily-plan", prodLive: true });
  });

  it("is fail-soft per provider: one throwing never blanks another selected provider", async () => {
    mocks.assemblePageRankingFacts.mockRejectedValueOnce(new Error("boom"));
    mocks.assemblePlanFacts.mockResolvedValueOnce([{ value: "plan fact", source: "llm", href: "/changes" }]);
    const facts = await gatherPlan("tenant-a", plan());
    expect(facts.map((f) => f.value)).toEqual(["plan fact"]);
  });

  it("NEVER overwrites provenance a provider already set (siteTrendProvider keeps its own freshness)", async () => {
    mocks.assembleSiteTrendFacts.mockResolvedValueOnce([{ value: "trend", source: "gsc", href: "/" }]);
    mocks.latestGscDailyDate.mockResolvedValueOnce("2026-07-08");
    const trendPlan = plan({
      routed: { questionClass: "site_trend", pagePath: null, speaker: "gsc" },
      selections: [{ provider: siteTrendProvider, matchedClass: "site_trend", reason: "primary" }],
      selectedClasses: ["site_trend"],
      deterministic: true,
      bestEffortOnly: true,
    });
    const facts = await gatherPlan("tenant-a", trendPlan);
    expect(facts[0]).toMatchObject({ freshnessIso: "2026-07-08", providerId: "gsc-daily-totals", prodLive: true });
  });

  it("threads the exact tenantId - tenant A's plan gather never returns tenant B's facts", async () => {
    mocks.assemblePageRankingFacts.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a" ? [{ value: "A rank", source: "gsc", href: "/results" }] : [{ value: "B rank", source: "gsc", href: "/results" }],
    );
    mocks.assemblePlanFacts.mockResolvedValue([]);
    const a = await gatherPlan("tenant-a", plan());
    const b = await gatherPlan("tenant-b", plan());
    expect(a.map((f) => f.value)).toEqual(["A rank"]);
    expect(b.map((f) => f.value)).toEqual(["B rank"]);
  });
});
