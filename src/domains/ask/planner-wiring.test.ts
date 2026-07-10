import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * ask/planner-wiring.test (W9 slice 2, 2026-07-10) - the true end-to-end proof for the
 * multi-provider planner: planAsk -> gatherPlan -> buildAskDossier -> composeAskAnswer,
 * exactly the chain ask-actions.ts runs. Only the RAW tenant-scoped loaders (and the budget
 * gate, so the one LLM-once case can run hermetically) are mocked; the planner, registry,
 * fact-assembly, and composer all run for real. Pins: two-tenant isolation (MANDATORY), the
 * deterministic multi-provider path never calling the LLM, a synthesis calling it exactly
 * once, the 12-fact bound, honest "unavailable" reporting, and derived provenance + freshness
 * with human labels (never a slug id).
 */

const raw = vi.hoisted(() => ({
  loadDailyTotalsForTenant: vi.fn(),
  loadGscPageSignalsForTenant: vi.fn(),
  loadGa4PageValuesForTenant: vi.fn(),
  loadKeywordLibraryForTenant: vi.fn(),
  getAcceptedPlan: vi.fn(),
  getLatestPreviewPlan: vi.fn(),
  checkBudget: vi.fn(),
  recordSpend: vi.fn(),
}));

vi.mock("@/domains/recommendation-intelligence/gsc-page-queries", () => ({
  loadDailyTotalsForTenant: raw.loadDailyTotalsForTenant,
}));
vi.mock("@/domains/recommendation-intelligence/gsc-page-signals", () => ({
  loadGscPageSignalsForTenant: raw.loadGscPageSignalsForTenant,
}));
vi.mock("@/domains/recommendation-intelligence/ga4-page-values", () => ({
  loadGa4PageValuesForTenant: raw.loadGa4PageValuesForTenant,
}));
vi.mock("@/domains/research/keyword-library", () => ({
  loadKeywordLibraryForTenant: raw.loadKeywordLibraryForTenant,
}));
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  getAcceptedPlan: raw.getAcceptedPlan,
  getLatestPreviewPlan: raw.getLatestPreviewPlan,
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: raw.checkBudget,
  recordSpend: raw.recordSpend,
}));

import { planAsk } from "./planner";
import { gatherPlan } from "./providers/registry";
import { buildAskDossier } from "./fact-assembly";
import { composeAskAnswer } from "./composer";
import type { CompleteFn } from "@/domains/llm/structured-drafter";

function fakeComplete(responses: Array<{ text: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

function tenDaysAt(clicks: number, startingFrom = "2026-06-29"): Array<{ date: string; clicks: number; impressions: number }> {
  const start = new Date(`${startingFrom}T00:00:00Z`);
  return Array.from({ length: 10 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), clicks, impressions: clicks * 20 };
  });
}

async function answerFor(tenantId: string, question: string, complete?: CompleteFn) {
  const plan = planAsk(question);
  const facts = await gatherPlan(tenantId, plan);
  const dossier = buildAskDossier(plan.routed, facts, {
    deterministic: plan.deterministic,
    selectedClasses: plan.selectedClasses,
    plannedProviderIds: plan.selections.map((s) => s.provider.id),
    maxFacts: 12,
    bestEffortOnly: plan.bestEffortOnly,
  });
  const answer = await composeAskAnswer(question, dossier, complete ? { complete } : {});
  return { plan, facts, dossier, answer };
}

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;

beforeEach(() => {
  vi.clearAllMocks();
  raw.checkBudget.mockResolvedValue({ allowed: true, remaining: 10 });
  raw.recordSpend.mockResolvedValue(undefined);
  raw.getLatestPreviewPlan.mockResolvedValue(null);
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
});

const LIST_Q = "list my top page and top keywords";
const FLAGSHIP_Q = "which page makes the most money and is it in tonight's plan";

describe("ask/planner-wiring - two-tenant isolation through the full chain (MANDATORY)", () => {
  it("tenant A's answer never carries tenant B's numbers", async () => {
    raw.loadGscPageSignalsForTenant.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a"
        ? new Map([["/a", { page: "/a", clicks90d: 111, impressions90d: 900 }]])
        : new Map([["/b", { page: "/b", clicks90d: 222, impressions90d: 800 }]]),
    );
    raw.loadKeywordLibraryForTenant.mockImplementation(async (tenantId: string) =>
      tenantId === "tenant-a"
        ? { rows: [{ keyword: "alpha-kw", searchesPerMo: 333, ownerPage: null, ownerPageHref: null, yourPosition: null }], volumeCoverage: 1, total: 1, bySource: {} }
        : { rows: [{ keyword: "beta-kw", searchesPerMo: 444, ownerPage: null, ownerPageHref: null, yourPosition: null }], volumeCoverage: 1, total: 1, bySource: {} },
    );

    const complete = vi.fn<CompleteFn>();
    const A = await answerFor("tenant-a", LIST_Q, complete);
    const B = await answerFor("tenant-b", LIST_Q, complete);

    expect(complete).not.toHaveBeenCalled();
    expect(A.answer.answer).toContain("111");
    expect(A.answer.answer).toContain("alpha-kw");
    expect(A.answer.answer).not.toContain("222");
    expect(A.answer.answer).not.toContain("beta-kw");
    expect(B.answer.answer).toContain("222");
    expect(B.answer.answer).toContain("beta-kw");
    expect(B.answer.answer).not.toContain("111");
    expect(B.answer.answer).not.toContain("alpha-kw");
    expect(A.answer.answer).not.toMatch(/[–—]/);
  });
});

describe("ask/planner-wiring - deterministic multi-provider path never calls the LLM", () => {
  it("a multi-provider list answer is composed from facts with provenance in the structured fields ONLY (never duplicated in prose), LLM untouched", async () => {
    raw.loadGscPageSignalsForTenant.mockResolvedValue(new Map([["/a", { page: "/a", clicks90d: 111, impressions90d: 900 }]]));
    raw.loadKeywordLibraryForTenant.mockResolvedValue({
      rows: [{ keyword: "alpha-kw", searchesPerMo: 333, ownerPage: null, ownerPageHref: null, yourPosition: null }],
      volumeCoverage: 1,
      total: 1,
      bySource: {},
    });

    const complete = vi.fn<CompleteFn>();
    const { answer, dossier } = await answerFor("tenant-a", LIST_Q, complete);

    expect(complete).not.toHaveBeenCalled();
    expect(dossier.selectedClasses).toEqual(["page_ranking", "keyword_next"]);
    expect(answer.source).toBe("fallback");
    // P1 fix (2026-07-10 review) - the old footer sentence must never reappear in prose;
    // providersUsed is the single source the UI renders (Specialists chips).
    expect(answer.answer).not.toContain("I pulled this together from my");
    expect(answer.providersUsed?.map((p) => p.label)).toEqual(["Search demand", "Live Google results"]);
    expect(answer.answer).not.toMatch(/[–—]/);
  });
});

describe("ask/planner-wiring - a multi-class synthesis reaches the single LLM compose exactly once", () => {
  it("the flagship 'most money AND in tonight's plan' calls complete once and speaks as the Strategist", async () => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    raw.loadGa4PageValuesForTenant.mockResolvedValue(new Map([["/pricing", { page: "/pricing", sessions28d: 20, engaged28d: 15, conversions28d: 5 }]]));
    raw.getAcceptedPlan.mockResolvedValue({
      status: "accepted",
      date: "2026-07-09",
      selected: [{ pageLabel: "Pricing", lever: "answer_block", targetQuery: "best pricing", whyNow: "high demand" }],
    });

    const plan = planAsk(FLAGSHIP_Q);
    const facts = await gatherPlan("tenant-a", plan);
    const dossier = buildAskDossier(plan.routed, facts, {
      deterministic: plan.deterministic,
      selectedClasses: plan.selectedClasses,
      plannedProviderIds: plan.selections.map((s) => s.provider.id),
      maxFacts: 12,
    });
    expect(dossier.deterministic).toBe(false);

    const cited = dossier.facts[0]!;
    const complete = vi.fn(
      fakeComplete([
        {
          text: JSON.stringify({
            speaker: "ga4",
            answer: "Putting those together, your top earning page is also in tonight's plan.",
            citedFacts: [{ fact: cited.value, href: cited.href }],
          }),
        },
      ]),
    );
    const answer = await composeAskAnswer(FLAGSHIP_Q, dossier, { complete });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(answer.source).toBe("llm");
    expect(answer.speaker).toBe("llm");
    expect(answer.providersUsed?.map((p) => p.label)).toEqual(["Revenue", "Strategist"]);
  });
});

describe("ask/planner-wiring - bounded multi-provider dossier", () => {
  it("caps the merged dossier at 12 facts and keeps facts from both providers", async () => {
    raw.loadGscPageSignalsForTenant.mockResolvedValue(
      new Map(Array.from({ length: 8 }, (_, i) => [`/p${i}`, { page: `/p${i}`, clicks90d: 100 - i, impressions90d: 1000 }])),
    );
    raw.loadKeywordLibraryForTenant.mockResolvedValue({
      rows: Array.from({ length: 8 }, (_, i) => ({ keyword: `kw${i}`, searchesPerMo: 900 - i, ownerPage: null, ownerPageHref: null, yourPosition: null })),
      volumeCoverage: 8,
      total: 8,
      bySource: {},
    });

    const { dossier } = await answerFor("tenant-a", LIST_Q, vi.fn<CompleteFn>());
    expect(dossier.facts.length).toBeLessThanOrEqual(12);
    expect(dossier.facts.some((f) => f.source === "gsc")).toBe(true);
    expect(dossier.facts.some((f) => f.source === "dataforseo")).toBe(true);
  });
});

describe("ask/planner-wiring - honest unavailable reporting", () => {
  it("names a selected specialist that returned nothing, as a structured credit ONLY (the UI renders the sentence, not the prose)", async () => {
    raw.loadGscPageSignalsForTenant.mockResolvedValue(new Map([["/a", { page: "/a", clicks90d: 111, impressions90d: 900 }]]));
    raw.loadKeywordLibraryForTenant.mockResolvedValue({ rows: [], volumeCoverage: 0, total: 0, bySource: {} });

    const { answer, dossier } = await answerFor("tenant-a", LIST_Q, vi.fn<CompleteFn>());
    expect(dossier.selectedClasses).toEqual(["page_ranking", "keyword_next"]);
    expect(answer.providersUnavailable?.map((p) => p.label)).toEqual(["Live Google results"]);
    // P1 fix (2026-07-10 review) - ask-chat-client.tsx renders this line once from
    // providersUnavailable; the prose must not repeat it.
    expect(answer.answer).not.toContain("I checked my Live Google results read too but found nothing there yet.");
  });
});

describe("ask/planner-wiring - provenance + freshness with human labels only", () => {
  it("credits the specialist by human name and states data freshness ONLY in the structured field, never a slug id, never duplicated in prose", async () => {
    raw.loadDailyTotalsForTenant.mockResolvedValue(tenDaysAt(20));
    raw.loadGscPageSignalsForTenant.mockResolvedValue(new Map([["/a", { page: "/a", clicks90d: 111, impressions90d: 900 }]]));

    const { answer, plan } = await answerFor("tenant-a", "how is overall revenue this month", vi.fn<CompleteFn>());
    expect(plan.selectedClasses).toEqual(["site_trend", "page_ranking"]);
    expect(answer.providersUsed?.[0]?.label).toBe("Search demand");
    expect(answer.providersUsed?.[0]?.freshnessIso).toBe("2026-07-08");
    // P1 fix (2026-07-10 review) - freshness now shows ONCE, via providersUsed (the UI's
    // Specialists chip renders "Search demand (through 2026-07-08)"); prose never repeats it.
    expect(answer.answer).not.toContain("Data through 2026-07-08");
    expect(answer.answer).not.toContain("gsc-daily-totals");
    expect(answer.answer).not.toMatch(/[–—]/);
  });
});

// P2 fix (2026-07-10 review) - planner.ts computed AskPlan.bestEffortOnly but nothing
// consumed it, even though router.ts's own comment claimed the answer "can say plainly
// it only had overall traffic to go on." This proves the full chain (planAsk ->
// buildAskDossier -> composeAskAnswer, exactly what ask-actions.ts runs) now makes that true.
describe("ask/planner-wiring - best-effort honesty is wired end to end", () => {
  it("a catch-all site-trend question with no explicit trend cue says plainly it only looked at overall traffic", async () => {
    raw.loadDailyTotalsForTenant.mockResolvedValue(tenDaysAt(20));

    const { plan, answer } = await answerFor("tenant-a", "how are things going", vi.fn<CompleteFn>());
    expect(plan.bestEffortOnly).toBe(true);
    expect(answer.answer).toContain("I did not spot a more specific question, so I looked at your overall traffic.");
    expect(answer.answer).not.toMatch(/[–—]/);
  });

  it("an explicit site-trend question (matches SITE_TREND_PATTERNS) is not best-effort and adds no honest line", async () => {
    raw.loadDailyTotalsForTenant.mockResolvedValue(tenDaysAt(20));

    const { plan, answer } = await answerFor("tenant-a", "did traffic drop sitewide this week", vi.fn<CompleteFn>());
    expect(plan.bestEffortOnly).toBe(false);
    expect(answer.answer).not.toContain("I did not spot a more specific question");
  });
});
