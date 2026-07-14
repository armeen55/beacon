import { describe, expect, it, vi } from "vitest";

import type { RankedUnifiedEntry } from "@/domains/allocator/unified-list";
import type { CompetitorPageAudit } from "@/domains/demand-graph/competitor-page-audit";
import { researchFinalRankedSerps } from "./ranked-serp-research";

function entry(over: Partial<RankedUnifiedEntry> = {}): RankedUnifiedEntry {
  return {
    id: "one",
    query: "persian tea culture",
    page: "https://iranopedia.com/tea",
    topic: null,
    pageLabel: "Persian Tea",
    kind: "edit",
    sources: ["worklist"],
    exactWhat: "Improve the answer.",
    expectedValue: { low: 100, high: 200, basis: "GSC", days: 28, hypothesisId: null },
    confidence: 0.8,
    risk: "low",
    riskFlags: [],
    effortMinutes: 20,
    forecastBasis: "Measured demand",
    hold: { held: false, reason: null },
    rank: 1,
    allocatorScore: 90,
    demandEvidence: { gscMonthly: 100, searchVolumeMonthly: null },
    competitorUrls: ["https://old.example/tea"],
    fanoutSeeds: [],
    graphBacked: true,
    ...over,
  } as RankedUnifiedEntry;
}

const audit = (url: string): CompetitorPageAudit => ({
  url,
  domain: new URL(url).hostname,
  fetchStatus: "ok",
  httpStatus: 200,
  facts: {
    canonicalUrl: url,
    title: "Winner",
    metaDescription: null,
    h1: "Winner",
    h2Count: 2,
    h3Count: 0,
    outline: ["Answer", "Details"],
    schemaTypes: ["Article"],
    hasFaq: false,
    faqQuestionCount: 0,
    faqQuestions: [],
    hasAnswerBlock: true,
    wordCount: 900,
    sectionCount: 2,
    internalLinkCount: 3,
    externalLinkCount: 1,
    imageCount: 1,
    hasToolOrCalculator: false,
    freshnessDate: null,
    ogTitle: null,
    ogType: null,
    topTerms: ["winner"],
  },
  contentHash: "hash",
  auditedAt: "2026-07-14T00:00:00.000Z",
  error: null,
});

describe("researchFinalRankedSerps", () => {
  it("preserves final order and score while adding and auditing live organic winners", async () => {
    const entries = [entry(), entry({ id: "two", query: "persian wedding ceremony", allocatorScore: 50 })];
    const runSerp = vi.fn(async (query: string) => ({
      status: "ok" as const,
      plan: {} as never,
      snapshot: {
        query,
        source: "dataforseo" as const,
        fetchedAt: "2026-07-14T00:00:00.000Z",
        features: [],
        results: [
          { rank: 1, url: `https://winner.example/${query.replaceAll(" ", "-")}`, domain: "winner.example", title: `Complete ${query} guide` },
          { rank: 2, url: "https://iranopedia.com/already-owned", domain: "iranopedia.com", title: query },
          { rank: 3, url: "https://reddit.com/noise", domain: "reddit.com", title: query },
        ],
      },
      costUsd: 0.003,
      detail: "ok",
    }));
    const auditUrls = vi.fn(async (urls: readonly string[]) => ({ audits: urls.map(audit), fromCache: 1 }));

    const result = await researchFinalRankedSerps(entries, {}, { runSerp: runSerp as never, auditUrls });

    expect(result.entries.map((row) => row.id)).toEqual(["one", "two"]);
    expect(result.entries.map((row) => row.allocatorScore)).toEqual([90, 50]);
    expect(result.entries[0]!.competitorUrls[0]).toContain("winner.example/persian-tea-culture");
    expect(auditUrls).toHaveBeenCalledTimes(1);
    expect(auditUrls.mock.calls[0]![0]).toHaveLength(2);
    expect(result.queriesChecked).toBe(2);
    expect(result.winnerPagesAnalyzed).toBe(2);
    expect(result.winnerPagesFromCache).toBe(1);
    expect(result.costUsd).toBe(0.006);
  });

  it("is fail-soft and leaves entries unchanged when the guarded runner has no snapshot", async () => {
    const original = entry();
    const result = await researchFinalRankedSerps([original], {}, {
      runSerp: vi.fn(async () => ({ status: "dry_run", plan: {} as never, snapshot: null, costUsd: 0, detail: "dry" })) as never,
      auditUrls: vi.fn(),
    });
    expect(result.entries[0]).toBe(original);
    expect(result.queriesChecked).toBe(0);
    expect(result.winnerPagesAnalyzed).toBe(0);
    expect(result.costUsd).toBe(0);
  });
});
