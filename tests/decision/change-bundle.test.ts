/** The ONE change contract: an existing-page repair (Slice 7), and NOTHING ELSE. Selection on a PROVEN recoverable gap, receipt-first grounding for the EXACT candidate
 *  search, scope named on every number, QUERY IDENTITY per query, winners attaching only on exact membership, atomic bundling, confidence and readiness by EVIDENCE HELD,
 *  determinism, honest refusal, no page is ever invented however much research backs the topic, a release publishing only on a real production result, dedupe, and a
 *  round trip. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"; import type { BundleComponent, BundleComponentKind, ChangeBundle, ChangeProposal } from "@/domains/decision/contracts";
import { receiptComposition } from "@/domains/decision/contracts";
import { proposalFingerprint } from "@/domains/decision/proposal-store"; import { DANGEROUS_COMPONENT_KINDS, dangerousComponents, needsSourcePack } from "@/domains/decision/contracts"; import { rankProposals, proposalValueScore } from "@/domains/decision/rank-proposals"; import { validateProposal } from "@/domains/decision/validate-proposal";
const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>() })); const env = vi.hoisted(() => ({ snap: null as unknown })); vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) })); vi.mock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadChangeProposals: async () => store.rows, saveChangeProposal: async (p: ChangeProposal) => { store.rows.set(p.id, p); },
  withdrawnProposalIds: async () => new Set<string>(), withdrawChangeProposal: async () => true }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap })); vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "fixture-tenant", domain: "fixture-content.example", growth_goal: null }), basisTag: () => "basis_test" })); import { produceBundleForSnapshot } from "@/domains/decision/produce-bundle"; import { ledgerProofLine } from "@/domains/decision/changes/lifecycle-counts";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals"; import { loadProposalQueue } from "@/domains/decision/load-proposals"; import { confidenceFor, serializeChangeProposal, deserializeChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter"; import { adjudicateCoverage, earnedNewPage, intersectionComparison } from "@/domains/decision/coverage-adjudication"; import type { OwnedCandidate } from "@/domains/decision/owned-coverage"; import type { ParsedPageIntersection } from "@/domains/evidence/page-intersection";
import { answerIntelOf } from "@/domains/evidence/answer-intel"; import type { TopicInvestigation } from "@/domains/evidence/topic-investigation"; import type { LlmCallCacheEntry } from "@/domains/decision/llm/call-cache"; import type { EvidenceSnapshot, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { readTechnicalFindings, technicalComponents, type TechnicalFinding } from "@/domains/decision/technical-findings"; import { suggestedEdits } from "@/domains/decision/suggested-edits"; import { compileCandidates } from "@/domains/decision/opportunities";
import { CORE_PRODUCERS } from "@/domains/decision/producers/core";
import type { Producer, ProducerCtx } from "@/domains/decision/producers/contract"; import { fieldForComponent } from "@/domains/decision/producers/contract";
import { emptyResearchEvidence, type CanonicalPairObservation, type ResearchPageExtract, type ResearchWinningAppearance } from "@/domains/evidence/funnel/research-evidence"; const TENANT = "fixture-tenant"; const NOW = new Date("2026-07-25T00:00:00.000Z");
const TITLE_AFTER = "Rain barrel sizing: gallons per storm by roof area"; const TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };
/** Every system prompt the drafter sent this run (so no vertical assumption can hide in one), every draft KIND it was asked for (so a page can never be written for a topic), and the injected drafter seam itself. */
const sent: string[] = []; const kinds: string[] = []; const seam: CompleteFn = async ({ system, kind }) => { sent.push(system); kinds.push(kind); return { value: { field: "title", before: null, after: TITLE_AFTER, rationale: "The current copy does not say what the page answers.", ...TAIL } }; };
const page = (over: Partial<OwnedPageEvidence> & { url: string }): OwnedPageEvidence => ({ content: { title: "Rain Barrels", metaDescription: null, h1: "Rain Barrels", h2: [], outline: ["Rain barrel sizing", "Roof area and gallons", "Chaining a second barrel"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" },
    // "rain barrel sizing" earns 90 clicks where position 3 normally earns about 660: a 570-click gap. The second search sits at position 11 and earns about what that position should, so it is no gap at all.
    search: { clicks90d: 120, impressions90d: 9000, ctr90d: 0.013, position90d: 8, topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 90, position: 3 }, { query: "how many gallons rain barrel", impressions: 2000, clicks: 20, position: 11 }] }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] }, ...over });
/** ONE canonical answer as the store files it: every identity field present, because a row that exists was settled under a current question on a named day. */ const canonObs = (o: Partial<CanonicalPairObservation> & { promptText: string; observedAt: string }): CanonicalPairObservation => ({ promptId: o.promptText, promptVersion: 1, engine: "chatgpt", observationMode: "consumer_search", modelRequested: null, modelServed: null, answerHash: "h", webSearchReported: true, fanOutQueries: null, citations: null, retrievedResults: null, brandMentions: null, analysis: null, ...o, observationId: o.observationId ?? `obs_${o.promptId ?? o.promptText}_${o.engine ?? "chatgpt"}`, reportingDay: o.reportingDay ?? o.observedAt.slice(0, 10), citationsObserved: (o.citations ?? null) != null });
const COMPOST = { clicks90d: 5, impressions90d: 1200, ctr90d: 0.004, position90d: 6, topQueries: [{ query: "compost bin sizing", impressions: 1200, clicks: 5, position: 6 }] }; const WIN1 = "https://gardenguide.example/a"; const RESEARCH = { ...emptyResearchEvidence(),
  retainedKeywords: [{ query: "rain barrel sizing", searchVolume: 4400, competition: 0.2, competitionLevel: "low" as const, difficulty: null, intent: "informational" }, { query: "how many gallons rain barrel", searchVolume: 880, competition: 0.1, competitionLevel: "low" as const, difficulty: null, intent: "informational" }],
  // The owned page is ON this results page, worded without the searcher's own word, while two rivals share it: the mismatch a diagnosis may name.
  serpEvidence: [{ observedAt: null, query: "rain barrel sizing", organic: [{ rank: 1, domain: "gardenguide.example", url: WIN1, title: "Rain barrel sizing guide" }, { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "Sizing a rain barrel by roof area" },
    { rank: 3, domain: "fixture-content.example", url: "https://fixture-content.example/rain-barrels", title: "Rain Barrels" }], aiOverview: [{ url: WIN1, domain: "gardenguide.example", title: "A" }], aiMode: [], paa: [], related: [] }],
  aiObservations: [canonObs({ promptId: "p1", promptText: "what size rain barrel do I need", citations: [{ url: WIN1, domain: "gardenguide.example", title: "A" }], fanOutQueries: ["what size rain barrel do I need", "rain barrel sizing"], observedAt: "2026-07-22T00:00:00.000Z" }),
  canonObs({ promptId: "p2", promptText: "rain barrel sizing rule of thumb", engine: "gemini", observationMode: "standardized_response", webSearchReported: null, observedAt: "2026-07-21T00:00:00.000Z" })],
  winningPages: [{ url: WIN1, domain: "gardenguide.example", engines: ["chatgpt"], examplePrompts: ["what size rain barrel do I need"], appearances: [{ kind: "ai_answer" as const, query: null, promptId: "p1", promptText: "what size rain barrel do I need", engine: "chatgpt", rank: null, citedUrl: WIN1, observedAt: "2026-07-22T00:00:00.000Z", modelServed: null }], extract: { title: "A", h1: "A", wordCount: 1400, headings: ["Sizing", "Overflow"], faqCount: 2 } }] };
// ── a topic the account owns NO page for, researched to the hilt ───────────────
const TOPIC = "rainwater harvesting permits"; const URL2 = "https://waterwise.example/permits"; const PROMPT2 = "rainwater harvesting permits by state"; const COMPETITOR = { url: URL2, domain: "waterwise.example", citationCount: 9, distinctPrompts: 4, engines: ["chatgpt"], examplePrompts: [PROMPT2] };
const TOPIC_RESEARCH = { ...RESEARCH, retainedKeywords: [...RESEARCH.retainedKeywords, { query: TOPIC, searchVolume: 1600, competition: 0.3, competitionLevel: "low" as const, difficulty: null, intent: "informational" }],
  serpEvidence: [...RESEARCH.serpEvidence, { observedAt: null, query: TOPIC, organic: [{ rank: 1, domain: "waterwise.example", url: URL2, title: "P" }], aiOverview: [], aiMode: [], paa: [], related: [] }],
  aiObservations: [...RESEARCH.aiObservations, canonObs({ promptId: "p3", promptText: PROMPT2, citations: [{ url: URL2, domain: "waterwise.example", title: "P" }], observedAt: "2026-07-23T00:00:00.000Z" })],
  winningPages: [...RESEARCH.winningPages, { url: URL2, domain: "waterwise.example", engines: ["chatgpt"], examplePrompts: [PROMPT2], appearances: [{ kind: "ai_answer" as const, query: null, promptId: "p3", promptText: PROMPT2, engine: "chatgpt", rank: null, citedUrl: URL2, observedAt: "2026-07-23T00:00:00.000Z", modelServed: null }], extract: { title: "P", h1: "P", wordCount: 1800, headings: ["Rules", "Rebates", "Limits"], faqCount: 3 } }] };
const snapshot = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({ scope: { tenantId: TENANT, site: "fixture-content.example", builtAt: NOW.toISOString() }, aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 },
    sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], evidenceHash: "fixture", research: RESEARCH,
    ownedPages: [page({ url: "fixture-content.example/rain-barrels" }), page({ url: "fixture-content.example/compost", search: COMPOST })], ...over }); const topicSnapshot = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => snapshot({ research: TOPIC_RESEARCH, competitors: [COMPETITOR], ...over });
const reverse = <T,>(a: readonly T[]): T[] => [...a].reverse(); const OPTS = { now: NOW, bypassCache: true }; /** Every component cites receipt items that actually exist. */ const expectKeysResolve = (b: ChangeBundle): void => { const keys = new Set(b.receipt.items.map((i) => i.key));
  for (const c of b.components) { expect(c.evidenceKeys.length).toBeGreaterThan(0); for (const k of c.evidenceKeys) expect(keys.has(k)).toBe(true); } };
/** No provider name, no lab word, no dash reaches operator-facing copy. */
const expectCleanCopy = (p: ChangeProposal): void => { const b = p.bundle!; const copy = [b.objective, b.metric, b.measurementPlan, p.whyItMatters, ...b.receipt.items.map((i) => i.fact), ...b.receipt.missing, ...b.risks,
    ...b.confidenceReasons, ...b.components.map((c) => `${c.label} ${c.after}`), ...b.alternatives.map((a) => `${a.option} ${a.reason}`)].join(" "); expect(copy).not.toMatch(/chatgpt|gemini|dataforseo|SERP|baseline|control group/i); expect(copy).not.toMatch(/[–—]/); };
beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; store.rows.clear(); sent.length = 0; kinds.length = 0; }); afterEach(() => { delete process.env.OPENAI_API_KEY; }); describe("produceBundleForSnapshot", () => {
  it("repairs the page with the biggest proven gap, in exact drafted copy, on a receipt every component cites", async () => { const out = await produceBundleForSnapshot(snapshot(), { complete: seam, ...OPTS }); expect(out.status).toBe("bundled"); if (out.status !== "bundled") return; const p = out.proposal; const bundle = p.bundle!; expect(p.id).toBe(`${TENANT}::/rain-barrels::existing_edit::title-family`); expect(p.pagePath).toBe("/rain-barrels"); expect(p.changeFamily).toBe("title-family"); // the family, in the id AND the stamp: a snippet rewrite and a body rebuild are two changes, and the ledger must be able to tell them apart expect(p.kind).toBe("existing_edit"); // the 570-click gap, not the 55-click one
    // ONE field, the one the results page accused. A description or an opening answer would need the line Google shows under the result or this page's own words, and neither is on file.
    expect(p.impactScore).toBe(570); expect(bundle.components.map((c) => c.kind)).toEqual(["title"]); expect(bundle.components[0].before).toBe("Rain Barrels"); expect(bundle.components[0].after).toBe(TITLE_AFTER); expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "title", before: "Rain Barrels", after: TITLE_AFTER }); expect(bundle.receipt.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["gsc_demand", "page_extract", "keyword", "serp", "ai_observation", "winning_page"]));
    // the receipt a ready title stands on: the exact search, this page's stored copy, the results page, the line Google displays for it, and the wording the winners share
    expect(bundle.components[0].evidenceKeys).toEqual(["demand-exact", "copy-current", "serp1", "serp-owned", "serp-pattern"]); expect(bundle.receipt.items.find((i) => i.key === "copy-current")!.fact).toBe('Read on 2026-07-20, this page was titled "Rain Barrels" and ran 900 words across 3 sections.'); expect(bundle.receipt.items.find((i) => i.key === "serp-owned")!.fact).toBe('On that results page Google shows this page worded "Rain Barrels".'); expect(bundle.receipt.items.find((i) => i.key === "serp-pattern")!.fact).toBe('Across the other pages that come up for "rain barrel sizing", "barrel", "rain", "sizing" recur in the wording Google shows.'); expect([bundle.receipt.items.some((i) => i.fact.startsWith("The results page was checked:")), bundle.confidenceReasons.some((r) => r.startsWith("The results page was checked:"))]).toEqual([true, false]); // the diagnosis is on the receipt once, never repeated back as a reason
    expect(bundle.alternatives[0]).toEqual({ option: "Google is already showing the words people search for", reason: 'Google shows this page as "Rain Barrels", and that line does not say "sizing".' }); expect(bundle.receipt.freshestObservedAt).toBe("2026-07-22T00:00:00.000Z"); expectKeysResolve(bundle); expectCleanCopy(p); expect(bundle.scope).toEqual({ queries: ["rain barrel sizing", "how many gallons rain barrel"], prompts: ["what size rain barrel do I need"] }); // the answer whose own fan-out ran this page's search, and no other expect(bundle.alternatives.some((a) => a.option.includes("/compost"))).toBe(true); expect(p.evidence.evidenceRefCount).toBe(bundle.receipt.items.length); // the count IS the receipt
    expect(p.diagnosisCause).toBe("ctr_snippet"); }); // the named cause rides to the ranker, so cause and lever are judged together on a real change
  it("names every number's scope, so a page total is never read as one search", async () => { const out = await produceBundleForSnapshot(snapshot(), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change"); const p = out.proposal; const b = p.bundle!; const facts = b.receipt.items.filter((i) => i.kind === "gsc_demand").map((i) => i.fact); expect(facts[0]).toBe("This page overall: 120 clicks from 9,000 views, position 8 (90 days)."); // the page total, said as a page total
    expect(facts[1]).toBe('"rain barrel sizing": 6,000 views, 90 clicks, position 3 (90 days).'); for (const line of [p.whyItMatters, b.objective, b.confidenceReasons[0]]) expect(line).not.toContain("9,000"); // no query claim ever borrows the page total
    expect(p.whyItMatters).toBe('6,000 people saw this page for "rain barrel sizing" in 90 days and 90 clicked. A page at position 3 usually earns about 660, so about 570 clicks are being left.'); expect(b.receipt.items.find((i) => i.kind === "ai_observation")!.fact).toBe('When a customer searches "what size rain barrel do I need" inside an assistant, it points people at gardenguide.example. To answer it the assistant went and searched "rain barrel sizing".'); });
  it("puts what the answers SAID on the receipt, dated and attributed, and never lets an engine's claim become source material", async () => {
    // A settled reading used to be stored and inert: 140 answers a day, read closely, and not one word of them reached a change. What they NAME, ASK FOR and LEAVE OUT does now.
    const read = (o: CanonicalPairObservation, analysis: Record<string, unknown>): CanonicalPairObservation => ({ ...o, analysis });
    // The omissions carry the engines' OWN wording. One of them claims the present, which the one validator refuses on any line not read today: undated it refused the WHOLE change, for ever.
    const both = { competitors: [{ name: "waterwise", position: 1 }], materialOmissions: ["what a first flush diverter costs", "whether the rules changed currently"], sections: [{ heading: "Roof area", covers: "x" }], claims: [{ subject: "roof area", text: "A 1,000 square foot roof yields 600 gallons an inch" }], caveats: ["prices vary by state"] };
    const out = await produceBundleForSnapshot(snapshot({ research: { ...RESEARCH, aiObservations: [read(RESEARCH.aiObservations[0]!, { ...both, contentTypesRecommended: ["a sizing table"], sections: [...both.sections, { heading: "Overflow", covers: "y" }] }), read({ ...RESEARCH.aiObservations[1]!, fanOutQueries: ["rain barrel sizing"] }, both)] } }), { complete: seam, ...OPTS });
    if (out.status !== "bundled") throw new Error("expected a change"); const items = out.proposal.bundle!.receipt.items; const at = (k: string) => items.find((i) => i.key === k); expect([at("named1")!.fact, at("named1")!.observationIds, at("named1")!.observationId, at("named1")!.observedAt]).toEqual(["The answers to 2 of the questions I track name waterwise as an option for this.", ["obs_p1_chatgpt", "obs_p2_gemini"], undefined, "2026-07-22T00:00:00.000Z"]); // a sentence about SEVERAL answers names every one of them, and never lets one of them stand in for the rest
    expect([at("format1")!.fact, at("format1")!.observationId, at("format1")!.observationIds]).toEqual(["One answer I hold here asks for a sizing table.", "obs_p1_chatgpt", undefined]); // one answer is said as one answer, never as agreement, and keeps the singular id it always wore
    expect([at("missing1")!.fact, at("brandnamed")!.fact]).toEqual(["The answers to 2 of the questions I track leave this unanswered: what a first flush diverter costs", "Not one of the 2 answers I hold here names your own site."]); expect([at("missing2"), items.some((i) => i.fact.includes("currently"))]).toEqual([undefined, false]); expect(out.proposal.bundle!.receipt.missing).toContain("I withheld 1 time-sensitive statement from these answers because I cannot confirm it is still current."); // the change SHIPS, the line that claimed the present is the only thing left out, and the withholding is DISCLOSED instead of dropped in silence
    // A HEADING IS A PATTERN OR IT IS NOTHING: both answers cover "Roof area" and one alone covers "Overflow", so only the shared one may be shown as what the answers agree on.
    expect([at("covered1")!.fact, at("covered1")!.observationIds, items.some((i) => i.fact.includes("Overflow"))]).toEqual(['The answers to 2 of the questions I track cover "Roof area".', ["obs_p1_chatgpt", "obs_p2_gemini"], false]); expect(items.map((i) => i.fact).join(" ")).not.toContain("600 gallons"); expect(items.filter((i) => ["named1", "format1", "missing1", "covered1", "brandnamed"].includes(i.key)).every((i) => !!i.observedAt)).toBe(true); // an engine's own claim and its caveats are never grounding for a word of copy, and every line is dated or the one saying "currently" refuses the whole change
    expect([at("brandnamed")!.observationIds, at("brandnamed")!.observationId, at("brandnamed")!.observedAt]).toEqual([["obs_p1_chatgpt", "obs_p2_gemini"], undefined, "2026-07-22T00:00:00.000Z"]); expect(out.proposal.bundle!.components.every((c) => !c.evidenceKeys.includes("missing1"))).toBe(true); expectCleanCopy(out.proposal); // an absence is read off EVERY inspected answer, so it stands on all of them and never on one arbitrary member, and a title is not a piece that covers a gap so the omission never props it up
    // IDENTITY IS MATERIAL, AND SO IS EVERY MEMBER OF IT: swapping ONE supporting answer is different evidence, merely REORDERING the same ones is not, and a row carrying no id at all computes exactly what it always did.
    const swap = (ids: string[]): ChangeProposal => ({ ...out.proposal, bundle: { ...out.proposal.bundle!, receipt: { ...out.proposal.bundle!.receipt, items: items.map((i) => (i.key === "named1" ? { ...i, observationIds: ids } : i)) } } });
    const was = out.proposal.bundle!.receipt, kept = (l: readonly string[]) => l.filter((m) => !m.startsWith("I withheld")); // a row exactly as it was FILED BEFORE any of this: no answer ids on its lines, no disclosure line under them
    const bare: ChangeProposal = { ...out.proposal, limitations: kept(out.proposal.limitations), bundle: { ...out.proposal.bundle!, receipt: { ...was, missing: kept(was.missing), items: items.map(({ observationId: _drop, observationIds: _also, ...rest }) => rest) } } };
    // THE STORED-ROW COMPATIBILITY CONTRACT, as a literal: a receipt item carrying NO answer id must hash to exactly what it hashed to before ids existed, or every proposal already on file is rewritten once to say the identical thing. Appending the id unconditionally (`?? null`) moves this string, which is the whole point of pinning it.
    expect(proposalFingerprint(bare)).toBe("e716037d0ca99b96"); expect(new Set([out.proposal, swap(["obs_p1_chatgpt", "obs_somebody_else"]), bare].map(proposalFingerprint)).size).toBe(3); expect(proposalFingerprint(swap(["obs_p2_gemini", "obs_p1_chatgpt"]))).toBe(proposalFingerprint(out.proposal)); // the same support in another order is the same support
    expect(deserializeChangeProposal(serializeChangeProposal(out.proposal))!.bundle!.receipt.items.find((i) => i.key === "named1")!.observationIds).toEqual(["obs_p1_chatgpt", "obs_p2_gemini"]); }); // and the WHOLE set survives being stored and read back
  it("lets an omission the answers keep leaving ADD support to a piece that stands on its own, and never rescue one that stands on nothing", async () => {
    const both = { competitors: [], materialOmissions: ["what a first flush diverter costs"], contentTypesRecommended: [] };
    const world = snapshot({ research: { ...RESEARCH, serpEvidence: [], aiObservations: [{ ...RESEARCH.aiObservations[0]!, analysis: { ...both, sections: [{ heading: "Only this one answer covers it", covers: "z" }] } }, { ...RESEARCH.aiObservations[1]!, fanOutQueries: ["rain barrel sizing"], analysis: both }] } });
    const slots = Object.keys(CORE_PRODUCERS) as (keyof typeof CORE_PRODUCERS)[]; const held = slots.map((k) => [k, CORE_PRODUCERS[k]] as const);
    // "ai2" is an answer whose sources I could not see: CONTEXT, never support. So one piece cites nothing valid of its own and the other cites this page's own demand.
    const piece = (label: string, evidenceKeys: string[]): BundleComponent => ({ kind: "section_add", label, before: null, after: "A rain barrel sized for your roof area holds what one storm gives you.", evidenceKeys, risk: "review",
      where: "After the opening", objective: "Answer what the assistants leave out", mechanism: "The answers I hold never cover it, so the page that does is the one they can name", measurementPlan: "Clicks for this search over 28 days" });
    for (const k of [...slots, "ai_citation_gap"]) (CORE_PRODUCERS as Record<string, unknown>)[k] = async () => ({ components: [piece("Rescued by an omission", ["ai2"]), piece("Stands on its own", ["demand-page"])] });
    const out = await produceBundleForSnapshot(world, { complete: seam, ...OPTS, door: { door: "ai_absence", entry: "An assistant answered around this page.", evidence: { query: "rain barrel sizing", engine: "chatgpt", promptText: "what size rain barrel do I need", competingUrls: [], window: null } } });
    for (const [k, v] of held) (CORE_PRODUCERS as Record<string, unknown>)[k] = v; delete (CORE_PRODUCERS as Record<string, unknown>).ai_citation_gap;
    if (out.status !== "bundled") throw new Error(`expected a change, got ${out.reason}`); const b = out.proposal.bundle!; expect(b.components.map((c) => c.label)).toEqual(["Stands on its own"]); expect(b.receipt.items.some((i) => i.key === "covered1")).toBe(false); // a rebuild justified ONLY by an omission somewhere in the case is not proven, and one answer's own outline is never what the answers agree on
    expect(b.alternatives.find((a) => a.option === "Rescued by an omission")!.reason).toContain("There was nothing to show behind that one"); expect(b.components[0]!.evidenceKeys).toEqual(["demand-page", "missing1"]); }); // and the omission still ADDS itself to the piece that already stood up
  it("spends nothing on a search whose results page it has never looked at, and says exactly that", async () => {
    let called = 0; const counting: CompleteFn = async (r) => { called += 1; return seam(r); }; const out = await produceBundleForSnapshot(snapshot({ research: emptyResearchEvidence() }), { complete: counting, ...OPTS });
    // A gap proves something is wrong, never what to change: unseen is an investigation, and an investigation costs no drafter call.
    expect(out.status).toBe("none"); if (out.status !== "none") return; expect(called).toBe(0); expect(out.reason).toBe("The results page for that search has not been read yet, so what to change cannot be named. It is first in line on the next research pass."); });
  it("refuses a page with no proven gap and no current copy, and round-trips through persistence", async () => { const opt = { complete: seam, ...OPTS }; const healthy = page({ url: "fixture-content.example/rain-barrels", search: { ...page({ url: "x" }).search!, topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 700, position: 3 }] } }); const noGap = await produceBundleForSnapshot(snapshot({ ownedPages: [healthy] }), opt); const noCopy = await produceBundleForSnapshot(snapshot({ ownedPages: [page({ url: "fixture-content.example/rain-barrels", content: null })] }), opt); expect(noGap.status).toBe("none"); expect(noCopy.status).toBe("none"); if (noCopy.status !== "none") return; // a big page earning its rank is not work
    expect(noCopy.reason).toContain("nothing honest to rewrite"); const out = await produceBundleForSnapshot(snapshot(), opt); if (out.status !== "bundled") throw new Error("expected a change"); const back = deserializeChangeProposal(serializeChangeProposal(out.proposal)); expect(back).toEqual(out.proposal); expect(back!.bundle!.components).toHaveLength(1); const { bundle: _dropped, ...preBundleRow } = out.proposal; void _dropped; const legacy = deserializeChangeProposal(serializeChangeProposal(preBundleRow as typeof out.proposal)); expect(legacy).not.toBeNull(); expect(legacy!.bundle).toBeUndefined(); });
  it("says what the change keeps, what it replaces, and what it adds", async () => {
    const out = await produceBundleForSnapshot(snapshot(), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change");
    const plan = out.proposal.bundle!.plan!; // the operator reads that most of their page is not being touched
    expect([plan.entries, plan.keeps]).toEqual([[{ kind: "title", label: "Page title", disposition: "change" }], ["Rain barrel sizing", "Roof area and gallons", "Chaining a second barrel"]]); expect(plan.removes).toEqual([{ what: "Rain Barrels", why: "Page title takes its place." }]); // a REMOVE row only where something is genuinely replaced
    expect(deserializeChangeProposal(serializeChangeProposal(out.proposal))!.bundle!.plan).toEqual(plan); });
  it("produces an identical result when every input list arrives in the opposite order", async () => { const base = snapshot(); const flipped = snapshot({ ownedPages: reverse(base.ownedPages).map((pg) => ({ ...pg, search: pg.search ? { ...pg.search, topQueries: reverse(pg.search.topQueries) } : null })), research: { ...RESEARCH, retainedKeywords: reverse(RESEARCH.retainedKeywords), aiObservations: reverse(RESEARCH.aiObservations), winningPages: reverse(RESEARCH.winningPages), serpEvidence: RESEARCH.serpEvidence.map((s) => ({ ...s, organic: reverse(s.organic) })) }, }); expect(JSON.stringify(await produceBundleForSnapshot(flipped, { complete: seam, ...OPTS }))).toBe(JSON.stringify(await produceBundleForSnapshot(base, { complete: seam, ...OPTS }))); }); }); // ── a topic is never a page: no amount of research invents one ────────────────
const obs = (citations: { url: string; domain: string; title: string }[] | null) => canonObs({ promptId: "t1", promptText: PROMPT2, citations, observedAt: "2026-07-23T00:00:00.000Z" });
const topicKeyword = { query: TOPIC, searchVolume: 1600, competition: 0.3, competitionLevel: "low" as const, difficulty: null, intent: "informational" }; describe("no evidence about a topic I own no page for may become a page", () => {
  // The last row also proves the seam is LIVE: on the same evidence the drafter really is called, twice, and both times for an edit to a page that already exists. A silent seam would make every assertion below true for the wrong reason.
  it.each([ ["a tracked prompt alone", { ...emptyResearchEvidence(), aiObservations: [obs(null)] }, []],
    ["a tracked prompt and one cited page", { ...emptyResearchEvidence(), aiObservations: [obs([{ url: URL2, domain: "waterwise.example", title: "P" }])] }, []],
    ["a tracked prompt and real monthly search volume", { ...emptyResearchEvidence(), aiObservations: [obs(null)], retainedKeywords: [topicKeyword] }, []],
    ["a tracked prompt, a live results page, and three pages I read", TOPIC_RESEARCH, ["atomic_edit", "atomic_edit"]], ])("refuses to draft a page from %s", async (_what, research, drafted) => {
    env.snap = snapshot({ research, competitors: [COMPETITOR] });
    const res = await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); expect(res.proposals.every((p) => p.kind === "existing_edit")).toBe(true); // nothing new-page is queued
    expect([...store.rows.values()].every((p) => p.kind !== "new_page")).toBe(true); // and nothing new-page is written
    expect(kinds).toEqual(drafted); }); // every completion this pass bought was an edit to a page that already exists
}); // ── anchored evidence: the words this account puts on everything prove nothing ─
const CONTENT = page({ url: "x" }).content!; const kwRow = (query: string, searchVolume: number | null) => ({ query, searchVolume, competition: 0.2, competitionLevel: "low" as const, difficulty: null, intent: "informational" });
const obsRow = (promptText: string, observedAt: string, url = WIN1, fanOutQueries: string[] | null = null) => canonObs({ promptText, citations: [{ url, domain: url.split("/")[2]!, title: "P" }], fanOutQueries, observedAt });
const GALLONS = "how many gallons does a rain barrel hold"; const MOSQUITO = "do rain barrels attract mosquitoes"; // shares only the everywhere-words with every page this account owns
const compostSerp = { observedAt: null, query: "compost bin sizing", aiOverview: [], aiMode: [], paa: [], related: [], organic: [{ rank: 1, domain: "compostpro.example", url: "https://compostpro.example/a", title: "Compost bin sizing guide" },
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
    expect(b.receipt.items.filter((i) => i.kind === "winning_page").map((i) => i.fact.split(" ")[0])).toEqual(["gardenguide.example"]); expect(b.receipt.items.some((i) => i.kind === "ai_observation")).toBe(true); expectKeysResolve(b); expectCleanCopy(out.proposal);
    const flipped = anchorSnap({ research: { ...ANCHOR_RESEARCH, retainedKeywords: reverse(ANCHOR_RESEARCH.retainedKeywords), aiObservations: reverse(ANCHOR_RESEARCH.aiObservations), winningPages: reverse(ANCHOR_RESEARCH.winningPages) } }); expect(JSON.stringify(await produceBundleForSnapshot(flipped, opt))).toBe(JSON.stringify(out)); }); // same snapshot, same bundle
  it("drops evidence that is not about the page, then says plainly what it no longer holds", async () => {
    const only = [page({ url: "fixture-content.example/compost", search: { clicks90d: 40, impressions90d: 9000, ctr90d: 0.004, position90d: 5, topQueries: [{ query: "compost bin sizing", impressions: 9000, clicks: 40, position: 5 }] } })]; const out = await produceBundleForSnapshot(anchorSnap({ ownedPages: only }), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a bundle");
    const b = out.proposal.bundle!; expect(b.components.map((c) => c.kind)).toEqual(["title"]); // one field, and only the evidence that is about this page
    expect(b.receipt.missing).toEqual(expect.arrayContaining(['No AI answer about "compost bin sizing" has been gathered yet.', 'The pages that come up for "compost bin sizing" have not been read yet.'])); expect(b.receipt.items.every((i) => i.kind !== "ai_observation" && i.kind !== "winning_page")).toBe(true); expect(b.scope.prompts).toEqual([]); });
  /** THE LIVE COUNTEREXAMPLE, in miniature: a small corpus switches the everywhere-word net off, and one shared subject word carried a "best places to visit" answer onto a page judged on a different search entirely. */
  it("never attaches an AI answer to a page, a winner, the receipt or a component on a shared subject word alone", async () => {
    const ELSE = "https://elsewhere.example/places"; const broad = { ...obsRow("what are the best places to visit for rain gardens", "2026-07-22T00:00:00.000Z", ELSE), promptId: "broad" };
    const out = await produceBundleForSnapshot(snapshot({ research: { ...RESEARCH, aiObservations: [broad], winningPages: [...RESEARCH.winningPages, winRow(ELSE, { title: "P", h1: "P", wordCount: 2000, headings: ["Places"], faqCount: 1 })] } }), { complete: seam, ...OPTS });
    if (out.status !== "bundled") throw new Error("expected a bundle"); const b = out.proposal.bundle!; expect([b.receipt.items.some((i) => i.kind === "ai_observation"), b.scope.prompts]).toEqual([false, []]); // no receipt line, and no winner it vouched for
    expect([b.receipt.items.map((i) => i.fact).join(" "), b.confidenceReasons.join(" ")].join(" ")).not.toMatch(/places to visit|elsewhere|an AI answer I watched/); expect(b.receipt.missing).toContain('No AI answer about "rain barrel sizing" has been gathered yet.'); expect(b.components.every((c) => c.evidenceKeys.every((k) => !k.startsWith("ai")))).toBe(true); }); // and nothing it says is supported by it
}); // ── query identity for what is bought per query; confidence by evidence class ──
const serpRow = (query: string) => ({ query, observedAt: null, aiOverview: [], aiMode: [], paa: [], related: [], organic: [{ rank: 1, domain: "gardenguide.example", url: WIN1, title: "Rain barrel sizing guide" }, { rank: 2, domain: "waterwise.example", url: "https://waterwise.example/b", title: "Sizing a rain barrel by roof area" }, { rank: 3, domain: "fixture-content.example", url: "https://fixture-content.example/rain-barrels", title: "Rain Barrels" }] });
const winRow = (url: string, extract: ResearchPageExtract | null = null) => ({ url, domain: url.split("/")[2]!, engines: ["chatgpt"], examplePrompts: [], appearances: [], extract });
const linkRow = (toUrl: string, anchor: string) => ({ fromUrl: "fixture-content.example/rain-barrels", toUrl, anchor, reason: "" });
describe("what a receipt will and will not accept", () => { it("takes the results page bought under the same words in any order, and no winner a shared domain alone vouches for", async () => {
    const research = { ...RESEARCH, serpEvidence: [serpRow("sizing rain barrel"), serpRow("rain barrel sizing chart")], winningPages: [winRow(WIN1, { title: "A", h1: "A", wordCount: 900, headings: ["Gallons per storm"], faqCount: 0 }), winRow("https://gardenguide.example/other"), winRow("https://opaque.example/rain-barrel-sizing")] }; const out = await produceBundleForSnapshot(snapshot({ research }), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change");
    const items = out.proposal.bundle!.receipt.items; const serps = items.filter((i) => i.kind === "serp").map((i) => i.fact).join(" "); expect(serps).toContain('"sizing rain barrel"'); expect(serps).not.toMatch(/chart/); // same words reordered is the same search; a new modifier is a different one
    // ONLY the exact URL that appeared for a member search attaches. Another page on that SAME domain never does.
    expect(items.filter((i) => i.kind === "winning_page")).toHaveLength(1); expect(items.find((i) => i.kind === "winning_page")!.fact).toContain("900 words"); expect(items.some((i) => i.key === "winpattern")).toBe(false); // one page's style is that page's style, never a pattern
    expect(out.proposal.confidence).toBe("medium"); expect(out.proposal.bundle!.confidenceReasons.join(" ")).toContain("the live results page"); });
  it("withholds a link it cannot place, and never calls my own data alone high confidence", async () => {
    const links = [linkRow("fixture-content.example/", "Home"), linkRow("fixture-content.example/contact", "Contact us"), linkRow("fixture-content.example/gallons", "Rain barrel gallons per storm")]; const out = await produceBundleForSnapshot(snapshot({ internalLinkOpportunities: links }), { complete: seam, ...OPTS });
    if (out.status !== "bundled") throw new Error("expected a change"); const b = out.proposal.bundle!; // one destination is on topic, but no body text means no honest placement
    expect(b.components.some((c) => c.kind === "internal_links")).toBe(false); expect(b.receipt.items.some((i) => i.kind === "internal_link")).toBe(false); expect(b.alternatives.find((a) => a.option === "Links out to your own pages")!.reason).toContain("1 of your own page is worth linking to");
    const reasons = b.confidenceReasons.join(" "); expect(receiptComposition(b.receipt.items)).toBe("13 checks: the live results page (3), what the results page shows about the cause (3), your search data (3), AI answers watched, monthly search counts, the page as last read, winning pages read"); expect(reasons).toContain("Built from 13 checks:"); expect(receiptComposition([])).toBe("nothing to show"); expect(reasons).not.toMatch(/\d+ pieces/); expect(confidenceFor({ gsc: true, ownedCopy: true, serp: false, winners: 0, body: false })).toBe("low"); }); // my own demand rows and copy are still only my own data
  it("anchors coverage to the account's own corpus, so its everywhere-word relates nothing", async () => {
    const { buildEvidenceSnapshot } = await import("@/domains/evidence/snapshot"); const src = <T,>(payload: T) => ({ status: "fresh" as const, lastSyncedAt: null, payload }); const input = (titles: string[], queries: string[], fan: string[] | null = null) => ({ scope: { tenantId: TENANT, site: "fixture-content.example", builtAt: NOW.toISOString() }, gsc: src([]), ga4: src([]), clarity: src([]), dataforseo: src([]), wix: src(titles.map((t, i) => ({ url: `https://fixture-content.example/p${i}`, ...CONTENT, title: t, h1: t, outline: [] }))), research: src({ ...emptyResearchEvidence(), retainedKeywords: queries.map((q) => kwRow(q, 100)), aiObservations: [{ ...obsRow(PROMPT2, "2026-07-23T00:00:00.000Z", URL2, fan), analysis: { questionsAnswered: ["harbor kayak rentals"] } }] }), aiAnswersUnread: false });
    const small = buildEvidenceSnapshot(input(["Harbor Tide Charts", "Harbor Whale Tours"], [])); expect(small.internalLinkOpportunities).toHaveLength(2); expect(small.questionDemand[0].coverageStatus).toBe("answered"); // under ten phrases nothing is ubiquitous yet
    const big = buildEvidenceSnapshot(input(["Harbor Tide Charts", "Harbor Whale Tours", "Harbor Seafood Market", "Harbor Ferry Schedule", "Harbor Parking Rates", "Harbor Fishing Permits"], ["harbor kayak rentals", "harbor sunset cruise", "harbor bike hire", "harbor dog beach", "harbor live music", "harbor farmers market"])); expect(big.internalLinkOpportunities).toEqual([]); expect(big.questionDemand[0].coverageStatus).toBe("unanswered"); }); // the everywhere-word relates nothing
}); describe("confidence is the evidence I hold, never how the draft reads", () => {
  const twin = (url: string, over: Partial<(typeof RESEARCH)["winningPages"][number]> = {}) => ({ ...RESEARCH.winningPages[0]!, url, domain: url.split("/")[2]!, ...over });
  const ranElsewhere: ResearchWinningAppearance[] = [{ kind: "serp_organic", query: "how many gallons rain barrel", promptId: null, promptText: null, engine: null, rank: 1, citedUrl: "https://elsewhere.example/x", observedAt: "2026-07-22T00:00:00.000Z", modelServed: null }]; const elsewhere = { ...twin("https://elsewhere.example/x"), examplePrompts: [], appearances: ranElsewhere };
  it("reads two winners as medium, names the one step left, and claims only a pattern both of them share", async () => {
    const research = { ...RESEARCH, winningPages: [...RESEARCH.winningPages, twin("https://waterwise.example/b"), elsewhere] };
    const out = await produceBundleForSnapshot(snapshot({ research }), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change");
    const items = out.proposal.bundle!.receipt.items; // the third page came up for the page's OTHER search, so it is not evidence about this one
    expect(items.filter((i) => i.kind === "winning_page").map((i) => i.fact).join(" ")).not.toMatch(/elsewhere/); expect(items.find((i) => i.key === "winpattern")!.fact).toBe('Of the 2 pages read that come up for "rain barrel sizing", 2 of them answer it in a question and answer block, and this page has none, and the middle one runs 1,400 words against this page\'s 900.'); expect(out.proposal.status).toBe("ready"); expect(out.proposal.confidence).toBe("medium"); expectCleanCopy(out.proposal); expect(out.proposal.limitations).toContain("This page's full body text is not on file, so every draft was checked against its title and section headings only."); expect(confidenceFor({ gsc: true, ownedCopy: true, serp: true, winners: 2, body: true })).toBe("high"); }); // reading the page itself is the only step left to certain
  it("hands over nothing at all rather than a change it can show you nothing for", async () => {
    const blind: CompleteFn = async () => ({ value: {} as never }); const out = await produceBundleForSnapshot(snapshot(), { complete: blind, ...OPTS }); expect(out.status).toBe("none"); if (out.status !== "none") return; expect(out.reason).toContain("nothing is handed over rather than filler"); });
}); describe("one pass, one row per change", () => { it("bundles the proven page once, and carries no vertical assumption into a single prompt", async () => {
    env.snap = topicSnapshot(); const res = await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); expect(res.coverage).toBeNull(); const queue = await loadProposalQueue(TENANT); expect(queue.ranked.every((p) => p.kind === "existing_edit")).toBe(true); // research this thin decides nothing, so no topic becomes a page
    expect(res.proposals.map((p) => [p.id, p.status]).sort()).toEqual([[`${TENANT}::/compost::existing_edit::title`, "needs_review"], [`${TENANT}::/rain-barrels::existing_edit::ai_answer_gap`, "needs_review"], [`${TENANT}::/rain-barrels::existing_edit::title-family`, "ready"]]);
    // FIVE GUARDS ON ONE PASS: host and path key the page (two hosts share /compost and the weak row must carry ITS OWN title), an em dash in a brand tail is never pasted, a page the strict path covered takes no second weaker row, a page beating its own curve on its ONE measured search is refused even through the AEO clause that waives the click test, and a search whose results page I never bought still earns ONE best-guess card, at the lowest confidence I have, rather than the silence that left a losing page with nothing to do.
    const twin = { ...topicSnapshot().ownedPages[1]!, url: "https://other.example/compost", content: { ...topicSnapshot().ownedPages[1]!.content!, title: "Twin Compost Page", h1: "Twin Compost Page" } };
    const dashed = { ...topicSnapshot().ownedPages[1]!, content: { ...topicSnapshot().ownedPages[1]!.content!, title: "Compost | Green \u2014 Co", h1: null } }; // the title is the only line there is, so the dash decides
    const only = (s: EvidenceSnapshot) => suggestedEdits(s, compileCandidates(s), { now: OPTS.now!, basis: "b" }); // the twin is LAST below, so keying on the path alone would hand that page the twin's words
    const looked = (s: EvidenceSnapshot): EvidenceSnapshot => ({ ...s, research: { ...s.research, serpEvidence: [...s.research.serpEvidence, { observedAt: null, query: "compost bin sizing", organic: [{ rank: 1, domain: "compostpro.example", url: "https://compostpro.example/a", title: "C" }], aiOverview: [], aiMode: [], paa: [], related: [] }] } });
    const two = looked({ ...topicSnapshot(), ownedPages: [topicSnapshot().ownedPages[1]!, twin] }); const one = only(two)[0]!; expect(only(topicSnapshot()).map((p) => [p.pagePath, p.confidence])).toEqual([["/compost", "low"]]); // never looked up: a labelled guess, never silence
    expect([only(two).length, one.pagePath, (one.recommendedChange as { before: string }).before, one.confidence]).toEqual([1, "/compost", "Rain Barrels", "medium"]); // the twin host's title never leaks onto this page
    expect([one.opportunityType, one.operatorSteps]).toEqual(['Lead the title with "compost bin sizing" and keep the words this page already earns on', ["Open your site editor on /compost", "Replace the title with the copy above", "Come back here and mark it done, and measurement starts"]]); // the exact move, where it happens, what I do next
    expect([only(looked({ ...topicSnapshot(), ownedPages: [dashed] })), suggestedEdits(looked(topicSnapshot()), compileCandidates(looked(topicSnapshot())), { now: OPTS.now!, basis: "b", skip: new Set(["/compost"]) })]).toEqual([[], []]); // the dash refuses the paste, and the strict path already owns that page
    const winner = { ...topicSnapshot().ownedPages[1]!, search: { clicks90d: 240, impressions90d: 1200, ctr90d: 0.2, position90d: 4, topQueries: [{ query: "compost bin sizing", impressions: 1200, clicks: 240, position: 4 }] } };
    const asked = { ...TOPIC_RESEARCH, aiObservations: [canonObs({ promptId: "pc", promptText: "compost bin sizing", citations: [{ url: "https://compostpro.example/a", domain: "compostpro.example", title: "C" }], analysis: { competitors: [{ name: "compostpro", position: 1 }] }, observedAt: "2026-07-22T00:00:00.000Z" })] };
    const aeo = looked({ ...topicSnapshot(), ownedPages: [winner], research: asked }); expect([compileCandidates(aeo)[0]!.cause.cause, only(aeo)]).toEqual(["ai_citation_gap", []]); // an assistant naming everybody else waives my CLICK test, never the fact that this page beats its own curve
    // A BELOW-BAR SEARCH SAYS ITS SIZE IN ONE UNIT, and a card asking for a minute of work never claims it is not asking: all three legacy tails close in the same honest frame, numbers intact.
    const soft = { ...topicSnapshot().ownedPages[1]!, search: { ...COMPOST, impressions90d: 600, topQueries: [{ query: "compost bin sizing", impressions: 600, clicks: 5, position: 6 }] } };
    const quiet = looked({ ...topicSnapshot(), ownedPages: [soft], research: asked }); const soften = compileCandidates(quiet)[0]!; const frame = "That is under the bar for a proven change, so this is a quick test, and what it does will be measured.";
    expect(soften.reason).toContain("that search is worth about 25 clicks, under the 50 clicks on 500 searches that earn a change. Watching it rather than asking for work.");
    expect(["and that is only about 7 clicks, under the 50 I act on.", "and that gap is 1.5 percent, under the 2.0 percent I act on.", "and that is too little search to act on yet (I want 500 impressions on one query)."]
      .map((t) => suggestedEdits(quiet, [{ ...soften, reason: `Scope. Rates, ${t} Watching it rather than asking for work.` }], { now: OPTS.now!, basis: "b" })[0]!.whyItMatters.split(" This line leads")[0]!))
      .toEqual([`Scope. Rates, and that is only about 7 clicks. ${frame}`, `Scope. Rates, and that gap is 1.5 percent. ${frame}`, `Scope. Rates. ${frame}`]);
    // The AI side of the same search only where the answers already joined it, a suggestion ranked like every other row, and the one proof number a ledger row can print.
    const ranked = rankProposals([res.proposals[0]!, one]); expect(only(quiet)[0]!.whyItMatters).toContain("AI answers about this topic credit compostpro, never this site.");
    expect([!!ranked[0]!.whyRankedAboveNext, ranked[0]!.rankingReceipt!.basis.length > 0, ranked[1]!.rankingReceipt!.factors.length > 0, ranked[1]!.whyRankedAboveNext, ledgerProofLine({ windows: [] }),
      ledgerProofLine({ windows: [{ day: 7, ran: true, controlsUsed: 3, adjustedLift: 12.4 }, { day: 28, ran: true, controlsUsed: 4, adjustedLift: -3.2 }, { day: 56, ran: false, controlsUsed: 0 }] })]).toEqual([true, true, true, undefined, null, "clicks -3 against similar pages that were not changed"]);
    // B6: generic product code carries no vertical assumption, whatever this account happens to sell.
    expect(sent.join(" ")).not.toMatch(/encyclopedia|wikipedia|culture|dynast|cuisine|province/i); });
  /** ONE TRACKED QUESTION IS ASKED OF SEVERAL ENGINES, so its id names several different answers. Matching lineage on the question id alone handed one engine's fan-out to another engine's answer: below, only the answer this account's lineage actually names may join, and its neighbour's searches stay its neighbour's. */
  it("never lets one engine's answer borrow the searches another engine's answer went and ran", async () => {
    const obs = (engine: string, promptText: string) => canonObs({ observationId: `obs_px_${engine}`, promptId: "px", promptText, engine, promptVersion: 2, reportingDay: "2026-07-22", citations: [{ url: WIN1, domain: "gardenguide.example", title: "A" }], observedAt: "2026-07-22T00:00:00.000Z" });
    const research = { ...RESEARCH, aiObservations: [obs("chatgpt", "how much rain does a roof catch"), obs("gemini", "roof runoff calculator")],
      retainedKeywords: RESEARCH.retainedKeywords.map((k) => k.query === "rain barrel sizing" ? { ...k, origins: [{ route: "fanout" as const, promptId: "px", promptVersion: 2, engine: "chatgpt", reportingDay: "2026-07-22", observationId: "obs_px_chatgpt" }] } : k) };
    const out = await produceBundleForSnapshot(snapshot({ research }), { complete: seam, ...OPTS });
    if (out.status !== "bundled") throw new Error("expected a change"); expect([out.proposal.bundle!.scope.prompts, out.proposal.bundle!.receipt.items.filter((i) => i.kind === "ai_observation").length]).toEqual([["how much rain does a roof catch"], 1]); }); // the keyword carries the FULL identity of ONE stored answer, and the receipt stands on that answer alone
  /** A CHANGE MAY NOT OUTLIVE ITS OWN EXPLANATION. This used to DEMOTE the row to needs_review, which is "look at this first" and still fully actionable, so an unsupported change kept its place on the operator's list under a quieter name. It is taken back now, and a page that still earns an action is untouched. */
  it("takes back the change whose page it read and can no longer prove anything about, and leaves the one it still can", async () => {
    env.snap = snapshot(); await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS });
    const held = [...store.rows.values()].find((p) => !!p.bundle)!;
    store.rows.set("orphan", { ...held, id: "orphan", pagePath: "/compost", status: "needs_review" }); // a page I DID read, that no door proves
    const after = await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); expect([after.proposals.some((p) => p.id === "orphan"), store.rows.has("orphan"), store.rows.has(held.id)]).toEqual([false, false, true]); });
  /** P0. THE SNAPSHOT IS FAIL-SOFT BY DESIGN: every leg catches to empty, so one database blip reads as an account with no pages. The retire loop then proved nothing about anything, took back EVERY live change, and the refusal kept them shut afterwards. A pass may only speak about a page it actually read. */
  it("takes nothing back about a page this pass never read, however healthy the rest of the pass looks", async () => {
    env.snap = snapshot(); await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS });
    const held = [...store.rows.values()].find((p) => !!p.bundle)!;
    store.rows.set("unread", { ...held, id: "unread", pagePath: "/nothing-reached-this-page" }); // its page is not in the read at all
    await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); expect([store.rows.has("unread"), store.rows.has(held.id)]).toEqual([true, true]); });
  it("queues only the changes it can show are current, and sets aside every basis it cannot match", async () => {
    env.snap = topicSnapshot(); await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); const seed = [...store.rows.values()].find((p) => p.kind === "existing_edit")!; store.rows.clear();
    const put = (id: string, over: Partial<ChangeProposal>) => store.rows.set(id, { ...seed, id, status: "ready", basis: "basis_today", limitations: [], ...over });
    put("ready", {}); put("review", { status: "needs_review" }); put("owing", { limitations: ["Add one before this is paste-ready."] }); put("older", { basis: "basis_last_week", kind: "new_page" }); put("historical", { basis: undefined });
    const rows = store.rows.size, q = await loadProposalQueue(TENANT, { currentBasis: "basis_today" }), blind = await loadProposalQueue(TENANT, { currentBasis: null }); expect(q.ready.map((p) => p.id)).toEqual(["ready"]); expect(q.toDo.map((p) => p.id)).toEqual(["owing", "review"]); expect(q.ranked.map((p) => p.id)).toEqual(["ready", "owing", "review"]); expect(q.demotedStaleBasis).toBe(2); expect([blind.ranked, blind.ready, blind.toDo].map((l) => l.length)).toEqual([0, 0, 0]); // a basis I cannot read proves nothing current, so it shows you nothing
    expect([blind.demotedStaleBasis, store.rows.size]).toEqual([5, rows]); }); // every set-aside row is still counted, and not one stored row is rewritten
}); // ── the release: a fresh timestamp may never sit on top of a failed production run ──
const release = async (produce: () => Promise<unknown>) => { vi.resetModules(); const published: { computedAt: string }[] = [];
  vi.doMock("@/lib/persistence/json-store", () => ({ readStore: async () => [], writeStore: async (_s: string, rows: { computedAt: string }[]) => { published.push(...rows); } }));
  vi.doMock("@/lib/tenant-context", () => ({ currentTenantId: async () => TENANT, runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn() }));
  vi.doMock("@/lib/single-flight", () => ({ runSingleFlight: async (_k: string, fn: () => Promise<unknown>) => fn() }));
  // THE TRIPWIRE THE BUILD RUNS: what it was told is already measured, and what it reverted.
  const swept: Array<{ shipped: string[] }> = [];
  vi.doMock("@/domains/measurement", () => ({ loadShippedChanges: ledger.read, loadShippedChangesForTenant: (_t: string) => ledger.read() }));
  vi.doMock("@/domains/decision", () => ({ produceProposalsForTenant: produce,
    reconcileImplementedWithoutShipment: async (_t: string, shipped: ReadonlySet<string>) => { swept.push({ shipped: [...shipped] }); return ["reverted"]; } }));
  vi.doMock("@/app/(shell)/changes-data", () => ({ buildChangesViewUncached: async () => ({ proposals: [] }) }));
  const signals: { declineNotes?: { page: string; note: string }[] }[] = [];
  vi.doMock("@/app/(shell)/today-view-data", () => ({ buildTodayCompositeFromChanges: async (_v: unknown, sig: { declineNotes?: { page: string; note: string }[] }) => { signals.push(sig); return { headline: "" }; } }));
  return { ...(await import("@/app/(shell)/surface-release")), published, signals, swept };
};
/** What the ledger hands the build: rows, or a read that FAILED. */
const ledger = { read: async (): Promise<Array<{ proposalId: string | null }>> => [] };
describe("a release publishes only on a real production result", () => { it("lets a production failure through instead of stamping stale work with a fresh timestamp", async () => {
    const { refreshCustomerSurface, published } = await release(async () => { throw new Error("evidence read failed"); });
    await expect(refreshCustomerSurface(TENANT)).rejects.toThrow("evidence read failed"); expect(published).toEqual([]); }); // the previous release is untouched, and the phase fails where a human can see it
  it("a pass that ran BLIND never publishes over a richer release", async () => { const { refreshCustomerSurface, published } = await release(async () => ({ proposals: [], opportunities: 0, noDraft: 0, outcome: "evidence_unreadable" })); await expect(refreshCustomerSurface(TENANT)).rejects.toThrow("your last release was kept"); expect(published).toEqual([]); }); // absence of a source is never deletion of the queue
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
    await refreshCustomerSurface(TENANT); expect(signals[0]?.declineNotes).toEqual([{ page: "/b", note: "big gap" }, { page: "/a", note: "small gap" }]); }); // an acted page is work, not a verdict
  // THE TRIPWIRE RUNS ON EVERY BUILD, on the ledger's own list of what is genuinely being measured, and a ledger that would not read reverts nothing: a list nobody
  // could read is not proof a change has no record.
  it("hands the tripwire what the ledger really holds, and sweeps nothing at all when that ledger will not read", async () => {
    const pass = async () => ({ proposals: [], outcome: "proposals_persisted", candidates: [] });
    ledger.read = async () => [{ proposalId: "fixture-tenant::/a::existing_edit::title" }, { proposalId: null }];
    const seen = await release(pass); await seen.refreshCustomerSurface(TENANT);
    expect(seen.swept).toEqual([{ shipped: ["fixture-tenant::/a::existing_edit::title"] }]);
    ledger.read = async () => { throw new Error("the ledger did not read"); };
    const blind = await release(pass); await blind.refreshCustomerSurface(TENANT);
    expect([blind.swept.length, blind.published.length]).toEqual([0, 1]); // the release still publishes; nothing was reverted on a blind read
    ledger.read = async () => []; // an EMPTY ledger sweeps nothing either: a schema-cache blip reads as empty without throwing
    const empty = await release(pass); await empty.refreshCustomerSurface(TENANT);
    expect([empty.swept.length, empty.published.length]).toEqual([0, 1]); }); });
// ── the coverage verdict: has this account already got the right page? ────────
const WIN = ["gardenguide.example", "waterwise.example", "downspout.example"].map((domain): TopicInvestigation["winners"][number] => ({ url: `https://${domain}/a`, domain, extractState: "current", wordCount: 1400, headings: 4, fetchedAt: "2026-07-24T00:00:00.000Z", appearances: [{ kind: "serp_organic" as const, query: "rain barrel sizing", promptId: null, promptText: null, engine: null, observationMode: null, rank: 1, observedAt: "2026-07-24T00:00:00.000Z", viaUrl: null }], readOutcome: null }));
/** The rows ON that results page are what a winner read can ever bank, so they decide whether asking again could work. */
const ROWS = WIN.map((w, i) => ({ rank: i + 1, url: w.url, domain: w.domain, title: "Sizing a rain barrel" }));
const LOOK: TopicInvestigation["exactSerps"] = [{ query: "rain barrel sizing", observedAt: "2026-07-24T00:00:00.000Z", freshness: "current", organicResults: 9, distinctDomains: 8, aiOverviewCitations: 0, aiModeCitations: 0, paaQuestions: 0, organicRows: ROWS, aiOverviewRows: [], aiModeRows: [] }];
const INV = (over: Partial<TopicInvestigation> = {}): TopicInvestigation => ({ key: "inv_rain", aliasKeys: [], label: "rain barrel sizing", demandBasis: "search", groupedBy: [], queries: ["rain barrel sizing"], keywords: [], trackedPrompts: [], fanOuts: [], answerIntel: answerIntelOf([]), exactSerps: LOOK, serpFreshness: "current",
  demand: { monthlySearchVolume: 4400, queriesWithVolume: 1, gscImpressions: 6000, difficulty: null, intent: "informational", trackedPrompts: 0, fanOuts: 0, engines: [] }, distinctResultDomains: 8, resultDomains: [], pageType: "informational_guide", pageTypeVotes: [], serpCoherence: "coherent",
  winners: WIN, distinctWinners: 3, currentReadableWinners: 3, missingEvidence: [], nextAcquisition: null, diminishing: false, ...over });
const OWNED = (url: string, over: Partial<OwnedCandidate> = {}): OwnedCandidate => ({ url, path: "/rain-barrels", title: "Rain Barrels", h1: null, wordCount: 900, outlineLength: 3, openingSample: "How to size a rain barrel.", entities: [], fetchedAt: null, bodyHeld: true, strongSignals: 1,
  signals: [{ kind: "gsc_exact_query", strength: "strong", basis: "rain barrel sizing", detail: "Google already shows this page for that search." }], ...over });
const ONE = OWNED("fixture-content.example/rain-barrels"); const ONE_URL = "https://fixture-content.example/rain-barrels"; const TWO = OWNED("fixture-content.example/barrel-sizes", { path: "/barrel-sizes", title: "Barrel Sizes" });
/** The seam records EVERY kind it was asked for, so a refusal that spends nothing is provable rather than assumed. */
const asked = (value: unknown) => { const calls: string[] = []; const complete: CompleteFn = async ({ kind }) => { calls.push(kind); return { value: value as never }; }; return { complete, calls }; };
const SAYS = (over: Record<string, unknown> = {}) => ({ verdict: "improve_existing", ownedUrls: [ONE.url], evidenceKeys: ["demand", "owned1"], explanation: "I would sharpen the page you already have rather than add another that competes with it.",
  alternativesRuledOut: [{ alternative: "Write a new page for this", reason: "Your own page already answers this search." }], ...over });
const GATES: Array<[string, Partial<TopicInvestigation>, OwnedCandidate[], string]> = [ ["no look at Google's results at all", { exactSerps: [], serpFreshness: "missing" }, [ONE], "exact_serp"],
  ["a look I took too long ago", { serpFreshness: "stale" }, [ONE], "fresh_serp"], ["two publishers where three is the floor", { winners: WIN.slice(0, 2) }, [ONE], "winners"],
  ["results that answer two different questions", { serpCoherence: "mixed" }, [ONE], "intent"],
  ["a page that could be the answer whose words I do not hold", {}, [OWNED("fixture-content.example/rain-barrels", { bodyHeld: false })], "owned_content"],
  ["nothing of my own, and too few winning pages read to write one", { currentReadableWinners: 1 }, [OWNED("fixture-content.example/blog", { strongSignals: 0 })], "page_intersection"]];
describe("the coverage verdict never invents a page this account already owns", () => {
  it.each(GATES)("refuses on %s, spends nothing, and names exactly what is missing", async (_what, over, owned, missing) => {
    const seam = asked(SAYS()); const d = await adjudicateCoverage(INV(over), owned, TENANT, {}); expect([d.verdict, d.missing]).toEqual(["research_needed", [missing]]); expect(seam.calls).toEqual([]); expect(d.alternativesRuledOut).toHaveLength(1); expect(JSON.stringify(d)).not.toMatch(/proposedTitle|metaDescription|openingAnswer|outline|faqQuestions/i); }); // a verdict is never a page
  it("says WHY a page of mine is unread and names the STORED retry date, identically however often it is asked, and never a date already past", async () => {
    const blind = [OWNED(ONE.url, { bodyHeld: false })]; const read = (o: Record<string, unknown>) => adjudicateCoverage(INV(), blind, TENANT, { now: new Date("2026-07-26T00:00:00.000Z"), ownedRead: { url: ONE.url, attemptedAt: "2026-07-26T00:00:00.000Z", ...o } as never });
    const shut = await read({ state: "robots_blocked", retryAfter: "2026-08-25T00:00:00.000Z" }); const down = await read({ state: "temporarily_unavailable", retryAfter: "2026-07-27T00:00:00.000Z" }); expect([shut.missing, shut.hold, down.missing, down.hold]).toEqual([["owned_content"], "2026-08-25T00:00:00.000Z", ["owned_content"], "2026-07-27T00:00:00.000Z"]); // the date is carried from the row, never minted here
    expect((await read({ state: "temporarily_unavailable", retryAfter: "2026-07-20T00:00:00.000Z" })).hold).toBeUndefined(); // a day that has already passed is not a promise, it is just a stale number
    expect(shut.explanation).toContain(`Your site's robots rules block ${ONE.url}`); expect(shut.explanation).toContain("Checked again in a couple of weeks"); expect(down.explanation).toContain(`${ONE.url} could not be read`); expect(down.explanation).toContain("Tried again tomorrow"); // the SAME date on every visit, because the outcome is persisted
    expect((await read({ state: "temporarily_unavailable", retryAfter: "2026-07-27T00:00:00.000Z" })).explanation).toBe(down.explanation); // asked twice, worded and dated identically
    expect(`${shut.explanation} ${down.explanation}`).not.toMatch(/provider|refused|blocked|[—–]/i); }); // a timeout is never dressed as a refusal, and nobody else is blamed for either
  it("leaves a topic the operator ruled out alone, and never reaches a model to say so", async () => {
    const off = asked(SAYS()); const skipped = await adjudicateCoverage(INV(), [ONE], TENANT, { outOfScopeTopics: ["rain barrels"] }); expect([skipped.verdict, skipped.missing, off.calls]).toEqual(["do_nothing", [], []]); expect(skipped.explanation).toContain("rain barrels"); });
  it("CLOSES a topic whose winners will not settle on one kind of page, instead of asking for research nothing can buy", async () => { for (const pageType of ["mixed", "unknown"] as const) {
      const d = await adjudicateCoverage(INV({ pageType, pageTypeVotes: [{ pageType: "list", domains: 2 }, { pageType: "informational_guide", domains: 2 }] }), [ONE], TENANT, {});
      expect([d.verdict, d.missing, earnedNewPage(d), /experiment|control|baseline|treatment|SERP|[—–]/.test(d.explanation)]).toEqual(["do_nothing", [], false, false]); // terminal: nothing owed, so it is never queued again
      expect(d.explanation).toContain("This picks back up on its own the day one kind of page takes the lead"); } }); // and it says exactly what would reopen it
  it("refuses to write words for a page search engines are not being served, and names the one thing to fix", async () => {
    const blocked = await adjudicateCoverage(INV(), [ONE], TENANT, { technical: readTechnicalFindings({ pages: [{ url: ONE_URL, robots_meta: "noindex" }] }) });
    expect([blocked.verdict, blocked.ownedUrls, blocked.missing, blocked.explanation.includes('I would take "noindex" out of the robots tag on /rain-barrels')]).toEqual(["technical_only", [ONE.url], [], true]);
    // a fault on somebody else's page, and a fault that stops nothing, both leave the ordinary ladder alone
    const elsewhere = await adjudicateCoverage(INV(), [ONE], TENANT, { technical: readTechnicalFindings({ pages: [{ url: `${AT}/other`, robots_meta: "noindex" }] }) });
    const cosmetic = await adjudicateCoverage(INV(), [ONE], TENANT, { technical: readTechnicalFindings({ pages: [{ url: ONE_URL, h1: null }] }) });
    expect([elsewhere.verdict, cosmetic.verdict]).toEqual(["research_needed", "research_needed"]); });
  it("carries the one purchase that would change a refusal, and stops asking once buying has stopped paying", async () => {
    const buy = { kind: "buy_serp" as const, subject: "rain barrel sizing", why: "I have never looked at Google's results for this." };
    const asking = await adjudicateCoverage(INV({ exactSerps: [], serpFreshness: "missing", nextAcquisition: buy }), [ONE], TENANT, {});
    expect([asking.verdict, asking.acquisition]).toEqual(["research_needed", buy]);
    expect(asking.explanation).toContain('What changes this: buying the results page for "rain barrel sizing".');
    // NO ENDLESS INVESTIGATION: the acquisition was tried, nothing left to buy moves it, so it becomes a decision
    const blind = { demand: { ...INV().demand, intent: null } };
    const spent = await adjudicateCoverage(INV({ ...blind, nextAcquisition: null, diminishing: true }), [ONE], TENANT, {});
    expect([spent.verdict, spent.missing, spent.acquisition]).toEqual(["do_nothing", [], undefined]);
    expect(spent.explanation).toContain("Nothing more that can be bought moves this today. It moves again when your own numbers move.");
    // while something IS still buyable, the same topic stays an investigation and says what to buy
    const again = await adjudicateCoverage(INV({ ...blind, nextAcquisition: buy }), [ONE], TENANT, {});
    expect([again.verdict, again.missing, again.acquisition]).toEqual(["research_needed", ["intent"], buy]); }); });
// ── the page by page comparison: the one paid check, and the only road to a new page ──
describe("a new page is earned by read evidence, and never by a guess about pages of your own", () => {
  it("buys nothing for an investigation short of any cheaper check, and names the exact pages for the one that earned it", async () => {
    for (const [, over, owned] of GATES.filter((g) => g[3] !== "page_intersection")) expect(intersectionComparison(await adjudicateCoverage(INV(over), owned, TENANT, {}), INV(over), owned)).toBeNull();
    const earned = await adjudicateCoverage(INV(), [ONE], TENANT, {});
    expect(intersectionComparison(earned, INV(), [ONE])).toEqual({ pages: [...WIN.map((w) => w.url), ONE_URL], intersection_mode: "union" });
    expect(intersectionComparison(earned, INV({ key: "inv_other" }), [ONE])).toBeNull(); const mine0 = await adjudicateCoverage(INV(), [OWNED("fixture-content.example/blog", { strongSignals: 0 })], TENANT, {}); expect([mine0.verdict, mine0.missing, earnedNewPage(mine0), mine0.explanation.includes('"rain barrel sizing" gets about 4,400 searches a month'), mine0.explanation.includes("3 of them were read")]).toEqual(["create_new", [], true, true, true]); // no page of mine is at risk, so the comparison is evidence rather than the door
    // A BODY I COULD NOT FETCH IS NOT A REASON TO WITHHOLD A COMPARISON OF ADDRESSES: three ranked publishers still earn it, and a page only ever CITED never counts as one of them.
    const blind = INV({ winners: WIN.map((w) => ({ ...w, extractState: "unreadable" as const, wordCount: null, fetchedAt: null })) });
    expect(intersectionComparison(await adjudicateCoverage(blind, [ONE], TENANT, {}), blind, [ONE])).toEqual({ pages: [...WIN.map((w) => w.url), ONE_URL], intersection_mode: "union" });
    const cited = INV({ winners: WIN.map((w) => ({ ...w, appearances: [{ ...w.appearances[0]!, kind: "ai_overview" as const, rank: null }] })) });
    expect((await adjudicateCoverage(cited, [ONE], TENANT, {})).missing).toEqual(["winners"]); });
  it.each(["blocked", "capped", "waiting", "quarantined", "ambiguous", "failed"] as const)("cannot turn a comparison that came back %s into a new page, and says why in plain words", async (unavailable) => {
    const d = await adjudicateCoverage(INV(), [ONE], TENANT, { intersection: { unavailable } });
    expect([d.verdict, d.missing, earnedNewPage(d)]).toEqual(["research_needed", ["page_intersection"], false]);
    expect(d.explanation).toContain("nothing is worth building"); expect(d.explanation).not.toMatch(/blocked|capped|quarantin|ambiguous|provider|task|status/i); }); });
// ── how a page is SERVED: the V1 technical catalogue, off the two stores that answer it ──
const AT = "https://fixture-content.example";
const row = (url: string, over: Record<string, unknown> = {}) => ({ url, discovered_via: "sitemap", crawl_state: "crawled", http_status: 200, redirects_to: null, ...over });
/** One account's inventory and capture, in the stores' own column names, carrying exactly one of each fault. */
const SERVED = { inventory: [row(`${AT}/`), row(`${AT}/rain-barrels`), row(`${AT}/gone`, { crawl_state: "gone", http_status: 404 }),
    row(`${AT}/old`, { redirects_to: `${AT}/mid` }), row(`${AT}/mid`, { redirects_to: `${AT}/rain-barrels` }), row(`${AT}/orphan`, { discovered_via: "nav" })],
  pages: [{ url: `${AT}/`, internal_links: [`${AT}/rain-barrels`] },
    { url: `${AT}/rain-barrels`, title: "Rain Barrel Sizing Guide", h1: "Rain Barrels", robots_meta: "noindex, follow", canonical_url: `${AT}/other`, has_canonical_mismatch: true, internal_links: [`${AT}/gone`] },
    { url: `${AT}/orphan`, title: "Rain Barrel Sizing", h1: "Rain Barrel Sizing", internal_links: [] },
    { url: `${AT}/twin`, title: "Rain Barrel Sizing Guide", h1: null, canonical_url: null, internal_links: [] }], };
describe("what is wrong with how a page is served", () => { it("names every fault it can prove, on a concrete address, with the exact fix", () => {
    const found = readTechnicalFindings(SERVED);
    expect(found.map((f) => f.kind)).toEqual(["non_200", "redirect_chain", "orphaned_page", "sitemap_omission",
      "broken_internal_link", "canonical_conflict", "duplicate_title", "robots_noindex", "canonical_missing", "duplicate_title", "missing_h1"]);
    expect(found.every((f) => f.url.startsWith(AT) && f.exactFix.length > 20 && f.evidence.length > 20)).toBe(true);
    // PIN (B, F2): a dead address with no replacement ASKS for one; a forward carries its destination as an address, so the live check reads where it was told to land.
    expect(found[0]!.exactFix).toBe("Tell me the address that replaced /gone and I will write you the forward. Until then I keep it out of your queue.");
    expect(found[0]!.redirectTo).toBeUndefined(); expect(found[1]!.evidence).toBe("/old sends people to /mid, and /mid sends them on again to /rain-barrels.");
    expect(found[1]!.redirectTo).toBe(`${AT}/rain-barrels`);
    // PIN (D, packet 19): a Ready technical change carries the EXACT edit, not a description of one.
    expect(found.find((f) => f.kind === "missing_h1")!.exact).toBe("Rain Barrel Sizing Guide");
    // PIN (D, packet 19): the orphan names a real source page, a real spot on it, and the words to type.
    const orphan = found.find((f) => f.kind === "orphaned_page")!;
    expect(orphan.exact).toBe("Rain Barrel Sizing"); expect(orphan.exactFix).toContain("/rain-barrels");
    expect(orphan.exactFix).toContain('reading "Rain Barrel Sizing"');
    // PIN (B, F8): the spot on the source page is named the way a person names it, never a bag of tokens.
    expect(orphan.exactFix).toContain('in the part of it about "Rain Barrel Sizing Guide"');
    expect(JSON.stringify(found)).not.toMatch(/[–—]|SERP|crawl_state|http_status|discovered_via/);
    // NOTHING FIRES WITHOUT HELD EVIDENCE: no inventory and no capture is no findings, never a clean bill
    expect([readTechnicalFindings({}), readTechnicalFindings({ inventory: [row(`${AT}/a`)] })]).toEqual([[], []]); });
  // PIN (D, packet 5 + 6): AN ACCESS STATE IS NOT A DEAD PAGE. Only the two answers that mean "the support is gone" produce a dead-page change; being turned away,
  // rate-limited or unreachable says something about me, not about the page. A server error is a bad minute until a SECOND read on a LATER day agrees.
  it("calls a page dead only on 404, 410 or a twice-confirmed server error, and never on an access state", () => {
    const dead = (over: Record<string, unknown>) => readTechnicalFindings({ inventory: [row(`${AT}/`), row(`${AT}/x`, over)] })
      .filter((f) => f.kind === "non_200");
    for (const code of [401, 403, 429, 503]) { expect(dead({ http_status: code }), `${code}`).toEqual([]);
      expect(dead({ crawl_state: "blocked", http_status: code }), `robots ${code}`).toEqual([]);
    }
    expect([dead({ http_status: 404 }).length, dead({ http_status: 410 }).length, dead({ crawl_state: "gone", http_status: null }).length]).toEqual([1, 1, 1]);
    expect(dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z" })).toEqual([]);
    expect(dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z", status_reconfirmed_at: "2026-08-01T18:00:00Z" })).toEqual([]);
    const twice = dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z", status_reconfirmed_at: "2026-08-03T09:00:00Z" });
    expect(twice[0]!.evidence).toContain("two different days"); });
  // PIN (D, packet 20): vague advice cannot enter Ready. Without the words to type there is no finding, and a copy fault with no copy behind it never reaches the
  // operator as a change.
  it("writes no change it has not written the wording for, and says so instead", async () => { const noWords = readTechnicalFindings({
      inventory: [row(`${AT}/`), row(`${AT}/rain-barrels`), row(`${AT}/orphan`, { discovered_via: "nav" })],
      pages: [{ url: `${AT}/`, internal_links: [`${AT}/rain-barrels`] }, { url: `${AT}/rain-barrels`, title: "Rain Barrel Sizing Guide", internal_links: [] }] });
    expect(noWords.some((f) => f.kind === "orphaned_page")).toBe(false);
    expect(readTechnicalFindings({ pages: [{ url: `${AT}/p`, h1: "" }] }).some((f) => f.kind === "missing_h1")).toBe(false);
    const run = async (findings: TechnicalFinding[]) => (CORE_PRODUCERS.technical_indexability as Producer)(
      { finding: { cause: "technical_indexability", payload: { cause: "technical_indexability", findings } }, primary: "rain barrel sizing" } as unknown as ProducerCtx);
    const vague = readTechnicalFindings({ pages: [{ url: `${AT}/a`, title: "Rain Barrel Sizing Guide" }, { url: `${AT}/b`, title: "Rain Barrel Sizing Guide" }] });
    expect(vague.map((f) => f.kind)).toEqual(["duplicate_title", "duplicate_title"]);
    const held = await run(vague);
    expect(held.components).toEqual([]);
    expect(held.refusal).toContain("an instruction is not handed over dressed as a change");
    // The same producer DOES hand over the ones whose exact wording it holds.
    expect((await run(readTechnicalFindings({ pages: [{ url: `${AT}/a`, title: "Rain Barrel Sizing Guide", h1: "" }] }))).components.map((c) => c.after))
      .toEqual(["Rain Barrel Sizing Guide"]);
    // PIN (B, F2b): a dead address with nowhere to send people is held the same deterministic way, and the operator is asked the one question that turns it into work.
    const stranded = await run(readTechnicalFindings({ inventory: [row(`${AT}/`), row(`${AT}/gone`, { crawl_state: "gone", http_status: 404 })] }));
    expect(stranded.components).toEqual([]);
    expect(stranded.refusal).toContain("Name the address that replaced it");
    const forwarded = await run(readTechnicalFindings({ inventory: [row(`${AT}/`), row(`${AT}/gone`, { crawl_state: "gone", http_status: 404, redirects_to: `${AT}/rain-barrels` })] }));
    expect(forwarded.components.map((c) => [c.kind, c.redirectTo])).toEqual([["redirect", `${AT}/rain-barrels`]]); });
  it("turns each fault into a component that answers for itself, and holds the dangerous ones", () => {
    const parts = technicalComponents(readTechnicalFindings(SERVED), "rain barrel sizing").map((c) => ({ ...c, evidenceKeys: ["demand-exact"] }));
    expect([parts.every((c) => !!c.where && !!c.objective && !!c.mechanism && !!c.measurementPlan && c.before === null), [...new Set(dangerousComponents(parts).map((c) => c.kind))].sort()]).toEqual([true, ["canonical", "noindex", "redirect"]]);
    const held = validateProposal(prop({ riskLevel: "high", status: "needs_review", bundle: bundleOf(parts) }));
    expect([held.verdict, held.reasons.some((r) => r.includes("confirm it before you make the change"))]).toEqual(["needs_review", true]);
    expect(validateProposal(prop({ bundle: bundleOf(parts) })).verdict).toBe("rejected"); // the same levers filed as a low risk ready change
    // and the ordinary ones pass the gate as the changes they are, copy and all
    const safe = parts.filter((c) => !dangerousComponents(parts).includes(c));
    for (const c of safe) expect(validateProposal(prop({ recommendedChange: { kind: "existing_edit", field: fieldForComponent(c.kind), before: null, after: c.after }, bundle: bundleOf([c]) })).verdict).not.toBe("rejected");
  }); });
// ── the complete change universe + the ONE unified ranking (Phase 4) ──────────
/** Every kind in the union, so a new lever can never be added without answering the gate. */
const ALL_KINDS: BundleComponentKind[] = ["title", "meta", "h1", "opening_answer", "section", "internal_links", "source_pack",
  "paragraph_correction", "section_add", "section_remove", "section_rewrite", "restructure", "full_rewrite", "factual_correction",
  "source_update", "entity_expansion", "table_or_list_add", "internal_link_add", "internal_link_remove", "anchor_text", "schema",
  "canonical", "redirect", "noindex", "consolidation", "navigation", "new_page"];
const comp = (over: Partial<BundleComponent> & { kind: BundleComponentKind }): BundleComponent => ({
  label: over.kind.replace(/_/g, " "), before: null, after: "Do this exact thing to the page.", evidenceKeys: ["demand-exact"], risk: "safe",
  where: "the first section of the page", objective: "Win back the clicks this search is losing.", mechanism: "It puts the words people search into the part of the page they read first.",
  measurementPlan: "Clicks from search for this one query over the next 28 days.", ...over });
const RECEIPT_ITEM = { key: "demand-exact", kind: "gsc_demand" as const, fact: "That one search brings this page 6,000 views and 90 clicks.", observedAt: null };
const bundleOf = (components: BundleComponent[], prompts: string[] = []): ChangeBundle => ({
  objective: "Close the gap on the one search this page is losing.", metric: "Clicks over 28 days.", scope: { queries: ["rain barrel sizing"], prompts },
  components, receipt: { items: [RECEIPT_ITEM], missing: [], freshestObservedAt: null }, alternatives: [], risks: [], confidenceReasons: [],
  measurementPlan: "I will read clicks, views and average position at 7, 14 and 28 days." });
const prop = (over: Partial<ChangeProposal>): ChangeProposal => ({ id: "p", tenantId: TENANT, kind: "existing_edit", pagePath: "/rain-barrels",
  pageUrl: "https://fixture-content.example/rain-barrels", pageLabel: "Rain Barrels", primaryQuery: "rain barrel sizing", opportunityType: "Capture clicks",
  changeFamily: "single", status: "ready", recommendedChange: { kind: "existing_edit", field: "title", before: "Rain Barrels", after: TITLE_AFTER },
  whyItMatters: "The title misses the word people search.", estimatedEffortMinutes: 1, riskLevel: "low", confidence: "medium", limitations: [],
  evidence: { query: "rain barrel sizing", hints: [], evidenceRefCount: 1 }, impactScore: 100, upsidePerMonth: null, publish: "manual", createdAt: "2026-07-25T00:00:00.000Z", ...over });
const factorOf = (p: ChangeProposal, name: string): number => p.rankingReceipt!.factors.find((f) => f.name === name)!.contribution;

describe("the complete change universe answers for itself", () => { it("round-trips every kind through the validator, and refuses one that cannot show its work", () => {
    for (const kind of ALL_KINDS) { const dangerous = DANGEROUS_COMPONENT_KINDS.has(kind);
      const c = comp({ kind, risk: dangerous ? "dangerous" : "safe", ...(needsSourcePack(comp({ kind })) ? { sourcePack: { sourceRequirements: ["Cite the county rule page."], factRequirements: ["Check the 2026 limit."] } } : {}) });
      const v = validateProposal(prop({ ...(dangerous ? { riskLevel: "high" as const, status: "needs_review" as const } : {}), bundle: bundleOf([c]) }));
      expect(v.verdict).not.toBe("rejected"); // every kind in the union is a shape this validator understands
      if (dangerous) { expect(v.verdict).toBe("needs_review"); expect(v.reasons.join(" ")).toContain("confirm it before you make the change"); }
    }
    // no component without evidence, no fact without sources, and no new kind without its four answers
    const blind = validateProposal(prop({ bundle: bundleOf([comp({ kind: "section_add", evidenceKeys: [] })]) }));
    expect([blind.verdict, blind.reasons.some((r) => r.includes("cannot show you anything behind"))]).toEqual(["rejected", true]);
    const unsourced = validateProposal(prop({ bundle: bundleOf([comp({ kind: "factual_correction" })]) }));
    expect([unsourced.verdict, unsourced.reasons.some((r) => r.includes("carries no sources to check it against"))]).toEqual(["rejected", true]);
    const mute = validateProposal(prop({ bundle: bundleOf([comp({ kind: "restructure", where: undefined, mechanism: undefined })]) }));
    expect([mute.verdict, mute.reasons.some((r) => r.includes("where on the page it goes, why it fixes what I diagnosed"))]).toEqual(["rejected", true]);
    // a lever that moves the page and is NOT marked as one is a mislabelled change, never a safe paste
    const sneaky = validateProposal(prop({ bundle: bundleOf([comp({ kind: "redirect", risk: "safe" })]) }));
    expect([sneaky.verdict, sneaky.reasons.some((r) => r.includes("not marked as one that needs your confirmation"))]).toEqual(["rejected", true]); });
  it("refuses a page move, a de-indexing or a merge smuggled through an ordinary component", () => {
    // the kind is a label somebody typed, and the copy is the change: a section rewrite that redirects and de-indexes the page is neither
    const smuggled = validateProposal(prop({ bundle: bundleOf([comp({ kind: "section", after: "Add a 301 redirect to the sizing guide and noindex this page." })]) }));
    expect([smuggled.verdict, smuggled.reasons.some((r) => r.includes("sends this page's address somewhere else")), smuggled.reasons.some((r) => r.includes("stops people finding this page in search"))]).toEqual(["rejected", true, true]);
    const canonical = validateProposal(prop({ bundle: bundleOf([comp({ kind: "internal_links", after: "Point the canonical tag at the sizing guide instead." })]) }));
    expect([canonical.verdict, canonical.reasons.some((r) => r.includes("as the real address"))]).toEqual(["rejected", true]);
    const merged = validateProposal(prop({ bundle: bundleOf([comp({ kind: "section", after: "Merge this page into the sizing guide once the copy is moved." })]) }));
    expect([merged.verdict, merged.reasons.some((r) => r.includes("merges it into another"))]).toEqual(["rejected", true]);
    // and an honest section rewrite that names none of them is still a safe paste
    expect(validateProposal(prop({ bundle: bundleOf([comp({ kind: "section", after: "Add a short section on roof area, with the gallons each one collects per storm." })]) })).verdict).not.toBe("rejected");
  });
  it("keeps a legal or medical correction dangerous however small the edit reads", () => {
    const legal = (risk: BundleComponent["risk"]): BundleComponent => comp({ kind: "factual_correction", risk, after: "Under the county statute the permit is required above 60 gallons.",
      sourcePack: { sourceRequirements: ["Cite the county statute."], factRequirements: ["Confirm the 60 gallon threshold."] } });
    expect(dangerousComponents([legal("safe")])).toHaveLength(1); // a statute is dangerous whatever the row claims
    // an unmarked one is a MISLABELLED change, and a mislabelled change is the one that gets pasted without a second look
    expect(validateProposal(prop({ bundle: bundleOf([legal("safe")]) })).verdict).toBe("rejected");
    const held = validateProposal(prop({ riskLevel: "high", status: "needs_review", bundle: bundleOf([legal("dangerous")]) }));
    expect([held.verdict, held.reasons.some((r) => r.includes("confirm it before you make the change"))]).toEqual(["needs_review", true]); }); });
describe("one score orders every kind of change, and says why", () => { it("puts the lever the evidence named above a bigger one it did not, on the same page", () => {
    const named = prop({ id: "title-fix", impactScore: 120, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "title" })]) });
    const bigger = prop({ id: "section-add", impactScore: 2000, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "section_add" })]) });
    const ranked = rankProposals([bigger, named]);
    expect(ranked.map((p) => p.id)).toEqual(["title-fix", "section-add"]);
    expect([factorOf(ranked[0]!, "causeFit"), factorOf(ranked[1]!, "causeFit")]).toEqual([25, -25]);
    expect(ranked[0]!.whyRankedAboveNext).toContain("this change works on the line a searcher reads");
    expect(ranked[0]!.whyRankedAboveNext).not.toMatch(/[—–]|experiment|control|baseline|treatment|SERP/i);
    expect(ranked[1]!.whyRankedAboveNext).toBeUndefined(); // nothing sits below the last one
    // both changes land on the same page, so each one discounts the other for confounding
    expect([factorOf(ranked[0]!, "confounding"), factorOf(ranked[1]!, "confounding")]).toEqual([-5, -5]);
    // a cause NOTHING on the page can fix rewards no lever and punishes none either: those changes rank on everything else
    for (const cause of ["demand_decline", "measuring_change"] as const) { const [only] = rankProposals([prop({ diagnosisCause: cause, bundle: bundleOf([comp({ kind: "title" })]) })]);
      expect(factorOf(only!, "causeFit")).toBe(0);
      expect(only!.rankingReceipt!.factors.find((f) => f.name === "causeFit")!.input).toBe("nothing you can write on the page fixes the cause named here");
    }
  });
  it("discounts a dangerous consolidation and a page that already has a change under measurement", () => {
    const safe = prop({ id: "safe", impactScore: 300, pagePath: "/quiet", bundle: bundleOf([comp({ kind: "title" })]) });
    const risky = prop({ id: "risky", impactScore: 300, pagePath: "/merge", status: "needs_review",
      bundle: bundleOf([comp({ kind: "consolidation", risk: "dangerous", after: "Fold this page into the sizing guide." })]) });
    const busy = prop({ id: "busy", impactScore: 300, pagePath: "/measuring", bundle: bundleOf([comp({ kind: "title" })]) });
    const ranked = rankProposals([risky, busy, safe], { measuringPagePaths: ["/measuring"] });
    expect(ranked.map((p) => p.id)).toEqual(["safe", "busy", "risky"]);
    const held = ranked.find((p) => p.id === "risky")!;
    expect(factorOf(held, "risk")).toBe(-18); // it still ranks, it just ranks with its discount
    expect(validateProposal(held).reasons.some((r) => r.includes("confirm it before you make the change"))).toBe(true);
    expect(factorOf(ranked.find((p) => p.id === "busy")!, "overlap")).toBe(-30);
    expect(factorOf(ranked.find((p) => p.id === "safe")!, "overlap")).toBe(0);
    expect(ranked[0]!.whyRankedAboveNext).toContain("/measuring already has a change under measurement");
    // every factor stays inside its own ceiling, so no single input can quietly decide the order
    for (const p of ranked) for (const f of p.rankingReceipt!.factors) expect(Math.abs(f.contribution)).toBeLessThanOrEqual(f.max); });
  it("holds every factor on its own floor, and never punishes a stored change for the age of its vocabulary", () => {
    // a tampered evidence count used to contribute -1,500 and drag a safe change down through the lifecycle tiers
    const [floored] = rankProposals([prop({ id: "floored", evidence: { query: "rain barrel sizing", hints: [], evidenceRefCount: -1000 } })]);
    expect(factorOf(floored!, "evidence")).toBe(0);
    expect(floored!.rankingReceipt!.factors.every((f) => f.contribution >= -f.max)).toBe(true);
    expect(proposalValueScore(floored!)).toBeGreaterThan(proposalValueScore(prop({ status: "needs_review", impactScore: 9999 })));
    // the older undifferentiated kinds ARE the levers their newer names describe, on a bundle and on a pre-bundle row alike
    const bundled = rankProposals([prop({ diagnosisCause: "incomplete_coverage", bundle: bundleOf([comp({ kind: "section" })]) })]);
    const stored = rankProposals([prop({ diagnosisCause: "incomplete_coverage", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A section on roof area." } })]);
    expect([factorOf(bundled[0]!, "causeFit"), factorOf(stored[0]!, "causeFit")]).toEqual([25, 25]); });
  it("ranks a change it holds no proven figure for as a direction, never a size, and says so", () => { const [blind] = rankProposals([prop({ impactScore: null, upsidePerMonth: null })]);
    expect(blind!.rankingReceipt!.directional).toBe(true);
    expect(blind!.rankingReceipt!.basis).toContain("this is the order to work in, not a promise about size");
    expect(factorOf(blind!, "visibility")).toBe(0);
    const [sized] = rankProposals([prop({ impactScore: 570 })]);
    expect([sized!.rankingReceipt!.directional, factorOf(sized!, "visibility")]).toEqual([false, 22.8]);
    expect(sized!.rankingReceipt!.basis).toContain("about 570 clicks proven recoverable"); });
  it("decodes and ranks a stored row that predates every field this ranking added", () => {
    const { rankingReceipt: _r, whyRankedAboveNext: _w, diagnosisCause: _c, bundle: _b, ...old } = prop({ impactScore: 300, bundle: bundleOf([comp({ kind: "title" })]) });
    void _r; void _w; void _c; void _b;
    const back = deserializeChangeProposal(serializeChangeProposal(old as ChangeProposal));
    expect(back).not.toBeNull();
    const [ranked] = rankProposals([back!]);
    expect(ranked!.rankingReceipt!.factors.map((f) => f.name)).toEqual(["actionability", "visibility", "evidence", "causeFit", "strategic", "effort", "risk", "overlap", "confounding", "history"]);
    expect(factorOf(ranked!, "causeFit")).toBe(0); // no diagnosis on the row, so nothing is matched and nothing is punished
    expect(proposalValueScore(back!)).toBeGreaterThan(proposalValueScore(prop({ status: "needs_review", impactScore: 9999 }))); }); });
