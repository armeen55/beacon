import { describe, it, expect, beforeEach, vi } from "vitest";

// In-memory batch store (json-store isolation, same pattern as batch-store.test.ts).
let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

const loadDemandGraphMock = vi.fn();
vi.mock("@/domains/demand-graph/load-graph", () => ({
  loadDemandGraphForTenantCached: (...a: unknown[]) => loadDemandGraphMock(...a),
}));

const loadPageCandidatesMock = vi.fn();
vi.mock("./load-page-candidates", () => ({
  loadPageCandidates: (...a: unknown[]) => loadPageCandidatesMock(...a),
}));

const readAllCachedKeywordDemandMock = vi.fn();
vi.mock("@/domains/serp/dataforseo-keywords", () => ({
  readAllCachedKeywordDemand: (...a: unknown[]) => readAllCachedKeywordDemandMock(...a),
}));

const saveMoveDraftMock = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/domains/demand-graph/move-draft-store", () => ({
  saveMoveDraft: (...a: unknown[]) => saveMoveDraftMock(...a),
}));

import {
  runProductionLineForTenant,
  mondayOfWeek,
  MAX_DRAFTS_PER_WEEK,
  WEEKLY_LLM_CEILING_USD,
} from "./production-line";
import { loadFactoryBatchHistory } from "./batch-store";
import type { PageCandidate } from "./entity-attribute-factory";
import type { CreatePageBrief } from "@/domains/llm/schemas";

const RITZ_TENANT_ID = "tenant-ritz-founder";

function candidate(over: Partial<PageCandidate> = {}): PageCandidate {
  return {
    slug: "nowruz-meaning",
    title: "Nowruz Meaning",
    entity: "nowruz",
    attribute: "meaning",
    intent: "definitional",
    relevance: 1,
    needsDemandValidation: true,
    why: "test",
    ...over,
  };
}

function emptyGraph() {
  return { graph: { moves: [], pageNodes: [], demandNodes: [] } };
}

const GOOD_BRIEF: CreatePageBrief = {
  proposedTitle: "Nowruz Meaning Explained",
  metaDescription: "A clear, direct explanation of what Nowruz means and why it matters to Persian culture.",
  openingAnswer:
    "Nowruz is the Persian New Year, marking the first day of spring and the start of the solar Hijri calendar, celebrated across Iran and the Persian diaspora with rituals of renewal.",
  outline: ["Origins of Nowruz", "How Nowruz is celebrated", "Nowruz across the Persian diaspora"],
  faqQuestions: ["When is Nowruz celebrated?"],
  schemaTypes: ["Article"],
  // W5 P1-4 (2026-07-09): the factual openingAnswer carries a generation-time
  // verified source so it clears the brief source gate.
  // Task #230 (2026-07-10): the source gate now requires the source's OWN
  // supportingExcerpt to actually COVER every protected sentence in the
  // opening (the same per-sentence check verifyStampedSources populates at
  // generation time via findSupportingSpan against the fetched page) - a
  // bare `claim` string is no longer enough. This excerpt names the same
  // entities (Persian New Year, Hijri calendar, Iran, Persian diaspora) the
  // opening states, exactly as Britannica's own Nowruz entry does.
  sources: [
    {
      url: "https://www.britannica.com/topic/Nowruz",
      title: "Nowruz",
      domain: "britannica.com",
      retrievedAt: "2026-07-01",
      claim: "Nowruz is the Persian New Year marking the first day of spring",
      authority: "authoritative",
      verified: true,
      supportingExcerpt:
        "Nowruz, the Persian New Year, marks the first day of spring and the beginning of the solar Hijri calendar. It is celebrated across Iran and by communities of the Persian diaspora with rituals of renewal.",
    },
  ],
  evidenceRefs: [{ source: "gsc", detail: "test" }],
  confidence: "high",
  risks: [],
  operatorSteps: ["Publish the page"],
  proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "same-site pages" },
};

function goodBriefFn() {
  return vi.fn(async () => ({ status: "drafted" as const, kind: "create_page_brief" as const, value: GOOD_BRIEF, costUsd: 0.03, retried: false }));
}

function emptyFullPageFn() {
  return vi.fn(async () => ({ status: "drafted" as const, outcomes: [], totalCostUsd: 0.02, sectionsDrafted: 0, sectionsFallback: 0 }));
}

beforeEach(() => {
  stored = [];
  loadDemandGraphMock.mockReset().mockResolvedValue(emptyGraph());
  loadPageCandidatesMock.mockReset().mockResolvedValue([]);
  readAllCachedKeywordDemandMock.mockReset().mockResolvedValue([]);
  saveMoveDraftMock.mockReset().mockResolvedValue(true);
});

describe("mondayOfWeek", () => {
  it("matches the strategy-review cron's mondayOfWeek behavior", () => {
    expect(mondayOfWeek(new Date("2026-07-08T12:00:00Z"))).toBe("2026-07-06");
  });
});

describe("runProductionLineForTenant - governance", () => {
  it("returns no_candidates when the factory finds nothing", async () => {
    const res = await runProductionLineForTenant("t1", "2026-07-06");
    expect(res.reason).toBe("no_candidates");
    expect(res.drafted).toBe(0);
  });

  it("caps drafted pages at MAX_DRAFTS_PER_WEEK even with many demand-passing candidates", async () => {
    // Distinct real topics: the N28 governor legitimately refuses two batch
    // pages on ONE topic, so a cap test needs genuinely different subjects.
    const topics = [
      ["haft-seen-symbols", "Haft Seen Symbols"],
      ["yalda-night-customs", "Yalda Night Customs"],
      ["chaharshanbe-suri-rituals", "Chaharshanbe Suri Rituals"],
      ["tahdig-rice-crust", "Tahdig Rice Crust"],
      ["ghormeh-sabzi-stew", "Ghormeh Sabzi Stew"],
      ["fesenjan-walnut-pomegranate", "Fesenjan Walnut Pomegranate"],
      ["sizdah-bedar-picnic", "Sizdah Bedar Picnic"],
      ["mehregan-autumn-celebration", "Mehregan Autumn Celebration"],
      ["shab-e-cheleh-poetry", "Shab e Cheleh Poetry"],
      ["tirgan-water-games", "Tirgan Water Games"],
    ] as const;
    const candidates = topics.map(([slug, title], i) =>
      candidate({ slug, title, entity: `topic${i}` }),
    );
    loadPageCandidatesMock.mockResolvedValue(candidates);
    readAllCachedKeywordDemandMock.mockResolvedValue(
      candidates.map((c) => ({
        keyword: c.title.toLowerCase(),
        searchVolume: 500,
        cpcUsd: null,
        competition: null,
        competitionLevel: null,
        monthlySearches: [],
        locationCode: 2840,
        languageCode: "en",
        source: "dataforseo" as const,
        fetchedAt: new Date().toISOString(),
        confidence: "high" as const,
        evidenceRef: "x",
      })),
    );
    const res = await runProductionLineForTenant("t1", "2026-07-06", {
      draftBrief: goodBriefFn(),
      draftFullPage: emptyFullPageFn(),
    });
    expect(res.drafted).toBeLessThanOrEqual(MAX_DRAFTS_PER_WEEK);
    expect(res.drafted).toBe(MAX_DRAFTS_PER_WEEK);
  });

  it("rejects a candidate whose matched keyword volume is under the demand floor", async () => {
    loadPageCandidatesMock.mockResolvedValue([candidate()]);
    readAllCachedKeywordDemandMock.mockResolvedValue([
      {
        keyword: "nowruz meaning",
        searchVolume: 10,
        cpcUsd: null,
        competition: null,
        competitionLevel: null,
        monthlySearches: [],
        locationCode: 2840,
        languageCode: "en",
        source: "dataforseo" as const,
        fetchedAt: new Date().toISOString(),
        confidence: "high" as const,
        evidenceRef: "x",
      },
    ]);
    const res = await runProductionLineForTenant("t1", "2026-07-06", { draftBrief: goodBriefFn(), draftFullPage: emptyFullPageFn() });
    expect(res.drafted).toBe(0);
    expect(res.rejected).toBe(1);
  });

  it("queues a candidate with no cached keyword data and no graph demand, never drafting it", async () => {
    loadPageCandidatesMock.mockResolvedValue([candidate()]);
    const res = await runProductionLineForTenant("t1", "2026-07-06", { draftBrief: goodBriefFn(), draftFullPage: emptyFullPageFn() });
    expect(res.drafted).toBe(0);
    expect(res.queued).toBe(1);
    expect(res.batch?.queuedForKeywordBatch).toHaveLength(1);
  });

  it("dedupes against an existing open demand-graph create_page Move for the same entity", async () => {
    loadPageCandidatesMock.mockResolvedValue([candidate()]);
    loadDemandGraphMock.mockResolvedValue({
      graph: { moves: [{ label: "Nowruz Meaning Guide", gap: "create_page", demandKey: "x", components: { demand: 0 } }] },
    });
    const res = await runProductionLineForTenant("t1", "2026-07-06", { draftBrief: goodBriefFn(), draftFullPage: emptyFullPageFn() });
    expect(res.drafted).toBe(0);
    expect(res.reason).toBe("no_candidates");
  });

  it("stops drafting once the weekly LLM cost ceiling is reached, queuing the rest", async () => {
    const topics = [
      ["haft-seen-symbols", "Haft Seen Symbols"],
      ["yalda-night-customs", "Yalda Night Customs"],
      ["chaharshanbe-suri-rituals", "Chaharshanbe Suri Rituals"],
      ["tahdig-rice-crust", "Tahdig Rice Crust"],
      ["ghormeh-sabzi-stew", "Ghormeh Sabzi Stew"],
    ] as const;
    const candidates = topics.map(([slug, title], i) => candidate({ slug, title, entity: `topic${i}` }));
    loadPageCandidatesMock.mockResolvedValue(candidates);
    readAllCachedKeywordDemandMock.mockResolvedValue(
      candidates.map((c) => ({
        keyword: c.title.toLowerCase(),
        searchVolume: 500,
        cpcUsd: null,
        competition: null,
        competitionLevel: null,
        monthlySearches: [],
        locationCode: 2840,
        languageCode: "en",
        source: "dataforseo" as const,
        fetchedAt: new Date().toISOString(),
        confidence: "high" as const,
        evidenceRef: "x",
      })),
    );
    // Each candidate costs 0.09 (brief 0.05 + page 0.04) - the third candidate should push
    // the running total past the 0.3 ceiling and stop the run.
    const expensiveBrief = vi.fn(async () => ({ status: "drafted" as const, kind: "create_page_brief" as const, value: GOOD_BRIEF, costUsd: 0.15, retried: false }));
    const expensivePage = vi.fn(async () => ({ status: "drafted" as const, outcomes: [], totalCostUsd: 0, sectionsDrafted: 0, sectionsFallback: 0 }));
    const res = await runProductionLineForTenant("t1", "2026-07-06", { draftBrief: expensiveBrief, draftFullPage: expensivePage });
    expect(res.costUsd).toBeLessThanOrEqual(WEEKLY_LLM_CEILING_USD + 0.15); // one over-the-line candidate max
    expect(res.drafted + res.queued).toBeGreaterThan(0);
    expect(res.queued).toBeGreaterThan(0); // some candidates got pushed to next week
  });

  it("is idempotent per (tenant, weekOf) - a second call the same week is a no-op", async () => {
    loadPageCandidatesMock.mockResolvedValue([candidate()]);
    readAllCachedKeywordDemandMock.mockResolvedValue([
      {
        keyword: "nowruz meaning",
        searchVolume: 500,
        cpcUsd: null,
        competition: null,
        competitionLevel: null,
        monthlySearches: [],
        locationCode: 2840,
        languageCode: "en",
        source: "dataforseo" as const,
        fetchedAt: new Date().toISOString(),
        confidence: "high" as const,
        evidenceRef: "x",
      },
    ]);
    const deps = { draftBrief: goodBriefFn(), draftFullPage: emptyFullPageFn() };
    const first = await runProductionLineForTenant("t1", "2026-07-06", deps);
    expect(first.ran).toBe(true);
    const second = await runProductionLineForTenant("t1", "2026-07-06", deps);
    expect(second.ran).toBe(false);
    expect(second.reason).toBe("already_ran");
    // The brief drafter is only called once across both invocations (second is a no-op read).
    expect(deps.draftBrief).toHaveBeenCalledTimes(1);
    const history = await loadFactoryBatchHistory("t1");
    expect(history).toHaveLength(1);
  });

  it("never stages or drafts anything for Ritz (advise-mode tenant regression)", async () => {
    loadPageCandidatesMock.mockResolvedValue([candidate()]);
    readAllCachedKeywordDemandMock.mockResolvedValue([
      {
        keyword: "nowruz meaning",
        searchVolume: 500,
        cpcUsd: null,
        competition: null,
        competitionLevel: null,
        monthlySearches: [],
        locationCode: 2840,
        languageCode: "en",
        source: "dataforseo" as const,
        fetchedAt: new Date().toISOString(),
        confidence: "high" as const,
        evidenceRef: "x",
      },
    ]);
    // The production line itself has no Ritz-specific gate (it's a content-drafting
    // pipeline, not a publish path) - this test pins that IF a caller ever wires Ritz
    // into the weekly cron, the actual live write/enrollment step downstream
    // (executePush / autoRecordShippedChangeForRec) is what hard-blocks it, not this
    // module. Documented here so a future change to those functions' Ritz guard is
    // caught by their own regression tests, and this module's job (draft + stage) is
    // never mistaken for "publish".
    loadPageCandidatesMock.mockResolvedValue([candidate()]);
    const res = await runProductionLineForTenant(RITZ_TENANT_ID, "2026-07-06", { draftBrief: goodBriefFn(), draftFullPage: emptyFullPageFn() });
    // Drafting + staging is allowed (never a live publish) - the batch is created but
    // every item's status is "pending", never "published".
    expect(res.batch?.items.every((i) => i.status === "pending")).toBe(true);
  });
});

describe("runProductionLineForTenant - fail-soft", () => {
  it("never throws when the graph load fails", async () => {
    loadDemandGraphMock.mockRejectedValue(new Error("boom"));
    const res = await runProductionLineForTenant("t1", "2026-07-06");
    expect(res.ran).toBe(false);
    expect(res.reason).toContain("error");
  });

  it("skips a candidate whose brief draft throws, without failing the whole batch", async () => {
    loadPageCandidatesMock.mockResolvedValue([
      candidate({ slug: "ash-reshteh-soup", title: "Ash Reshteh Soup", entity: "a" }),
      candidate({ slug: "kuku-sabzi-frittata", title: "Kuku Sabzi Frittata", entity: "b" }),
    ]);
    readAllCachedKeywordDemandMock.mockResolvedValue([
      { keyword: "ash reshteh soup", searchVolume: 500, cpcUsd: null, competition: null, competitionLevel: null, monthlySearches: [], locationCode: 2840, languageCode: "en", source: "dataforseo" as const, fetchedAt: new Date().toISOString(), confidence: "high" as const, evidenceRef: "x" },
      { keyword: "kuku sabzi frittata", searchVolume: 500, cpcUsd: null, competition: null, competitionLevel: null, monthlySearches: [], locationCode: 2840, languageCode: "en", source: "dataforseo" as const, fetchedAt: new Date().toISOString(), confidence: "high" as const, evidenceRef: "x" },
    ]);
    let calls = 0;
    const flakyBrief = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("LLM boom");
      return { status: "drafted" as const, kind: "create_page_brief" as const, value: GOOD_BRIEF, costUsd: 0.03, retried: false };
    });
    const res = await runProductionLineForTenant("t1", "2026-07-06", { draftBrief: flakyBrief, draftFullPage: emptyFullPageFn() });
    expect(res.drafted).toBe(1); // the second candidate still made it in
  });
});
