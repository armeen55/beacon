import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => false,
  getSupabaseAdmin: () => {
    throw new Error("should not be called in these tests - deps are injected");
  },
}));

vi.mock("@/domains/demand-graph/competitor-page-audit", () => ({
  getCompetitorAuditsForTenantId: async () => new Map(),
}));

import { buildRetrievalIndex, pickTopOwnedUrls, MAX_OWNED_PAGES, type BuildIndexDeps } from "./build-index";
import type { CompetitorPageAudit } from "@/domains/demand-graph/competitor-page-audit";
import type { EmbedBatchResult } from "./embeddings";

describe("pickTopOwnedUrls (pure)", () => {
  it("ranks by impressions, best-first", () => {
    const urls = ["a", "b", "c"];
    const demand = [
      { url: "a", impressions: 10 },
      { url: "b", impressions: 100 },
      { url: "c", impressions: 50 },
    ];
    expect(pickTopOwnedUrls(urls, demand, 10)).toEqual(["b", "c", "a"]);
  });

  it("treats a URL absent from demand as 0 impressions (sorts last, still included within cap)", () => {
    const urls = ["known", "unknown"];
    const demand = [{ url: "known", impressions: 5 }];
    expect(pickTopOwnedUrls(urls, demand, 10)).toEqual(["known", "unknown"]);
  });

  it("respects the limit", () => {
    const urls = ["a", "b", "c", "d"];
    const demand: { url: string; impressions: number }[] = [];
    expect(pickTopOwnedUrls(urls, demand, 2)).toHaveLength(2);
  });

  it("dedupes URLs", () => {
    expect(pickTopOwnedUrls(["a", "a", "b"], [], 10)).toEqual(["a", "b"]);
  });

  it("returns [] for an empty url list", () => {
    expect(pickTopOwnedUrls([], [], 10)).toEqual([]);
  });

  it("MAX_OWNED_PAGES matches the documented ~150 bound", () => {
    expect(MAX_OWNED_PAGES).toBe(150);
  });
});

function baseDeps(overrides: Partial<BuildIndexDeps> = {}): BuildIndexDeps {
  const embedResult: EmbedBatchResult = { embedded: [], cacheHits: 0, skipped: [], spentUsd: 0 };
  return {
    readOwnedDemand: async () => [],
    readOwnedUrls: async () => [],
    readOwnedSnapshots: async () => [],
    readCompetitorAudits: async () => new Map<string, CompetitorPageAudit>(),
    embed: (async () => embedResult) as unknown as BuildIndexDeps["embed"],
    ...overrides,
  };
}

describe("buildRetrievalIndex", () => {
  it("returns no_content when there are no owned pages and no competitor audits", async () => {
    const r = await buildRetrievalIndex("tenant-x", baseDeps());
    expect(r.status).toBe("no_content");
    expect(r.chunksBuilt).toBe(0);
    expect(r.message).toMatch(/do not have enough/i);
  });

  it("builds chunks from owned snapshots and reports the honest receipt", async () => {
    const embedded = [
      { id: "h1", source: "owned" as const, pageUrl: "https://iranopedia.com/nowruz", chunkText: "x", embedding: [1, 0] },
    ];
    const deps = baseDeps({
      readOwnedUrls: async () => ["https://iranopedia.com/nowruz"],
      readOwnedDemand: async () => [{ url: "https://iranopedia.com/nowruz", impressions: 500 }],
      readOwnedSnapshots: async () => [
        {
          url: "https://iranopedia.com/nowruz",
          title: "Nowruz Guide",
          meta_description: "A guide to Nowruz.",
          h1: "How Persians Celebrate Nowruz",
          h2_list: ["The Haft-Sin Table"],
          body_paragraph_sample: ["Nowruz marks the Persian new year."],
          card_texts: [],
          faqs: [{ question: "What is the haft-sin table?" }],
        },
      ],
      embed: (async () => ({ embedded, cacheHits: 0, skipped: [], spentUsd: 0.0001 })) as unknown as BuildIndexDeps["embed"],
    });
    const r = await buildRetrievalIndex("tenant-x", deps);
    expect(r.status).toBe("ok");
    expect(r.ownedPagesConsidered).toBe(1);
    expect(r.chunksBuilt).toBeGreaterThan(0);
    expect(r.chunksEmbedded).toBe(1);
    expect(r.message).toContain("1 of your pages");
    expect(/[–—]/.test(r.message)).toBe(false); // dash guard
  });

  it("includes competitor audits with 'ok' fetchStatus and facts, skips failed/empty ones", async () => {
    const okAudit: CompetitorPageAudit = {
      url: "https://wikipedia.org/nowruz",
      domain: "wikipedia.org",
      fetchStatus: "ok",
      httpStatus: 200,
      facts: {
        canonicalUrl: null,
        title: "Nowruz",
        metaDescription: "Persian new year.",
        h1: "Nowruz",
        h2Count: 1,
        h3Count: 0,
        outline: ["History"],
        schemaTypes: [],
        hasFaq: false,
        faqQuestionCount: 0,
        faqQuestions: [],
        hasAnswerBlock: true,
        wordCount: 500,
        sectionCount: 1,
        internalLinkCount: 5,
        externalLinkCount: 2,
        imageCount: 1,
        hasToolOrCalculator: false,
        freshnessDate: null,
        ogTitle: null,
        ogType: null,
        topTerms: ["nowruz"],
      },
      contentHash: "abc",
      auditedAt: new Date().toISOString(),
      error: null,
    };
    const failedAudit: CompetitorPageAudit = {
      url: "https://blocked.example.com/x",
      domain: "blocked.example.com",
      fetchStatus: "blocked_robots",
      httpStatus: null,
      facts: null,
      contentHash: null,
      auditedAt: new Date().toISOString(),
      error: null,
    };
    const map = new Map<string, CompetitorPageAudit>([
      [okAudit.url, okAudit],
      [failedAudit.url, failedAudit],
    ]);
    const embedded = [{ id: "h1", source: "competitor" as const, pageUrl: okAudit.url, chunkText: "x", embedding: [1, 0] }];
    const deps = baseDeps({
      readCompetitorAudits: async () => map,
      embed: (async () => ({ embedded, cacheHits: 0, skipped: [], spentUsd: 0.0001 })) as unknown as BuildIndexDeps["embed"],
    });
    const r = await buildRetrievalIndex("tenant-x", deps);
    expect(r.status).toBe("ok");
    expect(r.competitorPagesConsidered).toBe(1); // only the "ok" one counts
  });

  it("never throws even when every read dependency rejects", async () => {
    const deps = baseDeps({
      readOwnedUrls: async () => {
        throw new Error("boom");
      },
      readOwnedDemand: async () => {
        throw new Error("boom");
      },
      readCompetitorAudits: async () => {
        throw new Error("boom");
      },
    });
    const r = await buildRetrievalIndex("tenant-x", deps);
    expect(r.status).toBe("no_content");
  });
});
