/** The ONE change contract: an existing-page repair (Slice 7), and NOTHING ELSE. Selection on a PROVEN recoverable gap, receipt-first grounding for the EXACT candidate search, scope named on every number, QUERY IDENTITY per query, winners attaching only on exact membership, atomic bundling, confidence and readiness by EVIDENCE HELD, determinism, honest refusal, no page is ever invented however much research backs the topic, a release publishing only on a real production result, dedupe, and a round trip. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"; import type { BundleComponent, BundleComponentKind, ChangeBundle, ChangeProposal } from "@/domains/decision/contracts";
import { receiptComposition } from "@/domains/decision/contracts"; import { confirmedVersion, deliverableGaps, openHold, preferFinished } from "@/domains/decision/completeness"; import { acceptDeliverable, applyDraftedCopy, deliverableFailures, draftFieldForPage, staleCopyReasons, withoutCta } from "@/domains/decision/drafted-copy";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { proposalFingerprint } from "@/domains/decision/proposal-store"; import { DANGEROUS_COMPONENT_KINDS, dangerousComponents, needsSourcePack } from "@/domains/decision/contracts"; import { rankProposals, proposalValueScore } from "@/domains/decision/rank-proposals"; import { validateProposal } from "@/domains/decision/validate-proposal";
const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>() })); const env = vi.hoisted(() => ({ snap: null as unknown })); vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) })); vi.mock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadChangeProposals: async () => store.rows, saveChangeProposal: async (p: ChangeProposal) => { store.rows.set(p.id, p); },
  withdrawnProposalIds: async () => new Set<string>(), withdrawChangeProposal: async () => true }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap })); const bodyStore = vi.hoisted(() => ({ map: null as null | Map<string, unknown> }));
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()),
  loadOwnedPageBodies: async () => { if (bodyStore.map) return bodyStore.map; throw new Error("no body store in this fixture"); } })); const acct = vi.hoisted(() => ({ profile: null as unknown }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => acct.profile ?? null, getTenant: async () => ({ id: "fixture-tenant", domain: "fixture-content.example", growth_goal: null }), basisTag: () => "basis_test" })); import { produceBundleForSnapshot } from "@/domains/decision/produce-bundle"; import { ledgerProofLine } from "@/domains/decision/changes/lifecycle-counts";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals"; import { loadProposalQueue } from "@/domains/decision/load-proposals"; import { confidenceFor, serializeChangeProposal, deserializeChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter"; import { adjudicateCoverage, earnedNewPage, intersectionComparison } from "@/domains/decision/coverage-adjudication"; import type { OwnedCandidate } from "@/domains/decision/owned-coverage"; import type { ParsedPageIntersection } from "@/domains/evidence/page-intersection";
import { answerIntelOf } from "@/domains/evidence/answer-intel"; import type { TopicInvestigation } from "@/domains/evidence/topic-investigation"; import type { LlmCallCacheEntry } from "@/domains/decision/llm/call-cache"; import type { EvidenceSnapshot, OwnedPageEvidence } from "@/domains/evidence/snapshot";
import { readTechnicalFindings, technicalComponents, type TechnicalFinding } from "@/domains/decision/technical-findings"; import { suggestedEdits } from "@/domains/decision/suggested-edits"; import { compileCandidates } from "@/domains/decision/opportunities";
import { CORE_PRODUCERS } from "@/domains/decision/producers/core"; import { unsettledCause } from "@/domains/decision/authorization";
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
beforeEach(() => { process.env.OPENAI_API_KEY = "test-key"; store.rows.clear(); sent.length = 0; kinds.length = 0; acct.profile = null; }); afterEach(() => { delete process.env.OPENAI_API_KEY; }); describe("produceBundleForSnapshot", () => {
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
    // THE STORED-ROW COMPATIBILITY CONTRACT, as a literal: a receipt item carrying NO answer id must hash to exactly what it hashed to before ids existed, or every proposal already on file is rewritten once to say the identical thing. Appending the id unconditionally (`?? null`) moves this string, which is the whole point of pinning it. MOVED TWICE, ON PURPOSE: the two-window repair, then identity (2026-08-15), because a piece's PAGE, its placement, what it is for and why it works sat outside the hash, so a change spanning four addresses could drop one, move a piece to another page or be re-aimed entirely and compute "unchanged". Still pinned as a literal: the contract is that nothing moves this string by accident, never that it cannot move.
    expect(proposalFingerprint(bare)).toBe("da72f70f7fec0b25"); expect(new Set([out.proposal, swap(["obs_p1_chatgpt", "obs_somebody_else"]), bare].map(proposalFingerprint)).size).toBe(3); expect(proposalFingerprint(swap(["obs_p2_gemini", "obs_p1_chatgpt"]))).toBe(proposalFingerprint(out.proposal)); // the same support in another order is the same support
    expect(deserializeChangeProposal(serializeChangeProposal(out.proposal))!.bundle!.receipt.items.find((i) => i.key === "named1")!.observationIds).toEqual(["obs_p1_chatgpt", "obs_p2_gemini"]); }); // and the WHOLE set survives being stored and read back
  it("lets an omission the answers keep leaving ADD support to a piece that stands on its own, and never rescue one that stands on nothing", async () => {
    const both = { competitors: [], materialOmissions: ["what a first flush diverter costs"], contentTypesRecommended: [] };
    const world = snapshot({ research: { ...RESEARCH, serpEvidence: [], aiObservations: [{ ...RESEARCH.aiObservations[0]!, analysis: { ...both, sections: [{ heading: "Only this one answer covers it", covers: "z" }] } }, { ...RESEARCH.aiObservations[1]!, fanOutQueries: ["rain barrel sizing"], analysis: both }] } });
    const slots = Object.keys(CORE_PRODUCERS) as (keyof typeof CORE_PRODUCERS)[]; const held = slots.map((k) => [k, CORE_PRODUCERS[k]] as const);
    // "ai2" is an answer whose sources I could not see: CONTEXT, never support. So one piece cites nothing valid of its own and the other cites this page's own demand.
    const piece = (label: string, evidenceKeys: string[]): BundleComponent => ({ kind: "section_add", label, before: null, after: "A rain barrel sized for your roof area holds what one storm gives you.", evidenceKeys, risk: "review",
      where: "After the opening", objective: "Answer what the assistants leave out", mechanism: "The answers I hold never cover it, so the page that does is the one they can name", measurementPlan: "Clicks for this search over 28 days" });
    for (const k of [...slots, "ai_citation_gap"]) (CORE_PRODUCERS as Record<string, unknown>)[k] = async () => ({ components: [piece("Rescued by an omission", ["ai2"]), piece("Stands on its own", ["demand-page"])] });
    const out = await produceBundleForSnapshot(world, { complete: seam, ...OPTS, door: { door: "recent_decline", entry: "This page was earning and stopped.", evidence: { query: "rain barrel sizing", engine: null, promptText: null, competingUrls: [], window: "the four weeks to 2026-08-01, against the four weeks before" } } });
    for (const [k, v] of held) (CORE_PRODUCERS as Record<string, unknown>)[k] = v; delete (CORE_PRODUCERS as Record<string, unknown>).ai_citation_gap;
    if (out.status !== "bundled") throw new Error(`expected a change, got ${out.reason}`); const b = out.proposal.bundle!; expect(b.components.map((c) => c.label)).toEqual(["Stands on its own"]); expect(b.receipt.items.some((i) => i.key === "covered1")).toBe(false); // a rebuild justified ONLY by an omission somewhere in the case is not proven, and one answer's own outline is never what the answers agree on
    expect(b.alternatives.find((a) => a.option === "Rescued by an omission")!.reason).toContain("There was nothing to show behind that one"); expect(b.components[0]!.evidenceKeys).toEqual(["demand-page", "missing1"]); }); // and the omission still ADDS itself to the piece that already stood up
  it("spends nothing on a search whose results page it has never looked at, and says exactly that", async () => {
    let called = 0; const counting: CompleteFn = async (r) => { called += 1; return seam(r); }; const out = await produceBundleForSnapshot(snapshot({ research: emptyResearchEvidence() }), { complete: counting, ...OPTS });
    // A gap proves something is wrong, never what to change: unseen is an investigation, and an investigation costs no drafter call.
    expect(out.status).toBe("none"); if (out.status !== "none") return; expect(called).toBe(0); expect(out.reason).toBe("The results page for that search has not been read yet, so what to change cannot be named. It is first in line on the next research pass."); });
  it("refuses a page with no proven gap and no current copy, and round-trips through persistence", async () => { const opt = { complete: seam, ...OPTS }; const healthy = page({ url: "fixture-content.example/rain-barrels", search: { ...page({ url: "x" }).search!, topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 700, position: 3 }] } }); const noGap = await produceBundleForSnapshot(snapshot({ ownedPages: [healthy] }), opt); const noCopy = await produceBundleForSnapshot(snapshot({ ownedPages: [page({ url: "fixture-content.example/rain-barrels", content: null })] }), opt); expect(noGap.status).toBe("none"); expect(noCopy.status).toBe("none"); if (noCopy.status !== "none") return; // a big page earning its rank is not work
    expect(noCopy.reason).toContain("nothing honest to rewrite"); const out = await produceBundleForSnapshot(snapshot(), opt); if (out.status !== "bundled") throw new Error("expected a change"); const back = deserializeChangeProposal(serializeChangeProposal(out.proposal)); expect(back).toEqual(out.proposal); expect(back!.bundle!.components).toHaveLength(1); const { bundle: _dropped, ...preBundleRow } = out.proposal; void _dropped; const legacy = deserializeChangeProposal(serializeChangeProposal(preBundleRow as typeof out.proposal)); expect(legacy).not.toBeNull(); expect(legacy!.bundle).toBeUndefined(); });
  it("says what the change keeps, what it replaces, and what it adds", async () => {     const out = await produceBundleForSnapshot(snapshot(), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change");
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
    // FOUR CALLS, AND EVERY ONE OF THEM PLANNED. One deliverable is a draft and its judge, and the editor feeds a refusal back and tries again, so its allowance covers the retry the live receipt of 2026-08-23 proved it needs. This pass compiles and funds its jobs before it spends anything, and the page being bundled declares no shallow draft of its own: a bundle replaces the field edit it is about to rewrite, so paying for both funded one page twice, at three calls and then at twelve. Fewer calls, the same work, and still every call an edit to a page that already exists.
    ["a tracked prompt, a live results page, and three pages I read", TOPIC_RESEARCH, ["atomic_edit", "atomic_edit", "atomic_edit", "atomic_edit"]], ])("refuses to draft a page from %s", async (_what, research, drafted) => {
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
    // THE BOUNDARY HOLDS: the ai_answer_gap card used to admit /rain-barrels on word overlap with no page reading; now withheld with its reason on the run result. A MEASURED GAP WITH NO DIAGNOSED CAUSE MINTS NO TITLE GUESS (operator, 2026-08-17): the compost page's 1,200 impressions at position 6 used to earn a best-guess merge; the cause is unknown, so the honest output is the investigation path plus the page's real defects, never a rewrite nobody can justify.
    expect(res.proposals.map((p) => [p.id, p.status]).sort()).toEqual([[`${TENANT}::/compost::existing_edit::missing_description`, "needs_review"], [`${TENANT}::/rain-barrels::existing_edit::title-family`, "ready"]]);
    expect(res.held.some((h) => h.pageUrl.includes("/rain-barrels"))).toBe(true);
    // FIVE GUARDS ON ONE PASS: host and path key the page (two hosts share /compost and the weak row must carry ITS OWN title), an em dash in a brand tail is never pasted, a page the strict path covered takes no second weaker row, a page beating its own curve on its ONE measured search is refused even through the AEO clause that waives the click test, and a search whose results page I never bought still earns ONE best-guess card, at the lowest confidence I have, rather than the silence that left a losing page with nothing to do.
    const twin = { ...topicSnapshot().ownedPages[1]!, url: "https://other.example/compost", content: { ...topicSnapshot().ownedPages[1]!.content!, title: "Twin Compost Page", h1: "Twin Compost Page" } };
    const dashed = { ...topicSnapshot().ownedPages[1]!, content: { ...topicSnapshot().ownedPages[1]!.content!, title: "Compost | Green \u2014 Co", h1: null } }; // the title is the only line there is, so the dash decides
    // The guards below are exercised under a FORGED treatable cause: with the real (unknown) cause the boundary refuses the card outright, which is pinned separately right here.
    expect(suggestedEdits(topicSnapshot(), compileCandidates(topicSnapshot()), { now: OPTS.now!, basis: "b" })).toEqual([]);
    const treatably = (s: EvidenceSnapshot) => compileCandidates(s).map((c) => ({ ...c, cause: { ...c.cause, cause: "ctr_snippet" as const }, diagnosis: undefined }));
    const only = (s: EvidenceSnapshot) => suggestedEdits(s, treatably(s), { now: OPTS.now!, basis: "b" }); // the twin is LAST below, so keying on the path alone would hand that page the twin's words
    const looked = (s: EvidenceSnapshot): EvidenceSnapshot => ({ ...s, research: { ...s.research, serpEvidence: [...s.research.serpEvidence, { observedAt: null, query: "compost bin sizing", organic: [{ rank: 1, domain: "compostpro.example", url: "https://compostpro.example/a", title: "C" }], aiOverview: [], aiMode: [], paa: [], related: [] }] } });
    const two = looked({ ...topicSnapshot(), ownedPages: [topicSnapshot().ownedPages[1]!, twin] }); const one = only(two)[0]!; expect(only(topicSnapshot()).map((p) => [p.pagePath, p.confidence])).toEqual([["/compost", "low"]]); // under a treatable cause, a never-looked merge is a labelled low-confidence guess
    expect([only(two).length, one.pagePath, (one.recommendedChange as { before: string }).before, one.confidence]).toEqual([1, "/compost", "Rain Barrels", "medium"]); // the twin host's title never leaks onto this page
    expect([one.opportunityType, one.operatorSteps]).toEqual(['Lead the title with "compost bin sizing" and keep the words this page already earns on', ["Open your site editor on /compost", "Replace the title with the copy above", "Come back here and mark it done, and measurement starts"]]); // the exact move, where it happens, what I do next
    expect([only(looked({ ...topicSnapshot(), ownedPages: [dashed] })), suggestedEdits(looked(topicSnapshot()), treatably(looked(topicSnapshot())), { now: OPTS.now!, basis: "b", skip: new Set(["/compost"]) })]).toEqual([[], []]); // the dash refuses the paste, and the strict path already owns that page
    const winner = { ...topicSnapshot().ownedPages[1]!, search: { clicks90d: 240, impressions90d: 1200, ctr90d: 0.2, position90d: 4, topQueries: [{ query: "compost bin sizing", impressions: 1200, clicks: 240, position: 4 }] } };
    const asked = { ...TOPIC_RESEARCH, aiObservations: [canonObs({ promptId: "pc", promptText: "compost bin sizing", citations: [{ url: "https://compostpro.example/a", domain: "compostpro.example", title: "C" }], analysis: { competitors: [{ name: "compostpro", position: 1 }] }, observedAt: "2026-07-22T00:00:00.000Z" })] };
    const aeo = looked({ ...topicSnapshot(), ownedPages: [winner], research: asked }); expect([compileCandidates(aeo)[0]!.cause.cause, only(aeo)]).toEqual(["ai_citation_gap", []]); // an assistant naming everybody else waives my CLICK test, never the fact that this page beats its own curve
    // A BELOW-BAR SEARCH SAYS ITS SIZE IN ONE UNIT, and a card asking for a minute of work never claims it is not asking: all three legacy tails close in the same honest frame, numbers intact.
    const soft = { ...topicSnapshot().ownedPages[1]!, search: { ...COMPOST, impressions90d: 600, topQueries: [{ query: "compost bin sizing", impressions: 600, clicks: 5, position: 6 }] } };
    const quiet = looked({ ...topicSnapshot(), ownedPages: [soft], research: asked }); const soften = compileCandidates(quiet)[0]!; const frame = "That is under the bar for a proven change, so this is a quick test, and what it does will be measured.";
    expect(soften.reason).toContain("that search is worth about 25 clicks, under the 50 clicks that earn a change. Watching it rather than asking for work.");
    expect(["and that is only about 7 clicks, under the 50 I act on.", "and that gap is 1.5 percent, under the 2.0 percent I act on.", "and that is too little search to act on yet (I want 500 impressions on one query)."]
      .map((t) => suggestedEdits(quiet, [{ ...soften, cause: { ...soften.cause, cause: "ctr_snippet" as const }, diagnosis: undefined, reason: `Scope. Rates, ${t} Watching it rather than asking for work.` }], { now: OPTS.now!, basis: "b" })[0]!.whyItMatters.split(" This line leads")[0]!))
      .toEqual([`Scope. Rates, and that is only about 7 clicks. ${frame}`, `Scope. Rates, and that gap is 1.5 percent. ${frame}`, `Scope. Rates. ${frame}`]);
    // The AI side of the same search only where the answers already joined it, a suggestion ranked like every other row, and the one proof number a ledger row can print.
    const ranked = rankProposals([res.proposals[0]!, one]); expect(only(quiet)[0]!.whyItMatters).toContain("AI answers about this topic credit compostpro, never this site.");
    expect([!!ranked[0]!.whyRankedAboveNext, ranked[0]!.rankingReceipt!.basis.length > 0, ranked[1]!.rankingReceipt!.factors.length > 0, ranked[1]!.whyRankedAboveNext, ledgerProofLine({ windows: [] }),
      ledgerProofLine({ windows: [{ day: 7, ran: true, controlsUsed: 3, adjustedLift: 12.4 }, { day: 28, ran: true, controlsUsed: 4, adjustedLift: -3.2 }, { day: 56, ran: false, controlsUsed: 0 }] })]).toEqual([true, true, true, undefined, null, "clicks -3 against similar pages that were not changed"]);
    expect(sent.join(" ")).not.toMatch(/encyclopedia|wikipedia|culture|dynast|cuisine|province/i); }); // B6: generic product code carries no vertical assumption, whatever this account happens to sell.
  /** ONE TRACKED QUESTION IS ASKED OF SEVERAL ENGINES, so its id names several different answers. Matching lineage on the question id alone handed one engine's fan-out to another engine's answer: below, only the answer this account's lineage actually names may join, and its neighbour's searches stay its neighbour's. */
  it("never lets one engine's answer borrow the searches another engine's answer went and ran", async () => {
    const obs = (engine: string, promptText: string) => canonObs({ observationId: `obs_px_${engine}`, promptId: "px", promptText, engine, promptVersion: 2, reportingDay: "2026-07-22", citations: [{ url: WIN1, domain: "gardenguide.example", title: "A" }], observedAt: "2026-07-22T00:00:00.000Z" });
    const research = { ...RESEARCH, aiObservations: [obs("chatgpt", "how much rain does a roof catch"), obs("gemini", "roof runoff calculator")],
      retainedKeywords: RESEARCH.retainedKeywords.map((k) => k.query === "rain barrel sizing" ? { ...k, origins: [{ route: "fanout" as const, promptId: "px", promptVersion: 2, engine: "chatgpt", reportingDay: "2026-07-22", observationId: "obs_px_chatgpt" }] } : k) };
    const out = await produceBundleForSnapshot(snapshot({ research }), { complete: seam, ...OPTS });
    if (out.status !== "bundled") throw new Error("expected a change"); expect([out.proposal.bundle!.scope.prompts, out.proposal.bundle!.receipt.items.filter((i) => i.kind === "ai_observation").length]).toEqual([["how much rain does a roof catch"], 1]); }); // the keyword carries the FULL identity of ONE stored answer, and the receipt stands on that answer alone
  /** A CHANGE MAY NOT OUTLIVE ITS OWN EXPLANATION. This used to DEMOTE the row to needs_review, which is "look at this first" and still fully actionable, so an unsupported change kept its place on the operator's list under a quieter name. It is taken back now, and a page that still earns an action is untouched. */
  it("takes back the change whose page it read and can no longer prove anything about, and leaves the one it still can", async () => { env.snap = snapshot(); await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); const held = [...store.rows.values()].find((p) => !!p.bundle)!;
    store.rows.set("orphan", { ...held, id: "orphan", pagePath: "/compost", status: "needs_review" }); // a page I DID read, that no door proves
    const after = await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); expect([after.proposals.some((p) => p.id === "orphan"), store.rows.has("orphan"), store.rows.has(held.id)]).toEqual([false, false, true]); });
  /** P0. THE SNAPSHOT IS FAIL-SOFT BY DESIGN: every leg catches to empty, so one database blip reads as an account with no pages. The retire loop then proved nothing about anything, took back EVERY live change, and the refusal kept them shut afterwards. A pass may only speak about a page it actually read. */
  it("takes nothing back about a page this pass never read, however healthy the rest of the pass looks", async () => { env.snap = snapshot(); await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); const held = [...store.rows.values()].find((p) => !!p.bundle)!;
    store.rows.set("unread", { ...held, id: "unread", pagePath: "/nothing-reached-this-page" }); // its page is not in the read at all
    await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS }); expect([store.rows.has("unread"), store.rows.has(held.id)]).toEqual([true, true]); });
  it("queues only the changes it can show are current, and sets aside every basis it cannot match", async () => { env.snap = topicSnapshot(); await produceProposalsForTenant(TENANT, { complete: seam, ...OPTS });
    const seed = [...store.rows.values()].find((p) => p.kind === "existing_edit")!; store.rows.clear();
    const put = (id: string, over: Partial<ChangeProposal>) => store.rows.set(id, { ...seed, id, status: "ready", basis: "basis_today", limitations: [], ...over });
    put("ready", {}); put("review", { status: "needs_review" }); put("owing", { limitations: ["Add one before this is paste-ready."] }); put("older", { basis: "basis_last_week", kind: "new_page" }); put("historical", { basis: undefined });
    const rows = store.rows.size, q = await loadProposalQueue(TENANT, { currentBasis: "basis_today", now: NOW }), blind = await loadProposalQueue(TENANT, { currentBasis: null, now: NOW }); // THE CLOCK IS INJECTED: judged against the real moment this pin passed only while the fixture date was still inside the readings window, so it was a date bomb waiting on the calendar rather than on the code expect(q.ready.map((p) => p.id)).toEqual(["ready"]); expect(q.toDo.map((p) => p.id)).toEqual(["review", "owing"]); expect(q.ranked.map((p) => p.id)).toEqual(["ready", "review", "owing"]); expect(q.demotedStaleBasis).toBe(2); expect([blind.ranked, blind.ready, blind.toDo].map((l) => l.length)).toEqual([0, 0, 0]); // a basis I cannot read proves nothing current, so it shows you nothing
    expect([blind.demotedStaleBasis, store.rows.size]).toEqual([5, rows]); }); // every set-aside row is still counted, and not one stored row is rewritten
}); // ── the release: a fresh timestamp may never sit on top of a failed production run ──
const release = async (produce: () => Promise<unknown>) => { vi.resetModules(); const published: { computedAt: string }[] = [];
  vi.doMock("@/lib/persistence/json-store", () => ({ readStore: async () => [], writeStore: async () => {}, claimScope: async () => true, releaseScope: async () => undefined }));
  vi.doMock("@/lib/tenant-context", () => ({ currentTenantId: async () => TENANT, slugForTenantId: async () => "fixture", runWithTenant: async (_t: string, fn: () => Promise<unknown>) => fn() }));
  vi.doMock("@/lib/single-flight", () => ({ runSingleFlight: async (_k: string, fn: () => Promise<unknown>) => fn() }));
  const swept: Array<{ shipped: string[] }> = []; // THE TRIPWIRE THE BUILD RUNS: what it was told is already measured, and what it reverted.
  vi.doMock("@/domains/measurement", () => ({ loadShippedChanges: ledger.read, loadShippedChangesForTenant: (_t: string) => ledger.read() }));
  vi.doMock("@/domains/decision", () => ({ produceProposalsForTenant: produce,
    // The atomic commit IS the publish now: `published` records what the transaction landed, not what a cache wrote.
    publishCustomerRelease: async (a: { release: string; content: { computedAt: string } }) => { published.push(a.content); return a.release; },
    reconcileImplementedWithoutShipment: async (_t: string, shipped: ReadonlySet<string>) => { swept.push({ shipped: [...shipped] }); return ["reverted"]; } }));
  vi.doMock("@/app/(shell)/changes-data", () => ({ buildChangesViewUncached: async () => ({ proposals: [], stampRows: [] }) }));
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
  it("keeps the last loadable release when every write of the pass failed", async () => { const { refreshCustomerSurface, published } = await release(async () => ({ proposals: [], outcome: "persistence_failed", candidates: [] })); await expect(refreshCustomerSurface(TENANT)).rejects.toThrow(/could not save a single one/); expect(published).toEqual([]); });
  it("carries the kernel's own verdict for judged-but-declined pages, biggest gap first", async () => { const judged = [{ action: "watch", pageUrl: "https://s.example/a/", recoverableClicks: 12, reason: "small gap" }, { action: "research_needed", pageUrl: "https://s.example/b", recoverableClicks: 400, reason: "big gap" }, { action: "act_existing_page", pageUrl: "https://s.example/c", recoverableClicks: 900, reason: "acted" }];
    const { refreshCustomerSurface, signals } = await release(async () => ({ proposals: [], outcome: "proposals_persisted", candidates: judged })); await refreshCustomerSurface(TENANT); expect(signals[0]?.declineNotes).toEqual([{ page: "/b", note: "big gap" }, { page: "/a", note: "small gap" }]); }); // an acted page is work, not a verdict
  // THE TRIPWIRE RUNS ON EVERY BUILD, on the ledger's own list of what is genuinely being measured, and a ledger that would not read reverts nothing: a list nobody could read is not proof a change has no record.
  it("hands the tripwire what the ledger really holds, and sweeps nothing at all when that ledger will not read", async () => { const pass = async () => ({ proposals: [], outcome: "proposals_persisted", candidates: [] });
    ledger.read = async () => [{ proposalId: "fixture-tenant::/a::existing_edit::title" }, { proposalId: null }]; const seen = await release(pass); await seen.refreshCustomerSurface(TENANT);
    expect(seen.swept).toEqual([{ shipped: ["fixture-tenant::/a::existing_edit::title"] }]);
    ledger.read = async () => { throw new Error("the ledger did not read"); }; const blind = await release(pass); await blind.refreshCustomerSurface(TENANT);
    expect([blind.swept.length, blind.published.length]).toEqual([0, 1]); // the release still publishes; nothing was reverted on a blind read
    ledger.read = async () => []; const empty = await release(pass); await empty.refreshCustomerSurface(TENANT); // an EMPTY ledger sweeps nothing either: a schema-cache blip reads as empty without throwing
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
    const asking = await adjudicateCoverage(INV({ exactSerps: [], serpFreshness: "missing", nextAcquisition: buy }), [ONE], TENANT, {}); expect([asking.verdict, asking.acquisition]).toEqual(["research_needed", buy]);
    expect(asking.explanation).toContain('What changes this: buying the results page for "rain barrel sizing".');
    const blind = { demand: { ...INV().demand, intent: null } }; // NO ENDLESS INVESTIGATION: the acquisition was tried, nothing left to buy moves it, so it becomes a decision
    const spent = await adjudicateCoverage(INV({ ...blind, nextAcquisition: null, diminishing: true }), [ONE], TENANT, {}); expect([spent.verdict, spent.missing, spent.acquisition]).toEqual(["do_nothing", [], undefined]);
    expect(spent.explanation).toContain("Nothing more that can be bought moves this today. It moves again when your own numbers move.");
    const again = await adjudicateCoverage(INV({ ...blind, nextAcquisition: buy }), [ONE], TENANT, {}); // while something IS still buyable, the same topic stays an investigation and says what to buy
    expect([again.verdict, again.missing, again.acquisition]).toEqual(["research_needed", ["intent"], buy]); }); });
describe("a new page is earned by read evidence, and never by a guess about pages of your own", () => { // ── the page by page comparison: the one paid check, and the only road to a new page ──
  it("buys nothing for an investigation short of any cheaper check, and names the exact pages for the one that earned it", async () => {
    for (const [, over, owned] of GATES.filter((g) => g[3] !== "page_intersection")) expect(intersectionComparison(await adjudicateCoverage(INV(over), owned, TENANT, {}), INV(over), owned)).toBeNull();
    const earned = await adjudicateCoverage(INV(), [ONE], TENANT, {});     expect(intersectionComparison(earned, INV(), [ONE])).toEqual({ pages: [...WIN.map((w) => w.url), ONE_URL], intersection_mode: "union" });
    expect(intersectionComparison(earned, INV({ key: "inv_other" }), [ONE])).toBeNull(); const mine0 = await adjudicateCoverage(INV(), [OWNED("fixture-content.example/blog", { strongSignals: 0 })], TENANT, {}); expect([mine0.verdict, mine0.missing, earnedNewPage(mine0), mine0.explanation.includes('"rain barrel sizing" gets about 4,400 searches a month'), mine0.explanation.includes("3 of them were read")]).toEqual(["create_new", [], true, true, true]); // no page of mine is at risk, so the comparison is evidence rather than the door
    // A BODY I COULD NOT FETCH IS NOT A REASON TO WITHHOLD A COMPARISON OF ADDRESSES: three ranked publishers still earn it, and a page only ever CITED never counts as one of them.
    const blind = INV({ winners: WIN.map((w) => ({ ...w, extractState: "unreadable" as const, wordCount: null, fetchedAt: null })) });
    expect(intersectionComparison(await adjudicateCoverage(blind, [ONE], TENANT, {}), blind, [ONE])).toEqual({ pages: [...WIN.map((w) => w.url), ONE_URL], intersection_mode: "union" });
    const cited = INV({ winners: WIN.map((w) => ({ ...w, appearances: [{ ...w.appearances[0]!, kind: "ai_overview" as const, rank: null }] })) }); expect((await adjudicateCoverage(cited, [ONE], TENANT, {})).missing).toEqual(["winners"]); });
  it.each(["blocked", "capped", "waiting", "quarantined", "ambiguous", "failed"] as const)("cannot turn a comparison that came back %s into a new page, and says why in plain words", async (unavailable) => {
    const d = await adjudicateCoverage(INV(), [ONE], TENANT, { intersection: { unavailable } }); expect([d.verdict, d.missing, earnedNewPage(d)]).toEqual(["research_needed", ["page_intersection"], false]);
    expect(d.explanation).toContain("nothing is worth building"); expect(d.explanation).not.toMatch(/blocked|capped|quarantin|ambiguous|provider|task|status/i); }); });
const AT = "https://fixture-content.example"; // ── how a page is SERVED: the V1 technical catalogue, off the two stores that answer it ──
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
    expect(found.map((f) => f.kind)).toEqual(["non_200", "redirect_chain", "orphaned_page", "sitemap_omission", "broken_internal_link", "canonical_conflict", "duplicate_title", "robots_noindex", "canonical_missing", "duplicate_title", "missing_h1"]);
    expect(found.every((f) => f.url.startsWith(AT) && f.exactFix.length > 20 && f.evidence.length > 20)).toBe(true);
    // PIN (B, F2): a dead address with no replacement ASKS for one; a forward carries its destination as an address, so the live check reads where it was told to land.
    expect(found[0]!.exactFix).toBe("Tell me the address that replaced /gone and I will write you the forward. Until then I keep it out of your queue.");
    expect(found[0]!.redirectTo).toBeUndefined(); expect(found[1]!.evidence).toBe("/old sends people to /mid, and /mid sends them on again to /rain-barrels.");
    expect(found[1]!.redirectTo).toBe(`${AT}/rain-barrels`); // PIN (D, packet 19): a Ready technical change carries the EXACT edit, not a description of one
    expect(found.find((f) => f.kind === "missing_h1")!.exact).toBe("Rain Barrel Sizing Guide");
    const orphan = found.find((f) => f.kind === "orphaned_page")!; // PIN (D, packet 19): the orphan names a real source page, a real spot on it, and the words to type.
    expect(orphan.exact).toBe("Rain Barrel Sizing"); expect(orphan.exactFix).toContain("/rain-barrels"); expect(orphan.exactFix).toContain('reading "Rain Barrel Sizing"');
    expect(orphan.exactFix).toContain('in the part of it about "Rain Barrel Sizing Guide"'); // PIN (B, F8): the spot on the source page is named the way a person names it, never a bag of tokens.
    expect(JSON.stringify(found)).not.toMatch(/[–—]|SERP|crawl_state|http_status|discovered_via/);
    expect([readTechnicalFindings({}), readTechnicalFindings({ inventory: [row(`${AT}/a`)] })]).toEqual([[], []]); }); // NOTHING FIRES WITHOUT HELD EVIDENCE: no inventory and no capture is no findings, never a clean bill
  // PIN (D, packet 5 + 6): AN ACCESS STATE IS NOT A DEAD PAGE. Only the two answers that mean "the support is gone" produce a dead-page change; being turned away, rate-limited or unreachable says something about me, not about the page. A server error is a bad minute until a SECOND read on a LATER day agrees.
  it("calls a page dead only on 404, 410 or a twice-confirmed server error, and never on an access state", () => {
    const dead = (over: Record<string, unknown>) => readTechnicalFindings({ inventory: [row(`${AT}/`), row(`${AT}/x`, over)] }).filter((f) => f.kind === "non_200");
    for (const code of [401, 403, 429, 503]) { expect(dead({ http_status: code }), `${code}`).toEqual([]); expect(dead({ crawl_state: "blocked", http_status: code }), `robots ${code}`).toEqual([]); }
    expect([dead({ http_status: 404 }).length, dead({ http_status: 410 }).length, dead({ crawl_state: "gone", http_status: null }).length]).toEqual([1, 1, 1]);
    expect(dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z" })).toEqual([]); expect(dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z", status_reconfirmed_at: "2026-08-01T18:00:00Z" })).toEqual([]);
    const twice = dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z", status_reconfirmed_at: "2026-08-03T09:00:00Z" }); expect(twice[0]!.evidence).toContain("two different days"); });
  // PIN (D, packet 20): vague advice cannot enter Ready. Without the words to type there is no finding, and a copy fault with no copy behind it never reaches the operator as a change.
  it("writes no change it has not written the wording for, and says so instead", async () => { const noWords = readTechnicalFindings({
      inventory: [row(`${AT}/`), row(`${AT}/rain-barrels`), row(`${AT}/orphan`, { discovered_via: "nav" })],
      pages: [{ url: `${AT}/`, internal_links: [`${AT}/rain-barrels`] }, { url: `${AT}/rain-barrels`, title: "Rain Barrel Sizing Guide", internal_links: [] }] });
    expect(noWords.some((f) => f.kind === "orphaned_page")).toBe(false); expect(readTechnicalFindings({ pages: [{ url: `${AT}/p`, h1: "" }] }).some((f) => f.kind === "missing_h1")).toBe(false);
    const run = async (findings: TechnicalFinding[]) => (CORE_PRODUCERS.technical_indexability as Producer)(
      { finding: { cause: "technical_indexability", payload: { cause: "technical_indexability", findings } }, primary: "rain barrel sizing" } as unknown as ProducerCtx);
    const vague = readTechnicalFindings({ pages: [{ url: `${AT}/a`, title: "Rain Barrel Sizing Guide" }, { url: `${AT}/b`, title: "Rain Barrel Sizing Guide" }] }); expect(vague.map((f) => f.kind)).toEqual(["duplicate_title", "duplicate_title"]);
    const held = await run(vague); expect(held.components).toEqual([]);
    expect(held.refusal).toContain("an instruction is not handed over dressed as a change"); // and the same producer DOES hand over the ones whose exact wording it holds
    expect((await run(readTechnicalFindings({ pages: [{ url: `${AT}/a`, title: "Rain Barrel Sizing Guide", h1: "" }] }))).components.map((c) => c.after)).toEqual(["Rain Barrel Sizing Guide"]);
    // PIN (B, F2b): a dead address with nowhere to send people is held the same deterministic way, and the operator is asked the one question that turns it into work.
    const stranded = await run(readTechnicalFindings({ inventory: [row(`${AT}/`), row(`${AT}/gone`, { crawl_state: "gone", http_status: 404 })] })); expect(stranded.components).toEqual([]);
    expect(stranded.refusal).toContain("Name the address that replaced it");
    const forwarded = await run(readTechnicalFindings({ inventory: [row(`${AT}/`), row(`${AT}/gone`, { crawl_state: "gone", http_status: 404, redirects_to: `${AT}/rain-barrels` })] }));
    expect(forwarded.components.map((c) => [c.kind, c.redirectTo])).toEqual([["redirect", `${AT}/rain-barrels`]]); });
  it("turns each fault into a component that answers for itself, and holds the dangerous ones", () => {
    const parts = technicalComponents(readTechnicalFindings(SERVED), "rain barrel sizing").map((c) => ({ ...c, evidenceKeys: ["demand-exact"] }));
    expect([parts.every((c) => !!c.where && !!c.objective && !!c.mechanism && !!c.measurementPlan && c.before === null), [...new Set(dangerousComponents(parts).map((c) => c.kind))].sort()]).toEqual([true, ["canonical", "noindex", "redirect"]]);
    const held = validateProposal(prop({ riskLevel: "high", status: "needs_review", bundle: bundleOf(parts) }));
    expect([held.verdict, held.reasons.some((r) => r.includes("confirm it before you make the change"))]).toEqual(["needs_review", true]);
    expect(validateProposal(prop({ bundle: bundleOf(parts) })).verdict).toBe("rejected"); // the same levers filed as a low risk ready change
    const safe = parts.filter((c) => !dangerousComponents(parts).includes(c)); // and the ordinary ones pass the gate as the changes they are, copy and all
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
describe("the complete change universe answers for itself", () => { it("round-trips every kind through the validator, and refuses one that cannot show its work", () => { for (const kind of ALL_KINDS) { const dangerous = DANGEROUS_COMPONENT_KINDS.has(kind);
      const c = comp({ kind, risk: dangerous ? "dangerous" : "safe", ...(needsSourcePack(comp({ kind })) ? { sourcePack: { sourceRequirements: ["Cite the county rule page."], factRequirements: ["Check the 2026 limit."] } } : {}) });
      const v = validateProposal(prop({ ...(dangerous ? { riskLevel: "high" as const, status: "needs_review" as const } : {}), bundle: bundleOf([c]) }));
      expect(v.verdict).not.toBe("rejected"); // every kind in the union is a shape this validator understands
      if (dangerous) { expect(v.verdict).toBe("needs_review"); expect(v.reasons.join(" ")).toContain("confirm it before you make the change"); }
    }
    const blind = validateProposal(prop({ bundle: bundleOf([comp({ kind: "section_add", evidenceKeys: [] })]) })); // no component without evidence, no fact without sources, and no new kind without its four answers
    expect([blind.verdict, blind.reasons.some((r) => r.includes("cannot show you anything behind"))]).toEqual(["rejected", true]); const unsourced = validateProposal(prop({ bundle: bundleOf([comp({ kind: "factual_correction" })]) }));
    expect([unsourced.verdict, unsourced.reasons.some((r) => r.includes("carries no sources to check it against"))]).toEqual(["rejected", true]);
    const mute = validateProposal(prop({ bundle: bundleOf([comp({ kind: "restructure", where: undefined, mechanism: undefined })]) }));
    expect([mute.verdict, mute.reasons.some((r) => r.includes("where on the page it goes, why it fixes what I diagnosed"))]).toEqual(["rejected", true]);
    const sneaky = validateProposal(prop({ bundle: bundleOf([comp({ kind: "redirect", risk: "safe" })]) })); // a lever that moves the page and is NOT marked as one is a mislabelled change, never a safe paste
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
    expect(validateProposal(prop({ bundle: bundleOf([comp({ kind: "section", after: "Add a short section on roof area, with the gallons each one collects per storm." })]) })).verdict).not.toBe("rejected"); });
  it("keeps a legal or medical correction dangerous however small the edit reads", () => {
    const legal = (risk: BundleComponent["risk"]): BundleComponent => comp({ kind: "factual_correction", risk, after: "Under the county statute the permit is required above 60 gallons.",
      sourcePack: { sourceRequirements: ["Cite the county statute."], factRequirements: ["Confirm the 60 gallon threshold."] } });
    expect(dangerousComponents([legal("safe")])).toHaveLength(1); // a statute is dangerous whatever the row claims
    expect(validateProposal(prop({ bundle: bundleOf([legal("safe")]) })).verdict).toBe("rejected"); // an unmarked one is a MISLABELLED change, and a mislabelled change is the one that gets pasted without a second look
    const held = validateProposal(prop({ riskLevel: "high", status: "needs_review", bundle: bundleOf([legal("dangerous")]) }));
    expect([held.verdict, held.reasons.some((r) => r.includes("confirm it before you make the change"))]).toEqual(["needs_review", true]); }); });
describe("one score orders every kind of change, and says why", () => { it("puts the lever the evidence named above a bigger one it did not, on the same page", () => {
    const named = prop({ id: "title-fix", impactScore: 120, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "title" })]) });
    const bigger = prop({ id: "section-add", impactScore: 2000, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "section_add" })]) });
    const ranked = rankProposals([bigger, named]); expect(ranked.map((p) => p.id)).toEqual(["title-fix", "section-add"]); expect([factorOf(ranked[0]!, "causeFit"), factorOf(ranked[1]!, "causeFit")]).toEqual([25, -25]);
    expect(ranked[0]!.whyRankedAboveNext).toContain("this change works on the line a searcher reads"); expect(ranked[0]!.whyRankedAboveNext).not.toMatch(/[—–]|experiment|control|baseline|treatment|SERP/i);
    expect(ranked[1]!.whyRankedAboveNext).toBeUndefined(); // nothing sits below the last one
    expect([factorOf(ranked[0]!, "confounding"), factorOf(ranked[1]!, "confounding")]).toEqual([-5, -5]); // both changes land on the same page, so each one discounts the other for confounding
    // a cause NOTHING on the page can fix rewards no lever and punishes none either: those changes rank on everything else
    for (const cause of ["demand_decline", "measuring_change"] as const) { const [only] = rankProposals([prop({ diagnosisCause: cause, bundle: bundleOf([comp({ kind: "title" })]) })]);
      expect(factorOf(only!, "causeFit")).toBe(0); expect(only!.rankingReceipt!.factors.find((f) => f.name === "causeFit")!.input).toBe("nothing you can write on the page fixes the cause named here");
    } });
  // DRAFT CAPACITY FOLLOWS THIS RANKING, NEVER ARRIVAL ORDER (operator, 2026-08-21): produce-proposals ranks the eligible cards through THIS function before the bounded drafter walks them, so with
  it("puts the sixth-arriving highest-impact card first, so the one drafting slot goes to it", () => { // capacity for one draft, the highest-impact opportunity gets it wherever the producers happened to emit it.
    const six = Array.from({ length: 6 }, (_, i) => prop({ id: `card-${i}`, pagePath: `/p${i}`, impactScore: i === 5 ? 900 : 10 + i })); expect(rankProposals(six)[0]!.id).toBe("card-5");
  });
  it("puts what is riding on the change above how long it takes, and never lets a wrong lever ride a recovery", () => {
    // A page proven to be losing 191 clicks against a description errand on a page shown twice: value leads, and the whole of the errand's speed is worth less than what the losing page has riding on it.
    const losing = prop({ id: "losing", pagePath: "/persian-male-names", impactScore: 191, estimatedEffortMinutes: 30 });
    const errand = prop({ id: "errand", pagePath: "/tiny", impactScore: null, demandImpressions90d: 2, estimatedEffortMinutes: 1 }); const ranked = rankProposals([errand, losing]); expect(ranked.map((p) => p.id)).toEqual(["losing", "errand"]);
    expect([factorOf(ranked[0]!, "visibility"), factorOf(ranked[1]!, "effort")]).toEqual([6.49, 3.83]); // 191 recoverable clicks at medium confidence: 7.64 counted at 85 percent. The discount is named, never silent.
    expect(factorOf(ranked[0]!, "visibility")).toBeGreaterThan(factorOf(ranked[1]!, "effort"));
    // THE RECOVERY BELONGS TO THE CAUSE: a lever that does not touch the cause forfeits the figure outright, so a bigger page can never buy a wrong change past the right one however wide the visibility band gets.
    const wrong = rankProposals([prop({ diagnosisCause: "ctr_snippet", impactScore: 2000, bundle: bundleOf([comp({ kind: "section_add" })]) })]);
    expect([factorOf(wrong[0]!, "visibility"), wrong[0]!.rankingReceipt!.directional]).toEqual([0, true]);
    expect(factorOf(rankProposals([prop({ diagnosisCause: "ctr_snippet", impactScore: 2000, bundle: bundleOf([comp({ kind: "title" })]) })])[0]!, "visibility")).toBe(68); });
  // THE CARD THAT SHIPPED AS READY ON 2026-08-15: its own ranking receipt read "this change does not touch two of your own pages splitting one search", it rewrote the title of ONE of the two pages Google serves for "persian girl names" and left the other exactly as it was, and it sat in the paste-ready lane with a Copy button on it. A RANKING PENALTY IS AN ORDER, NEVER A PERMISSION. A split is settled on every page it names or it is not settled, and a page left alone is a page that got no words whatever reason was recorded beside it.
  it("never reads as ready while it leaves its own diagnosed cause unsettled", () => {
    const NAMED = ["iranopedia.com/persian-female-first-names", "iranopedia.com/persian-names"];
    const split = (pages: string[]) => unsettledCause(prop({ pagePath: "/persian-female-first-names", primaryQuery: "persian girl names", diagnosisCause: "cannibalization", causeFinding: { cause: "cannibalization", action: null, evidenceKeys: [], explanation: "2 of your own pages come up for it.", competingExplanations: [], notConsidered: [], falsifier: "the split closes and one page keeps the search", payload: { cause: "cannibalization", competingPaths: NAMED, comparison: [], survivor: null } }, bundle: bundleOf(pages.map((pg) => comp({ kind: "title", page: pg, after: `A line only ${pg} could carry.` }))) }));
    expect([split(["/persian-female-first-names"])?.includes("(/persian-names)"), split(["/persian-female-first-names", "/persian-names"]), unsettledCause(prop({ diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "section_add" })]) }))?.slice(0, 20), unsettledCause(prop({}))])
      .toEqual([true, null, "This change works on", null]); });
  // IF BEACON HAS NOT FINISHED THE DELIVERABLE, IT IS NOT A CHANGE. One boundary, read off the deliverable itself and never off the sentence an operator reads. NO VERB LIST: a producer that hands over a brief says so in a typed field as it mints the card, so ordinary imperative page copy ("Cover the pot with a lid") is finished copy and stays one, and a brief is held by the fact rather than by its spelling.
  it("calls a deliverable finished only when it is the work, by type", () => { const gaps = (after: string, field: "title" | "meta" | "h1" | "section" = "title", over: Partial<ChangeProposal> = {}) => deliverableGaps(prop({ recommendedChange: { kind: "existing_edit", field, before: null, after }, ...over }))[0];
    const WORDS = "Rain barrels for a 1,200 square foot roof hold 50 gallons.", SAYS = "it describes the work instead of being it", OUT = ["Roof area", "Rainfall", "Overflow"];
    const page = (cs: BundleComponent[]) => deliverableGaps(prop({ kind: "new_page", pagePath: null, ...(cs.length ? { bundle: bundleOf(cs) } : {}), recommendedChange: { kind: "new_page", proposedTitle: "Rain barrel sizing", metaDescription: "How to size a rain barrel for your roof.", openingAnswer: WORDS, outline: OUT, faqQuestions: [], schemaTypes: [] } }))[0];
    // A TYPED BRIEF, A BLANK and copy that says it is unwritten are unfinished; a real title is a Change. New copy owes the place it lands, and a NEW PAGE IS NEVER TITLE ONLY. The typed fact round trips.
    const owed = prop({ status: "needs_review", researchOnly: true });
    expect([deliverableGaps(owed)[0], gaps("Write a description of about 150 characters.", "meta", { researchOnly: true }), gaps("Rain barrels hold [NUMBER] gallons."), gaps("The exact copy has not been drafted."), gaps(TITLE_AFTER), gaps(WORDS, "section"),
      gaps(WORDS, "section", { bundle: bundleOf([comp({ kind: "section_add", where: "under the sizing heading" })]) }), page([]), page(OUT.map((h) => comp({ kind: "section_add", label: h, after: `${h}: a roof sheds 750 gallons in an inch of rain.` }))),
      rankProposals([owed])[0]!.rankingReceipt!.factors.find((f) => f.name === "readiness")!.input, deserializeChangeProposal(serializeChangeProposal(owed))!.researchOnly])
      .toEqual(["nothing has been written for it yet", "nothing has been written for it yet", SAYS, SAYS, undefined, "where it goes on the page is not named", undefined, "3 of its 3 sections have no copy written", undefined,
        "this is research still owed, not an edit waiting on you", true]);
    // EVERY PAGE THE DIAGNOSIS NAMED, NOT EVERY PAGE THAT SURVIVED IT. A split across three addresses that came back with copy on one used to answer "complete", because the component list is the only record a page was ever named and a page whose drafting refused simply vanished from it. The producer's own verdict ledger is the roll call now: a page it says it is differentiating owes written copy, and a page it decided to leave alone owes the reason.
    const spanning = (dispositions: { page: string; verdict: "differentiate" | "keep_as_is"; because: string }[]) => deliverableGaps(prop({ bundle: { ...bundleOf([comp({ kind: "title", page: "/a", after: "A line only /a could carry." })]), dispositions } }))[0];
    expect([spanning([{ page: "/a", verdict: "differentiate", because: "it has to say what it alone covers" }, { page: "/b", verdict: "differentiate", because: "it has to say what it alone covers" }]),
      spanning([{ page: "/a", verdict: "differentiate", because: "it has to say what it alone covers" }, { page: "/b", verdict: "keep_as_is", because: "nothing came back for it that would not narrow it off its own subject" }]), spanning([{ page: "/a", verdict: "differentiate", because: "x" }, { page: "/b", verdict: "keep_as_is", because: "no" }])])
      .toEqual(["1 of the pages it changes have no copy written", undefined, "1 of the pages it names give no reason for being left alone"]);
    // ORDINARY IMPERATIVE PAGE COPY IS FINISHED COPY. A recipe step, a visa step and a description opening on a production verb were all refused by the verb list this boundary no longer carries.
    const g = (after: string, field: "title" | "meta" | "h1" | "section" = "section") => gaps(after, field, { bundle: bundleOf([comp({ kind: "section_add", where: "under the sizing heading" })]) }); expect([g("Cover the pot with a lid so it steams for ten minutes, then fluff the rice with a fork."), g("Fill in the form online, then pay the fee at a designated bank branch."), g("Include a copy of your passport photo page when you apply."), g("Link building for a Persian culture site works best through museums and university pages.", "meta"), g("Add Saffron to Your Rice: A Persian Cook's Guide", "title")])
      .toEqual(Array(5).fill(undefined)); });
  // FINISHED WORK SURVIVES A PASS THAT DID NOT REACH IT. Drafting is capped per pass, so a card past the cap comes back as the BRIEF it started as; writing that over banked copy took the live queue from 6 finished cards to 4 to 3 across three consecutive passes on 2026-08-15, destroying the biggest description on the site. Real stored shapes: the brief the producer re-mints, and the description an earlier pass banked.
  it("a pass that did not re-draft a card never undoes it", () => { const banked = prop({ id: "t::/iran-flags/achaemenid-empire-flag::existing_edit::missing_description", basis: "b8", status: "needs_review", estimatedEffortMinutes: 3, limitations: ["Read off the last stored copy of each page."], operatorSteps: ["Paste the description above, exactly as written"],
      // THE PROVENANCE IS PART OF THE BANKED WORK. All three ready cards on the live account carried `claims: null` because this branch preserved the copy and dropped what stood behind it, so nothing on the row could ever be re-checked. Banked copy survives WITH its claims, and copy that cannot show what supports it is redrafted rather than served on. AND THE WORDS BEHIND THE ID, banked beside them: an id resolves only inside the pass that drafted the copy, so banked words survive only while every id their claims name carries its own quoted fact.
      claims: [{ text: "The Achaemenid Empire ran from 550 to 330 BCE.", supportedBy: ["card-1"] }], supportFacts: [{ id: "card-1", fact: "23 pages share one templated description" }], evidence: { query: "achaemenid flag", hints: ["23 pages share one templated description"], evidenceRefCount: 3 },
      recommendedChange: { kind: "existing_edit", field: "meta", before: "Learn about the History of Iran Flags and the Achaemenid Empire Flag (550-330 BCE).", after: "Achaemenid Empire Flag (550 - 330 BCE) in Persian Flags History: symbolism, role, changes and origins. Explore more." } });
    const brief = prop({ ...banked, researchOnly: true, estimatedEffortMinutes: 15, limitations: [], operatorSteps: undefined, evidence: { ...banked.evidence, evidenceRefCount: 9 },
      recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Write a description of about 150 characters that says what only this page answers." } });
    // IDENTITY IS MATERIAL, NOT PROVENANCE (operator, 2026-08-22): a basis stamp, a reworded hint or a new agreeing observation preserves finished words; only the page moving under them destroys, with the stale-basis demotion and the
    const kept = preferFinished(brief, banked), moved = preferFinished({ ...brief, basis: "b9" }, banked); // banked-copy re-reads still guarding truth on their own doors.
    const recrawled = preferFinished({ ...brief, copyStamp: "a page that reads differently now" }, { ...banked, copyStamp: "the page as it read when this line was written" });
    expect((recrawled.recommendedChange as { after: string }).after.slice(0, 5)).toBe("Write");
    const fresher = preferFinished(prop({ ...banked, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "A newer finished line about the Achaemenid flag and what it meant." } }), banked);
    expect([deliverableGaps(kept), kept.recommendedChange, kept.researchOnly, kept.estimatedEffortMinutes, kept.limitations, kept.evidence.evidenceRefCount, kept.claims,
      moved.researchOnly, (moved.recommendedChange as { after: string }).after.slice(0, 5), (fresher.recommendedChange as { after: string }).after.slice(0, 7), preferFinished(brief, null).researchOnly,
      // UNSUPPORTED BANKED COPY IS NOT FINISHED WORK: a row with no claims, or claims naming facts nobody banked, is redrafted rather than served on. The banked facts ride the ROW, so an incoming pass's own hint list moving says nothing about them.
      preferFinished(brief, { ...banked, claims: undefined }).researchOnly, preferFinished({ ...brief, evidence: { ...brief.evidence, hints: [] } }, banked).researchOnly,
      kept.supportFacts, preferFinished(brief, { ...banked, supportFacts: undefined }).researchOnly])
      .toEqual([[], banked.recommendedChange, false, 3, banked.limitations, 9, banked.claims, false, "Achae", "A newer", true, true, false, banked.supportFacts, true]);
    // AND A SECOND GENERATION OF THE SAME WORK DOES NOT REPLACE THE ONE THAT ALREADY PASSED. `fresher` above is the rule for work still open; once a row is READY under a settled identity the model has had its say. Five inspected deliverables persisted as three because later passes re-drafted them and saved whatever came back, once storing "Goodbye: goodbye." over a finished answer.
    const same = { workKey: "wk-1", copyStamp: "the page as it read when this line was written", status: "ready" as const };
    const settled = prop({ ...banked, ...same }), worse = prop({ ...banked, ...same, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Goodbye: goodbye. Please: please." } });
    // Same work, same page, a finished predecessor: the banked words stand. A page that has moved under it is different work, so the new copy lands.
    expect([(preferFinished(worse, settled).recommendedChange as { after: string }).after,
      (preferFinished({ ...worse, copyStamp: "the page reads differently now" }, settled).recommendedChange as { after: string }).after])
      .toEqual([(banked.recommendedChange as { after: string }).after, "Goodbye: goodbye. Please: please."]); });
  // THE CLOSING "READ THIS PAGE" LINE, on the two descriptions that carried one into the live queue on 2026-08-15. A description whose last sentence tells the reader to read the page carries filler where a fact belongs, which is the description equivalent of "click here". Trimmed where the field still fills without it, sent back for ONE redraft where it does not, and NEITHER card is special-cased: the achaemenid line loses too much (104 characters left, under the 110 a description takes) and the accessories line does not (142 left). LIST-SHAPED COPY (review, 2026-08-22): a CTA that is a whole last LINE is dropped whole, and the " - " separating a phrase from its meaning on an honest list item is never a cut point on multi-line copy.
  it("drops a CTA last line from list-shaped copy and never amputates a phrase-meaning item", () => {
    const LIST = "Persian greetings people actually use every day, from the first hello to the goodbye at the door:\nSalam - hello, the everyday greeting you can use with anyone at any time of day.\nKhodahafez - goodbye, literally may God protect you, said when parting.\nMerci - thank you, borrowed from French and completely common in Iran.";
    expect(withoutCta(`${LIST}\nSee the page for more phrases.`, "section")).toBe(LIST); expect(withoutCta(LIST, "section")).toBe(LIST);
  });
  it("takes the call to action off the end of a description, or sends it back for one redraft", () => {
    const A = "Achaemenid Empire Flag (550-330 BCE): its symbolism, origins, role and changes in Persian flags history. Read this page for the focused summary.", B = "Persian Accessories: showcase heritage with hats, patterned phone cases and timeless designs that blend Iranian tradition with modern fashion. Browse unique pieces.";
    const FACT = "Persian Accessories: hats, phone cases and designs inspired by Iranian culture, made for everyday wear and shipped from the shop.";
    const SEMI = "Iranopedia x TavanDesigns Persian Shoes - features Love \"Eshgh\" and Nothingness \"Heech\" sneakers with Persian calligraphy; view designs and shop details.", DASH = "Achaemenid Empire Flag (550-330 BCE): concise history, symbolism and origins featured on this page - click to read the focused account.";
    expect([withoutCta(A, "meta"), withoutCta(B, "meta"), withoutCta(FACT, "meta"), withoutCta(SEMI, "meta"), withoutCta(DASH, "meta")])
      // THE CUT LEAVES A SENTENCE, NOT A STUB: the last one shipped ending on the semicolon its call to action had been joined on with.
      .toEqual([null, "Persian Accessories: showcase heritage with hats, patterned phone cases and timeless designs that blend Iranian tradition with modern fashion.", FACT, "Iranopedia x TavanDesigns Persian Shoes - features Love \"Eshgh\" and Nothingness \"Heech\" sneakers with Persian calligraphy.", null]); });
  // THE MATERIALLY FALSE CARD THAT REACHED THE LIVE QUEUE ON 2026-08-15: every digit was lifted from the page and the sentence was still a lie. The stored body says INTERNATIONAL delivery takes 7-21 days DEPENDING on location while the page offers free USA shipping, and the copy sold that window as the shipping time. It evaded the gate twice on punctuation alone: the body writes an en dash and the drafter wrote a hyphen, then spaced hyphens. Both spellings of the same figure are pinned here, with the real stored sentence.
  it("refuses a figure that walked away from the qualifier its own sentence carried", () => { const body = "Free USA shipping on all orders, with delivery in 2-6 business days. International shipping is available worldwide, with delivery usually between 7\u201321 business days depending on location.";
    const pk = { targetUrl: "https://www.iranopedia.com/p", title: "T", h1: "H", metaDescription: null, bodyText: body, headings: [], evidence: { "page-copy-1": body }, trackedQuestion: "Q", ownedPaths: ["/p"], bannedTerms: [], demand: { preserve: [], vocabulary: [] } };
    const meta = (after: string) => deliverableFailures({ targetUrl: "https://www.iranopedia.com/p", actionType: "meta", naturalHeading: null, beforeText: null, placementAnchor: "the description", evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 1, measurementTarget: "ctr", claims: [{ text: "a claim", supportedBy: ["page-copy-1"] }], finalCopy: after } as never, pk as never);
    const SAYS = "the figure's own sentence says international, and the copy drops it";
    expect([meta("Iran Shir o Khorshid Vertical Stripe Shirt - lightweight polyester jersey with Lion & Sun emblem; ships in 7-21 business days. Free USA shipping.").includes(SAYS),
      meta("Iran Shir o Khorshid vertical stripe jersey with green, white, red panel and Lion & Sun emblem; loose athletic fit. Ships in 7 - 21 business days - see details.").includes(SAYS),
      meta("Iran Shir o Khorshid Vertical Stripe Shirt - runs true to size, relaxed fit. Free USA shipping in 2-6 business days; see sizing and details.").includes(SAYS)])
      .toEqual([true, true, false]); });
  // THE SEARCHERS' OWN WORDS ARE FIRST-CLASS EVIDENCE, and the words a page is PAID for are load-bearing. Two live destructions pinned: a title rewrite proposed "Shiraz Population" for a city page and stripped the words its own searches earn clicks on, and the Farsi ban refused the exact word a page's real audience searches with. Demand decides both: a preserved query's tokens may not be dropped without a reason, and a banned term a stored search actually carries is that page's own vocabulary.
  it("never drops a word the page earns clicks on, and demand vocabulary overrides the banned list", () => {
    const body = "Persian boy names with meanings, a list of classic and modern Iranian names for boys.";
    const pk = (demand: { preserve: string[]; vocabulary: string[] }, bannedTerms: string[] = [], fact = 'people search "persian boy names list" 4,100 times in 90 days') => ({
      targetUrl: "https://www.iranopedia.com/persian-male-first-names", title: "Persian Boy Names List | Iranopedia", h1: "Persian Boy Names",
      metaDescription: null, bodyText: body, headings: [], evidence: { "page-copy-1": body, "demand-1": fact },
      trackedQuestion: "persian boy names", ownedPaths: ["/persian-male-first-names"], bannedTerms, demand });
    const title = (finalCopy: string, P: unknown) => deliverableFailures({ targetUrl: "https://www.iranopedia.com/persian-male-first-names",
      actionType: "title", naturalHeading: null, beforeText: "Persian Boy Names List | Iranopedia", placementAnchor: "the page title",
      evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 1, measurementTarget: "clicks",
      claims: [{ text: "Persian boy names list with meanings", supportedBy: ["page-copy-1", "demand-1"] }], finalCopy } as never, P as never);
    const DROP = 'it drops "list", which this page earns clicks on, and names no supported reason to';
    expect([title("Persian Boy Names with Meanings | Iranopedia", pk({ preserve: ["persian boy names list"], vocabulary: [] })).includes(DROP),
      title("Persian Boy Names List with Meanings | Iranopedia", pk({ preserve: ["persian boy names list"], vocabulary: [] })).includes(DROP),
      title("Persian Boy Names with Meanings | Iranopedia", pk({ preserve: [], vocabulary: [] })).includes(DROP)]).toEqual([true, false, false]);
    const farsi = (demand: string[]) => deliverableFailures({ targetUrl: "https://www.iranopedia.com/persian-male-first-names", // The Farsi ruling: banned everywhere EXCEPT where a real stored search for this page carries it.
      actionType: "meta", naturalHeading: null, beforeText: null, placementAnchor: "the description", evidenceIdsUsed: ["page-copy-1"],
      uncertaintyOrOmitted: [], implementationMinutes: 1, measurementTarget: "clicks",
      claims: [{ text: "a list of classic and modern Iranian names for boys in Farsi", supportedBy: ["page-copy-1", "demand-1"] }],
      finalCopy: "Persian boy names with meanings: classic and modern Iranian names for boys in Farsi." } as never,
    pk({ preserve: [], vocabulary: demand }, ["Farsi"], 'people search "persian boy names in farsi" 480 times in 90 days') as never);
    expect([farsi(["persian boy names in farsi"]).some((r) => r.toLowerCase().includes("farsi")),
      farsi([]).some((r) => r.toLowerCase().includes("farsi"))]).toEqual([false, true]); });
  // A BLANK CAPTURE AUTHORIZES NOTHING. persian-last-names holds 194,554 lifetime impressions and a raw fetch reads zero words off its javascript body; until a rendered read lands, no body-dependent
  it("an unread page buys no draft, while a read page on the same pass still leaves with work", async () => { // copy may be bought or written for it. A page that WAS read keeps earning its editor attention on the same pass.
    const page = (path: string, wordCount: number) => ({ url: `https://www.iranopedia.com${path}`, content: { wordCount }, search: null });
    const snapshot = { ownedPages: [page("/persian-last-names", 0), page("/thin-guide", 120)], research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
    const card = (path: string) => ({ ...prop({ id: `${TENANT}::${path}::existing_edit::thin_page`, pagePath: path, pageUrl: `https://www.iranopedia.com${path}`,
      changeFamily: "section", status: "needs_review" as const, researchOnly: true as const, limitations: [],
      recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Add 200 to 300 words that answer its main question." } }) });
    const out = await applyDraftedCopy([card("/persian-last-names"), card("/thin-guide")], { tenantId: TENANT, snapshot: snapshot as never, now: NOW, attempts: { left: 0 } });
    expect([out[0]!.researchOnly, out[0]!.limitations.length, out[1]!.limitations.length]).toEqual([true, 0, 1]); }); // The unread page's card comes back UNTOUCHED, still research: not drafted, not decorated, not promoted.
  /** THE PRICE AND THE LOOP ARE ONE CONTRACT, AND THE FINAL REVIEWER IS PART OF THE PRICE (Codex, 2026-08-23). A deliverable is a draft and its judge, twice more if refused, and ONE mandatory adversarial read of the survivor: three rounds of two, plus one. At six it could win on the second retry and then be unable to afford the review that promotes it, and hold the change again with nothing on the receipt to say why. */
  it("prices a deliverable at exactly what its rounds and its final review cost, and never lets the two drift apart", () => {
    expect([DRAFT_BUDGET.DELIVERABLE_CALLS, (1 + DRAFT_BUDGET.RETRIES) * 2]).toEqual([6, 6]); // one round is a draft and its ONE evaluation, and the LAST evaluation is the promotion decision: no separate final-review unit exists to starve
    expect(DRAFT_BUDGET.POLICY).toMatch(new RegExp(`^w\\d+r${DRAFT_BUDGET.RETRIES}c${DRAFT_BUDGET.DELIVERABLE_CALLS}$`)); });  // and the WRITER version rides in front, so a material writer change reopens what the old writer settled // and the policy the day's memory is keyed on moves with them, so a page written off under the old price is asked again under the new one
  /** AN EDITOR REFUSAL IS NEVER MUTE, AND THE TWO KINDS ARE OPPOSITE FACTS (Codex, 2026-08-23). Beacon running out of its OWN allowance part-way through a deliverable settles nothing: the copy may be perfect and nobody finished reading it, so the page stays owed. One of Beacon's own gates reading the words and refusing them IS settled, in that gate's sentence. Filing both as a reasonless "blocked" wrote pages off for a whole day over Beacon's accounting, and told nobody which had happened. */
  it("says why an editor refusal happened: running out of its own allowance stays owed, a gate that read the copy is settled and quotes itself", async () => {
    const page = { url: "https://www.iranopedia.com/nowruz", content: { wordCount: 800, title: "Nowruz", h1: "Nowruz", outline: [] }, search: null };
    const snapshot = { ownedPages: [page], research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
    const card = () => prop({ id: `${TENANT}::/nowruz::existing_edit::missing_description`, pagePath: "/nowruz", pageUrl: page.url, changeFamily: "meta", status: "needs_review" as const,
      researchOnly: true as const, limitations: [], recommendedChange: { kind: "existing_edit" as const, field: "meta" as const, before: null, after: "Write a description of about 150 characters." } });
    const meta: CompleteFn = async () => ({ value: { field: "meta", before: null, after: "Nowruz is the Persian new year, marked at the spring equinox.", rationale: "The page carries no description.", ...TAIL } }), notes: Array<[string, string, string]> = []; const purse = (calls: number) => DRAFT_BUDGET.plan({ jobs: [{ key: DRAFT_BUDGET.keyOf({ pagePath: "/nowruz" }), family: "editor", impact: 9, calls }], candidates: 1, calls });
    const run = (calls: number) => applyDraftedCopy([card()], { tenantId: TENANT, snapshot: snapshot as never, now: NOW, complete: meta, budget: purse(calls), unsettled: new Set<string>(),
      refusals: new Map<string, string>(), note: (k: string, o: string, why?: string) => { notes.push([k, o, why ?? ""]); } } as never);
    await run(2); await run(DRAFT_BUDGET.DELIVERABLE_CALLS); // a round's worth and no more, then a whole deliverable's worth so the gates get to read the copy and refuse it
    // AND A CANON HOLD IS A VERDICT, NEVER A MUTE BLOCK (Codex, 2026-08-23, from /funny-farsi-phrases live): `needs_review` means the copy was READ against today's evidence and held, so it is settled, it says which quality status held it, and the adversarial reviewer is never asked about copy the canon already stopped.
    const reviewed: string[] = []; await applyDraftedCopy([card()], { tenantId: TENANT, snapshot: snapshot as never, now: NOW, complete: meta, budget: purse(DRAFT_BUDGET.DELIVERABLE_CALLS),
      unsettled: new Set<string>(), refusals: new Map<string, string>(), note: (k: string, o: string, why?: string) => { notes.push([k, o, why ?? ""]); },
      reviewer: async () => (reviewed.push("asked"), { notes: "n" }) as never } as never);
    expect([notes.filter(([, o, why]) => o === "deterministic_refusal" && why.length > 0).length > 0, reviewed]).toEqual([true, []]); // it named what held it, and nobody paid a reviewer to re-read copy the canon had already stopped
    const ranOut = notes.find(([, , why]) => why.includes("spent its whole attempt budget")), gate = notes.find(([, , why]) => why !== "" && !why.includes("attempt budget"));
    expect([ranOut?.[1] ?? "none", gate?.[1], (gate?.[2] ?? "").length > 0]).toEqual(["retryable_blocked", "deterministic_refusal", true]); }); // Beacon's own accounting is not a verdict on the words; a gate that READ them is settled and says what it saw
  /** THE WRITER IS AN EVIDENCE-TO-COPY COMPILER, NOT AN AUTHOR (Codex, 2026-08-23, from the live 01:30Z receipts). Placement is code's, not the model's; a category word is a claim; a brief is an assignment, never source material; a retry names the exact words to remove. The gates are untouched: what changed is that the writer is finally pointed at them, and my first fixture here was refused by those same gates for a summary sentence of its own until its copy was exactly its claims, which is the discipline working. */
  describe("grounded writing: mechanical placement, evidence-first copy, corrective retries", () => {
    const P1 = "Jeegareto bokhoram is a Persian expression of affection that literally means I want to eat your liver, said warmly to loved ones and close family members across generations of Persian speakers.", P2 = "Moosh bokhoradet is a playful Persian phrase meaning may a mouse eat you, used for something small and cute, and it is one of the most common terms of endearment parents say to children.", P3 = "Pedar sag literally means dog father and is used as a playful insult between close friends rather than a serious offence, usually said with a smile in casual conversation.";
    const BODY = { url: "https://www.iranopedia.com/funny-farsi-phrases", title: "Funny Farsi Phrases" as string | null, h1: "Funny Farsi Phrases" as string | null, metaDescription: null, vocabulary: "", headings: ["Playful Persian expressions"], passages: ["Playful Persian expressions", P1, P2, P3] }; // a real crawl streams the heading INTO the body, which is what makes a section cuttable
    const GOOD = { field: "answer_block", before: null, rationale: "grounded", ...TAIL, after: `${P1}\n${P2}\n${P3}`, naturalHeading: "Playful expressions and their meanings",
      claims: [{ text: P1, supportedBy: ["page-copy-1"] }, { text: P2, supportedBy: ["page-copy-2"] }, { text: P3, supportedBy: ["page-copy-3"] }] };
    const OKJ = { pageFit: true, claimsEntailed: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true };
    const drive = (value: Record<string, unknown>, body = BODY) => draftFieldForPage({ field: "answer_block" as const, body: body as never, query: "funny persian phrases meanings",
      brief: "Add a section that answers the question. Place it directly under the heading and answer directly.", evidenceHints: [], ownedPaths: ["/funny-farsi-phrases"], minutes: 5 },
      { tenantId: TENANT, now: NOW, complete: async () => ({ value }), judge: async () => OKJ as never });
    it("assigns the placement itself, ignores the anchor the model invented, and keeps the brief's workflow words out of the copy", async () => {
      const d = await drive({ ...GOOD, placementAnchor: "Ancient rooftop of the flag hall" }); expect([d?.anchor, (d?.after ?? "x").toLowerCase().includes("directly")]).toEqual(["Funny Farsi Phrases", false]); }); // the invented place that failed live on /iran-flags/achaemenid-empire-flag
    it("still refuses, and never invents, when the page's stored copy carries no clean heading", async () =>
      expect(await drive({ ...GOOD, placementAnchor: "anywhere" }, { ...BODY, title: null, h1: null, headings: [] })).toBeNull());
    /** A NAME NOTHING ON FILE HAS HEARD OF IS REFUSED, AND THE RETRY IS TOLD THE EXACT WORD (Codex, 2026-08-23). This replaces a word-containment gate that refused ordinary prose; what is checked now is the thing that actually reaches a reader as a false fact. THE EVALUATOR'S OWN SENTENCE IS THE FEEDBACK (Codex, 2026-08-23): the notes name the single worst defect, and they were being thrown away, so every retry heard only checkbox labels. */
    it("feeds the evaluator's exact objection into the retry, in its own words", async () => {
      const asked: string[] = []; let judged = 0;
      const good2 = { ...GOOD, claims: [{ text: P1, supportedBy: ["page-heading-1"] }, { text: P2, supportedBy: ["page-heading-1"] }, { text: P3, supportedBy: ["page-heading-1"] }] };
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, primaryQuery: "funny persian phrases",
        limitations: [], evidence: { query: "funny persian phrases", hints: [P1, P2, P3], evidenceRefCount: 3 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Add a section that answers the question." } });
      const snap = { ownedPages: [{ url: BODY.url, content: { wordCount: 400, title: BODY.title, h1: BODY.h1, outline: BODY.headings }, search: null }], research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
      await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, reviewer: async () => ({ notes: "fine" }) as never,
        judge: async () => ((judged += 1) === 1
          ? ({ ...OKJ, usefulAndNatural: false, notes: "the opening sentence answers a different question than the reader asked" } as never)
          : (OKJ as never)),
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async ({ system, user }: { system: string; user: string }) => (asked.push(`${system} ${user}`), { value: good2 }) } as never);
      expect(asked.length).toBeGreaterThan(1); // the first verdict refused, so the writer was asked again
      expect(asked.at(-1)).toContain("the evaluator's exact objection: the opening sentence answers a different question than the reader asked"); });
    /** A THIN PAGE IS A REASON TO ACQUIRE FACTS, NOT TO ABANDON THE CHANGE (Codex, 2026-08-23). A material floor
     *  stood here for one dispatch and refused /funny-farsi-phrases at $0 over "44 words of material", on a page
     *  of 1,222 words with real assistant evidence behind it. A candidate short of facts goes to the writer with
     *  what the pass could read for it; only being WRONG refuses it. */
    it("still drafts for a page whose card carries little material, instead of refusing it unread", async () => {
      const asked: string[] = [];
      const card = prop({ id: `${TENANT}::/iran-animals/persian-wolf::existing_edit::thin_page`, pagePath: "/iran-animals/persian-wolf",
        pageUrl: "https://www.iranopedia.com/iran-animals/persian-wolf", changeFamily: "section", status: "needs_review" as const,
        researchOnly: false, primaryQuery: "persian wolf", limitations: [],
        evidence: { query: "persian wolf", hints: ["/iran-animals/persian-wolf holds 196 words of copy"], evidenceRefCount: 1 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Add words that answer its main question." } });
      const snap = { ownedPages: [{ url: card.pageUrl, content: { wordCount: 196, title: "Persian Wolf", h1: "Persian Wolf", outline: ["Range"] }, search: null }], research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
      await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never, refusals: new Map<string, string>(),
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/iran-animals/persian-wolf", family: "editor", impact: 91, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async ({ system, user }: { system: string; user: string }) => (asked.push(`${system} ${user}`), { value: GOOD }) } as never);
      expect(asked.length).toBeGreaterThan(0); }); // it was ASKED: the page is thin, which is a reason to find facts

    /** THE CTA REPAIR IS A PRICED RETRY, NEVER A FREE RECURSION (Codex, 2026-08-23): the old branch redrafted
     *  the closing line outside the attempt budget, so the declared price of a deliverable was false. */
    it("refuses a call-to-action closing line, retries at full price, and names the refusal to the writer", async () => {
      const asked: string[] = []; let round = 0;
      // the packet keeps only the passages that overlap this card's question, so the fixture cites the one it is sure of
      const good2 = { ...GOOD, claims: [{ text: P1, supportedBy: ["page-copy-1"] }, { text: P2, supportedBy: ["page-copy-1"] }, { text: P3, supportedBy: ["page-copy-1"] }] };
      const cta = { ...good2, after: "See the page for more phrases.", claims: [{ text: "See the page for more phrases.", supportedBy: ["page-copy-1"] }] };
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, primaryQuery: "funny persian phrases",
        limitations: [], evidence: { query: "funny persian phrases", hints: [P1, P2, P3], evidenceRefCount: 3 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Add a section that answers the question." } });
      const snap = { ownedPages: [{ url: BODY.url, content: { wordCount: 400, title: BODY.title, h1: BODY.h1, outline: BODY.headings }, search: null }], research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
      const budget = DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 });
      const { canonicalUrlKey: ck } = await import("@/domains/evidence/snapshot");
      bodyStore.map = new Map([[ck(BODY.url), BODY]]);
      const out = await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never, budget,
        complete: async ({ system, user }: { system: string; user: string }) => (asked.push(`${system} ${user}`), { value: (round += 1) === 1 ? cta : good2 }) } as never);
      expect(asked.length).toBe(2); // the repair is a second PAID draft, not a hidden free one
      expect(budget.spent().calls).toBe(2); // and both drafts came off the page's one declared allowance
      expect(asked.at(-1)).toContain("it points at the page instead of answering"); // the CTA objection, in the gate's own words
      expect([out[0]!.status, out[0]!.recommendedChange.kind === "existing_edit" ? out[0]!.recommendedChange.after.includes("Jeegareto") : false]).toEqual(["ready", true]); });
    /** THE REWRITE TREATMENT REPLACES AN IDENTIFIED SECTION OR REFUSES (Codex, 2026-08-23). Live, a
     *  rewrite_existing_section card still rendered "A new section ... placed after the H1": the output was a
     *  different deliverable than the treatment sold. The card must name the stored passage it replaces, and a
     *  page whose stored copy cannot be identified is a refusal, never a new section. */
    it("a rewrite names the exact stored passage it replaces, never a new section", async () => {
      const { canonicalUrlKey } = await import("@/domains/evidence/snapshot");
      bodyStore.map = new Map([[canonicalUrlKey(BODY.url), BODY]]);
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, treatment: "rewrite_existing_section", primaryQuery: "playful persian expressions",
        limitations: [], evidence: { query: "playful persian expressions", hints: [P1, P2, P3], evidenceRefCount: 3 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Rewrite the playful expressions section with information gain." } });
      const snap = { ownedPages: [{ url: BODY.url, content: { wordCount: 400, title: BODY.title, h1: BODY.h1, outline: BODY.headings }, search: null }], research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
      const rewritten = { ...GOOD, claims: [{ text: P1, supportedBy: ["page-heading-1"] }, { text: P2, supportedBy: ["page-heading-1"] }, { text: P3, supportedBy: ["page-heading-1"] }] };
      const out = await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async () => ({ value: rewritten }) } as never);
      const rc = out[0]!.recommendedChange;
      expect(rc.kind === "existing_edit" ? rc.where : "").toBe('Replaces the existing passage under "Playful Persian expressions"');
      expect((rc.kind === "existing_edit" ? rc.before ?? "" : "").includes(P2)).toBe(true); // A REWRITE REPLACES THE SECTION UNDER ITS HEADING, never an arbitrary thousand-character slice of the crawl: cut between this heading and the next, the target is a thing an operator can find
      expect(JSON.stringify(out[0]!.operatorSteps)).toContain("Replace that passage with the copy above, exactly as written");
      expect(JSON.stringify(out[0])).not.toContain("A new section");
      expect(out[0]!.treatment).toBe("rewrite_existing_section"); // the passage WAS found, so this really is a replacement and stays one
      // AND WHEN NO PASSAGE CAN BE FOUND, THE CARD SAYS SO IN THE TREATMENT AND NOT ONLY IN THE PLACEMENT. Same page, same body, a question sharing nothing with any stored passage: the copy still lands, but as an ADDITION. It used to keep `rewrite_existing_section` while rendering "A new section headed ...", telling the operator to start a new section straight after the very section it was written to replace, which is a restructure shipping as a duplicate.
      const away = { ...card, primaryQuery: "wholesale freight logistics", evidence: { query: "wholesale freight logistics", hints: [P1], evidenceRefCount: 1 } };
      const add = await applyDraftedCopy([away], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 },),
        complete: async () => ({ value: rewritten }) } as never);
      const arc = add[0]!.recommendedChange;
      if (arc.kind === "existing_edit" && (arc.where ?? "").includes("A new section headed")) expect(add[0]!.treatment).toBe("add_answer_section");
      expect(add[0]!.treatment === "rewrite_existing_section").toBe(JSON.stringify(arc).includes("Replaces the existing passage"));
      bodyStore.map = null;
    });
    /** THE SYNTHESIS QUESTION IS ASKED AFTER THE SECTION IS FOUND, AND A REPLACEMENT MAY NOT RESTATE WHAT STAYS BELOW IT. The structural_synthesis assignment sat ABOVE the block that computes `rewrite`, reading a variable still initialised to null, so the condition was false on every card ever drafted and the instruction reached the evaluator exactly ZERO times: a correctly targeted rewrite was then judged by the standard written for a brand-new section. And once it does arrive, "the page already holds this" stops being a refusal, so the copy has to be held to something else: only the named passage goes, and repeating the detail still printed underneath hands the reader the same thing twice. Live, /funny-farsi-phrases replaced a content-free intro with six definitions that all remain in their own sections directly below. */
    it("tells the evaluator this is a synthesis, and refuses copy that repeats what stays below", async () => {
      const { canonicalUrlKey } = await import("@/domains/evidence/snapshot");
      const Q3 = "Chert o Pert means nonsense or gibberish in everyday Persian conversation between close friends.";
      const TWO = { ...BODY, headings: ["Playful Persian expressions", "More playful expressions"], passages: ["Playful Persian expressions", P1, "More playful expressions", P2, P3, Q3] };
      bodyStore.map = new Map([[canonicalUrlKey(BODY.url), TWO]]);
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, treatment: "rewrite_existing_section", primaryQuery: "playful persian phrase meanings",
        limitations: [], evidence: { query: "playful persian phrase meanings", hints: [P1, P2, P3], evidenceRefCount: 3 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Rewrite the playful expressions section." } });
      const snap = { ownedPages: [{ url: BODY.url, content: { wordCount: 400, title: BODY.title, h1: BODY.h1, outline: TWO.headings }, search: null }], research: {}, sources: [], scope: { tenantId: TENANT } };
      const run = async (copy: string) => applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, reviewer: async () => ({ notes: "fine" }) as never, judge: async () => OKJ as never,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async () => ({ value: { ...GOOD, after: copy, claims: [{ text: P1, supportedBy: ["page-heading-1"] }] } }) } as never);
      // A summary that restates nothing below lands, as a REPLACEMENT: the section was found, which is the only state in which the synthesis flag is now set.
      const ok = await run("Persian slang runs from affectionate teasing to blunt dismissal, and each entry below gives the literal wording beside the tone it carries.");
      expect((ok[0]!.recommendedChange as { where?: string }).where).toBe('Replaces the existing passage under "Playful Persian expressions"');
      // The same card, handed the three lines that stay directly below it, is refused for exactly that.
      const dup = await run(`${P2}\n${P3}\n${Q3}`);
      expect(JSON.stringify(dup[0]!.limitations ?? [])).toContain("it repeats what stays on the page below it");
      bodyStore.map = null;
    });
    /** A REFUSAL MUST PRODUCE BETTER WORK, NOT ANOTHER GUESS. Two things were missing from every corrective round: the ASSIGNMENT was passed on the first call only, so rounds two and three were asked to fix "it repeats what stays on the page below it" without being told what stays or even that this was a replacement, while the gate that refused them kept asking; and nothing ever said what to ADD, because the searches this page is shown for and does not answer were computed on the packet and read by nothing at all. */
    it("tells a corrective round what it is replacing and what to add", async () => {
      const { canonicalUrlKey } = await import("@/domains/evidence/snapshot");
      const Q3 = "Chert o Pert means nonsense or gibberish in everyday Persian conversation between close friends.";
      bodyStore.map = new Map([[canonicalUrlKey(BODY.url), { ...BODY, headings: ["Playful Persian expressions", "More playful expressions"],
        passages: ["Playful Persian expressions", P1, "More playful expressions", P2, P3, Q3] }]]);
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, treatment: "rewrite_existing_section", primaryQuery: "playful persian phrase meanings",
        limitations: [], evidence: { query: "playful persian phrase meanings", hints: [P1], evidenceRefCount: 1 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Rewrite it." } });
      const snap = { ownedPages: [{ url: BODY.url, content: { wordCount: 400, title: BODY.title, h1: BODY.h1, outline: ["Playful Persian expressions"] },
        search: { topQueries: [{ query: "what do persian insults mean", clicks: 0, impressions: 900, position: 14 }] } }], research: {}, sources: [], scope: { tenantId: TENANT } };
      const seen: string[] = [];
      await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "n" }) as never,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async (r: { user: string }) => { seen.push(r.user); return { value: { ...GOOD, after: `${P2}\n${P3}\n${Q3}` } }; } } as never);
      expect(seen.length).toBeGreaterThan(1); // round one is refused for restating what stays below; the round after it is told BOTH the assignment and the search this page owes
      const retry = seen[seen.length - 1]!;
      expect(retry).toContain("You are REWRITING the existing section");
      expect(retry).toContain("what do persian insults mean");
      expect(retry).not.toContain("REMOVE these exact words"); // the inverted clause is gone, not repaired
    });
    /** A CRAWLER BLOB IS NOT A SECTION (Codex, 2026-08-23, from the first live Ready change). The first change this campaign produced told the operator to paste five lines over a thousand-character passage opening "top of pagePopular Persian(Farsi) Insults..." that ran from the page intro through a "Shop Now" block into two entries. Nobody can find that string, and following it would delete real content. Such a passage is refused as a target, and the refusal names the work that IS available. */
    it("refuses to aim a rewrite at a crawler blob, and says the work is a new section instead", async () => {
      const { canonicalUrlKey } = await import("@/domains/evidence/snapshot");
      const CHROMED = `top of page${P1} Shop Now ${P2}`; // exactly the shape production picked
      bodyStore.map = new Map([[canonicalUrlKey(BODY.url), { ...BODY, passages: [CHROMED] }]]);
      const notes: string[] = [];
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, treatment: "rewrite_existing_section", primaryQuery: "playful persian expressions",
        limitations: [], evidence: { query: "playful persian expressions", hints: [P1, P2, P3], evidenceRefCount: 3 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Rewrite the playful expressions section." } });
      const snap = { ownedPages: [{ url: BODY.url, content: { wordCount: 400, title: BODY.title, h1: BODY.h1, outline: BODY.headings }, search: null }], research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
      const out = await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never,
        note: (_k: string, o: string, why?: string) => notes.push(`${o}:${why ?? ""}`), refusals: new Map<string, string>(),
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async () => ({ value: GOOD }) } as never);
      // THE PLANNER REPLANS RATHER THAN WRITING THE PAGE OFF: no section to replace is a fact about the treatment.
      expect(notes.join(" ")).not.toContain("is a section this rewrite could replace");
      expect(JSON.stringify(out[0]!.recommendedChange)).not.toContain("Shop Now"); // and the operator is never told to delete it
      bodyStore.map = null;
    });
    it("a rewrite that cannot identify its section refuses in those words, and never invents a placement", async () => {
      const notes: string[] = [];
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, treatment: "rewrite_existing_section", primaryQuery: "playful persian expressions",
        limitations: [], evidence: { query: "playful persian expressions", hints: [P1, P2, P3], evidenceRefCount: 3 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Rewrite the playful expressions section." } });
      const snap = { ownedPages: [{ url: BODY.url, content: { wordCount: 400, title: BODY.title, h1: BODY.h1, outline: BODY.headings }, search: null }], research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
      const out = await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never,
        note: (_k: string, o: string, why?: string) => notes.push(`${o}:${why ?? ""}`), refusals: new Map<string, string>(),
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async () => ({ value: GOOD }) } as never); // no stored body is on file, so no passage can be identified
      // A REWRITE WITH NOTHING TO REPLACE BECOMES THE SECTION THE PAGE DOES NOT HAVE, and never a settled refusal.
      expect(notes.join(" ")).not.toContain("is a section this rewrite could replace");
    });
    it("a grounded answer passes every editor gate AND the canon, mechanically placed", async () => {
      const d = await drive({ ...GOOD, placementAnchor: "whatever" }); expect([d?.anchor, (d?.after ?? "").includes(P2)]).toEqual(["Funny Farsi Phrases", true]);
      const v = validateProposal(prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url, changeFamily: "section", status: "needs_review" as const,
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: d!.after } }), { pageBodyText: [P1, P2, P3].join(" "), evidenceText: [P1, P2, P3].join(" "), now: NOW });
      expect([v.verdict, v.qualityStatus]).toEqual(["ready", "ready"]); }); // the same copy clears the canon that held every previous draft
  });
  // THE THREE CARDS WITHDRAWN FROM A PAYING OPERATOR'S LIVE QUEUE ON 2026-08-14, as fixtures. Each was written by the model, passed every gate INCLUDING the live judge on all seven of its criteria, and reached the customer surface. Each is now refused DETERMINISTICALLY, by name, before any model is consulted. The judge is defence in depth behind these, never the thing they rest on.
  it("the cards that reached a customer are refused before a model is asked", () => { const pk = (bodyText: string, bannedTerms: string[] = []) => ({ targetUrl: "https://www.iranopedia.com/x", title: "T", h1: "H", metaDescription: null, bodyText, headings: [], evidence: { "page-copy-1": bodyText }, trackedQuestion: "Q", ownedPaths: ["/x"], bannedTerms, demand: { preserve: [], vocabulary: [] } });
    const d = (o: Record<string, unknown>) => deliverableFailures({ targetUrl: "https://www.iranopedia.com/x", actionType: "answer_block", naturalHeading: "A human heading", beforeText: null, evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 30, measurementTarget: "citations", claims: [{ text: "a claim", supportedBy: ["page-copy-1"] }], ...o } as never, (o.P as never) ?? pk(""));
    const chrome = "top of pagePopular Persian(Farsi) Insults, Funny Phrases, and SlangPersian is a lively language full of humorous expressions.";
    const learn = "Persian Greetings and Basic PhrasesSay hello, goodbye, thank you, and much more with confidence. This guide covers the most common Persian greetings and everyday phrases, along with cultural notes and pronunciation tips, so you know when and how to use them naturally.";
    const blob = "Visual Timeline of Persia/IranA comprehensive visual timeline of Iran's history, capturing pivotal events from ancient Persia to to modern Iran. Explore significant milestones, cultural developments, political changes, and influential figures that have shaped Iran's rich and diverse heritage.";
    // 1: names slang terms the stored page never carries (caught by reading the COPY, since it declared none of them as claims), self-points, uses a word this account bans, and anchors on the crawl's own marker. 2: says the page LISTS phrases it only mentions in passing, which the self-pointer rule can see. 3: hands over a paragraph where a place on the page belongs.
    const RECV=[d({ P: pk(chrome, ["Farsi"]), placementAnchor: chrome, finalCopy: "Funny Persian phrases and idioms are common Farsi insults and playful slang such as Pedar Sag, Topoli, Gooz, Bikhial, and Chert-o-Pert. This page lists those expressions, gives brief meanings and typical contexts. See the headings below for each example and its short meaning." }),
      d({ P: pk(learn), placementAnchor: "Persian Greetings and Basic Phrases", finalCopy: "Basic Persian phrases for beginners include common greetings, simple everyday sentences, and numbers shown in Finglish so you can speak before learning the script. This page lists hello, goodbye, thank you, pronunciation tips and cultural notes, and recommends gamified lessons to practice these phrases aloud." }),
      d({ P: pk(blob), placementAnchor: blob, finalCopy: "Famous Iranian people in history and today include Cyrus the Great and the poet Ferdowsi, who founded an empire and wrote the epic that carried the Persian language across many centuries of recorded history, verse and memory, and who are named on this timeline among the milestones that shaped Iran." })];
    expect(RECV)

      // AND THE FIRST CARD IS REFUSED A SECOND TIME FOR A SECOND REASON: past the slang it invents, it promises a reader this page "gives brief meanings" and "typical contexts" for those expressions, and the stored page puts those words together nowhere. The third card needs neither list rule; it is caught naming Cyrus and Ferdowsi, two people its page never mentions.
      .toEqual([["it points at the page instead of answering", "it uses words this account does not publish: Farsi", "where it goes is two page elements glued together, which nobody can find on the rendered page", "where it goes is taken from the crawl's own markers, not from the page"], ["it points at the page instead of answering"], ["where it goes is a paragraph rather than a place on the page", "where it goes is two page elements glued together, which nobody can find on the rendered page"]]) });
  // THE READY CARD ON THE LIVE ACCOUNT, 2026-08-15: the description sells "modern designs" and the page shows neither. NO DETERMINISTIC RULE CATCHES IT ANY MORE, and this case is kept to say so out loud. It slips a bag-of-words corpus because one stored sentence says "timeless designs" and another says "modern fashion", so every part of the phrase is on file. Reading the page's word ORDER instead does catch it, and was tried on 2026-08-23, and it refused ordinary copy the page prints word for word: a page reading "Persian rugs, carpets and textiles" refuses an answer that says "Persian carpets", because one modifier distributes over three nouns and a contiguous run cannot see that. Refusing finished work is the worse failure of the two, and this file has thrown out a lexical gate for exactly that reason twice before. The evaluator owns the question now, and it demonstrably answers it: on 2026-08-23 it refused a girl-names answer for repeating what the page already said.
  it("does not pretend a deterministic rule can catch a recombined phrase", () => {
    const BODY = "Persian AccessoriesShowcase your heritage with our Persian accessories, featuring timeless designs inspired by Iranian culture and craftsmanship. From stylish Iranian hats to intricately patterned Persian phone cases, each piece blends tradition with modern fashion. Elevate your look and express your love for Iran with unique accessories that stand out!";
    const P = { targetUrl: "https://www.iranopedia.com/category/persian-accessories", title: "Persian Accessories | Iranopedia", h1: "Persian Accessories", metaDescription: null, bodyText: BODY, headings: ["Browse by", "Filter by", "Explore More"], trackedQuestion: "Persian Accessories", ownedPaths: ["/category/persian-accessories"], demand: { preserve: [], vocabulary: [] }, bannedTerms: [], evidence: { "page-copy-1": BODY, "page-title": "Persian Accessories | Iranopedia", "page-h1": "Persian Accessories", "page-heading-1": "Browse by", "card-2": "/category/persian-accessories earns 15 impressions and 0 clicks in 90 days" } };
    const claims = [{ text: "The page subject is Persian Accessories", supportedBy: ["page-h1", "page-title"] }, { text: "The page showcases heritage-inspired hats and intricately patterned phone cases", supportedBy: ["page-copy-1"] },
      { text: "The page lists accessory types (Browse by)", supportedBy: ["page-heading-1", "page-copy-1"] }, { text: "This category page currently earned 15 impressions and 0 clicks in 90 days", supportedBy: ["card-2"] }];
    const d = (over: Record<string, unknown> = {}) => deliverableFailures({ actionType: "meta", targetUrl: P.targetUrl, placementAnchor: "the page's description field", beforeText: null, naturalHeading: null, evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 1, measurementTarget: "clicks on this page", claims, supportFacts: [],
      finalCopy: "Persian Accessories - showcases heritage-inspired hats, intricately patterned phone cases and modern designs; page lists these accessory types.", ...over } as never, P as never);
    expect([d(), d({ claims: [...claims, { text: "The page shows modern designs", supportedBy: ["page-copy-1"] }] })])
      .toEqual([[], []]); });   // both pass the deterministic gates; only a reader of MEANING can refuse this one
  /** AN ANCHOR IS A LINE THE OPERATOR CAN FIND, and a crawler glues with whitespace as often as without any. Live, /iran-animals drafted a finished answer to land after "Iran Wildlife and National Animals  Discover the Animals of Iran": a heading and its subheading run together by the read, a string on no rendered page. Nothing caught it until the banked re-read, by which point the page was out of hand and the card was stuck in review with nothing anybody could fix. Caught while drafting, the editor picks a line that is really there. */
  it("refuses a place on the page that only the crawler ever saw", () => {
    const BODY = "Iran Wildlife and National Animals Discover the Animals of Iran. Native wildlife of Iran includes the caracal and the Persian leopard, each with the one fact a reader needs about it on the page today.";
    const P = { targetUrl: "https://www.iranopedia.com/iran-animals", title: "T", h1: "Iran Wildlife and National Animals", metaDescription: null, bodyText: BODY, headings: ["Iran Wildlife and National Animals"], evidence: { "page-copy-1": BODY }, trackedQuestion: "What wildlife is native to Iran?", ownedPaths: ["/iran-animals"], bannedTerms: [], demand: { preserve: [], vocabulary: [] } };
    const at = (placementAnchor: string) => deliverableFailures({ actionType: "answer_block", targetUrl: P.targetUrl, placementAnchor, beforeText: null,
      naturalHeading: "Native wildlife of Iran", evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 20, measurementTarget: "citations", supportFacts: [],
      claims: [{ text: "Native wildlife of Iran includes the caracal and the Persian leopard", supportedBy: ["page-copy-1"] }],
      finalCopy: "Native wildlife of Iran includes the caracal and the Persian leopard, each with the one fact a reader needs about it on the page today, drawn from what this page already carries and nothing else." } as never, P as never)
      .some((r) => r.startsWith("where it goes is two page elements glued together"));
    // the live anchor, the same anchor with the glue closed up, and an ordinary heading
    expect([at("Iran Wildlife and National Animals  Discover the Animals of Iran"), at("Iran Wildlife and National AnimalsDiscover"), at("Iran Wildlife and National Animals")])
      .toEqual([true, true, false]); });

  // THE THREE FINISHED ANSWERS SITTING IN REVIEW ON THE LIVE ACCOUNT AT 21:02Z, 2026-08-23, as fixtures. Every one is accurate, drafted off its own page, and every one was held back by ONE refusal naming a fragment of its own sentence: "with mammals of Iran" and "habitats" are governed by a preposition, "under Shah Abbas I" carries "Shah Sultan Husayn" with it, "symbolizing royal authority" is a participle, and "Persia faced internal decline" is a clause. None of them is a thing a page offers, and the rule that flagged them asked whether the writer had restated each one inside a claim. Three answers, three customers' worth of finished work, one parser.
  it("reads a list member as a thing, never as the sentence around it", () => {
    const CASES = [
      { body: "Iran Animals. Native wildlife of Iran: caracal, red fox, Pallas cat, striped hyena, Eurasian lynx, green sea turtle, Mugger crocodile, Asiatic cheetah, Persian leopard, Caspian horse, Caspian seal, white bellied sea eagle, Bezoar ibex, Persian wolf (Iranian wolf), Houbara bustard, Persian cat (Persian longhair). Iran animals and Persian wildlife, with mammals of Iran and habitats.",
        heading: "Native wildlife of Iran", claims: ["Native wildlife in Iran includes the named species on this page.", "The page also names Persian cat and ties the topic to Iran animals and Persian wildlife."],
        copy: "Native wildlife in Iran includes caracal, red fox, Pallas cat, striped hyena, Eurasian lynx, green sea turtle, Mugger crocodile, Asiatic cheetah, Persian leopard, Caspian horse, Caspian seal, white bellied sea eagle, Bezoar ibex, Persian wolf (Iranian wolf), and Houbara bustard. The page also names Persian cat (Persian longhair) and groups the subject around Iran animals and Persian wildlife, with mammals of Iran and habitats." },
      { body: "Achaemenid Empire Flag (550 to 330 BCE). The Achaemenid Empire was established by Cyrus the Great and ran from 550 BCE to 330 BCE. No official flag design has been preserved. Ancient reliefs and inscriptions suggest banners with eagle and winged sun symbols. The flag is often depicted with a red background and a golden Faravahar or eagle emblem, symbolizing royal authority, divine protection, and Persian identity.",
        heading: "Achaemenid Empire Flag", claims: ["The Achaemenid Empire was established by Cyrus the Great and ran from 550 BCE to 330 BCE.", "550 BCE comes before 330 BCE.", "No official flag design has been preserved.", "Ancient reliefs and inscriptions suggest banners with eagle and winged sun symbols.", "The flag is often depicted with a red background and a golden Faravahar or eagle emblem.", "The emblem symbolizes royal authority, divine protection, and Persian identity."],
        copy: "The Achaemenid Empire flag belongs to the Achaemenid Empire, established by Cyrus the Great, from 550 BCE to 330 BCE.\n550 BCE: Cyrus the Great established the Achaemenid Empire.\n330 BCE: the Achaemenid Empire ends.\nNo official flag design has been preserved. Ancient reliefs and inscriptions suggest banners with eagle and winged sun symbols. The flag is often depicted with a red background and a golden Faravahar or eagle emblem, symbolizing royal authority, divine protection, and Persian identity." },
      { body: "Late Safavid Military Flag. The lion and sun flag is the late Safavid military banner. The Lion and Sun emblem marks Persia's Shi'a identity and military strength. It uses a golden Lion and Sun emblem on a green field, and the lion stands before the rising sun. It represents Persian monarchy, divine legitimacy, and Shi’a heritage. The Lion and Sun motif gained prominence in Safavid military campaigns. During this period, under Shah Abbas I and Shah Sultan Husayn, Persia faced internal decline and external threats.",
        heading: "Safavid military banner", claims: ["The lion and sun flag is the late Safavid military banner.", "It marks Persia's Shi'a identity and military strength.", "It uses a golden Lion and Sun emblem on a green field.", "The lion stands before the rising sun.", "It represents Persian monarchy, divine legitimacy, and Shi’a heritage.", "The motif gained prominence in Safavid military campaigns."],
        copy: "The lion and sun flag is the late Safavid military banner, and the Lion and Sun emblem marks Persia's Shi'a identity and military strength. It uses a golden Lion and Sun emblem on a green field, and the lion stands before the rising sun.\nSafavid military banner\nThe banner is from the late Safavid era.\nIt represents Persian monarchy, divine legitimacy, and Shi’a heritage.\nThe Lion and Sun motif gained prominence in Safavid military campaigns.\nDuring this period, under Shah Abbas I and Shah Sultan Husayn, Persia faced internal decline and external threats." }];
    const offers = CASES.map((c) => deliverableFailures({ actionType: "answer_block", targetUrl: "https://www.iranopedia.com/x", placementAnchor: c.heading, beforeText: null, naturalHeading: c.heading, evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 20, measurementTarget: "citations", supportFacts: [],
      claims: c.claims.map((t) => ({ text: t, supportedBy: ["page-copy-1"] })), finalCopy: c.copy } as never,
      { targetUrl: "https://www.iranopedia.com/x", title: "T", h1: c.heading, metaDescription: null, bodyText: c.body, headings: [c.heading], evidence: { "page-copy-1": c.body }, trackedQuestion: "Q", ownedPaths: ["/x"], bannedTerms: [], demand: { preserve: [], vocabulary: [] } } as never)
      .filter((r) => r.startsWith("it tells a reader this page offers")));
    expect(offers).toEqual([[], [], []]); });
  // THE EDITOR'S HOMEWORK IS CHECKED AGAINST THE STORED PAGE, NEVER AGAINST ITS SPELLING: a faithful paraphrase whose claims name real stored evidence is FINISHED. Not one sentence here is a quotation, and the copy merges two stored sentences, drops what the field cannot hold and re-orders the rest. WHAT IT MAY NOT DO ANY MORE is reach outside the words its own claims stand on: this fixture used to say "no Achaemenid flag has SURVIVED" off a stored sentence reading "has been PRESERVED", and it passed because the claim declaring "survived" was inside the corpus the copy was tested against. That is the self-authenticating hole, pinned below, and the paraphrase is now made of the evidence's own content words. AND A FIELD IS ITS OWN PLACE, which is where fixtures once agreed with the code's mistake: every case passed `beforeText: null`, so nobody noticed a title, an H1 or a description checked against the page BODY can never match and every real field edit was refused forever. Each now replaces its OWN stored line.
  it("an editor's deliverable is finished only when the stored page carries it", () => {
    const BODY = "Though no official flag design has been preserved, ancient reliefs and inscriptions suggest banners with eagle and winged sun symbols. The Achaemenid Empire Flag is often depicted with a red background and a golden Faravahar or eagle emblem, from 550 to 330 BCE.", P = { targetUrl: "https://www.iranopedia.com/iran-flags/achaemenid-empire-flag", title: "Achaemenid Empire Flag (550 to 330 BCE)", h1: "Achaemenid Empire Flag (550 to 330 BCE)", metaDescription: "Learn about the History of Iran Flags and the Achaemenid Empire Flag. Discover its symbolism, role in Persian History, its changes, and its origins.", headings: ["Explore More"], trackedQuestion: "What are funny Persian phrases and idioms?", ownedPaths: ["/iran-flags/achaemenid-empire-flag", "/persian-female-first-names"], demand: { preserve: [], vocabulary: [] }, bannedTerms: ["Farsi"], evidence: { "page-copy-1": "Though no official flag design has been preserved, ancient reliefs and inscriptions suggest banners with eagle and winged sun symbols", "page-copy-2": "The Achaemenid Empire Flag is often depicted with a red background and a golden Faravahar or eagle emblem, from 550 to 330 BCE.", "page-title": "Achaemenid Empire Flag (550 to 330 BCE)" }, bodyText: BODY };
    const D = { actionType: "meta" as const, targetUrl: P.targetUrl, placementAnchor: "the page's description field", beforeText: P.metaDescription, naturalHeading: null, evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 3, measurementTarget: "clicks on this page", claims: [{ text: "No official Achaemenid flag design has been preserved", supportedBy: ["page-copy-1", "page-title"] }, { text: "Ancient reliefs and inscriptions suggest banners with an eagle and winged sun, and the flag is often depicted with a red background and a golden Faravahar emblem from 550 to 330 BCE", supportedBy: ["page-copy-1", "page-copy-2"] }], supportFacts: [], finalCopy: "No official Achaemenid flag design has been preserved: reliefs and inscriptions suggest a red banner with a golden Faravahar eagle, 550 to 330 BCE." }, T = { ...D, actionType: "title" as const, beforeText: P.title, placementAnchor: "the page title", finalCopy: "Achaemenid Flag: What Reliefs and Inscriptions Suggest" };
    const WRONG = "the line it says it replaces is not the one this page carries", blk = (o: Record<string, unknown>) => deliverableFailures({ ...D, actionType: "answer_block", beforeText: null, finalCopy: BODY, ...o } as never, P)[0];
    expect([deliverableFailures(D, P), deliverableFailures(T, P), deliverableFailures({ ...D, beforeText: "a description this page never carried" }, P)[0], deliverableFailures({ ...T, beforeText: "A title this page never carried" }, P)[0],
      deliverableFailures({ ...D, claims: [{ text: "Cyrus raised it himself", supportedBy: ["made-up-7"] }] }, P)[0], blk({ naturalHeading: "What the reliefs show", placementAnchor: "a heading nowhere on the page" }), blk({ naturalHeading: P.trackedQuestion, placementAnchor: "ancient reliefs and inscriptions" })]).toEqual([[], [], WRONG, WRONG, "it names evidence that is not on file: made-up-7", "the place it says it lands is not on the stored page", "its heading is the tracked question said back word for word"]); });
  // THE HALLUCINATION THAT AUTHENTICATED ITSELF, on the live account's own stored page evidence, and with a judge that says yes to all seven of its rulings. The coverage graph carried the writer's own claim text, so a sentence and the claim declaring it were one string: a claim naming a real evidence id, repeated word for word in ordinary prose, cleared every check because the word was in the claim. Each claim is now read against the quoted facts IT names, with itself taken out of the corpus, and the refusal is DETERMINISTIC, so the permissive judge below is never asked. THE LIVE ROW IS HERE TOO: the one ready card on the account (2026-08-15) declared "The page includes Love Eshgh black and white variants" against four headings and one body excerpt that name the shoes and never say the page includes anything, and it is refused for exactly that word. A paraphrase made of the quoted facts' own content words still passes. FINISHED WORK IS NEVER DESTROYED BY A SOFT RULE (Codex, 2026-08-23). Live, the /funny-farsi-phrases answer was drafted, saved Ready at 20:33:38, and overwritten by its own research brief at 20:33:39, because a re-read applied the banned-word rule without the searcher-vocabulary exemption the editor had honoured. Soft reasons DOWNGRADE finished copy to a review draft carrying the reason; only the four hard classes retire it.
  it("classifies the live destruction reason as soft, and every one of the four hard classes as hard", () => {
    expect(DRAFT_BUDGET.HARD_REFUSAL.test("it uses words this account does not publish: Farsi")).toBe(false); // the exact live reason: SOFT
    expect(DRAFT_BUDGET.HARD_REFUSAL.test("its copy is 68 long, outside the 80 to 150 this field takes, or carries something nobody can paste")).toBe(false);
    expect(DRAFT_BUDGET.HARD_REFUSAL.test("it points at the page instead of answering")).toBe(false);
    for (const hard of ["the words it says it replaces are not on the stored page", "it names a page this evidence is not about",
      "its copy is blank or still carries a placeholder", "the evidence its claims name is not banked beside them: card-9",
      'its copy names "Cyrus", and nothing on file about this page mentions them', "it names evidence that is not on file: owned_snapshot"])
      expect(DRAFT_BUDGET.HARD_REFUSAL.test(hard)).toBe(true); });

  /** ONE RANGE, HOWEVER IT IS SPELLED (Codex, 2026-08-23): /iran-flags/achaemenid-empire-flag lost five calls and $0.026846 because "from 550 BCE to 330 BCE" was read as dropping a qualifier the page's own "550-330 BCE" never carried. Real qualifiers must still be enforced, so both directions are pinned. */
  it.each([
    ["from 550 BCE to 330 BCE", "The empire ran 550-330 BCE.", true],
    ["550 BCE to 330 BCE", "The empire ran 550-330 BCE.", true],
    ["550-330 BCE", "The empire ran from 550 BCE to 330 BCE.", true],
    ["shipping in 7 days", "Orders ship in 7 days, excluding weekends.", false],
  ])("reads %s against the page correctly", (copy, body, shouldPass) => {
    const P = { targetUrl: "https://www.iranopedia.com/f", title: "Flag", h1: "Flag", metaDescription: null, headings: [],
      bodyText: body, evidence: { "page-copy-1": body }, trackedQuestion: "achaemenid flag", ownedPaths: [], bannedTerms: [],
      demand: { preserve: [], vocabulary: [] } } as unknown as Parameters<typeof deliverableFailures>[1];
    const d = { actionType: "answer_block" as const, targetUrl: P.targetUrl, placementAnchor: "Flag", beforeText: null,
      naturalHeading: "The dates", evidenceIdsUsed: ["page-copy-1"], claims: [{ text: copy, supportedBy: ["page-copy-1"] }],
      finalCopy: copy, uncertaintyOrOmitted: [], implementationMinutes: 2, measurementTarget: "citations", supportFacts: [] } as unknown as Parameters<typeof deliverableFailures>[0];
    const dropped = deliverableFailures(d, P).filter((r) => r.includes("and the copy drops it"));
    expect(dropped.length === 0).toBe(shouldPass); });

  /** THE CAPITAL-LETTER NAME CHECK IS GONE, and this pins that it stays gone for the ordinary-word cases it kept refusing. It blocked /iran-animals/persian-wolf over "Look" opening a list item, and in three consecutive live drafting runs on 2026-08-24 it refused "Key", "BCE The" and "Earliest" - three ordinary English words, three whole pages lost. Whether a claim is entailed by its evidence is a question about meaning, and the evaluator reads every claim against the quoted evidence for exactly that. A spelling rule cannot ask it. */
  it.each([
    ["a dash-led clause", "The Persian wolf ranges across Iran - Look for it in the highlands.", []],
    ["a bulleted list", "Where to see it:\n- Look in the highlands\n- Look at dawn", []],
    ["a clause after a comma", "If you want to see one, Look at dawn.", []],
    ["a capitalised word the page never carries", "The Persian wolf was described by Cyrus the Great.", []],
  ])("never refuses %s on spelling alone", (_what, copy, expected) => {
    const P = { targetUrl: "https://www.iranopedia.com/w", title: "Persian Wolf", h1: "Persian Wolf", metaDescription: null, headings: [],
      bodyText: "The Persian wolf ranges across Iran and the highlands.", evidence: { "page-copy-1": "The Persian wolf ranges across Iran and the highlands." },
      trackedQuestion: "persian wolf", ownedPaths: [], bannedTerms: [], demand: { preserve: [], vocabulary: [] } } as unknown as Parameters<typeof deliverableFailures>[1];
    const d = { actionType: "answer_block" as const, targetUrl: P.targetUrl, placementAnchor: "Persian Wolf", beforeText: null,
      naturalHeading: "Where to see it", evidenceIdsUsed: ["page-copy-1"], claims: [{ text: "The Persian wolf ranges across Iran", supportedBy: ["page-copy-1"] }],
      finalCopy: copy, uncertaintyOrOmitted: [], implementationMinutes: 2, measurementTarget: "citations", supportFacts: [] } as unknown as Parameters<typeof deliverableFailures>[0];
    const named = deliverableFailures(d, P).filter((r) => r.includes("its copy names"));
    if (expected.length === 0) expect(named).toEqual([]);
    else for (const name of expected) expect(named.join(" ")).toContain(`"${name}"`); });

  it("ranks by what is riding on the change, readiness a label and confidence a multiplier, and names a lever for a page losing ground", () => {
    // THE 152-CLICK CLASS. A card whose copy is still owed but whose page has two thousand clicks proven recoverable now LEADS a finished trifle: being unfinished costs a factor named on the receipt, never a flat fine, so the lane label says what is pasteable today and the ORDER says what matters most. The flat 45 this replaces put every big research card behind every three impression description.
    const owed = prop({ id: "owed", pagePath: "/big", impactScore: 2000, demandImpressions90d: 50_000,
      limitations: ["The exact description lands on the next pass; it is still owed, and this card is what is owed. No action needed from you until it does."] });
    const finished = prop({ id: "finished", pagePath: "/small", impactScore: 100 }); const ranked = rankProposals([owed, finished]); expect(ranked.map((p) => p.id)).toEqual(["owed", "finished"]);
    // No diagnosed cause on the owed card: its 2,000-click figure rides the MEASURED-SHORTFALL band (half the proven reach), never "proven recoverable". 60 × 0.595 = 35.7; the order still holds.
    expect([factorOf(ranked[0]!, "visibility"), factorOf(ranked[0]!, "readiness"), factorOf(ranked[1]!, "readiness")]).toEqual([35.7, 0, 0]);
    expect(ranked[0]!.rankingReceipt!.factors.find((f) => f.name === "visibility")!.input).toContain("counted at 60 percent because the copy is still owed and confidence is medium");
    // A PAGE LOSING GROUND ON A SEARCH PEOPLE STILL RUN has levers; a search fewer people run has none, and saying otherwise would score a decline card for a fix that is not one.
    expect([factorOf(rankProposals([prop({ diagnosisCause: "ranking_loss", bundle: bundleOf([comp({ kind: "section_add" })]) })])[0]!, "causeFit"),
      factorOf(rankProposals([prop({ diagnosisCause: "demand_decline", bundle: bundleOf([comp({ kind: "section_add" })]) })])[0]!, "causeFit")]).toEqual([25, 0]); });
  it("discounts a dangerous consolidation and a page that already has a change under measurement", () => {
    const safe = prop({ id: "safe", impactScore: 300, pagePath: "/quiet", bundle: bundleOf([comp({ kind: "title" })]) });
    const risky = prop({ id: "risky", impactScore: 300, pagePath: "/merge", status: "needs_review",
      bundle: bundleOf([comp({ kind: "consolidation", risk: "dangerous", after: "Fold this page into the sizing guide." })]) });
    const busy = prop({ id: "busy", impactScore: 300, pagePath: "/measuring", bundle: bundleOf([comp({ kind: "title" })]) }); const ranked = rankProposals([risky, busy, safe], { measuringPagePaths: ["/measuring"] });
    // A DANGEROUS CHANGE IS DISCOUNTED, NOT SUNK, and being held for a look is no longer a score at all: what separates these three is what each costs (a risky lever, -18) and what each would ruin (-30, a second change on a page being read). Whether the risky one may be pasted is settled off this file.
    expect(ranked.map((p) => p.id)).toEqual(["safe", "risky", "busy"]);
    const held = ranked.find((p) => p.id === "risky")!; expect(factorOf(held, "risk")).toBe(-18); // it still ranks, it just ranks with its discount
    expect(validateProposal(held).reasons.some((r) => r.includes("confirm it before you make the change"))).toBe(true); expect(factorOf(ranked.find((p) => p.id === "busy")!, "overlap")).toBe(-30);
    expect(factorOf(ranked.find((p) => p.id === "safe")!, "overlap")).toBe(0); expect(ranked[1]!.whyRankedAboveNext).toContain("/measuring already has a change under measurement");
    for (const p of ranked) for (const f of p.rankingReceipt!.factors) expect(Math.abs(f.contribution)).toBeLessThanOrEqual(f.max); }); // every factor stays inside its own ceiling, so no single input can quietly decide the order
  it("holds every factor on its own floor, and never punishes a stored change for the age of its vocabulary", () => {
    const [floored] = rankProposals([prop({ id: "floored", evidence: { query: "rain barrel sizing", hints: [], evidenceRefCount: -1000 } })]); // a tampered evidence count used to contribute -1,500 and drag a safe change down through the lifecycle tiers
    expect(factorOf(floored!, "evidence")).toBe(0); expect(floored!.rankingReceipt!.factors.every((f) => f.contribution >= -f.max)).toBe(true);
    // WORTH DECIDES, AND ONLY WORTH: 9,999 clicks proven recoverable outranks none, and the stage a row is at contributes nothing either way. Being safe to paste was worth 250, more than every other factor together.
    expect(proposalValueScore(prop({ status: "needs_review", impactScore: 9999 }))).toBeGreaterThan(proposalValueScore(floored!));
    const bundled = rankProposals([prop({ diagnosisCause: "incomplete_coverage", bundle: bundleOf([comp({ kind: "section" })]) })]); // the older undifferentiated kinds ARE the levers their newer names describe, on a bundle and on a pre-bundle row alike
    const stored = rankProposals([prop({ diagnosisCause: "incomplete_coverage", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A section on roof area." } })]);
    expect([factorOf(bundled[0]!, "causeFit"), factorOf(stored[0]!, "causeFit")]).toEqual([25, 25]); });
  it("ranks a change it holds no proven figure for as a direction, never a size, and says so", () => { const [blind] = rankProposals([prop({ impactScore: null, upsidePerMonth: null })]);
    expect([blind!.rankingReceipt!.directional, factorOf(blind!, "visibility")]).toEqual([true, 0]); expect(blind!.rankingReceipt!.basis).toContain("this is the order to work in, not a promise about size");
    // AN IMPACT FIGURE WITH NO DIAGNOSED CAUSE IS A DIRECTION: the number rides as measured shortfall and the receipt never claims a proven recovery for a gap nobody has explained.
    const [sized] = rankProposals([prop({ impactScore: 570 })]); expect([sized!.rankingReceipt!.directional, factorOf(sized!, "visibility")]).toEqual([true, 19.38]);
    expect(sized!.rankingReceipt!.factors.find((f) => f.name === "visibility")!.input).toContain("measured shortfall, cause not yet diagnosed");
    const [causal] = rankProposals([prop({ impactScore: 570, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "title" })]) })]);
    expect([causal!.rankingReceipt!.directional, causal!.rankingReceipt!.basis.includes("about 570 clicks proven recoverable")]).toEqual([false, true]); });
  it("decodes and ranks a stored row that predates every field this ranking added", () => {
    const { rankingReceipt: _r, whyRankedAboveNext: _w, diagnosisCause: _c, bundle: _b, ...old } = prop({ impactScore: 300, bundle: bundleOf([comp({ kind: "title" })]) });
    void _r; void _w; void _c; void _b;
    const back = deserializeChangeProposal(serializeChangeProposal(old as ChangeProposal)); expect(back).not.toBeNull();
    const [ranked] = rankProposals([back!]); expect(ranked!.rankingReceipt!.factors.map((f) => f.name)).toEqual(["readiness", "visibility", "evidence", "causeFit", "strategic", "effort", "risk", "overlap", "confounding", "treatment", "history"]);
    expect(factorOf(ranked!, "causeFit")).toBe(0); // no diagnosis on the row, so nothing is matched and nothing is punished
    // A ROW WITH NO DIAGNOSIS AND NO RECEIPT STILL RANKS ON WHAT IS RIDING ON IT, and below a change with thirty three times its proven recovery, whatever stage either is at: worth what its own figures say, never less for its age.
    expect(proposalValueScore(back!)).toBeLessThan(proposalValueScore(prop({ status: "needs_review", impactScore: 9999 }))); }); });

/** READY INTEGRITY (2026-08-15). Three promises about a change that is allowed to read as ready: every published claim stands on the exact evidence it names, the version an operator confirms names everything they read, and banked words are re-read against today's rules before they are served again. */
describe("a change earns ready on its own evidence, its whole version, and words that still stand", () => {
  const EV = "Each order earns store credit toward the next tote.";
  const TOTES = "Every order earns store credit toward the next red tote; each order earns store credit toward the next red tote.";
  const PK = { targetUrl: "https://fixture-content.example/totes", title: "Totes", h1: "Totes", metaDescription: null, headings: [], bodyText: EV, evidence: { "page-copy-1": EV }, trackedQuestion: null, ownedPaths: ["/totes"], bannedTerms: [] };
  // A CLAIM WORD THAT ONLY SPELLS ITSELF INSIDE AN EVIDENCE WORD IS NOT SUPPORT. "The evidence carries this" was asked with String.includes, so evidence reading "credit" was held to carry copy saying "red": a colour nobody ever observed, published as a fact about a customer's product. EXACT NORMALIZED TOKEN MEMBERSHIP, singular and plural counted as one word, and nothing here is a claim about meaning: the judge stays the only reader of that, and the faithful paraphrase pinned above still passes.
  // THE YES NAMES EVERYTHING THE OPERATOR READ. The stamp used to fold the copy, the pieces, their destinations and their grades and nothing else, so fourteen material things on the screen a person confirms could be rewritten under a stamp that still matched: the line being replaced, where the copy lands, what survives a page move, the risks, the caveats, the steps, the reason a page is left alone, every claim, the ids it stands on, the exact quoted words behind them, the readings, the days they were taken, what could not be checked, and what would overturn the diagnosis. Every one of them moves the version now; the ranking, the clock and the measurement figures do not, because none of them is the change.
  it("mints a different version for everything material on the screen, and the same one for everything that is not", () => {
    const piece = comp({ kind: "consolidation", risk: "dangerous", label: "Merge the two pages", page: "/a", before: "Comedians", after: "Iranian Comedians: the 12 names people search",
      redirectTo: "https://fixture-content.example/keep", preserves: { keeps: ["the photo gallery"], losses: [{ what: "the old address", why: "it forwards now" }] } });
    const ITEM = { key: "demand-exact", kind: "gsc_demand" as const, fact: "That one search brings this page 6,000 views and 90 clicks.", observedAt: "2026-07-24T00:00:00.000Z", observationId: "obs-1" };
    const deep = { ...bundleOf([piece]), risks: ["The old address stops answering."], receipt: { items: [ITEM, { ...ITEM, key: "serp1", kind: "serp" as const, fact: "Two of your pages come up for it." }], missing: ["the results page for this search"], freshestObservedAt: ITEM.observedAt },
      dispositions: [{ page: "/a", verdict: "differentiate" as const, because: "it has to say what it alone covers" }, { page: "/b", verdict: "keep_as_is" as const, because: "nothing came back that would not narrow it" }] };
    const CHANGE = { kind: "existing_edit" as const, field: "title" as const, before: "Comedians", after: "Iranian Comedians: the 12 names people search", where: "the page title" };
    const FIND = { cause: "cannibalization" as const, action: null, evidenceKeys: [], explanation: "2 of your own pages come up for it.", competingExplanations: [{ cause: "ctr_snippet" as const, reason: "the line Google shows already says it" }], notConsidered: [{ cause: "demand_decline" as const, missing: "no history on file" }], falsifier: "the split closes", payload: { cause: "cannibalization" as const, competingPaths: ["/a", "/b"], comparison: [], survivor: null } };
    const full = prop({ status: "needs_review", riskLevel: "high", basis: "b1", copyStamp: "A|A|desc|one>two", limitations: ["Check the forward before you publish it.", "Read the gallery note."], operatorSteps: ["Open the site editor", "Add the forward"],
      recommendedChange: CHANGE, bundle: deep, diagnosisCause: "cannibalization", causeFinding: FIND, claims: [{ text: "Two pages come up for this search", supportedBy: ["k1", "k2"] }], supportFacts: [{ id: "k1", fact: "163 clicks lost in 4 weeks." }, { id: "k2", fact: "Both pages rank for it." }] });
    const base = confirmedVersion(full), V = (over: Partial<ChangeProposal>) => confirmedVersion({ ...full, ...over } as ChangeProposal);
    const B = (over: Partial<ChangeBundle>) => V({ bundle: { ...deep, ...over } }), C = (over: Partial<BundleComponent>) => B({ components: [{ ...piece, ...over }] });
    const R = (over: Record<string, unknown>) => B({ receipt: { ...deep.receipt, ...over } }), item = (over: Record<string, unknown>) => R({ items: [{ ...ITEM, ...over }, deep.receipt.items[1]!] });
    const moved: Array<[string, string]> = [["recommended after", V({ recommendedChange: { ...CHANGE, after: "A different line entirely" } })], ["recommended before", V({ recommendedChange: { ...CHANGE, before: "Something else was there" } })],
      ["placement", V({ recommendedChange: { ...CHANGE, where: "somewhere else entirely" } })], ["component copy", C({ after: "A completely different piece of copy" })], ["component page", C({ page: "/somewhere-else" })],
      ["redirect destination", C({ redirectTo: "https://fixture-content.example/elsewhere" })], ["component risk", C({ risk: "safe" })], ["what survives", C({ preserves: { keeps: [], losses: [] } })],
      ["proposal risk", V({ riskLevel: "low" })], ["bundle risks", B({ risks: ["Something else happens."] })], ["limitations", V({ limitations: ["An entirely different caveat."] })], ["operator steps", V({ operatorSteps: ["Do something else"] })],
      ["disposition verdict", B({ dispositions: [{ ...deep.dispositions[0]!, verdict: "keep_as_is" }, deep.dispositions[1]!] })], ["disposition reason", B({ dispositions: [{ ...deep.dispositions[0]!, because: "an entirely different reason" }, deep.dispositions[1]!] })],
      ["claim text", V({ claims: [{ text: "Something else is true", supportedBy: ["k1", "k2"] }] })], ["claim support ids", V({ claims: [{ text: "Two pages come up for this search", supportedBy: ["k1"] }] })],
      ["quoted evidence", V({ supportFacts: [{ id: "k1", fact: "A different quoted fact." }, { id: "k2", fact: "Both pages rank for it." }] })], ["receipt fact", item({ fact: "A different reading entirely." })],
      ["observation identity", item({ observationId: "obs-2" })], ["reading date", item({ observedAt: "2026-07-01T00:00:00.000Z" })], ["what could not be checked", R({ missing: ["something else entirely"] })],
      ["basis", V({ basis: "b2" })], ["copy stamp", V({ copyStamp: "the page reads differently now" })], ["diagnosis", V({ causeFinding: { ...FIND, explanation: "a different reading of it" } })], ["what would overturn it", V({ causeFinding: { ...FIND, falsifier: "something else would" } })]];
    const same: Array<[string, string]> = [["where the queue put it", V({ rankingReceipt: { score: 9, factors: [], directional: true, basis: "b" }, whyRankedAboveNext: "It beats the next one." })],
      ["when it was drafted", V({ createdAt: "2026-08-14T00:00:00.000Z" })], ["what it is worth", V({ impactScore: 4242, upsidePerMonth: 4242, demandImpressions90d: 99_000 })],
      ["the order of the caveats", V({ limitations: reverse(full.limitations) })], ["the order of the support ids", V({ claims: [{ text: "Two pages come up for this search", supportedBy: ["k2", "k1"] }] })],
      ["the order of the readings", R({ items: reverse(deep.receipt.items) })], ["the order of the risks", B({ risks: reverse(deep.risks) })]];
    expect([moved.filter(([, v]) => v === base).map(([k]) => k), same.filter(([, v]) => v !== base).map(([k]) => k)]).toEqual([[], []]); });

  // BANKED WORDS ARE RE-READ BEFORE THEY ARE SERVED AGAIN. Preserving finished copy on an unchanged identity skipped every gate it was written under, so a stored ready card outlived both the rules that would refuse it and its own evidence: identity says the page and the argument have not moved, and says nothing about whether the words still stand. The re-read is $0, buys no judging and no fresh reading, and REFUSES rather than repairs: a card it will not preserve goes back through the normal drafting path. What it is not holding it skips, so a page nobody could read this pass costs no copy at all.
  it("will not preserve banked copy today's rules would refuse, or copy whose support moved underneath it", () => {
    const SHIP = "International shipping is available worldwide, with delivery usually between 7-21 business days depending on location."; const CREDIT = "Every order earns store credit toward the next pair at the Tehran studio.";
    const GOOD = "International shipping worldwide, with delivery usually between 7-21 business days, and every order earns store credit toward the next pair.";
    const banked = prop({ status: "ready", changeFamily: "missing_description", pagePath: "/shoes", pageUrl: "https://fixture-content.example/shoes",
      claims: [{ text: "International shipping worldwide takes 7-21 business days", supportedBy: ["card-1"] }, { text: "Every order earns store credit toward the next pair", supportedBy: ["card-2"] }],
      supportFacts: [{ id: "card-1", fact: SHIP }, { id: "card-2", fact: CREDIT }],
      recommendedChange: { kind: "existing_edit", field: "meta", before: "Learn about Persian shoes.", after: GOOD } });
    const page = { title: "Persian Shoes", h1: "Persian Shoes", metaDescription: "Learn about Persian shoes.", outline: [] };
    const why = (over: Partial<ChangeProposal> = {}, held: typeof page | null = page) => staleCopyReasons({ ...banked, ...over } as ChangeProposal, new Map(), [], held);
    const copy = (after: string) => ({ recommendedChange: { kind: "existing_edit" as const, field: "meta" as const, before: "Learn about Persian shoes.", after } });
    expect([why(), why({}, null), why(copy(GOOD.replace("International ", "")))[0], why({ supportFacts: [{ id: "card-1", fact: SHIP }, { id: "card-2", fact: "An entirely different reading nobody wrote this copy from." }] })[0],
      why({ supportFacts: [{ id: "card-1", fact: SHIP }] })[0], why({}, { ...page, metaDescription: "A description this page no longer carries." })[0], why({ claims: undefined })])
      .toEqual([[], [], "the figure's own sentence says international, and the copy drops it",
        'the evidence "Every order earns store credit toward the next pair" names is about something else entirely, so this copy argues from support nobody banked',
        "the evidence its claims name is not banked beside them: card-2", "the line it says it replaces is not the one this page carries", []]); });
  // A WORD IS THE WORD IT IS. The fold that made "showcase" and "showcases" one token also made "rate" and "rat" one, so evidence about a rat was read as carrying copy about a rate, in both directions. Only the tokenizer's own over-trim is repaired now.
  // THE THREE LANES, AND THE ONE DEMOTION THAT KEEPS THE WORK. Nothing written is research; exact copy owing only a look is a draft a person may approve; copy whose placement nobody can re-check is a draft nobody may approve, and its words, claims and evidence are untouched by the demotion.
  it("sorts an opportunity into one lane only, and demotes unre-checkable placement instead of deleting it", () => {
    const BODY = "Rain barrels for a 1,200 square foot roof hold 50 gallons of the runoff that roof sheds in an inch of rain.";
    const body = { kind: "existing_edit" as const, field: "section" as const, before: null, after: BODY, where: 'A new section headed "Sizing", placed after "The studio cuts every barrel."' };
    const placed = prop({ status: "ready", claims: [{ text: "The studio cuts every barrel", supportedBy: ["card-1"] }],
      supportFacts: [{ id: "card-1", fact: "The studio cuts every barrel." }], recommendedChange: body });
    const lost = { ...placed, supportFacts: [{ id: "card-1", fact: "A reading that no longer quotes that sentence." }] } as ChangeProposal;
    const brief = prop({ researchOnly: true, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Write a description of about 150 characters." } }); const lanes = [openHold(placed), openHold(lost), openHold(brief)];
    expect([lanes.map((h) => h.lane), lanes.map((h) => h.blocking == null), lanes[1]!.why[0]!.startsWith("Where this copy goes can no longer be checked"),
      (lost.recommendedChange as { after: string }).after === BODY, lost.claims?.length])
      .toEqual([["review", "review", "research"], [true, false, false], true, true, 1]); });
});

describe("the AI side ranks on recurrence and stage, never on raw answer totals (AEO reconstruction, 2026-08-19)", () => {
  const aiProp = (id: string, ai: Partial<NonNullable<ChangeProposal["aiImpact"]>> & { answers: number; citedRivals: number }) => prop({ id, impactScore: null, demandImpressions90d: null, aiImpact: { audienceWeight: null, mentionRate: 0, ...ai } });
  it("puts a question asked every day for a week above one asked once with ten times the rows", () => {
    const recurring = aiProp("recurring", { answers: 5, citedRivals: 3, days: 7, engines: 4, stage: "owned_retrieved_not_cited" });
    const burst = aiProp("burst", { answers: 50, citedRivals: 3 }); // fifty rows, no recurrence on file
    const ranked = rankProposals([burst, recurring]); expect(ranked.map((p) => p.id)).toEqual(["recurring", "burst"]); const receipt = ranked[0]!.rankingReceipt!.factors.find((f) => f.name === "visibility")!;
    expect(receipt.input).toContain("asked on 7 days across 4 assistants"); // the receipt says the same thing the score used
    expect(receipt.input).toContain("while this page is already read and passed over");
  });
  it("ranks a page already read and passed over above the same claim on a page never retrieved", () => {
    const shared = { answers: 5, citedRivals: 3, days: 7, engines: 4 } as const;
    const ranked = rankProposals([
      aiProp("never-read", { ...shared, stage: "rivals_cited_own_not_retrieved" }),
      aiProp("passed-over", { ...shared, stage: "owned_retrieved_not_cited" })]);
    expect(ranked.map((p) => p.id)).toEqual(["passed-over", "never-read"]); // closer to the citation ranks first
  });
});

/** FINISHED COPY SURVIVES EVERYTHING BUT A MATERIAL CHANGE (operator, 2026-08-22): a paused $0 pass reworded its generator's prose and DESTROYED the one Ready change in production. Identity is material now, and a genuine replacement of finished words stamps an inspectable retirement receipt. */

/** A TREATMENT CHANGE IS A DELIVERABLE IDENTITY BOUNDARY (Codex, 2026-08-23). Live, /cities was re-diagnosed technical_reachability ("copy is premature until reachability work is done") while its old finished section draft sat beside that verdict as actionable review work. The swap must retire the copy WITH a receipt, keep the opportunity and its evidence, and land on ordinary days too: the funding filter that keeps non-writing treatments away from the editor was also the only path that persisted them outside quiet days. */
describe("a changed treatment retires the copy it makes premature, on any kind of day", () => {
  const CITIES = `${TENANT}::/cities::existing_edit::ai_answer_gap`;
  const heldRow = (over: Partial<ChangeProposal> = {}) => prop({ id: CITIES, pagePath: "/cities", pageUrl: "https://fixture-content.example/cities",
    pageLabel: "Cities", primaryQuery: "cities of iran", changeFamily: "section", status: "ready", researchOnly: false, basis: "basis_test",
    recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The finished cities section, drafted when this was still writing work." }, ...over });
  const incoming = (over: Partial<ChangeProposal> = {}) => prop({ id: CITIES, pagePath: "/cities", pageUrl: "https://fixture-content.example/cities",
    pageLabel: "Cities", primaryQuery: "cities of iran", changeFamily: "section", status: "needs_review", researchOnly: true,
    treatment: "technical_reachability", opportunityType: "Win an AI answer",
    recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "No stored answer reports reading this page while rivals are credited, so the work is reachability first." },
    evidence: { query: "cities of iran", hints: ["No stored answer reports reading this page"], evidenceRefCount: 1 }, ...over });
  const runWith = async (card: ChangeProposal) => { vi.resetModules();
    vi.doMock("@/domains/decision/producers/extra", () => ({ extraQueuePass: async () => ({
      run: { cards: [card], complete: true, held: [], needsOwnPage: [], families: ["ai_answer_gap"] }, unitLoad: null }) }));
    const { produceProposalsForTenant: run } = await import("@/domains/decision/produce-proposals");
    env.snap = snapshot(); // /rain-barrels still earns an acted candidate, so this is an ORDINARY day, not a quiet one
    return run(TENANT, { complete: seam, ...OPTS });
  };
  it("retires the finished copy with its receipt, keeps the opportunity as research work, and persists on an ordinary day", async () => {
    store.rows.set(CITIES, heldRow());
    await runWith(incoming());
    const out = store.rows.get(CITIES)!;
    expect(out.previousCopy?.after).toBe("The finished cities section, drafted when this was still writing work.");
    expect(out.previousCopy?.retiredBecause).toContain("technical_reachability");
    // The row IS the research card now: the old words did not survive as the offered change.
    expect(out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "").toContain("reachability first");
    expect([out.researchOnly, out.status === "ready", out.evidence.hints.some((h) => h.includes("reports reading"))]).toEqual([true, false, true]);
  });
  /** FINISHED WORK SURVIVES A SOFT RE-READ AS REVIEW WORK (Codex, 2026-08-23). Live, the /funny-farsi-phrases answer was saved Ready and destroyed back to its own brief ONE SECOND later, because the re-mint's re-read applied the banned-word rule without the exemption the editor had honoured. Soft reasons keep the words, at review, with the reason on the card; only the four hard classes still retire copy. */
  it("keeps finished copy through a soft re-read failure, downgraded to review with the reason, never the brief", async () => {
    const finished = "The finished cities section, with the word Farsi the searchers themselves use.";
    store.rows.set(CITIES, heldRow({ copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap", primaryQuery: "cities of iran",
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: finished, where: 'A new section headed "Cities", placed after "Cities of Iran"' },
      claims: [{ text: finished, supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: finished }] }));
    acct.profile = { trustedSourceDomains: { value: [] }, constraints: { value: { bannedTerms: ["Farsi"] } }, name: { value: "Fixture" } };
    // the re-minted BRIEF, exactly the live shape: same page, same stamps, same diagnosis, no drafting of its own
    await runWith(incoming({ treatment: "add_answer_section", researchOnly: true, status: "needs_review",
      copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap", primaryQuery: "cities of iran" }));
    const out = store.rows.get(CITIES)!;
    const kept = out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "";
    expect(kept).toBe(finished);                                          // THE WORDS SURVIVE
    expect(out.status).toBe("needs_review");                              // downgraded, visible in the Review lane
    expect(out.limitations.join(" ")).toContain("does not publish");      // with the reason on the card
    expect(out.previousCopy).toBeUndefined(); });                         // nothing was retired, because nothing was lost
  /** AND IT REACHES THE ROWS THIS PASS NEVER WORKS. The three live answers were held on pages the day's manifest had already spent on, so no later pass re-read them and the correction never arrived: a row is only re-read when its own page comes back up. This one is stored for a page nothing in the pass touches, and it is still released. Reaching only what a pass happens to work IS the defect. */
  it("releases a held row on a page this pass never touches", async () => {
    const OTHER = "fixture-tenant::/untouched::existing_edit::ai_answer_gap";
    const finished = "The untouched page's finished section answers the question in one sentence and then lists what the page already carries, one item per line, each with the single fact a reader needs about it, written off the page's own stored words and nothing else.";
    store.rows.set(CITIES, heldRow());
    store.rows.set(OTHER, heldRow({ id: OTHER, pagePath: "/untouched", pageUrl: "https://fixture-content.example/untouched",
      pageLabel: "Untouched", status: "needs_review", researchOnly: false, copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap",
      limitations: ["Read off the last stored copy of this page, so anything added since is not counted here.",
        "it tells a reader this page offers \"habitats\", and no claim on this card carries it"],
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: finished, where: 'A new section headed "Untouched", placed after "Untouched heading"' },
      claims: [{ text: finished, supportedBy: ["page-copy-1"] }],
      supportFacts: [{ id: "page-copy-1", fact: finished }, { id: "page-copy-2", fact: "The page's Untouched heading introduces the list." }] }));
    await runWith(incoming());
    const out = store.rows.get(OTHER)!;
    expect(out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "").toBe(finished);
    // released, the dead rule's own lowercase receipt gone with the hold, and the reader's caveat still there
    expect([out.status, out.limitations.some((l) => l.startsWith("it tells a reader")), out.limitations.some((l) => l.startsWith("Read off"))]).toEqual(["ready", false, true]); });

  /** AND THE SAME SWEEP HOLDS BACK WORK A RULE ADDED TODAY REFUSES. Live and READY on the account at 21:37Z: "Persian girl names here match persian girl names, persian names for girls, persian names girl, persian girls names, persian girl name, and unique persian girl names. People also search persian female names and female persian names." Six of those are one phrase reordered and the next line names a results-page feature. Pasting it costs the operator the ranking the card was bought to win. It keeps every word and it stops being paste-ready. */
  it("holds back a ready row that today's rules refuse, without losing a word of it", async () => {
    const stuffed = "Persian girl names: Afsaneh, Afsoon, Aida.";
    store.rows.set(CITIES, heldRow({ status: "ready", researchOnly: false, copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap",
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: stuffed, where: 'A new section headed "Names", placed after "Names heading"' },
      claims: [{ text: "Persian girl names here include Afsaneh, Afsoon and Aida.", supportedBy: ["page-copy-1"] }],
      supportFacts: [{ id: "page-copy-1", fact: "Persian girl names here include Afsaneh, Afsoon and Aida. Afsaneh: Goddess, divine and strong. Afsoon: Charming, enchanting, and alluring. Aida: Radiance and eternal beauty." },
        { id: "page-copy-2", fact: "The page's Names heading introduces the list." }] }));
    await runWith(incoming({ pagePath: "/elsewhere", pageUrl: "https://fixture-content.example/elsewhere", id: "fixture-tenant::/elsewhere::existing_edit::ai_answer_gap" }));
    const out = store.rows.get(CITIES)!;
    expect(out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "").toBe(stuffed); // every word kept
    expect(out.status).toBe("needs_review");
    expect(out.limitations.join(" ")).toContain("outside the"); });

  /** AND ON A DAY WHEN NOTHING EARNS AN ACTION, WHICH IS THE DAY IT MATTERS MOST. A quiet pass returns before the editor ever runs, and the sweep sat behind that return: live, the stuffed answer survived a pass that rewrote fifteen other rows, because the one branch it took never reached the re-read. A stocked queue makes quiet days the NORMAL case, so a sweep only ordinary days reach is a sweep that runs exactly when it is not needed. */
  it("re-reads stored rows on a day nothing earns an action", async () => {
    const OTHER = "fixture-tenant::/quiet-page::existing_edit::ai_answer_gap";
    const stuffed = "Persian girl names: Afsaneh, Afsoon, Aida.";
    store.rows.set(OTHER, heldRow({ id: OTHER, pagePath: "/quiet-page", pageUrl: "https://fixture-content.example/quiet-page",
      pageLabel: "Quiet", status: "ready", researchOnly: false, copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap",
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: stuffed, where: 'A new section headed "Names", placed after "Names heading"' },
      claims: [{ text: "Persian girl names here include Afsaneh, Afsoon and Aida.", supportedBy: ["page-copy-1"] }],
      supportFacts: [{ id: "page-copy-1", fact: "Persian girl names here include Afsaneh, Afsoon and Aida. Afsaneh: Goddess, divine and strong. Afsoon: Charming, enchanting, and alluring. Aida: Radiance and eternal beauty." },
        { id: "page-copy-2", fact: "The page's Names heading introduces the list." }] }));
    vi.resetModules();
    vi.doMock("@/domains/decision/producers/extra", () => ({ extraQueuePass: async () => ({ run: { cards: [], complete: true, held: [], needsOwnPage: [], families: ["ai_answer_gap"] }, unitLoad: null }) }));
    const { produceProposalsForTenant: run } = await import("@/domains/decision/produce-proposals");
    env.snap = snapshot({ ownedPages: [] }); // nothing earns an action, so this pass returns before the editor
    await run(TENANT, { complete: seam, ...OPTS });
    const out = store.rows.get(OTHER)!;
    expect(out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "").toBe(stuffed);
    expect([out.status, out.limitations.join(" ").includes("outside the")]).toEqual(["needs_review", true]); });

  /** AND IT DOES NOT RELEASE WHAT A MODEL LOOKED AT AND REFUSED. The release strips the gate's own lowercase lines, so a hold written in lowercase was being DELETED rather than obeyed, and the fitness check then read a row the hold had already been erased from. An evaluator's refusal is not a deterministic one: a model read the copy and said what was wrong with it, and no re-read of rules can answer that. Only a fresh draft can. */
  it("leaves a row a model refused where the model put it", async () => {
    const JUDGED = "fixture-tenant::/judged::existing_edit::ai_answer_gap";
    const words = "The judged page's section answers the question in one sentence and then lists what the page already carries, one item per line, each with the single fact a reader needs about it, under a heading a reader would look for.";
    const row = (lim: string[]) => heldRow({ id: JUDGED, pagePath: "/judged", pageUrl: "https://fixture-content.example/judged",
      pageLabel: "Judged", status: "needs_review", researchOnly: false, copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap", limitations: lim,
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: words, where: 'A new section headed "Judged", placed after "Judged heading"' },
      claims: [{ text: words, supportedBy: ["page-copy-1"] }],
      supportFacts: [{ id: "page-copy-1", fact: words }, { id: "page-copy-2", fact: "The page's Judged heading introduces the list." }] });
    // 1. a model's own objection holds, and its words stay on the card
    store.rows.set(JUDGED, row(["the evaluator's exact objection: it only repeats what the page already says"]));
    await runWith(incoming());
    const judged = store.rows.get(JUDGED)!;
    expect([judged.status, judged.limitations.some((l) => l.includes("evaluator"))]).toEqual(["needs_review", true]);
    // 2. a hold written in lowercase that names a missing source is obeyed, not deleted
    store.rows.set(JUDGED, row(["this one still needs a cited authoritative source before it is paste-ready"]));
    await runWith(incoming());
    expect(store.rows.get(JUDGED)!.status).toBe("needs_review");
    // 3. BOTH rules withdrawn today release the row, because withdrawing a rule and not naming its receipt
    //    strands every row it held with an objection nothing stands behind and no way back but a redraft
    for (const gone of ["it tells a reader this page offers \"habitats\", and no claim on this card carries it",
      "it tells a reader this page offers \"wool rugs\", and this page never puts those words together"]) {
      store.rows.set(JUDGED, row([gone]));
      await runWith(incoming());
      expect(store.rows.get(JUDGED)!.status).toBe("ready"); }
    // 4. and a note that merely ENDS the same way is a person's sentence, not the gate's line: it holds
    store.rows.set(JUDGED, row(["the operator read this and no claim on this card carries it"]));
    await runWith(incoming());
    expect(store.rows.get(JUDGED)!.status).toBe("needs_review"); });

  it("retires nothing when there is no finished copy to make premature", async () => {
    store.rows.set(CITIES, heldRow({ researchOnly: true, status: "needs_review",
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "An earlier brief, never finished work." } }));
    await runWith(incoming());
    expect(store.rows.get(CITIES)!.previousCopy).toBeUndefined();
  });
});

describe("finished copy survives a pass that cannot redraft", () => {
  const finished = (over: Partial<ChangeProposal> = {}) => prop({ status: "ready", researchOnly: false, copyStamp: "T|H|D|O",
    diagnosisCause: "ai_citation_gap", claims: [{ text: "c", supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: "f" }],
    recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The finished words, one item per line.", where: 'A new section headed "H", placed after "x"' },
    evidence: { query: "rain barrel sizing", hints: ["original hint wording"], evidenceRefCount: 1 }, ...over });
  const brief = (over: Partial<ChangeProposal> = {}) => prop({ status: "needs_review", researchOnly: true, copyStamp: "T|H|D|O",
    diagnosisCause: "ai_citation_gap",
    recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The next pass compares the credited pages first." },
    evidence: { query: "rain barrel sizing", hints: ["COMPLETELY REWORDED HINT", "and a new agreeing observation"], evidenceRefCount: 2 }, ...over });
  it("a reworded brief with new observations and no drafting preserves the finished words, status and receipt-free row", () => {
    const kept = preferFinished(brief(), finished());
    expect([kept.recommendedChange.kind === "existing_edit" ? kept.recommendedChange.after : "", kept.status, kept.researchOnly, kept.previousCopy])
      .toEqual(["The finished words, one item per line.", "ready", false, undefined]);
  });
  it("a MATERIAL change replaces the copy and stamps the retirement receipt with the fact that moved", () => {
    for (const [over, said] of [[{ copyStamp: "THE PAGE WAS RECRAWLED DIFFERENT" }, "content changed"],
      [{ diagnosisCause: "ranking_loss" as const }, "cause changed"]] as const) {
      const out = preferFinished(brief(over), finished()); expect(out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "").toContain("credited pages");
      expect(out.previousCopy?.after).toBe("The finished words, one item per line."); expect(out.previousCopy?.retiredBecause).toContain(said);
    }
  });
});

/** ONE BUDGET, ONE RANKED LINE (operator, 2026-08-22). The top-up spent $1.28 across 239 calls and produced nothing, because every family kept a private pool, one stubborn candidate could eat a pass, and stale work spent in front of the globally ranked line. These pin the arithmetic and the order. */
describe("the paid line is compiled, priced and funded ONCE, before a cent is spent", () => {
  const job = (key: string, family: string, impact: number, calls: number = DRAFT_BUDGET.DELIVERABLE_CALLS): { key: string; family: string; impact: number; calls: number; blocked?: string } => ({ key, family, impact, calls });
  const plan = (jobs: ReturnType<typeof job>[], over: Partial<Parameters<typeof DRAFT_BUDGET.plan>[0]> = {}) => DRAFT_BUDGET.plan({ jobs, candidates: 2, calls: 30, ...over });
  const SMALLS = ["/a", "/b", "/c", "/d"].map((k, i) => job(k, "field_draft", 40 - i)), BUNDLE = job("/bundle", "deep_bundle", 60, DRAFT_BUDGET.BUNDLE_CALLS);
  /** A KNOWN-DEAD JOB TAKES NO SLOT, AND AN UNREACHED ONE DOES NOT HOLD ONE FOREVER (Codex, 2026-08-23). Both were live defects on one dispatch: three of five slots came back unreached while cheaper completable work went unfunded, and the same pages would have been funded first again on the next drive. */
  it("declares a blocked job with its own reason and funds it never, so the money walks to the next one that can finish", () => {
    const b = plan([{ ...job("/measuring", "editor", 90), blocked: "a change on this page is already being measured, so a second one cannot be saved until that finishes" },
      job("/live", "editor", 40), job("/next", "editor", 30)], { candidates: 1 });
    // EXCLUDED from `declared`, because a blocked job can never be funded and so can never settle: leaving it there made "every declared candidate is settled" unreachable, which held the day open and re-drove it on every visit.
    expect(b.declared).not.toContain("/measuring");
    expect(b.funded.map((f) => f.key)).toEqual(["/live"]); // and the slot went to the strongest job that can be done
    expect(b.declined.find((d) => d.key === "/measuring")?.reason).toContain("already being measured");
    expect(b.declined.find((d) => d.key === "/next")?.reason).toContain("stronger work filled them"); }); // an ordinary refusal still reads as one
  it("lets a live job outrank a blocked one on the same page, whatever the scores say", () => {
    const b = plan([{ ...job("/p", "field_draft", 90), blocked: "this work was already taken back under this evidence, so it is not offered again" },
      job("/p", "editor", 10)], { candidates: 1 });
    expect(b.funded.map((f) => [f.key, f.family, f.impact])).toEqual([["/p", "editor", 10]]); // ONE page, and the family that can still do something owns it
    expect(b.declined).toEqual([]); });
  /** A CANDIDATE SELECTED AND NOT STARTED IS OWED FIRST, NOT LAST (Codex, 2026-08-23). Sorting unreached work to the back put /persian-female-first-names, worth 560 recoverable clicks, behind a product page worth 0.22 and a category page worth 0.13, and left it unattempted for a third dispatch running. A CANDIDATE THAT WAS TRIED AND SPENT MAY NOT RE-CONSUME EVERY DRIVE (Codex, 2026-08-23). /persian-female-first-names spent seven provider calls, came back transiently blocked, and was top-ranked again on the next drive, taking the whole box while the page behind it went unreached for a sixth dispatch. It stays owed; it just goes after work nobody has tried. This is the OPPOSITE population to the deferral that was deleted, which demoted work never started. */
  it("ranks a candidate that was tried and spent behind work nobody has tried, without writing it off", () => {
    const jobs = [job("/strong", "editor", 560), job("/next", "editor", 312), job("/small", "editor", 9)];
    expect(plan(jobs, { candidates: 1 }).funded.map((f) => f.key)).toEqual(["/strong"]);
    const after = plan(jobs, { candidates: 1, retry: ["/strong"] }); // it spent seven calls and came back blocked
    expect(after.funded.map((f) => f.key)).toEqual(["/next"]);        // the page behind it finally gets the drive
    expect(after.declared).toEqual(["/next", "/small", "/strong"]);   // and it is still declared, still owed, never written off
    expect(plan(jobs, { candidates: 3, retry: ["/strong"] }).funded.map((f) => f.key)).toEqual(["/next", "/small", "/strong"]); });
  it("funds the strongest candidate again the moment it was not reached, ahead of work worth a hundredth of it", () => {
    const jobs = [job("/strong", "editor", 560), job("/tiny", "editor", 0.22), job("/tinier", "editor", 0.13)];
    expect(plan(jobs, { candidates: 1 }).funded.map((f) => f.key)).toEqual(["/strong"]);
    // the drive ran out of time and never started it: the next plan puts it first again, because nothing settled it
    expect(plan(jobs, { candidates: 2 }).funded.map((f) => f.key)).toEqual(["/strong", "/tiny"]);
    // and only a SETTLED page steps aside, which is the caller's skip list and never a demotion
    expect(plan(jobs, { candidates: 1, skip: ["/strong"] }).funded.map((f) => f.key)).toEqual(["/tiny"]); });
  it("gives the first funded slot to the best ranked ordinary candidate, however early an unranked family asks for it", () => {
    // THE EXACT DEFECT (Codex, 2026-08-22): the new page and the correction review were minted first and claimed first, so they took the pass's slots before the strongest completable change was ever reached. Asking order is not a ranking, so nothing claims by asking any more.
    const b = plan([job("topic:wildlife", "new_page", 4, DRAFT_BUDGET.BUNDLE_CALLS), job("/rugs", "correction_review", 3), job("/best", "field_draft", 90)]); expect(b.funded[0]!.key).toBe("/best");
    // Impact orders the line: the strongest candidate leads however early the weak new page asked; with two slots the new page funds BEHIND it and the weakest is declined for slots, never for asking late.
    expect([b.funded.map((f) => f.key), b.take("/best") != null, b.declined[0]?.key]).toEqual([["/best", "topic:wildlife"], true, "/rugs"]);
  });
  it("collapses every family that wants one page into ONE funded job, so two slots cover two pages and not one page twice", () => {
    // THE DEFECT (Codex, 2026-08-22): a deep bundle and an editor card on one page were two candidates and two allowances, so a rewrite that SUCCEEDED left the editor's slot funded and unused, and one that FAILED let the same page spend twelve calls and then three more while other pages went unfunded.
    const b = plan([job("/one", "deep_bundle", 60, DRAFT_BUDGET.BUNDLE_CALLS), job("/one", "editor", 55), job("/next", "field_draft", 30)]);
    // THE PAGE GETS THE TREATMENT WITH THE HIGHEST EXPECTED SITE IMPACT (Codex, 2026-08-23): the bundle at 60 beats the editor at 55, WINS AT ITS OWN PRICE, and keeps ITS OWN score: a cheap edit never inherits the expected value of the rewrite it does not perform, and cost breaks ties only.
    expect(b.funded.map((f) => [f.key, f.family, f.calls, f.impact, [...f.fallbacks]])).toEqual([["/one", "deep_bundle", 12, 60, ["editor"]], ["/next", "field_draft", DRAFT_BUDGET.DELIVERABLE_CALLS, 30, []]]);
    const winner = b.draw("/one", 12)!; winner.left = 0; // the winning treatment produced, spending its allowance
    expect([b.draw("/one", DRAFT_BUDGET.DELIVERABLE_CALLS), b.spent().calls]).toEqual([null, 12]); }); // and nothing else on that page may spend after it
  it("lets a failed rewrite's fallback draw its own price from the SAME allowance, never a second one", () => {
    const b = plan([job("/one", "deep_bundle", 90, DRAFT_BUDGET.BUNDLE_CALLS), job("/one", "editor", 20)], { candidates: 5 }); // 90/12 beats 20/6, so the bundle genuinely wins this page and the editor is its fallback
    const rewrite = b.draw("/one", DRAFT_BUDGET.BUNDLE_CALLS)!; rewrite.left = 10; // refused after two units
    const editor = b.draw("/one", DRAFT_BUDGET.DELIVERABLE_CALLS)!;
    expect(editor.left).toBe(DRAFT_BUDGET.DELIVERABLE_CALLS); // its OWN deliverable's price, never the page's whole remainder
    editor.left = 0;
    expect([b.spent().calls, b.funded.length]).toEqual([2 + DRAFT_BUDGET.DELIVERABLE_CALLS, 1]); }); // two calls, then one deliverable's worth, all inside the ONE twelve-call allowance on ONE funded candidate
  it("refuses a key nobody put on the manifest, whenever it asks", () => expect(plan([job("/best", "field_draft", 90)]).take("/never-declared")).toBeNull());
  it("prices a whole page and a deep bundle at TWELVE charged calls, and shows that price to the ranking before it funds one", () => {
    const b = plan([BUNDLE], { candidates: 5 }); expect([DRAFT_BUDGET.BUNDLE_CALLS, b.funded[0]!.calls, b.take("/bundle")!.left]).toEqual([12, 12, 12]); });
  it("does not let one expensive bundle silently starve several higher-value small changes", () => {
    expect(plan([BUNDLE, ...SMALLS], { candidates: 5, calls: 40 }).funded.map((f) => f.key)).toEqual(["/bundle", "/a", "/b", "/c", "/d"]); // impact orders the line: the 60-impact bundle leads and everything still fits in forty
    const tight = plan([BUNDLE, ...SMALLS], { candidates: 5, calls: 33 }); // and when the last cheap job does not fit, the walk KEPT funding strong work past the expensive leader instead of starving on it
    expect([tight.funded.map((f) => f.key), tight.declined.map((d) => d.reason)]).toEqual([["/bundle", "/a", "/b", "/c"], ["this needs 6 charged calls and 3 were left"]]);
  });
  it("never lets the families together exceed the pass ceiling", () => expect(DRAFT_BUDGET.plan({ jobs: Array.from({ length: 50 }, (_, i) => job(`/p${i}`, "field_draft", 50 - i)), candidates: 50, calls: 7 })
    .funded.reduce((n, f) => n + f.calls, 0)).toBeLessThanOrEqual(7));
  it("funds nothing at all while the provider's own credit is spent", () => {
    const b = plan([job("/best", "field_draft", 90)], { breakerOpen: true }); expect([b.funded, b.take("/best"), b.spent().calls]).toEqual([[], null, 0]); });
  it("caps one candidate at ONE deliverable's price, banks the failure and still funds the next", () => {
    const b = plan([job("/best", "field_draft", 90), job("/second", "field_draft", 80)], { calls: 40 });
    const first = b.take("/best")!; expect(first.left).toBe(DRAFT_BUDGET.DELIVERABLE_CALLS); // a draft, its judge, and the retries the editor is built to make
    first.left = 0;                                   // the candidate spent its whole allowance and finished nothing
    expect([b.take("/best"), b.take("/second") != null, b.spent().calls]).toEqual([null, true, DRAFT_BUDGET.DELIVERABLE_CALLS]);
  });
});
