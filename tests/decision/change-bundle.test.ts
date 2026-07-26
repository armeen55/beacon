/**
 * Slice 7 contract: ONE deeply evidenced existing-page ChangeBundle. Selection,
 * receipt-first grounding, determinism under reordered evidence, honest omission
 * when research is absent, refusal when demand or current copy is missing, and a
 * persistence round-trip that also reads a pre-bundle row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));

import { produceBundleForSnapshot } from "@/domains/decision/produce-bundle";
import { serializeChangeProposal, deserializeChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { EvidenceSnapshot, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";

const TENANT = "fixture-tenant";
const NOW = new Date("2026-07-25T00:00:00.000Z");
const TITLE_AFTER = "Rain barrel sizing: gallons per storm by roof area";
const META_AFTER =
  "Rain barrel sizing comes down to roof area and gallons per storm, and this page walks through the numbers so you can pick a size with confidence.";
const ANSWER_AFTER =
  "Rain barrel sizing comes down to two numbers you already have: the roof area feeding your downspout, and the gallons of rain that area sheds in an ordinary storm. Most households start with a single barrel, then chain a second one as soon as the barrel overflows in a normal week of weather. The barrel you want is the one that holds a whole storm without spilling, so measure the roof section above the downspout, decide how many days of watering you want on hand, and size up from there rather than guessing at the gallons.";

const TAIL = { sources: [], evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };

/** The injected drafter seam: exact copy, chosen by draft kind + requested field. */
const seam: CompleteFn = async ({ kind, user }) => {
  if (kind === "answer_block") return { value: { answer: ANSWER_AFTER, citationHook: null, ...TAIL } };
  const field = user.includes("Field to edit: meta") ? "meta" : "title";
  return { value: { field, before: null, after: field === "meta" ? META_AFTER : TITLE_AFTER, rationale: "The current copy does not say what the page answers.", ...TAIL } };
};

function page(over: Partial<OwnedPageEvidence> & { url: string }): OwnedPageEvidence {
  return {
    content: { title: "Rain Barrels", metaDescription: null, h1: "Rain Barrels", h2: [], outline: ["Rain barrel sizing", "Roof area and gallons", "Chaining a second barrel"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" },
    search: { clicks90d: 120, impressions90d: 9000, ctr90d: 0.013, position90d: 8, topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 90, position: 8 }, { query: "how many gallons rain barrel", impressions: 2000, clicks: 20, position: 11 }] },
    engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] },
    ...over,
  };
}

const RESEARCH = {
  ...emptyResearchEvidence(),
  retainedKeywords: [
    { query: "rain barrel sizing", searchVolume: 4400, competition: 0.2, competitionLevel: "low" as const, intent: "informational" },
    { query: "how many gallons rain barrel", searchVolume: 880, competition: 0.1, competitionLevel: "low" as const, intent: "informational" },
  ],
  serpEvidence: [
    { query: "rain barrel sizing", organic: [{ rank: 1, domain: "gardenguide.example", url: "https://gardenguide.example/a", title: "A" }, { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "B" }], aiOverview: [{ url: "https://gardenguide.example/a", domain: "gardenguide.example", title: "A" }], aiMode: [], paa: [], related: [] },
  ],
  aiObservations: [
    { promptId: "p1", promptText: "what size rain barrel do I need", engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [{ url: "https://gardenguide.example/a", domain: "gardenguide.example", title: "A" }], fanOutQueries: ["rain barrel gallons"], observedAt: "2026-07-22T00:00:00.000Z" },
    { promptId: "p2", promptText: "rain barrel sizing rule of thumb", engine: "gemini", observationMode: "standardized_response" as const, modelRequested: null, modelServed: null, webSearchReported: null, citationsObserved: false, citations: null, fanOutQueries: null, observedAt: "2026-07-21T00:00:00.000Z" },
  ],
  winningPages: [
    { url: "https://gardenguide.example/a", domain: "gardenguide.example", engines: ["chatgpt"], examplePrompts: ["what size rain barrel do I need"], appearances: [{ kind: "ai_answer" as const, query: null, promptId: "p1", promptText: "what size rain barrel do I need", engine: "chatgpt", rank: null, citedUrl: "https://gardenguide.example/a", observedAt: "2026-07-22T00:00:00.000Z", modelServed: null }], extract: { title: "A", h1: "A", wordCount: 1400, headings: ["Sizing", "Overflow"], faqCount: 2 } },
  ],
};

function snapshot(over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    scope: { tenantId: TENANT, site: "fixture-content.example", builtAt: NOW.toISOString() },
    sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [],
    contentGaps: [], internalLinkOpportunities: [], newPageOpportunities: [], evidenceHash: "fixture", research: RESEARCH,
    aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 },
    ownedPages: [
      page({ url: "fixture-content.example/rain-barrels" }),
      page({ url: "fixture-content.example/compost", search: { clicks90d: 4, impressions90d: 300, ctr90d: 0.013, position90d: 22, topQueries: [{ query: "compost bin sizing", impressions: 300, clicks: 4, position: 22 }] } }),
    ],
    ...over,
  };
}

const reverse = <T,>(a: readonly T[]): T[] => [...a].reverse();

beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; });
afterEach(() => { delete process.env.OPENAI_API_KEY; });

describe("produceBundleForSnapshot", () => {
  it("bundles the strongest page with exact drafted copy and a receipt every component cites", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { complete: seam, now: NOW, bypassCache: true });
    expect(out.status).toBe("bundled");
    if (out.status !== "bundled") return;
    const p = out.proposal;

    expect(p.id).toBe(`${TENANT}::/rain-barrels::existing_edit::bundle`);
    expect(p.pagePath).toBe("/rain-barrels"); // the 9,000-view page, not the 300-view one
    expect(p.changeFamily).toBe("bundle");
    expect(p.kind).toBe("existing_edit");

    const bundle = p.bundle!;
    expect(bundle.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer"]);
    expect(bundle.components.map((c) => c.before)).toEqual(["Rain Barrels", null, null]); // no description today
    expect(bundle.components.map((c) => c.after)).toEqual([TITLE_AFTER, META_AFTER, ANSWER_AFTER]);
    expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "title", before: "Rain Barrels", after: TITLE_AFTER });

    const keys = new Set(bundle.receipt.items.map((i) => i.key));
    for (const c of bundle.components) {
      expect(c.evidenceKeys.length).toBeGreaterThan(0);
      for (const k of c.evidenceKeys) expect(keys.has(k)).toBe(true);
    }
    expect(bundle.receipt.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["gsc_demand", "page_extract", "keyword", "serp", "ai_observation", "winning_page"]));
    expect(bundle.receipt.freshestObservedAt).toBe("2026-07-22T00:00:00.000Z");
    expect(bundle.scope.queries).toEqual(["rain barrel sizing", "how many gallons rain barrel"]);
    expect(bundle.scope.prompts).toEqual(["rain barrel sizing rule of thumb", "what size rain barrel do I need"]);
    expect(bundle.alternatives.some((a) => a.option.includes("/compost"))).toBe(true);
    expect(p.evidence.evidenceRefCount).toBe(bundle.receipt.items.length);
    // No provider name, no lab word, no dash reaches operator-facing copy.
    const copy = [bundle.objective, bundle.metric, bundle.measurementPlan, p.whyItMatters,
      ...bundle.receipt.items.map((i) => i.fact), ...bundle.receipt.missing, ...bundle.risks, ...bundle.confidenceReasons,
      ...bundle.components.map((c) => `${c.label} ${c.after}`), ...bundle.alternatives.map((a) => `${a.option} ${a.reason}`)].join(" ");
    expect(copy).not.toMatch(/chatgpt|gemini|dataforseo|SERP|baseline|control group/i);
    expect(copy).not.toMatch(/[–—]/);
  });

  it("is identical when every input list arrives in the opposite order", async () => {
    const base = snapshot();
    const flipped = snapshot({
      ownedPages: reverse(base.ownedPages).map((pg) => ({ ...pg, search: pg.search ? { ...pg.search, topQueries: reverse(pg.search.topQueries) } : null })),
      research: { ...RESEARCH, retainedKeywords: reverse(RESEARCH.retainedKeywords), aiObservations: reverse(RESEARCH.aiObservations), winningPages: reverse(RESEARCH.winningPages), serpEvidence: RESEARCH.serpEvidence.map((s) => ({ ...s, organic: reverse(s.organic) })) },
    });
    const a = await produceBundleForSnapshot(base, { complete: seam, now: NOW, bypassCache: true });
    const b = await produceBundleForSnapshot(flipped, { complete: seam, now: NOW, bypassCache: true });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("names the research it does not have and omits the component that needed it", async () => {
    const out = await produceBundleForSnapshot(snapshot({ research: emptyResearchEvidence() }), { complete: seam, now: NOW, bypassCache: true });
    expect(out.status).toBe("bundled");
    if (out.status !== "bundled") return;
    const bundle = out.proposal.bundle!;
    expect(bundle.components.map((c) => c.kind)).toEqual(["title", "meta"]);
    expect(bundle.receipt.missing).toEqual(expect.arrayContaining([
      "I do not have a monthly search count for these searches yet.",
      "I have not looked at the live results page for these searches yet.",
      "No AI answers have been gathered for these prompts yet.",
      "I have not read the pages AI keeps citing on this topic yet.",
    ]));
    expect(bundle.alternatives.some((a) => a.option.includes("Opening answer"))).toBe(true);
    expect(bundle.scope.prompts).toEqual([]);
  });

  it("refuses rather than filling in when there is no demand or no current copy", async () => {
    const opt = { complete: seam, now: NOW, bypassCache: true };
    const noDemand = await produceBundleForSnapshot(snapshot({ ownedPages: [page({ url: "fixture-content.example/rain-barrels", search: null })] }), opt);
    expect(noDemand.status).toBe("none");
    const noCopy = await produceBundleForSnapshot(snapshot({ ownedPages: [page({ url: "fixture-content.example/rain-barrels", content: null })] }), opt);
    expect(noCopy.status).toBe("none");
    if (noCopy.status !== "none") return;
    expect(noCopy.reason).toContain("nothing honest to rewrite");
  });

  it("survives a persistence round-trip, and a pre-bundle row still deserializes", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { complete: seam, now: NOW, bypassCache: true });
    if (out.status !== "bundled") throw new Error("expected a bundle");
    const back = deserializeChangeProposal(serializeChangeProposal(out.proposal));
    expect(back).toEqual(out.proposal);
    expect(back!.bundle!.components).toHaveLength(3);
    const { bundle: _dropped, ...preBundleRow } = out.proposal;
    void _dropped;
    const legacy = deserializeChangeProposal(serializeChangeProposal(preBundleRow as typeof out.proposal));
    expect(legacy).not.toBeNull();
    expect(legacy!.bundle).toBeUndefined();
  });
});
