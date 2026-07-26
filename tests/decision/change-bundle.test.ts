/**
 * The ONE bundle contract, both archetypes: an existing-page rewrite (Slice 7) and a
 * new page (Slice 8). Selection, receipt-first grounding, determinism under reordered
 * evidence, honest omission and refusal, topic dedupe fresh + historical, and a
 * persistence round-trip that also reads a pre-bundle row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChangeBundle, ChangeProposal } from "@/domains/decision/contracts";

const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>() }));
const env = vi.hoisted(() => ({ snap: null as unknown }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/decision/proposal-store", () => ({ loadChangeProposals: async () => store.rows, saveChangeProposal: async (p: ChangeProposal) => { store.rows.set(p.id, p); } }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null }));

import { produceBundleForSnapshot, produceNewPageBundleForSnapshot } from "@/domains/decision/produce-bundle";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import { loadProposalQueue } from "@/domains/decision/load-proposals";
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
const TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };
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
  retainedKeywords: [{ query: "rain barrel sizing", searchVolume: 4400, competition: 0.2, competitionLevel: "low" as const, intent: "informational" },
    { query: "how many gallons rain barrel", searchVolume: 880, competition: 0.1, competitionLevel: "low" as const, intent: "informational" }],
  serpEvidence: [{ query: "rain barrel sizing", organic: [{ rank: 1, domain: "gardenguide.example", url: "https://gardenguide.example/a", title: "A" }, { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "B" }], aiOverview: [{ url: "https://gardenguide.example/a", domain: "gardenguide.example", title: "A" }], aiMode: [], paa: [], related: [] }],
  aiObservations: [{ promptId: "p1", promptText: "what size rain barrel do I need", engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [{ url: "https://gardenguide.example/a", domain: "gardenguide.example", title: "A" }], fanOutQueries: ["rain barrel gallons"], observedAt: "2026-07-22T00:00:00.000Z" },
  { promptId: "p2", promptText: "rain barrel sizing rule of thumb", engine: "gemini", observationMode: "standardized_response" as const, modelRequested: null, modelServed: null, webSearchReported: null, citationsObserved: false, citations: null, fanOutQueries: null, observedAt: "2026-07-21T00:00:00.000Z" }],
  winningPages: [{ url: "https://gardenguide.example/a", domain: "gardenguide.example", engines: ["chatgpt"], examplePrompts: ["what size rain barrel do I need"], appearances: [{ kind: "ai_answer" as const, query: null, promptId: "p1", promptText: "what size rain barrel do I need", engine: "chatgpt", rank: null, citedUrl: "https://gardenguide.example/a", observedAt: "2026-07-22T00:00:00.000Z", modelServed: null }], extract: { title: "A", h1: "A", wordCount: 1400, headings: ["Sizing", "Overflow"], faqCount: 2 } }],
};
// ── new-page fixture: one researched topic, one demand-only runner up ──────────
const TOPIC = "rainwater harvesting permits";
const URL2 = "https://waterwise.example/permits";
const PROMPT2 = "rainwater harvesting permits by state";
const OPP = { topic: TOPIC, demandWeight: 5200, basis: "mixed" as const, competitorUrls: [URL2], fanoutSeeds: ["do I need a permit for a rain barrel", "rainwater harvesting rules by county"], confidence: "medium" as const };
const OPP2 = { topic: "downspout diverter install", demandWeight: 900, basis: "ai_attention" as const, competitorUrls: [], fanoutSeeds: [], confidence: "low" as const };
const COMPETITOR = { url: URL2, domain: "waterwise.example", citationCount: 9, distinctPrompts: 4, engines: ["chatgpt"], examplePrompts: [PROMPT2] };
const TOPIC_RESEARCH = {
  ...RESEARCH,
  retainedKeywords: [...RESEARCH.retainedKeywords, { query: TOPIC, searchVolume: 1600, competition: 0.3, competitionLevel: "low" as const, intent: "informational" }],
  serpEvidence: [...RESEARCH.serpEvidence, { query: TOPIC, organic: [{ rank: 1, domain: "waterwise.example", url: URL2, title: "P" }], aiOverview: [], aiMode: [], paa: [], related: [] }],
  aiObservations: [...RESEARCH.aiObservations, { promptId: "p3", promptText: PROMPT2, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [{ url: URL2, domain: "waterwise.example", title: "P" }], fanOutQueries: null, observedAt: "2026-07-23T00:00:00.000Z" }],
  winningPages: [...RESEARCH.winningPages, { url: URL2, domain: "waterwise.example", engines: ["chatgpt"], examplePrompts: [PROMPT2], appearances: [{ kind: "ai_answer" as const, query: null, promptId: "p3", promptText: PROMPT2, engine: "chatgpt", rank: null, citedUrl: URL2, observedAt: "2026-07-23T00:00:00.000Z", modelServed: null }], extract: { title: "P", h1: "P", wordCount: 1800, headings: ["Rules", "Rebates", "Limits"], faqCount: 3 } }],
};
const BRIEF = {
  proposedTitle: "Rainwater harvesting permits: what the rules ask of you",
  metaDescription: "Rainwater harvesting permits differ by where you live, so this page walks through who needs one, what the rules cover, and how to check yours.",
  openingAnswer: "Rainwater harvesting permits are set locally, so whether you need one depends on where your barrel sits and how much water you plan to hold. Most households can put in a single barrel with no paperwork, while a larger cistern or any plumbed connection to the house usually needs a filed permit and an inspection. Check your county rules before you buy, because the limits are written per property rather than per barrel.",
  outline: ["Who needs a rainwater harvesting permit", "What the rules usually cover", "How to check your own county", "What an inspection looks for"],
  faqQuestions: ["Do I need a permit for one rain barrel?", "What happens if I skip the permit?"],
  schemaTypes: ["Article", "FAQPage"],
};
const SOURCE = { url: URL2, title: "County permit rules", domain: "waterwise.example", retrievedAt: "2026-07-23", claim: "Rainwater permit rules are set by county.", authority: "unverified" };
const PLAN = [...BRIEF.outline, ...BRIEF.faqQuestions].join("\n");
/** The same seam, plus the new-page brief with a chosen source list. */
const briefSeam = (sources: unknown[]): CompleteFn => async (req) =>
  req.kind === "create_page_brief" ? { value: { ...BRIEF, sources, ...TAIL } } : seam(req);
function snapshot(over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    scope: { tenantId: TENANT, site: "fixture-content.example", builtAt: NOW.toISOString() },
    sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [],
    contentGaps: [], internalLinkOpportunities: [], newPageOpportunities: [], evidenceHash: "fixture", research: RESEARCH,
    aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 },
    ownedPages: [page({ url: "fixture-content.example/rain-barrels" }),
      page({ url: "fixture-content.example/compost", search: { clicks90d: 4, impressions90d: 300, ctr90d: 0.013, position90d: 22, topQueries: [{ query: "compost bin sizing", impressions: 300, clicks: 4, position: 22 }] } })],
    ...over,
  };
}
const topicSnapshot = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot =>
  snapshot({ research: TOPIC_RESEARCH, newPageOpportunities: [OPP, OPP2], competitors: [COMPETITOR], ...over });
const reverse = <T,>(a: readonly T[]): T[] => [...a].reverse();
/** Every component cites receipt items that actually exist. */
const expectKeysResolve = (b: ChangeBundle): void => {
  const keys = new Set(b.receipt.items.map((i) => i.key));
  for (const c of b.components) { expect(c.evidenceKeys.length).toBeGreaterThan(0); for (const k of c.evidenceKeys) expect(keys.has(k)).toBe(true); }
};
/** No provider name, no lab word, no dash reaches operator-facing copy. */
const expectCleanCopy = (p: ChangeProposal): void => {
  const b = p.bundle!;
  const copy = [b.objective, b.metric, b.measurementPlan, p.whyItMatters, ...b.receipt.items.map((i) => i.fact), ...b.receipt.missing, ...b.risks,
    ...b.confidenceReasons, ...b.components.map((c) => `${c.label} ${c.after}`), ...b.alternatives.map((a) => `${a.option} ${a.reason}`)].join(" ");
  expect(copy).not.toMatch(/chatgpt|gemini|dataforseo|SERP|baseline|control group/i);
  expect(copy).not.toMatch(/[–—]/);
};
beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; store.rows.clear(); });
afterEach(() => { delete process.env.OPENAI_API_KEY; });
describe("produceBundleForSnapshot", () => {
  it("bundles the strongest page with exact drafted copy and a receipt every component cites", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { complete: seam, now: NOW, bypassCache: true });
    expect(out.status).toBe("bundled");
    if (out.status !== "bundled") return;
    const p = out.proposal; const bundle = p.bundle!;
    expect(p.id).toBe(`${TENANT}::/rain-barrels::existing_edit::bundle`);
    expect(p.pagePath).toBe("/rain-barrels"); // the 9,000-view page, not the 300-view one
    expect(p.changeFamily).toBe("bundle"); expect(p.kind).toBe("existing_edit");
    expect(bundle.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer"]);
    expect(bundle.components.map((c) => c.before)).toEqual(["Rain Barrels", null, null]); // no description today
    expect(bundle.components.map((c) => c.after)).toEqual([TITLE_AFTER, META_AFTER, ANSWER_AFTER]);
    expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "title", before: "Rain Barrels", after: TITLE_AFTER });
    expectKeysResolve(bundle);
    expect(bundle.receipt.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["gsc_demand", "page_extract", "keyword", "serp", "ai_observation", "winning_page"]));
    expect(bundle.receipt.freshestObservedAt).toBe("2026-07-22T00:00:00.000Z");
    expect(bundle.scope).toEqual({ queries: ["rain barrel sizing", "how many gallons rain barrel"], prompts: ["rain barrel sizing rule of thumb", "what size rain barrel do I need"] });
    expect(bundle.alternatives.some((a) => a.option.includes("/compost"))).toBe(true);
    expect(p.evidence.evidenceRefCount).toBe(bundle.receipt.items.length);
    expectCleanCopy(p);
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
    expect(bundle.receipt.missing).toEqual(expect.arrayContaining(["I do not have a monthly search count for these searches yet.",
      "I have not looked at the live results page for these searches yet.", "No AI answers have been gathered for these prompts yet.",
      "I have not read the pages AI keeps citing on this topic yet."]));
    expect(bundle.alternatives.some((a) => a.option.includes("Opening answer"))).toBe(true);
    expect(bundle.scope.prompts).toEqual([]);
  });
  it("refuses without demand or current copy, and round-trips through persistence", async () => {
    const opt = { complete: seam, now: NOW, bypassCache: true };
    const noDemand = await produceBundleForSnapshot(snapshot({ ownedPages: [page({ url: "fixture-content.example/rain-barrels", search: null })] }), opt);
    const noCopy = await produceBundleForSnapshot(snapshot({ ownedPages: [page({ url: "fixture-content.example/rain-barrels", content: null })] }), opt);
    expect(noDemand.status).toBe("none"); expect(noCopy.status).toBe("none");
    if (noCopy.status !== "none") return;
    expect(noCopy.reason).toContain("nothing honest to rewrite");
    const out = await produceBundleForSnapshot(snapshot(), opt);
    if (out.status !== "bundled") throw new Error("expected a bundle");
    const back = deserializeChangeProposal(serializeChangeProposal(out.proposal));
    expect(back).toEqual(out.proposal); expect(back!.bundle!.components).toHaveLength(3);
    const { bundle: _dropped, ...preBundleRow } = out.proposal; void _dropped;
    const legacy = deserializeChangeProposal(serializeChangeProposal(preBundleRow as typeof out.proposal));
    expect(legacy).not.toBeNull(); expect(legacy!.bundle).toBeUndefined();
  });
});
describe("produceNewPageBundleForSnapshot", () => {
  it("builds one researched topic into a page plan every component cites", async () => {
    const out = await produceNewPageBundleForSnapshot(topicSnapshot(), { complete: briefSeam([SOURCE]), now: NOW, bypassCache: true });
    expect(out.status).toBe("bundled");
    if (out.status !== "bundled") return;
    const p = out.proposal; const bundle = p.bundle!;
    expect(p.id).toBe(`${TENANT}::new::${TOPIC}::new_page::bundle`);
    expect(p.kind).toBe("new_page"); expect(p.pagePath).toBeNull();
    expect(p.impactScore).toBe(5200); // the opportunity's own demand weight
    expect(p.recommendedChange).toEqual({ kind: "new_page", ...BRIEF });
    expect(bundle.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer", "section", "source_pack"]);
    expect(bundle.components.map((c) => c.label)).toEqual(["Page title", "Search description", "Opening answer", "Page plan", "Sources to cite"]);
    expect(bundle.components.every((c) => c.before === null)).toBe(true); // every component is an insertion
    expect(bundle.components[3].after).toBe(PLAN); // the outline plus the FAQ questions, one heading per line
    expect(bundle.components[4].after).toBe("County permit rules, waterwise.example: https://waterwise.example/permits");
    expectKeysResolve(bundle);
    expect(bundle.receipt.items.map((i) => i.kind)).toEqual(["keyword", "serp", "ai_observation", "competitor", "winning_page"]);
    expect(bundle.receipt.items.find((i) => i.kind === "competitor")!.fact).toBe("AI answers cite waterwise.example for this on 4 different prompts.");
    expect(bundle.receipt.items.find((i) => i.kind === "winning_page")!.fact).toContain("runs 1,800 words with 3 sections");
    expect(bundle.receipt.freshestObservedAt).toBe("2026-07-23T00:00:00.000Z");
    expect(bundle.objective).toBe(`Build one page that answers "${TOPIC}" so the demand lands on you.`);
    expect(bundle.metric).toBe(`Clicks and views from search for "${TOPIC}" over the next 28 days.`);
    expect(bundle.scope).toEqual({ queries: [TOPIC], prompts: [PROMPT2] });
    expect(bundle.alternatives.some((a) => a.option.includes("downspout diverter install"))).toBe(true);
    expectCleanCopy(p); expect(deserializeChangeProposal(serializeChangeProposal(p))).toEqual(p);
  });
  it("is identical when every input list arrives in the opposite order", async () => {
    const opt = { complete: briefSeam([SOURCE]), now: NOW, bypassCache: true };
    const flipped = topicSnapshot({
      newPageOpportunities: [OPP2, OPP],
      research: { ...TOPIC_RESEARCH, retainedKeywords: reverse(TOPIC_RESEARCH.retainedKeywords), aiObservations: reverse(TOPIC_RESEARCH.aiObservations), winningPages: reverse(TOPIC_RESEARCH.winningPages), serpEvidence: reverse(TOPIC_RESEARCH.serpEvidence) },
    });
    const a = await produceNewPageBundleForSnapshot(topicSnapshot(), opt);
    const b = await produceNewPageBundleForSnapshot(flipped, opt);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
  it("omits the source list when the brief has none, and refuses outright without research", async () => {
    const noSources = await produceNewPageBundleForSnapshot(topicSnapshot(), { complete: briefSeam([]), now: NOW, bypassCache: true });
    if (noSources.status !== "bundled") throw new Error("expected a bundle");
    expect(noSources.proposal.bundle!.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer", "section"]);
    expect(noSources.proposal.bundle!.alternatives.some((a) => a.option === "Sources to cite")).toBe(true); // named, never silently dropped
    const unresearched = await produceNewPageBundleForSnapshot(snapshot({ newPageOpportunities: [OPP, OPP2] }), { complete: briefSeam([SOURCE]), now: NOW, bypassCache: true });
    expect(unresearched.status).toBe("none");
    if (unresearched.status !== "none") return;
    expect(unresearched.reason).toContain("has research behind it yet");
  });
});
describe("one pass, both bundles, one row per change", () => {
  it("drops the shallow brief for a bundled topic at generation and again on load", async () => {
    env.snap = topicSnapshot();
    const res = await produceProposalsForTenant(TENANT, { complete: briefSeam([SOURCE]), now: NOW, bypassCache: true });
    const bundleId = `${TENANT}::new::${TOPIC}::new_page::bundle`;
    // both archetypes land in the SAME pass without interfering
    expect(res.proposals.map((p) => p.id)).toEqual(expect.arrayContaining([bundleId, `${TENANT}::/rain-barrels::existing_edit::bundle`]));
    // fresh dedupe: exactly one row for this topic, and it is the bundle; the shallow row persisted earlier in the pass is suppressed on load
    expect(res.proposals.filter((p) => p.kind === "new_page" && p.primaryQuery === TOPIC).map((p) => p.id)).toEqual([bundleId]);
    expect([...store.rows.keys()].filter((id) => id.includes(`new::${TOPIC}`)).length).toBeGreaterThan(1);
    const queue = await loadProposalQueue(TENANT);
    expect(queue.newPageBriefs.filter((p) => p.primaryQuery === TOPIC).map((p) => p.id)).toEqual([bundleId]);
  });
});
