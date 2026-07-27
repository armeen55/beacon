/** The ONE change contract, both archetypes: an existing-page repair (Slice 7) and a new page (Slice 8). Selection on a PROVEN recoverable gap,
 *  receipt-first grounding for the EXACT candidate search, scope named on every number, QUERY IDENTITY per query, winners attaching only on exact
 *  membership, atomic bundling, confidence and readiness by EVIDENCE HELD, determinism, honest refusal, a release publishing only on a real production result, dedupe, and a round trip. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChangeBundle, ChangeProposal } from "@/domains/decision/contracts";
const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>() })); const env = vi.hoisted(() => ({ snap: null as unknown }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/decision/proposal-store", () => ({ loadChangeProposals: async () => store.rows, saveChangeProposal: async (p: ChangeProposal) => { store.rows.set(p.id, p); } }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap })); vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null }));
import { produceBundleForSnapshot, produceNewPageBundleForSnapshot } from "@/domains/decision/produce-bundle";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals"; import { loadProposalQueue } from "@/domains/decision/load-proposals";
import { confidenceFor, serializeChangeProposal, deserializeChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { EvidenceSnapshot, NewPageOpportunity, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { emptyResearchEvidence, type ResearchPageExtract, type ResearchWinningAppearance } from "@/domains/evidence/funnel/research-evidence";
const TENANT = "fixture-tenant"; const NOW = new Date("2026-07-25T00:00:00.000Z");
const TITLE_AFTER = "Rain barrel sizing: gallons per storm by roof area"; const TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };
/** Every system prompt the drafter sent this run (so no vertical assumption can hide in one), and the injected
 *  drafter seam itself: exact copy, chosen by draft kind + requested field. */
const sent: string[] = []; const seam: CompleteFn = async ({ system }) => { sent.push(system);
  return { value: { field: "title", before: null, after: TITLE_AFTER, rationale: "The current copy does not say what the page answers.", ...TAIL } }; };
const page = (over: Partial<OwnedPageEvidence> & { url: string }): OwnedPageEvidence => ({
    content: { title: "Rain Barrels", metaDescription: null, h1: "Rain Barrels", h2: [], outline: ["Rain barrel sizing", "Roof area and gallons", "Chaining a second barrel"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" },
    // "rain barrel sizing" earns 90 clicks where position 3 normally earns about 660: a 570-click gap. The second search sits at position 11 and earns about what that position should, so it is no gap at all.
    search: { clicks90d: 120, impressions90d: 9000, ctr90d: 0.013, position90d: 8, topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 90, position: 3 }, { query: "how many gallons rain barrel", impressions: 2000, clicks: 20, position: 11 }] },
    engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] }, ...over });
const COMPOST = { clicks90d: 5, impressions90d: 1200, ctr90d: 0.004, position90d: 6, topQueries: [{ query: "compost bin sizing", impressions: 1200, clicks: 5, position: 6 }] };
const WIN1 = "https://gardenguide.example/a"; const RESEARCH = { ...emptyResearchEvidence(),
  retainedKeywords: [{ query: "rain barrel sizing", searchVolume: 4400, competition: 0.2, competitionLevel: "low" as const, difficulty: null, intent: "informational" },
    { query: "how many gallons rain barrel", searchVolume: 880, competition: 0.1, competitionLevel: "low" as const, difficulty: null, intent: "informational" }],
  // The owned page is ON this results page, worded without the searcher's own word, while two rivals share it: the mismatch a diagnosis may name.
  serpEvidence: [{ query: "rain barrel sizing", organic: [{ rank: 1, domain: "gardenguide.example", url: WIN1, title: "Rain barrel sizing guide" }, { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "Sizing a rain barrel by roof area" },
    { rank: 3, domain: "fixture-content.example", url: "https://fixture-content.example/rain-barrels", title: "Rain Barrels" }], aiOverview: [{ url: WIN1, domain: "gardenguide.example", title: "A" }], aiMode: [], paa: [], related: [] }],
  aiObservations: [{ promptId: "p1", promptText: "what size rain barrel do I need", engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [{ url: WIN1, domain: "gardenguide.example", title: "A" }], fanOutQueries: ["rain barrel gallons"], observedAt: "2026-07-22T00:00:00.000Z" },
  { promptId: "p2", promptText: "rain barrel sizing rule of thumb", engine: "gemini", observationMode: "standardized_response" as const, modelRequested: null, modelServed: null, webSearchReported: null, citationsObserved: false, citations: null, fanOutQueries: null, observedAt: "2026-07-21T00:00:00.000Z" }],
  winningPages: [{ url: WIN1, domain: "gardenguide.example", engines: ["chatgpt"], examplePrompts: ["what size rain barrel do I need"], appearances: [{ kind: "ai_answer" as const, query: null, promptId: "p1", promptText: "what size rain barrel do I need", engine: "chatgpt", rank: null, citedUrl: WIN1, observedAt: "2026-07-22T00:00:00.000Z", modelServed: null }], extract: { title: "A", h1: "A", wordCount: 1400, headings: ["Sizing", "Overflow"], faqCount: 2 } }] };
// ── new-page fixture: one researched topic, one demand-only runner up ──────────
const TOPIC = "rainwater harvesting permits"; const URL2 = "https://waterwise.example/permits"; const PROMPT2 = "rainwater harvesting permits by state";
const OPP = { topic: TOPIC, demandWeight: 5200, basis: "mixed" as const, competitorUrls: [URL2], fanoutSeeds: ["do I need a permit for a rain barrel", "rainwater harvesting rules by county"], confidence: "medium" as const };
const OPP2 = { topic: "downspout diverter install", demandWeight: 900, basis: "ai_attention" as const, competitorUrls: [], fanoutSeeds: [], confidence: "low" as const };
const COMPETITOR = { url: URL2, domain: "waterwise.example", citationCount: 9, distinctPrompts: 4, engines: ["chatgpt"], examplePrompts: [PROMPT2] };
const TOPIC_RESEARCH = { ...RESEARCH,
  retainedKeywords: [...RESEARCH.retainedKeywords, { query: TOPIC, searchVolume: 1600, competition: 0.3, competitionLevel: "low" as const, difficulty: null, intent: "informational" }],
  serpEvidence: [...RESEARCH.serpEvidence, { query: TOPIC, organic: [{ rank: 1, domain: "waterwise.example", url: URL2, title: "P" }], aiOverview: [], aiMode: [], paa: [], related: [] }],
  aiObservations: [...RESEARCH.aiObservations, { promptId: "p3", promptText: PROMPT2, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [{ url: URL2, domain: "waterwise.example", title: "P" }], fanOutQueries: null, observedAt: "2026-07-23T00:00:00.000Z" }],
  winningPages: [...RESEARCH.winningPages, { url: URL2, domain: "waterwise.example", engines: ["chatgpt"], examplePrompts: [PROMPT2], appearances: [{ kind: "ai_answer" as const, query: null, promptId: "p3", promptText: PROMPT2, engine: "chatgpt", rank: null, citedUrl: URL2, observedAt: "2026-07-23T00:00:00.000Z", modelServed: null }], extract: { title: "P", h1: "P", wordCount: 1800, headings: ["Rules", "Rebates", "Limits"], faqCount: 3 } }] };
const BRIEF = { proposedTitle: "Rainwater harvesting permits: what the rules ask of you",
  metaDescription: "Rainwater harvesting permits differ by where you live, so this page walks through who needs one, what the rules cover, and how to check yours.",
  openingAnswer: "Rainwater harvesting permits are set locally, so whether you need one depends on where your barrel sits and how much water you plan to hold. Most households can put in a single barrel with no paperwork, while a larger cistern or any plumbed connection to the house usually needs a filed permit and an inspection. Check your county rules before you buy, because the limits are written per property rather than per barrel.",
  outline: ["Who needs a rainwater harvesting permit", "What the rules usually cover", "How to check your own county", "What an inspection looks for"],
  faqQuestions: ["Do I need a permit for one rain barrel?", "What happens if I skip the permit?"], schemaTypes: ["Article", "FAQPage"] };
const SOURCE = { url: URL2, title: "County permit rules", domain: "waterwise.example", retrievedAt: "2026-07-23", claim: "Rainwater permit rules are set by county.", authority: "unverified" };
const PLAN = [...BRIEF.outline, ...BRIEF.faqQuestions].join("\n"); /** The same seam, plus the new-page brief with a chosen source list. */
const briefSeam = (sources: unknown[]): CompleteFn => async (req) => { sent.push(req.system); return req.kind === "create_page_brief" ? { value: { ...BRIEF, sources, ...TAIL } } : seam(req); };
const snapshot = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
    scope: { tenantId: TENANT, site: "fixture-content.example", builtAt: NOW.toISOString() }, aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 },
    sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [],
    contentGaps: [], internalLinkOpportunities: [], newPageOpportunities: [], evidenceHash: "fixture", research: RESEARCH,
    ownedPages: [page({ url: "fixture-content.example/rain-barrels" }), page({ url: "fixture-content.example/compost", search: COMPOST })], ...over });
const topicSnapshot = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => snapshot({ research: TOPIC_RESEARCH, newPageOpportunities: [OPP, OPP2], competitors: [COMPETITOR], ...over });
const reverse = <T,>(a: readonly T[]): T[] => [...a].reverse(); const OPTS = { now: NOW, bypassCache: true }; /** Every component cites receipt items that actually exist. */
const expectKeysResolve = (b: ChangeBundle): void => { const keys = new Set(b.receipt.items.map((i) => i.key));
  for (const c of b.components) { expect(c.evidenceKeys.length).toBeGreaterThan(0); for (const k of c.evidenceKeys) expect(keys.has(k)).toBe(true); } };
/** No provider name, no lab word, no dash reaches operator-facing copy. */
const expectCleanCopy = (p: ChangeProposal): void => {
  const b = p.bundle!; const copy = [b.objective, b.metric, b.measurementPlan, p.whyItMatters, ...b.receipt.items.map((i) => i.fact), ...b.receipt.missing, ...b.risks,
    ...b.confidenceReasons, ...b.components.map((c) => `${c.label} ${c.after}`), ...b.alternatives.map((a) => `${a.option} ${a.reason}`)].join(" ");
  expect(copy).not.toMatch(/chatgpt|gemini|dataforseo|SERP|baseline|control group/i); expect(copy).not.toMatch(/[–—]/); };
beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; store.rows.clear(); sent.length = 0; }); afterEach(() => { delete process.env.OPENAI_API_KEY; });
describe("produceBundleForSnapshot", () => {
  it("repairs the page with the biggest proven gap, in exact drafted copy, on a receipt every component cites", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { complete: seam, ...OPTS }); expect(out.status).toBe("bundled"); if (out.status !== "bundled") return;
    const p = out.proposal; const bundle = p.bundle!; expect(p.id).toBe(`${TENANT}::/rain-barrels::existing_edit::bundle`);
    expect(p.pagePath).toBe("/rain-barrels"); expect(p.changeFamily).toBe("single"); expect(p.kind).toBe("existing_edit"); // the 570-click gap, not the 55-click one
    // ONE field, the one the results page accused. A description or an opening answer would need the line Google shows under the result or this page's own words, and neither is on file.
    expect(p.impactScore).toBe(570); expect(bundle.components.map((c) => c.kind)).toEqual(["title"]); expect(bundle.components[0].before).toBe("Rain Barrels");
    expect(bundle.components[0].after).toBe(TITLE_AFTER); expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "title", before: "Rain Barrels", after: TITLE_AFTER });
    expect(bundle.receipt.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["gsc_demand", "page_extract", "keyword", "serp", "ai_observation", "winning_page"]));
    // the receipt a ready title stands on: the exact search, this page's stored copy, the results page, the line Google displays for it, and the wording the winners share
    expect(bundle.components[0].evidenceKeys).toEqual(["demand-exact", "copy-current", "serp1", "serp-owned", "serp-pattern"]);
    expect(bundle.receipt.items.find((i) => i.key === "copy-current")!.fact).toContain('is titled "Rain Barrels"');
    expect(bundle.receipt.items.find((i) => i.key === "serp-owned")!.fact).toBe('On that results page Google shows this page worded "Rain Barrels".');
    expect(bundle.receipt.items.find((i) => i.key === "serp-pattern")!.fact).toBe('Across the other pages that come up for "rain barrel sizing", "barrel", "rain", "sizing" recur in the wording Google shows.');
    expect(bundle.confidenceReasons.some((r) => r.startsWith("I checked the results page:"))).toBe(true); // the diagnosis itself, in the operator's words
    expect(bundle.alternatives[0]).toEqual({ option: "Google is already showing the words people search for", reason: 'Google shows this page as "Rain Barrels", and that line does not say "sizing".' });
    expect(bundle.receipt.freshestObservedAt).toBe("2026-07-22T00:00:00.000Z"); expectKeysResolve(bundle); expectCleanCopy(p);
    expect(bundle.scope).toEqual({ queries: ["rain barrel sizing", "how many gallons rain barrel"], prompts: ["rain barrel sizing rule of thumb", "what size rain barrel do I need"] });
    expect(bundle.alternatives.some((a) => a.option.includes("/compost"))).toBe(true); expect(p.evidence.evidenceRefCount).toBe(bundle.receipt.items.length); }); // the count IS the receipt
  it("names every number's scope, so a page total is never read as one search", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change"); const p = out.proposal;
    const b = p.bundle!; const facts = b.receipt.items.filter((i) => i.kind === "gsc_demand").map((i) => i.fact);
    expect(facts[0]).toContain("this page overall earned 120 clicks from 9,000 views"); // the page total, said as a page total
    expect(facts[1]).toBe('That one search "rain barrel sizing" brings this page 6,000 views and 90 clicks, at about position 3.');
    for (const line of [p.whyItMatters, b.objective, b.confidenceReasons[0]]) expect(line).not.toContain("9,000"); // no query claim ever borrows the page total
    expect(p.whyItMatters).toContain('Searching "rain barrel sizing" brings this page 6,000 views and only 90 clicks over 90 days, about 570 clicks short of what position 3 usually earns');
    expect(b.receipt.items.find((i) => i.kind === "ai_observation")!.fact).toBe('When a customer searches "what size rain barrel do I need" inside an assistant, it points people at gardenguide.example. To answer it the assistant went and searched "rain barrel gallons".'); });
  it("spends nothing on a search whose results page it has never looked at, and says exactly that", async () => {
    let called = 0; const counting: CompleteFn = async (r) => { called += 1; return seam(r); };
    const out = await produceBundleForSnapshot(snapshot({ research: emptyResearchEvidence() }), { complete: counting, ...OPTS });
    // A gap proves something is wrong, never what to change: unseen is an investigation, and an investigation costs no drafter call.
    expect(out.status).toBe("none"); if (out.status !== "none") return; expect(called).toBe(0);
    expect(out.reason).toBe("I have not looked at the results page for that search yet, so I cannot tell you what to change. It is first in line on my next research pass."); });
  it("refuses a page with no proven gap and no current copy, and round-trips through persistence", async () => {
    const opt = { complete: seam, ...OPTS }; const healthy = page({ url: "fixture-content.example/rain-barrels", search: { ...page({ url: "x" }).search!, topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 700, position: 3 }] } });
    const noGap = await produceBundleForSnapshot(snapshot({ ownedPages: [healthy] }), opt);
    const noCopy = await produceBundleForSnapshot(snapshot({ ownedPages: [page({ url: "fixture-content.example/rain-barrels", content: null })] }), opt); expect(noGap.status).toBe("none"); expect(noCopy.status).toBe("none"); if (noCopy.status !== "none") return; // a big page earning its rank is not work
    expect(noCopy.reason).toContain("nothing honest to rewrite"); const out = await produceBundleForSnapshot(snapshot(), opt); if (out.status !== "bundled") throw new Error("expected a change");
    const back = deserializeChangeProposal(serializeChangeProposal(out.proposal)); expect(back).toEqual(out.proposal); expect(back!.bundle!.components).toHaveLength(1);
    const { bundle: _dropped, ...preBundleRow } = out.proposal; void _dropped; const legacy = deserializeChangeProposal(serializeChangeProposal(preBundleRow as typeof out.proposal));
    expect(legacy).not.toBeNull(); expect(legacy!.bundle).toBeUndefined(); });
  it("produces an identical result of either archetype when every input list arrives in the opposite order", async () => {
    const base = snapshot(); const flipped = snapshot({
      ownedPages: reverse(base.ownedPages).map((pg) => ({ ...pg, search: pg.search ? { ...pg.search, topQueries: reverse(pg.search.topQueries) } : null })),
      research: { ...RESEARCH, retainedKeywords: reverse(RESEARCH.retainedKeywords), aiObservations: reverse(RESEARCH.aiObservations), winningPages: reverse(RESEARCH.winningPages), serpEvidence: RESEARCH.serpEvidence.map((s) => ({ ...s, organic: reverse(s.organic) })) },
    }); expect(JSON.stringify(await produceBundleForSnapshot(flipped, { complete: seam, ...OPTS }))).toBe(JSON.stringify(await produceBundleForSnapshot(base, { complete: seam, ...OPTS })));
    const opt = { complete: briefSeam([SOURCE]), ...OPTS };
    const flippedTopic = topicSnapshot({ newPageOpportunities: [OPP2, OPP],
      research: { ...TOPIC_RESEARCH, retainedKeywords: reverse(TOPIC_RESEARCH.retainedKeywords), aiObservations: reverse(TOPIC_RESEARCH.aiObservations), winningPages: reverse(TOPIC_RESEARCH.winningPages), serpEvidence: reverse(TOPIC_RESEARCH.serpEvidence) } });
    expect(JSON.stringify(await produceNewPageBundleForSnapshot(flippedTopic, opt))).toBe(JSON.stringify(await produceNewPageBundleForSnapshot(topicSnapshot(), opt))); });
}); describe("produceNewPageBundleForSnapshot", () => {
  it("builds one researched topic into a page plan every component cites", async () => {
    const out = await produceNewPageBundleForSnapshot(topicSnapshot(), { complete: briefSeam([SOURCE]), ...OPTS }); expect(out.status).toBe("bundled"); if (out.status !== "bundled") return;
    const p = out.proposal; const bundle = p.bundle!; expect(p.id).toBe(`${TENANT}::new::${TOPIC}::new_page::bundle`);
    expect(p.kind).toBe("new_page"); expect(p.pagePath).toBeNull(); expect(p.impactScore).toBe(5200); // the opportunity's own demand weight
    expect(p.recommendedChange).toEqual({ kind: "new_page", ...BRIEF }); expect(bundle.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer", "section", "source_pack"]);
    expect(bundle.components.map((c) => c.label)).toEqual(["Page title", "Search description", "Opening answer", "Page plan", "Sources to cite"]);
    expect(bundle.components.every((c) => c.before === null)).toBe(true); expect(bundle.components[3].after).toBe(PLAN); // insertions only; the outline plus the FAQ questions
    expect(bundle.components[4].after).toBe("County permit rules, waterwise.example: https://waterwise.example/permits");
    expect(bundle.risks[0]).toContain("one page and only work as one"); // a new page is a genuine package, and says why
    expect(bundle.receipt.items.map((i) => i.kind)).toEqual(["keyword", "serp", "ai_observation", "competitor", "winning_page"]);
    expect(bundle.receipt.items.find((i) => i.kind === "competitor")!.fact).toBe("AI answers cite waterwise.example for this on 4 different prompts.");
    expect(bundle.receipt.items.find((i) => i.kind === "winning_page")!.fact).toContain("runs 1,800 words with 3 sections");
    expect(bundle.receipt.freshestObservedAt).toBe("2026-07-23T00:00:00.000Z"); expectKeysResolve(bundle); expect(bundle.objective).toBe(`Build one page that answers "${TOPIC}" so the demand lands on you.`);
    expect(bundle.metric).toBe(`Clicks and views from search for "${TOPIC}" over the next 28 days.`); expect(bundle.scope).toEqual({ queries: [TOPIC], prompts: [PROMPT2] });
    expect(bundle.alternatives.some((a) => a.option.includes("downspout diverter install"))).toBe(true); expectCleanCopy(p); expect(deserializeChangeProposal(serializeChangeProposal(p))).toEqual(p); });
  it("omits the source list when the brief has none, and refuses outright without research", async () => {
    const noSources = await produceNewPageBundleForSnapshot(topicSnapshot(), { complete: briefSeam([]), ...OPTS }); if (noSources.status !== "bundled") throw new Error("expected a bundle");
    expect(noSources.proposal.bundle!.components.map((c) => c.kind)).toEqual(["title", "meta", "opening_answer", "section"]);
    expect(noSources.proposal.bundle!.alternatives.some((a) => a.option === "Sources to cite")).toBe(true); // named, never silently dropped
    const unresearched = await produceNewPageBundleForSnapshot(snapshot({ newPageOpportunities: [OPP, OPP2] }), { complete: briefSeam([SOURCE]), ...OPTS });
    expect(unresearched.status).toBe("none"); if (unresearched.status !== "none") return; expect(unresearched.reason).toContain("has research behind it yet"); });
}); // ── anchored evidence: the words this account puts on everything prove nothing ─
const CONTENT = page({ url: "x" }).content!; const kwRow = (query: string, searchVolume: number | null) => ({ query, searchVolume, competition: 0.2, competitionLevel: "low" as const, difficulty: null, intent: "informational" });
const obsRow = (promptText: string, observedAt: string, url = WIN1, fanOutQueries: string[] | null = null) => ({ promptId: promptText, promptText, engine: "chatgpt", observationMode: "consumer_search" as const, modelRequested: null, modelServed: null, webSearchReported: true, citationsObserved: true, citations: [{ url, domain: url.split("/")[2]!, title: "P" }], fanOutQueries, observedAt });
const GALLONS = "how many gallons does a rain barrel hold"; const MOSQUITO = "do rain barrels attract mosquitoes"; // shares only the everywhere-words with every page this account owns
const compostSerp = { query: "compost bin sizing", aiOverview: [], aiMode: [], paa: [], related: [], organic: [{ rank: 1, domain: "compostpro.example", url: "https://compostpro.example/a", title: "Compost bin sizing guide" },
  { rank: 2, domain: "binguide.example", url: "https://binguide.example/b", title: "Sizing a compost bin" }, { rank: 3, domain: "fixture-content.example", url: "https://fixture-content.example/compost", title: "Compost" }] };
const ANCHOR_RESEARCH = { ...emptyResearchEvidence(), serpEvidence: [...TOPIC_RESEARCH.serpEvidence, compostSerp],
  retainedKeywords: [kwRow("rain barrel sizing", 4400), kwRow("how many gallons rain barrel", 880), kwRow(TOPIC, 1600), kwRow("rain barrel winter care", 210), kwRow("rain barrel overflow hose", 140), kwRow("rain barrel mosquito screen", 90)],
  aiObservations: [obsRow(GALLONS, "2026-07-22T00:00:00.000Z", WIN1, ["sizing rain barrel"]), obsRow(MOSQUITO, "2026-07-21T00:00:00.000Z"), obsRow(PROMPT2, "2026-07-23T00:00:00.000Z", URL2), obsRow("how do I winterize a rain barrel", "2026-07-20T00:00:00.000Z"), obsRow("rain barrel overflow in a storm", "2026-07-19T00:00:00.000Z")],
  winningPages: [{ ...RESEARCH.winningPages[0], examplePrompts: [GALLONS], extract: { title: GALLONS, h1: "Rain barrel gallons", wordCount: 1400, headings: ["Typical gallons", "Overflow hose"], faqCount: 2 } }, { ...TOPIC_RESEARCH.winningPages[1], examplePrompts: [MOSQUITO] }] };
const anchorSnap = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => snapshot({ research: ANCHOR_RESEARCH, competitors: [COMPETITOR], ...over });
describe("evidence attaches only where it is topically anchored", () => {
  it("keeps the AI answer and cited page that are about THIS page, drops the ones sharing only the everywhere-word", async () => {
    const opt = { complete: seam, ...OPTS }; const out = await produceBundleForSnapshot(anchorSnap(), opt); if (out.status !== "bundled") throw new Error("expected a bundle");
    const b = out.proposal.bundle!; const facts = b.receipt.items.map((i) => i.fact).join(" "); expect(b.scope.prompts).toEqual([GALLONS]); expect(facts).not.toMatch(/mosquito|winterize|permit/i); // kept only because the assistant itself searched this page's own search
    expect(b.receipt.items.filter((i) => i.kind === "winning_page").map((i) => i.fact.split(" ")[0])).toEqual(["gardenguide.example"]);
    expect(b.receipt.items.some((i) => i.kind === "ai_observation")).toBe(true); expectKeysResolve(b); expectCleanCopy(out.proposal);
    const flipped = anchorSnap({ research: { ...ANCHOR_RESEARCH, retainedKeywords: reverse(ANCHOR_RESEARCH.retainedKeywords), aiObservations: reverse(ANCHOR_RESEARCH.aiObservations), winningPages: reverse(ANCHOR_RESEARCH.winningPages) } });
    expect(JSON.stringify(await produceBundleForSnapshot(flipped, opt))).toBe(JSON.stringify(out)); }); // same snapshot, same bundle
  it("researches a new topic only from rows anchored to it, and refuses when every row is weak-only", async () => {
    const opt = { complete: briefSeam([SOURCE]), ...OPTS }; const out = await produceNewPageBundleForSnapshot(anchorSnap({ newPageOpportunities: [{ ...OPP, topic: "rain barrel permits" }] }), opt);
    if (out.status !== "bundled") throw new Error("expected a bundle"); const b = out.proposal.bundle!;
    expect(b.scope.queries).toEqual(["rain barrel permits", TOPIC]); expect(b.scope.prompts).toEqual([PROMPT2]); // the five other searches share only "rain barrel"
    expect(b.receipt.items.map((i) => i.fact).join(" ")).not.toMatch(/mosquito|gallons|sizing/i);
    const weakOnly = await produceNewPageBundleForSnapshot(anchorSnap({ newPageOpportunities: [{ ...OPP, topic: "rain barrel stands" }] }), opt); expect(weakOnly.status).toBe("none");
    if (weakOnly.status === "none") expect(weakOnly.reason).toContain("has research behind it yet"); });
  it("drops evidence that is not about the page, then says plainly what it no longer holds", async () => {
    const only = [page({ url: "fixture-content.example/compost", search: { clicks90d: 40, impressions90d: 9000, ctr90d: 0.004, position90d: 5, topQueries: [{ query: "compost bin sizing", impressions: 9000, clicks: 40, position: 5 }] } })];
    const out = await produceBundleForSnapshot(anchorSnap({ ownedPages: only }), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a bundle");
    const b = out.proposal.bundle!; expect(b.components.map((c) => c.kind)).toEqual(["title"]); // one field, and only the evidence that is about this page
    expect(b.receipt.missing).toEqual(expect.arrayContaining(['I have not gathered an AI answer about "compost bin sizing" yet.', 'I have not read the pages that come up for "compost bin sizing" yet.']));
    expect(b.receipt.items.every((i) => i.kind !== "ai_observation" && i.kind !== "winning_page")).toBe(true); expect(b.scope.prompts).toEqual([]); });
  it("suppresses a new page that overlaps an owned page on its distinguishing words, never on the everywhere-word", async () => {
    const { snapshotToEvidenceInputs } = await import("@/domains/decision/opportunities"); const owned = ["Harbor", "Harbor Girl Names|Harbor Female Names", "Harbor Tide Charts", "Harbor Ferry Schedule", "Harbor Whale Tours", "Harbor Seafood Market", "Harbor Parking Rates", "Harbor Fishing Permits"]
      .map((t) => t.split("|")).map(([title, h1]) => page({ url: `fixture-content.example/${title}`, content: { ...CONTENT, title, h1: h1 ?? title } }));
    const topics = ["beautiful harbor girl names", "harbor kayak rentals"].map((topic, i) => ({ ...OPP, topic, demandWeight: 90 - i }));
    const kept = snapshotToEvidenceInputs(snapshot({ ownedPages: owned, newPageOpportunities: topics })).filter((i) => i.opportunity.kind === "new_page");
    expect(kept.map((i) => i.opportunity.query)).toEqual(["harbor kayak rentals"]); }); // the girl-names topic is the owned page's own job
}); // ── query identity for what is bought per query; confidence by evidence class ──
const serpRow = (query: string) => ({ query, aiOverview: [], aiMode: [], paa: [], related: [], organic: [{ rank: 1, domain: "gardenguide.example", url: WIN1, title: "Rain barrel sizing guide" },
  { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "Sizing a rain barrel by roof area" }, { rank: 3, domain: "fixture-content.example", url: "https://fixture-content.example/rain-barrels", title: "Rain Barrels" }] });
const winRow = (url: string, extract: ResearchPageExtract | null = null) => ({ url, domain: url.split("/")[2]!, engines: ["chatgpt"], examplePrompts: [], appearances: [], extract });
const linkRow = (toUrl: string, anchor: string) => ({ fromUrl: "fixture-content.example/rain-barrels", toUrl, anchor, reason: "" });
describe("what a receipt will and will not accept", () => {
  it("takes the results page bought under the same words in any order, and no winner a shared domain alone vouches for", async () => {
    const research = { ...RESEARCH, serpEvidence: [serpRow("sizing rain barrel"), serpRow("rain barrel sizing chart")], winningPages: [winRow(WIN1, { title: "A", h1: "A", wordCount: 900, headings: ["Gallons per storm"], faqCount: 0 }), winRow("https://gardenguide.example/other"), winRow("https://opaque.example/rain-barrel-sizing")] };
    const out = await produceBundleForSnapshot(snapshot({ research }), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change");
    const items = out.proposal.bundle!.receipt.items; const serps = items.filter((i) => i.kind === "serp").map((i) => i.fact).join(" "); expect(serps).toContain('"sizing rain barrel"'); expect(serps).not.toMatch(/chart/); // same words reordered is the same search; a new modifier is a different one
    // ONLY the exact URL that appeared for a member search attaches. Another page on that SAME domain never does.
    expect(items.filter((i) => i.kind === "winning_page")).toHaveLength(1); expect(items.find((i) => i.kind === "winning_page")!.fact).toContain("900 words");
    expect(items.some((i) => i.key === "winpattern")).toBe(false); // one page's style is that page's style, never a pattern
    expect(out.proposal.confidence).toBe("medium"); expect(out.proposal.bundle!.confidenceReasons.join(" ")).toContain("a live results check");
    const tracked = await produceNewPageBundleForSnapshot(topicSnapshot({ research: { ...TOPIC_RESEARCH, winningPages: [winRow("https://waterwise.example/other")] } }), { complete: briefSeam([SOURCE]), ...OPTS });
    if (tracked.status !== "bundled") throw new Error("expected a bundle"); expect(tracked.proposal.bundle!.receipt.items.some((i) => i.kind === "winning_page")).toBe(false); }); // a competitor's domain is not this page's provenance
  it("withholds a link it cannot place, and never calls my own data alone high confidence", async () => {
    const links = [linkRow("fixture-content.example/", "Home"), linkRow("fixture-content.example/contact", "Contact us"), linkRow("fixture-content.example/gallons", "Rain barrel gallons per storm")];
    const out = await produceBundleForSnapshot(snapshot({ internalLinkOpportunities: links }), { complete: seam, ...OPTS });
    if (out.status !== "bundled") throw new Error("expected a change"); const b = out.proposal.bundle!; // one destination is on topic, but no body text means no honest placement
    expect(b.components.some((c) => c.kind === "internal_links")).toBe(false); expect(b.receipt.items.some((i) => i.kind === "internal_link")).toBe(false);
    expect(b.alternatives.find((a) => a.option === "Links out to your own pages")!.reason).toContain("I can see 1 of your own page worth linking to");
    const reasons = b.confidenceReasons.join(" "); expect(reasons).toContain("your own search data"); expect(reasons).toContain("what the page says today"); expect(reasons).not.toMatch(/\d+ pieces/);
    expect(confidenceFor({ gsc: true, ownedCopy: true, serp: false, winners: 0, body: false })).toBe("low"); }); // my own demand rows and copy are still only my own data
  it("hands on only the follow-up searches the provider actually ran, and anchors coverage to the account corpus", async () => {
    const { buildEvidenceSnapshot } = await import("@/domains/evidence/snapshot"); const src = <T,>(payload: T) => ({ status: "fresh" as const, lastSyncedAt: null, payload });
    const input = (titles: string[], queries: string[], fan: string[] | null = null) => ({
      scope: { tenantId: TENANT, site: "fixture-content.example", builtAt: NOW.toISOString() }, gsc: src([]), ga4: src([]), clarity: src([]), dataforseo: src([]),
      wix: src(titles.map((t, i) => ({ url: `https://fixture-content.example/p${i}`, ...CONTENT, title: t, h1: t, outline: [] }))),
      research: src({ ...emptyResearchEvidence(), retainedKeywords: queries.map((q) => kwRow(q, 100)), aiObservations: [obsRow(PROMPT2, "2026-07-23T00:00:00.000Z", URL2, fan)] }),
      nativeAi: src({ citedPages: [{ url: URL2, isOwned: false, citationCount: 9, distinctPrompts: 4, engines: ["chatgpt"], examplePrompts: [PROMPT2] }], questions: [{ text: "harbor kayak rentals", weight: 3, sourcePrompts: [] }], rowsScanned: 0, enginesSeen: [] }) });
    const real = buildEvidenceSnapshot(input([], [], ["rainwater permit cost", "greywater rules by county"])).newPageOpportunities[0];
    expect(real.topic).toBe(PROMPT2); expect(real.fanoutSeeds).toEqual(["rainwater permit cost", "greywater rules by county"]); // the prompt we track names the topic
    expect(real.fanoutSeeds).not.toContain(PROMPT2); // and a question we track is ours, never handed on as the provider's own search
    const small = buildEvidenceSnapshot(input(["Harbor Tide Charts", "Harbor Whale Tours"], [])); expect(small.newPageOpportunities[0].fanoutSeeds).toEqual([]); // the provider reported none
    expect(small.internalLinkOpportunities).toHaveLength(2); expect(small.questionDemand[0].coverageStatus).toBe("answered"); // under ten phrases nothing is ubiquitous yet
    const big = buildEvidenceSnapshot(input(["Harbor Tide Charts", "Harbor Whale Tours", "Harbor Seafood Market", "Harbor Ferry Schedule", "Harbor Parking Rates", "Harbor Fishing Permits"], ["harbor kayak rentals", "harbor sunset cruise", "harbor bike hire", "harbor dog beach", "harbor live music", "harbor farmers market"]));
    expect(big.internalLinkOpportunities).toEqual([]); expect(big.questionDemand[0].coverageStatus).toBe("unanswered"); }); // the everywhere-word relates nothing
}); describe("confidence is the evidence I hold, never how the draft reads", () => {
  const twin = (url: string, over: Partial<(typeof RESEARCH)["winningPages"][number]> = {}) => ({ ...RESEARCH.winningPages[0]!, url, domain: url.split("/")[2]!, ...over });
  const ranElsewhere: ResearchWinningAppearance[] = [{ kind: "serp_organic", query: "how many gallons rain barrel", promptId: null, promptText: null, engine: null, rank: 1, citedUrl: "https://elsewhere.example/x", observedAt: "2026-07-22T00:00:00.000Z", modelServed: null }];
  const elsewhere = { ...twin("https://elsewhere.example/x"), examplePrompts: [], appearances: ranElsewhere };
  it("reads two winners as medium, names the one step left, and claims only a pattern both of them share", async () => {
    const research = { ...RESEARCH, winningPages: [...RESEARCH.winningPages, twin("https://waterwise.example/b"), elsewhere] };
    const out = await produceBundleForSnapshot(snapshot({ research }), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change");
    const items = out.proposal.bundle!.receipt.items; // the third page came up for the page's OTHER search, so it is not evidence about this one
    expect(items.filter((i) => i.kind === "winning_page").map((i) => i.fact).join(" ")).not.toMatch(/elsewhere/);
    expect(items.find((i) => i.key === "winpattern")!.fact).toBe('Of the 2 pages I read that come up for "rain barrel sizing", 2 of them answer it in a question and answer block, and this page has none, and the middle one runs 1,400 words against this page\'s 900.');
    expect(out.proposal.status).toBe("proposed"); expect(out.proposal.confidence).toBe("medium"); expectCleanCopy(out.proposal);
    expect(out.proposal.limitations).toContain("I do not hold this page's full body text, so I checked every draft against its title and section headings only.");
    expect(confidenceFor({ gsc: true, ownedCopy: true, serp: true, winners: 2, body: true })).toBe("high"); }); // reading the page itself is the only step left to certain
  it("hands over nothing at all rather than a change it can show you nothing for", async () => {
    const blind: CompleteFn = async () => ({ value: {} as never }); const out = await produceBundleForSnapshot(snapshot(), { complete: blind, ...OPTS });
    expect(out.status).toBe("none"); if (out.status !== "none") return; expect(out.reason).toContain("handing you nothing rather than filler"); });
}); describe("one pass, both changes, one row per change", () => {
  it("drops the shallow brief for a bundled topic at generation and again on load", async () => {
    env.snap = topicSnapshot(); const res = await produceProposalsForTenant(TENANT, { complete: briefSeam([SOURCE]), ...OPTS }); const bundleId = `${TENANT}::new::${TOPIC}::new_page::bundle`;
    // both archetypes land in the SAME pass without interfering
    expect(res.proposals.map((p) => p.id)).toEqual(expect.arrayContaining([bundleId, `${TENANT}::/rain-barrels::existing_edit::bundle`]));
    // fresh dedupe: exactly one row for this topic, and it is the bundle; the shallow row persisted earlier in the pass is suppressed on load
    expect(res.proposals.filter((p) => p.kind === "new_page" && p.primaryQuery === TOPIC).map((p) => p.id)).toEqual([bundleId]);
    expect([...store.rows.keys()].filter((id) => id.includes(`new::${TOPIC}`)).length).toBeGreaterThan(1); const queue = await loadProposalQueue(TENANT);
    expect(queue.newPageBriefs.filter((p) => p.primaryQuery === TOPIC).map((p) => p.id)).toEqual([bundleId]);
    // B6: generic product code carries no vertical assumption, whatever this account happens to sell.
    expect(sent.join(" ")).not.toMatch(/encyclopedia|wikipedia|culture|dynast|cuisine|province/i); });
  it("READY means ready: an older-basis row and a row still owing a source both drop to to-do, and neither is deleted", async () => {
    env.snap = topicSnapshot(); await produceProposalsForTenant(TENANT, { complete: briefSeam([SOURCE]), ...OPTS });
    const owing = "Add one before this is paste-ready.", owingId = `${TENANT}::/rain-barrels::existing_edit::bundle`;
    [...store.rows.values()].forEach((p) => store.rows.set(p.id, { ...p, status: "proposed", basis: "basis_today", limitations: p.id === owingId ? [owing] : [] }));
    const rows = store.rows.size; const stale = await loadProposalQueue(TENANT, { currentBasis: "basis_after_the_operator_changed_the_business" });
    expect(stale.ready).toEqual([]); expect(stale.toDo.length).toBe(stale.ranked.length); // an old basis can never claim ready
    const current = await loadProposalQueue(TENANT, { currentBasis: "basis_today" }); expect(current.ready.length).toBeGreaterThan(0); expect(current.ready.some((p) => p.limitations.includes(owing))).toBe(false);
    expect(current.toDo.some((p) => p.limitations.includes(owing))).toBe(true); expect(store.rows.size).toBe(rows); }); // demotion in presentation only: no row rewritten, no history lost
  it("never claims both sources when one is missing, and never proposes a page the tenant already owns", async () => {
    const { snapshotToEvidenceInputs } = await import("@/domains/decision/opportunities"); const label = (over: Partial<NewPageOpportunity>) => snapshotToEvidenceInputs(topicSnapshot({ newPageOpportunities: [{ ...OPP, ...over }] })).filter((i) => i.opportunity.kind === "new_page");
    const aiOnly = label({ basis: "ai_attention" })[0]!; expect(aiOnly.opportunity.opportunityType).toBe("Build a page AI keeps asking about");
    expect(`${aiOnly.opportunity.opportunityType} ${(aiOnly.evidence.hints ?? []).join(" ")}`).not.toMatch(/people search|google/i);
    expect(label({ basis: "search_volume" })[0]!.opportunity.opportunityType).toBe("Build a page people search for");
    expect(label({})[0]!.opportunity.opportunityType).toBe("Build a page people search for and AI asks about");
    expect(label({ topic: "rain barrels" })).toEqual([]); }); // an owned page title: proposing a new page for it is self-cannibalization
}); // ── the release: a fresh timestamp may never sit on top of a failed production run ──
const release = async (produce: () => Promise<unknown>) => { vi.resetModules(); const published: { computedAt: string }[] = [];
  vi.doMock("@/lib/persistence/json-store", () => ({ readStore: async () => [], writeStore: async (_s: string, rows: { computedAt: string }[]) => { published.push(...rows); } }));
  vi.doMock("@/lib/tenant-context", () => ({ currentTenantId: async () => TENANT, runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn() }));
  vi.doMock("@/lib/single-flight", () => ({ runSingleFlight: async (_k: string, fn: () => Promise<unknown>) => fn() }));
  vi.doMock("@/domains/decision", () => ({ produceProposalsForTenant: produce }));
  vi.doMock("@/app/(shell)/changes-data", () => ({ buildChangesViewUncached: async () => ({ proposals: [] }) }));
  const signals: { declineNotes?: { page: string; note: string }[] }[] = [];
  vi.doMock("@/app/(shell)/today-view-data", () => ({ buildTodayCompositeFromChanges: async (_v: unknown, sig: { declineNotes?: { page: string; note: string }[] }) => { signals.push(sig); return { headline: "" }; } }));
  return { ...(await import("@/app/(shell)/surface-release")), published, signals };
};
describe("a release publishes only on a real production result", () => {
  it("lets a production failure through instead of stamping stale work with a fresh timestamp", async () => {
    const { refreshCustomerSurface, published } = await release(async () => { throw new Error("evidence read failed"); });
    await expect(refreshCustomerSurface(TENANT)).rejects.toThrow("evidence read failed"); expect(published).toEqual([]); }); // the previous release is untouched, and the phase fails where a human can see it
  it("publishes cleanly when a healthy run finds nothing worth doing", async () => { const { refreshCustomerSurface, published } = await release(async () => ({ proposals: [], opportunities: 0, noDraft: 0 }));
    const surface = await refreshCustomerSurface(TENANT); expect(surface.tenantId).toBe(TENANT); expect(published).toHaveLength(1); }); // nothing to do is an answer, not an outage
  it("keeps the last loadable release when every write of the pass failed", async () => {
    const { refreshCustomerSurface, published } = await release(async () => ({ proposals: [], outcome: "persistence_failed", candidates: [] }));
    await expect(refreshCustomerSurface(TENANT)).rejects.toThrow(/could not save a single one/); expect(published).toEqual([]); });
  it("carries the kernel's own verdict for judged-but-declined pages, biggest gap first", async () => {
    const judged = [{ action: "watch", pageUrl: "https://s.example/a/", recoverableClicks: 12, reason: "small gap" },
      { action: "research_needed", pageUrl: "https://s.example/b", recoverableClicks: 400, reason: "big gap" },
      { action: "act_existing_page", pageUrl: "https://s.example/c", recoverableClicks: 900, reason: "acted" }];
    const { refreshCustomerSurface, signals } = await release(async () => ({ proposals: [], outcome: "proposals_persisted", candidates: judged }));
    await refreshCustomerSurface(TENANT);
    expect(signals[0]?.declineNotes).toEqual([{ page: "/b", note: "big gap" }, { page: "/a", note: "small gap" }]); }); }); // an acted page is work, not a verdict
