/** The ONE change contract: an existing-page repair (Slice 7), and NOTHING ELSE. Selection on a PROVEN recoverable gap, receipt-first grounding for the EXACT candidate search, scope named on every number, QUERY IDENTITY per query, winners attaching only on exact membership, atomic bundling, confidence and readiness by EVIDENCE HELD, determinism, honest refusal, no page is ever invented however much research backs the topic, a release publishing only on a real production result, dedupe, and a round trip. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"; import type { BundleComponent, BundleComponentKind, ChangeBundle, ChangeProposal } from "@/domains/decision/contracts";
import { receiptComposition } from "@/domains/decision/contracts"; import { confirmedVersion, deliverableGaps, openHold, preferFinished } from "@/domains/decision/completeness"; import { acceptDeliverable, applyDraftedCopy, deliverableFailures, draftFieldForPage, staleCopyReasons, withoutCta } from "@/domains/decision/drafted-copy";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { proposalFingerprint } from "@/domains/decision/proposal-store"; import { DANGEROUS_COMPONENT_KINDS, dangerousComponents, needsSourcePack } from "@/domains/decision/contracts"; import { rankProposals, proposalValueScore } from "@/domains/decision/rank-proposals"; import { validateProposal } from "@/domains/decision/validate-proposal";
const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>() })); const env = vi.hoisted(() => ({ snap: null as unknown })); vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) })); vi.mock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadChangeProposals: async () => store.rows, saveChangeProposal: async (p: ChangeProposal) => { store.rows.set(p.id, p); },
  withdrawnProposalIds: async () => new Set<string>(), withdrawChangeProposal: async () => true }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
const factStore = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => ({ ...(await orig<Record<string, unknown>>()), readFactChecks: async () => factStore.rows })); const bodyStore = vi.hoisted(() => ({ map: null as null | Map<string, unknown> }));
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
    search: { clicks90d: 120, impressions90d: 9000, ctr90d: 0.013, position90d: 8, topQueries: [{ query: "rain barrel sizing", impressions: 6000, clicks: 90, position: 3 }, { query: "how many gallons rain barrel", impressions: 2000, clicks: 20, position: 11 }] }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] }, ...over });
/** ONE canonical answer as the store files it: every identity field present, because a row that exists was settled under a current question on a named day. */ const canonObs = (o: Partial<CanonicalPairObservation> & { promptText: string; observedAt: string }): CanonicalPairObservation => ({ promptId: o.promptText, promptVersion: 1, engine: "chatgpt", observationMode: "consumer_search", modelRequested: null, modelServed: null, answerHash: "h", webSearchReported: true, fanOutQueries: null, citations: null, retrievedResults: null, brandMentions: null, analysis: null, ...o, observationId: o.observationId ?? `obs_${o.promptId ?? o.promptText}_${o.engine ?? "chatgpt"}`, reportingDay: o.reportingDay ?? o.observedAt.slice(0, 10), citationsObserved: (o.citations ?? null) != null });
const COMPOST = { clicks90d: 5, impressions90d: 1200, ctr90d: 0.004, position90d: 6, topQueries: [{ query: "compost bin sizing", impressions: 1200, clicks: 5, position: 6 }] }; const WIN1 = "https://gardenguide.example/a"; const RESEARCH = { ...emptyResearchEvidence(),
  retainedKeywords: [{ query: "rain barrel sizing", searchVolume: 4400, competition: 0.2, competitionLevel: "low" as const, difficulty: null, intent: "informational" }, { query: "how many gallons rain barrel", searchVolume: 880, competition: 0.1, competitionLevel: "low" as const, difficulty: null, intent: "informational" }],
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
    expect(p.impactScore).toBe(177); // the 28-day-equivalent shortfall, normalised once at evidence/demand-units expect(bundle.components.map((c) => c.kind)).toEqual(["title"]); expect(bundle.components[0].before).toBe("Rain Barrels"); expect(bundle.components[0].after).toBe(TITLE_AFTER); expect(p.recommendedChange).toEqual({ kind: "existing_edit", field: "title", before: "Rain Barrels", after: TITLE_AFTER }); expect(bundle.receipt.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["gsc_demand", "page_extract", "keyword", "serp", "ai_observation", "winning_page"]));
    expect(bundle.components[0].evidenceKeys).toEqual(["demand-exact", "copy-current", "serp1", "serp-owned", "serp-pattern"]); expect(bundle.receipt.items.find((i) => i.key === "copy-current")!.fact).toBe('Read on 2026-07-20, this page was titled "Rain Barrels" and ran 900 words across 3 sections.'); expect(bundle.receipt.items.find((i) => i.key === "serp-owned")!.fact).toBe('On that results page Google shows this page worded "Rain Barrels".'); expect(bundle.receipt.items.find((i) => i.key === "serp-pattern")!.fact).toBe('Across the other pages that come up for "rain barrel sizing", "barrel", "rain", "sizing" recur in the wording Google shows.'); expect([bundle.receipt.items.some((i) => i.fact.startsWith("The results page was checked:")), bundle.confidenceReasons.some((r) => r.startsWith("The results page was checked:"))]).toEqual([true, false]); // the diagnosis is on the receipt once, never repeated back as a reason
    expect(bundle.alternatives[0]).toEqual({ option: "Google is already showing the words people search for", reason: 'Google shows this page as "Rain Barrels", and that line does not say "sizing".' }); expect(bundle.receipt.freshestObservedAt).toBe("2026-07-22T00:00:00.000Z"); expectKeysResolve(bundle); expectCleanCopy(p); expect(bundle.scope).toEqual({ queries: ["rain barrel sizing", "how many gallons rain barrel"], prompts: ["what size rain barrel do I need"] }); // the answer whose own fan-out ran this page's search, and no other expect(bundle.alternatives.some((a) => a.option.includes("/compost"))).toBe(true); expect(p.evidence.evidenceRefCount).toBe(bundle.receipt.items.length); // the count IS the receipt
    expect(p.diagnosisCause).toBe("ctr_snippet"); }); // the named cause rides to the ranker, so cause and lever are judged together on a real change
  it("names every number's scope, so a page total is never read as one search", async () => { const out = await produceBundleForSnapshot(snapshot(), { complete: seam, ...OPTS }); if (out.status !== "bundled") throw new Error("expected a change"); const p = out.proposal; const b = p.bundle!; const facts = b.receipt.items.filter((i) => i.kind === "gsc_demand").map((i) => i.fact); expect(facts[0]).toBe("This page overall: 120 clicks from 9,000 views, position 8 (90 days)."); // the page total, said as a page total
    expect(facts[1]).toBe('"rain barrel sizing": 6,000 views, 90 clicks, position 3 (90 days).'); for (const line of [p.whyItMatters, b.objective, b.confidenceReasons[0]]) expect(line).not.toContain("9,000"); // no query claim ever borrows the page total
    expect(p.whyItMatters).toBe('6,000 people saw this page for "rain barrel sizing" in 90 days and 90 clicked. A page at position 3 usually earns about 660, so about 570 clicks are being left.'); expect(b.receipt.items.find((i) => i.kind === "ai_observation")!.fact).toBe('When a customer searches "what size rain barrel do I need" inside an assistant, it points people at gardenguide.example. To answer it the assistant went and searched "rain barrel sizing".'); });
  it("puts what the answers SAID on the receipt, dated and attributed, and never lets an engine's claim become source material", async () => {
    const read = (o: CanonicalPairObservation, analysis: Record<string, unknown>): CanonicalPairObservation => ({ ...o, analysis });
    const both = { competitors: [{ name: "waterwise", position: 1 }], materialOmissions: ["what a first flush diverter costs", "whether the rules changed currently"], sections: [{ heading: "Roof area", covers: "x" }], claims: [{ subject: "roof area", text: "A 1,000 square foot roof yields 600 gallons an inch" }], caveats: ["prices vary by state"] };
    const out = await produceBundleForSnapshot(snapshot({ research: { ...RESEARCH, aiObservations: [read(RESEARCH.aiObservations[0]!, { ...both, contentTypesRecommended: ["a sizing table"], sections: [...both.sections, { heading: "Overflow", covers: "y" }] }), read({ ...RESEARCH.aiObservations[1]!, fanOutQueries: ["rain barrel sizing"] }, both)] } }), { complete: seam, ...OPTS });
    if (out.status !== "bundled") throw new Error("expected a change"); const items = out.proposal.bundle!.receipt.items; const at = (k: string) => items.find((i) => i.key === k); expect([at("named1")!.fact, at("named1")!.observationIds, at("named1")!.observationId, at("named1")!.observedAt]).toEqual(["The answers to 2 of the questions I track name waterwise as an option for this.", ["obs_p1_chatgpt", "obs_p2_gemini"], undefined, "2026-07-22T00:00:00.000Z"]); // a sentence about SEVERAL answers names every one of them, and never lets one of them stand in for the rest
    expect([at("format1")!.fact, at("format1")!.observationId, at("format1")!.observationIds]).toEqual(["One answer I hold here asks for a sizing table.", "obs_p1_chatgpt", undefined]); // one answer is said as one answer, never as agreement, and keeps the singular id it always wore
    expect([at("missing1")!.fact, at("brandnamed")!.fact]).toEqual(["The answers to 2 of the questions I track leave this unanswered: what a first flush diverter costs", "Not one of the 2 answers I hold here names your own site."]); expect([at("missing2"), items.some((i) => i.fact.includes("currently"))]).toEqual([undefined, false]); expect(out.proposal.bundle!.receipt.missing).toContain("I withheld 1 time-sensitive statement from these answers because I cannot confirm it is still current."); // the change SHIPS, the line that claimed the present is the only thing left out, and the withholding is DISCLOSED instead of dropped in silence
    expect([at("covered1")!.fact, at("covered1")!.observationIds, items.some((i) => i.fact.includes("Overflow"))]).toEqual(['The answers to 2 of the questions I track cover "Roof area".', ["obs_p1_chatgpt", "obs_p2_gemini"], false]); expect(items.map((i) => i.fact).join(" ")).not.toContain("600 gallons"); expect(items.filter((i) => ["named1", "format1", "missing1", "covered1", "brandnamed"].includes(i.key)).every((i) => !!i.observedAt)).toBe(true); // an engine's own claim and its caveats are never grounding for a word of copy, and every line is dated or the one saying "currently" refuses the whole change
    expect([at("brandnamed")!.observationIds, at("brandnamed")!.observationId, at("brandnamed")!.observedAt]).toEqual([["obs_p1_chatgpt", "obs_p2_gemini"], undefined, "2026-07-22T00:00:00.000Z"]); expect(out.proposal.bundle!.components.every((c) => !c.evidenceKeys.includes("missing1"))).toBe(true); expectCleanCopy(out.proposal); // an absence is read off EVERY inspected answer, so it stands on all of them and never on one arbitrary member, and a title is not a piece that covers a gap so the omission never props it up
    const swap = (ids: string[]): ChangeProposal => ({ ...out.proposal, bundle: { ...out.proposal.bundle!, receipt: { ...out.proposal.bundle!.receipt, items: items.map((i) => (i.key === "named1" ? { ...i, observationIds: ids } : i)) } } });
    const was = out.proposal.bundle!.receipt, kept = (l: readonly string[]) => l.filter((m) => !m.startsWith("I withheld")); // a row exactly as it was FILED BEFORE any of this: no answer ids on its lines, no disclosure line under them
    const bare: ChangeProposal = { ...out.proposal, limitations: kept(out.proposal.limitations), bundle: { ...out.proposal.bundle!, receipt: { ...was, missing: kept(was.missing), items: items.map(({ observationId: _drop, observationIds: _also, ...rest }) => rest) } } };
    expect(proposalFingerprint(bare)).toBe("27ace7bc2d34dfd5"); expect(new Set([out.proposal, swap(["obs_p1_chatgpt", "obs_somebody_else"]), bare].map(proposalFingerprint)).size).toBe(3); expect(proposalFingerprint(swap(["obs_p2_gemini", "obs_p1_chatgpt"]))).toBe(proposalFingerprint(out.proposal)); // the same support in another order is the same support
    expect(deserializeChangeProposal(serializeChangeProposal(out.proposal))!.bundle!.receipt.items.find((i) => i.key === "named1")!.observationIds).toEqual(["obs_p1_chatgpt", "obs_p2_gemini"]); }); // and the WHOLE set survives being stored and read back
  it("lets an omission the answers keep leaving ADD support to a piece that stands on its own, and never rescue one that stands on nothing", async () => {
    const both = { competitors: [], materialOmissions: ["what a first flush diverter costs"], contentTypesRecommended: [] };
    const world = snapshot({ research: { ...RESEARCH, serpEvidence: [], aiObservations: [{ ...RESEARCH.aiObservations[0]!, analysis: { ...both, sections: [{ heading: "Only this one answer covers it", covers: "z" }] } }, { ...RESEARCH.aiObservations[1]!, fanOutQueries: ["rain barrel sizing"], analysis: both }] } });
    const slots = Object.keys(CORE_PRODUCERS) as (keyof typeof CORE_PRODUCERS)[]; const held = slots.map((k) => [k, CORE_PRODUCERS[k]] as const);
    const piece = (label: string, evidenceKeys: string[]): BundleComponent => ({ kind: "section_add", label, before: null, after: "A rain barrel sized for your roof area holds what one storm gives you.", evidenceKeys, risk: "review",
      where: "After the opening", objective: "Answer what the assistants leave out", mechanism: "The answers I hold never cover it, so the page that does is the one they can name", measurementPlan: "Clicks for this search over 28 days" });
    for (const k of [...slots, "ai_citation_gap"]) (CORE_PRODUCERS as Record<string, unknown>)[k] = async () => ({ components: [piece("Rescued by an omission", ["ai2"]), piece("Stands on its own", ["demand-page"])] });
    const out = await produceBundleForSnapshot(world, { complete: seam, ...OPTS, door: { door: "recent_decline", entry: "This page was earning and stopped.", evidence: { query: "rain barrel sizing", engine: null, promptText: null, competingUrls: [], window: "the four weeks to 2026-08-01, against the four weeks before" } } });
    for (const [k, v] of held) (CORE_PRODUCERS as Record<string, unknown>)[k] = v; delete (CORE_PRODUCERS as Record<string, unknown>).ai_citation_gap;
    if (out.status !== "bundled") throw new Error(`expected a change, got ${out.reason}`); const b = out.proposal.bundle!; expect(b.components.map((c) => c.label)).toEqual(["Stands on its own"]); expect(b.receipt.items.some((i) => i.key === "covered1")).toBe(false); // a rebuild justified ONLY by an omission somewhere in the case is not proven, and one answer's own outline is never what the answers agree on
    expect(b.alternatives.find((a) => a.option === "Rescued by an omission")!.reason).toContain("There was nothing to show behind that one"); expect(b.components[0]!.evidenceKeys).toEqual(["demand-page", "missing1"]); }); // and the omission still ADDS itself to the piece that already stood up
  it("spends nothing on a search whose results page it has never looked at, and says exactly that", async () => {
    let called = 0; const counting: CompleteFn = async (r) => { called += 1; return seam(r); }; const out = await produceBundleForSnapshot(snapshot({ research: emptyResearchEvidence() }), { complete: counting, ...OPTS });
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
  it.each([ ["a tracked prompt alone", { ...emptyResearchEvidence(), aiObservations: [obs(null)] }, []],
    ["a tracked prompt and one cited page", { ...emptyResearchEvidence(), aiObservations: [obs([{ url: URL2, domain: "waterwise.example", title: "P" }])] }, []],
    ["a tracked prompt and real monthly search volume", { ...emptyResearchEvidence(), aiObservations: [obs(null)], retainedKeywords: [topicKeyword] }, []],
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
    expect(res.proposals.map((p) => [p.id, p.status]).sort()).toEqual([[`${TENANT}::/compost::existing_edit::missing_description`, "needs_review"], [`${TENANT}::/rain-barrels::existing_edit::title-family`, "ready"]]);
    expect(res.held.some((h) => h.pageUrl.includes("/rain-barrels"))).toBe(true);
    const twin = { ...topicSnapshot().ownedPages[1]!, url: "https://other.example/compost", content: { ...topicSnapshot().ownedPages[1]!.content!, title: "Twin Compost Page", h1: "Twin Compost Page" } };
    const dashed = { ...topicSnapshot().ownedPages[1]!, content: { ...topicSnapshot().ownedPages[1]!.content!, title: "Compost | Green \u2014 Co", h1: null } }; // the title is the only line there is, so the dash decides
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
    const soft = { ...topicSnapshot().ownedPages[1]!, search: { ...COMPOST, impressions90d: 600, topQueries: [{ query: "compost bin sizing", impressions: 600, clicks: 5, position: 6 }] } };
    const quiet = looked({ ...topicSnapshot(), ownedPages: [soft], research: asked }); const soften = compileCandidates(quiet)[0]!; const frame = "That is under the bar for a proven change, so this is a quick test, and what it does will be measured.";
    expect(soften.reason).toContain("that search is worth about 8 clicks, under the 16 clicks that earn a change. Watching it rather than asking for work.");
    expect(["and that is only about 7 clicks, under the 50 I act on.", "and that gap is 1.5 percent, under the 2.0 percent I act on.", "and that is too little search to act on yet (I want 500 impressions on one query)."]
      .map((t) => suggestedEdits(quiet, [{ ...soften, cause: { ...soften.cause, cause: "ctr_snippet" as const }, diagnosis: undefined, reason: `Scope. Rates, ${t} Watching it rather than asking for work.` }], { now: OPTS.now!, basis: "b" })[0]!.whyItMatters.split(" This line leads")[0]!))
      .toEqual([`Scope. Rates, and that is only about 7 clicks. ${frame}`, `Scope. Rates, and that gap is 1.5 percent. ${frame}`, `Scope. Rates. ${frame}`]);
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
    publishCustomerRelease: async (a: { release: string; content: { computedAt: string } }) => { published.push(a.content); return a.release; },
    reconcileImplementedWithoutShipment: async (_t: string, shipped: ReadonlySet<string>) => { swept.push({ shipped: [...shipped] }); return ["reverted"]; } }));
  vi.doMock("@/app/(shell)/changes-data", () => ({ buildChangesViewUncached: async () => ({ proposals: [], stampRows: [] }) }));
  const signals: { declineNotes?: { page: string; note: string }[] }[] = [];
  vi.doMock("@/app/(shell)/today-view-data", () => ({ buildTodayCompositeFromChanges: async (_v: unknown, sig: { declineNotes?: { page: string; note: string }[] }) => { signals.push(sig); return { headline: "" }; } }));
  return { ...(await import("@/app/(shell)/surface-release")), published, signals, swept };};
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
    expect(found[0]!.exactFix).toBe("Tell me the address that replaced /gone and I will write you the forward. Until then I keep it out of your queue.");
    expect(found[0]!.redirectTo).toBeUndefined(); expect(found[1]!.evidence).toBe("/old sends people to /mid, and /mid sends them on again to /rain-barrels.");
    expect(found[1]!.redirectTo).toBe(`${AT}/rain-barrels`); // PIN (D, packet 19): a Ready technical change carries the EXACT edit, not a description of one
    expect(found.find((f) => f.kind === "missing_h1")!.exact).toBe("Rain Barrel Sizing Guide");
    const orphan = found.find((f) => f.kind === "orphaned_page")!; // PIN (D, packet 19): the orphan names a real source page, a real spot on it, and the words to type.
    expect(orphan.exact).toBe("Rain Barrel Sizing"); expect(orphan.exactFix).toContain("/rain-barrels"); expect(orphan.exactFix).toContain('reading "Rain Barrel Sizing"');
    expect(orphan.exactFix).toContain('in the part of it about "Rain Barrel Sizing Guide"'); // PIN (B, F8): the spot on the source page is named the way a person names it, never a bag of tokens.
    expect(JSON.stringify(found)).not.toMatch(/[–—]|SERP|crawl_state|http_status|discovered_via/);
    expect([readTechnicalFindings({}), readTechnicalFindings({ inventory: [row(`${AT}/a`)] })]).toEqual([[], []]); }); // NOTHING FIRES WITHOUT HELD EVIDENCE: no inventory and no capture is no findings, never a clean bill
  it("calls a page dead only on 404, 410 or a twice-confirmed server error, and never on an access state", () => {
    const dead = (over: Record<string, unknown>) => readTechnicalFindings({ inventory: [row(`${AT}/`), row(`${AT}/x`, over)] }).filter((f) => f.kind === "non_200");
    for (const code of [401, 403, 429, 503]) { expect(dead({ http_status: code }), `${code}`).toEqual([]); expect(dead({ crawl_state: "blocked", http_status: code }), `robots ${code}`).toEqual([]); }
    expect([dead({ http_status: 404 }).length, dead({ http_status: 410 }).length, dead({ crawl_state: "gone", http_status: null }).length]).toEqual([1, 1, 1]);
    expect(dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z" })).toEqual([]); expect(dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z", status_reconfirmed_at: "2026-08-01T18:00:00Z" })).toEqual([]);
    const twice = dead({ http_status: 500, last_crawled_at: "2026-08-01T09:00:00Z", status_reconfirmed_at: "2026-08-03T09:00:00Z" }); expect(twice[0]!.evidence).toContain("two different days"); });
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
      if (dangerous) { expect(v.verdict).toBe("needs_review"); expect(v.reasons.join(" ")).toContain("confirm it before you make the change"); }}
    const blind = validateProposal(prop({ bundle: bundleOf([comp({ kind: "section_add", evidenceKeys: [] })]) })); // no component without evidence, no fact without sources, and no new kind without its four answers
    expect([blind.verdict, blind.reasons.some((r) => r.includes("cannot show you anything behind"))]).toEqual(["rejected", true]); const unsourced = validateProposal(prop({ bundle: bundleOf([comp({ kind: "factual_correction" })]) }));
    expect([unsourced.verdict, unsourced.reasons.some((r) => r.includes("carries no sources to check it against"))]).toEqual(["rejected", true]);
    const mute = validateProposal(prop({ bundle: bundleOf([comp({ kind: "restructure", where: undefined, mechanism: undefined })]) }));
    expect([mute.verdict, mute.reasons.some((r) => r.includes("where on the page it goes, why it fixes what I diagnosed"))]).toEqual(["rejected", true]);
    const sneaky = validateProposal(prop({ bundle: bundleOf([comp({ kind: "redirect", risk: "safe" })]) })); // a lever that moves the page and is NOT marked as one is a mislabelled change, never a safe paste
    expect([sneaky.verdict, sneaky.reasons.some((r) => r.includes("not marked as one that needs your confirmation"))]).toEqual(["rejected", true]); });
  it("refuses a page move, a de-indexing or a merge smuggled through an ordinary component", () => {
    const smuggled = validateProposal(prop({ bundle: bundleOf([comp({ kind: "section", after: "Add a 301 redirect to the sizing guide and noindex this page." })]) }));
    expect([smuggled.verdict, smuggled.reasons.some((r) => r.includes("sends this page's address somewhere else")), smuggled.reasons.some((r) => r.includes("stops people finding this page in search"))]).toEqual(["rejected", true, true]);
    const canonical = validateProposal(prop({ bundle: bundleOf([comp({ kind: "internal_links", after: "Point the canonical tag at the sizing guide instead." })]) }));
    expect([canonical.verdict, canonical.reasons.some((r) => r.includes("as the real address"))]).toEqual(["rejected", true]);
    const merged = validateProposal(prop({ bundle: bundleOf([comp({ kind: "section", after: "Merge this page into the sizing guide once the copy is moved." })]) }));
    expect([merged.verdict, merged.reasons.some((r) => r.includes("merges it into another"))]).toEqual(["rejected", true]);
    expect(validateProposal(prop({ bundle: bundleOf([comp({ kind: "section", after: "Add a short section on roof area, with the gallons each one collects per storm." })]) })).verdict).not.toBe("rejected"); });
  it("keeps a legal or medical correction dangerous however small the edit reads", () => {
    const legal = (risk: BundleComponent["risk"]): BundleComponent => comp({ kind: "factual_correction", risk, after: "Under the county statute the permit is required above 60 gallons.",
      sourcePack: { sourceRequirements: ["Cite the county statute."], factRequirements: ["Confirm the 60 gallon threshold."] } });
    expect(dangerousComponents([legal("safe")])).toHaveLength(1); // a statute is dangerous whatever the row claims
    expect(validateProposal(prop({ bundle: bundleOf([legal("safe")]) })).verdict).toBe("rejected"); // an unmarked one is a MISLABELLED change, and a mislabelled change is the one that gets pasted without a second look
    const held = validateProposal(prop({ riskLevel: "high", status: "needs_review", bundle: bundleOf([legal("dangerous")]) }));
    expect([held.verdict, held.reasons.some((r) => r.includes("confirm it before you make the change"))]).toEqual(["needs_review", true]); }); });
describe("a held body claim on one outside source asks for its second source, typed", () => {
  it("mints the factual_source requirement for the claim's own proposition, and only for the single-source case", () => {
    const held = prop({ status: "needs_review", pageUrl: "https://www.iranopedia.com/iran-flags/iran-islamic-republic-flag-history",
      recommendedChange: { kind: "existing_edit", field: "answer_block", before: null, after: "Why the Takbir appears twenty-two times." },
      claims: [{ text: "The Takbir is repeated 11 times along each band, reminiscent of 22 Bahman.", supportedBy: ["fact-1"] },
        { text: "The design changed in 1980.", supportedBy: ["page-copy-1"] }],
      supportFacts: [{ id: "fact-1", fact: "Wikipedia, Flag of Iran: repeated 11 times along each band." }, { id: "page-copy-1", fact: "the page's own line" }] } as never);
    const verdict = openHold(held);
    expect(verdict.need?.kind).toBe("factual_source");
    expect(verdict.need?.reasonCode).toBe("single_source");
    expect(verdict.need?.missingTopic).toContain("22 Bahman"); // the claim's own proposition, so the acquisition researches THIS
    const twoSources = prop({ ...held, claims: [{ text: "A claim.", supportedBy: ["fact-1", "fact-2"] }],
      supportFacts: [{ id: "fact-1", fact: "one" }, { id: "fact-2", fact: "two" }] } as never);
    expect(openHold(twoSources).need).toBeUndefined();
    expect(openHold(prop({ ...held, status: "ready" } as never)).need).toBeUndefined();
    expect(openHold(prop({ ...held, recommendedChange: { kind: "existing_edit", field: "title", before: "a", after: "b" } } as never)).need).toBeUndefined(); }); });

describe("traffic is the objective and every other factor may only discount it", () => {
  const clicky = (over: Record<string, unknown> = {}) => prop({ id: "measured", pagePath: "/cheetah", impactScore: 98,
    estimatedEffortMinutes: 2, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "title" })]), ...over });
  const aeo = (over: Record<string, unknown> = {}) => prop({ id: "aeo", pagePath: "/phrases", impactScore: null,
    estimatedEffortMinutes: 30, aiImpact: { answers: 9, days: 7, engines: 4, citedRivals: 3, mentionRate: 0, audienceWeight: null, stage: "owned_retrieved_not_cited" as const }, ...over });

  it("puts a supported click opportunity above an AEO hypothesis that carries no traffic figure", () => {
    const ranked = rankProposals([aeo(), clicky()]);
    expect(ranked.map((p) => p.id)).toEqual(["measured", "aeo"]);
    expect(factorOf(ranked[1]!, "visibility")).toBeGreaterThan(0);
    expect(ranked[1]!.rankingReceipt!.factors.find((f) => f.name === "visibility")!.input).toContain("stored answers hand"); });

  it("scores a change on its own measured recovery, never on the impressions of the page it sits on", () => {
    const [only] = rankProposals([clicky({ impactScore: 20, demandImpressions90d: 900_000 })]);
    const vis = only!.rankingReceipt!.factors.find((f) => f.name === "visibility")!;
    expect(only!.rankingReceipt!.directional, "it holds a measured figure, so the order is a size and not a direction").toBe(false);
    expect(vis.input).toContain("clicks over 28 days");
    expect(vis.input, "the page's own audience is not what this change is scored on").not.toContain("900,000"); });

  it("gives identical traffic evidence an identical figure under every label a change can wear", () => {
    const labels = ["title-family", "section", "factual_correction", "new_page", "ai_answer_gap", "meta", "internal_link"];
    const seen = labels.map((changeFamily) => factorOf(rankProposals([clicky({ id: changeFamily, changeFamily })])[0]!, "visibility"));
    expect(new Set(seen).size, `one figure across ${labels.length} labels, got ${JSON.stringify(seen)}`).toBe(1); });

  it("lets an AEO card compete on the audience actually connected to its own page, without calling a citation a click", () => {
    const connected = aeo({ id: "connected", demandImpressions90d: 90_000 });
    const ranked = rankProposals([aeo({ id: "bare", aiImpact: { answers: 2, days: 1, engines: 1, citedRivals: 1, mentionRate: 0, audienceWeight: null, stage: "owned_retrieved_not_cited" as const } }), connected]);
    expect(ranked[0]!.id).toBe("connected"); // its own page's demand, not a bonus for being AEO
    for (const p of ranked) {
      expect(p.rankingReceipt!.directional).toBe(true);
      expect(p.rankingReceipt!.factors.find((f) => f.name === "visibility")!.input).not.toMatch(/click/i);
      expect(p.rankingReceipt!.basis).toContain("not a promise about size"); } });

  it("holds a STORED ready card whose copy the rules now refuse, not only a new draft", async () => {
    const stored = prop({ id: "tenant-iranopedia::/discover-iran::existing_edit::missing_description",
      pageUrl: "https://www.iranopedia.com/discover-iran", pagePath: "/discover-iran", status: "ready",
      recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Discover Iran on Iranopedia, a page about Iran from Iranopedia, with Iran as its clear focus and Iranopedia as the source." },
      claims: [{ text: "The page is about Iran.", supportedBy: ["page-copy-1"] }],
      supportFacts: [{ id: "page-copy-1", fact: "The page covers Iran." }] } as never);
    const why = staleCopyReasons(stored, new Map(), [], null);
    expect(why.some((r) => r.includes("names iranopedia 3 times")), `got ${JSON.stringify(why)}`).toBe(true); });

  it("never prints a bare zero at the operator, it says the thing in words", () => {
    const [only] = rankProposals([clicky({ id: "alone" })]);
    for (const f of only!.rankingReceipt!.factors) {
      expect(f.input.trim(), `${f.name} opens with a bare zero`).not.toMatch(/^0 /);
    }
    expect(only!.rankingReceipt!.factors.map((f) => f.name)).toContain("strategic");
    expect(only!.rankingReceipt!.factors.find((f) => f.name === "confounding")!.input)
      .toBe("nothing else in this batch lands on the same page"); });

  it("never lets anything but traffic add to worth", () => {
    for (const p of rankProposals([clicky(), aeo(), prop({ id: "plain" })])) {
      for (const f of p.rankingReceipt!.factors) {
        if (f.name === "visibility" || f.name === "readiness") continue;
        expect(f.contribution, `${p.id}.${f.name} may only discount`).toBeLessThanOrEqual(0);
      } } });

  it("discounts a weakly supported large opportunity below a smaller proven one, and says why on the receipt", () => {
    const weak = clicky({ id: "weak", impactScore: 150, confidence: "low", researchOnly: true, status: "needs_review" });
    const solid = clicky({ id: "solid", impactScore: 120, pagePath: "/solid", confidence: "high" });
    const ranked = rankProposals([weak, solid]);
    expect(ranked.map((p) => p.id)).toEqual(["solid", "weak"]);
    expect(ranked[1]!.rankingReceipt!.factors.find((f) => f.name === "visibility")!.input).toContain("counted at"); }); });

describe("one score orders every kind of change, and says why", () => { it("puts the lever the evidence named above a bigger one it did not, on the same page", () => {
    const named = prop({ id: "title-fix", impactScore: 120, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "title" })]) });
    const bigger = prop({ id: "section-add", impactScore: 2000, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "section_add" })]) });
    const ranked = rankProposals([bigger, named]); expect(ranked.map((p) => p.id)).toEqual(["title-fix", "section-add"]); expect([factorOf(ranked[0]!, "causeFit"), factorOf(ranked[1]!, "causeFit")].every((v) => v <= 0), "a lever is discounted or left alone, never promoted").toBe(true);
    expect(Math.abs(factorOf(ranked[0]!, "causeFit")), "the lever the evidence named is not discounted at all").toBe(0);
    expect(ranked[0]!.whyRankedAboveNext).toContain("more is riding on it"); expect(ranked[0]!.whyRankedAboveNext).not.toMatch(/[—–]|experiment|control|baseline|treatment|SERP/i);
    expect(ranked[1]!.whyRankedAboveNext).toBeUndefined(); // nothing sits below the last one
    expect(ranked.every((p) => p.rankingReceipt!.factors.find((f) => f.name === "confounding")!.input.includes("1 other change"))).toBe(true);
    expect(factorOf(ranked[0]!, "confounding")).toBeLessThan(0);
    for (const cause of ["demand_decline", "measuring_change"] as const) { const [only] = rankProposals([prop({ diagnosisCause: cause, bundle: bundleOf([comp({ kind: "title" })]) })]);
      expect(Math.abs(factorOf(only!, "causeFit"))).toBe(0); expect(only!.rankingReceipt!.factors.find((f) => f.name === "causeFit")!.input).toBe("nothing you can write on the page fixes the cause named here");
    } });
  it("puts the sixth-arriving highest-impact card first, so the one drafting slot goes to it", () => { // capacity for one draft, the highest-impact opportunity gets it wherever the producers happened to emit it.
    const six = Array.from({ length: 6 }, (_, i) => prop({ id: `card-${i}`, pagePath: `/p${i}`, impactScore: i === 5 ? 900 : 10 + i })); expect(rankProposals(six)[0]!.id).toBe("card-5");
  });
  it("puts what is riding on the change above how long it takes, and never lets a wrong lever ride a recovery", () => {
    const losing = prop({ id: "losing", pagePath: "/persian-male-names", impactScore: 191, estimatedEffortMinutes: 30 });
    const errand = prop({ id: "errand", pagePath: "/tiny", impactScore: null, demandImpressions90d: 2, estimatedEffortMinutes: 1 }); const ranked = rankProposals([errand, losing]); expect(ranked.map((p) => p.id)).toEqual(["losing", "errand"]);
    expect(factorOf(ranked[0]!, "visibility")).toBe(8.07); // 191 recoverable clicks at medium confidence: 7.64 counted at 85 percent. The discount is named, never silent.
    expect(factorOf(ranked[1]!, "effort")).toBeLessThanOrEqual(0);
    expect(factorOf(ranked[1]!, "visibility")).toBeLessThan(factorOf(ranked[0]!, "visibility"));
    expect(ranked[0]!.rankingReceipt!.factors.filter((f) => f.name !== "visibility").every((f) => f.contribution <= 0), "nothing but traffic may add to worth").toBe(true);
    const wrong = rankProposals([prop({ diagnosisCause: "ctr_snippet", impactScore: 2000, bundle: bundleOf([comp({ kind: "section_add" })]) })]);
    expect([factorOf(wrong[0]!, "visibility"), wrong[0]!.rankingReceipt!.directional]).toEqual([0.2, true]);
    expect(factorOf(rankProposals([prop({ diagnosisCause: "ctr_snippet", impactScore: 2000, bundle: bundleOf([comp({ kind: "title" })]) })])[0]!, "visibility")).toBe(102); }); // 2,000 recoverable over 28 days, halved by the stated collection chance, capped by the band
  it("never reads as ready while it leaves its own diagnosed cause unsettled", () => {
    const NAMED = ["iranopedia.com/persian-female-first-names", "iranopedia.com/persian-names"];
    const split = (pages: string[]) => unsettledCause(prop({ pagePath: "/persian-female-first-names", primaryQuery: "persian girl names", diagnosisCause: "cannibalization", causeFinding: { cause: "cannibalization", action: null, evidenceKeys: [], explanation: "2 of your own pages come up for it.", competingExplanations: [], notConsidered: [], falsifier: "the split closes and one page keeps the search", payload: { cause: "cannibalization", competingPaths: NAMED, comparison: [], survivor: null } }, bundle: bundleOf(pages.map((pg) => comp({ kind: "title", page: pg, after: `A line only ${pg} could carry.` }))) }));
    expect([split(["/persian-female-first-names"])?.includes("(/persian-names)"), split(["/persian-female-first-names", "/persian-names"]), unsettledCause(prop({ diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "section_add" })]) }))?.slice(0, 20), unsettledCause(prop({}))])
      .toEqual([true, null, "This change works on", null]); });
  it("calls a deliverable finished only when it is the work, by type", () => { const gaps = (after: string, field: "title" | "meta" | "h1" | "section" = "title", over: Partial<ChangeProposal> = {}) => deliverableGaps(prop({ recommendedChange: { kind: "existing_edit", field, before: null, after }, ...over }))[0];
    const WORDS = "Rain barrels for a 1,200 square foot roof hold 50 gallons.", SAYS = "it describes the work instead of being it", OUT = ["Roof area", "Rainfall", "Overflow"];
    const page = (cs: BundleComponent[]) => deliverableGaps(prop({ kind: "new_page", pagePath: null, ...(cs.length ? { bundle: bundleOf(cs) } : {}), recommendedChange: { kind: "new_page", proposedTitle: "Rain barrel sizing", metaDescription: "How to size a rain barrel for your roof.", openingAnswer: WORDS, outline: OUT, faqQuestions: [], schemaTypes: [] } }))[0];
    const owed = prop({ status: "needs_review", researchOnly: true });
    expect([deliverableGaps(owed)[0], gaps("Write a description of about 150 characters.", "meta", { researchOnly: true }), gaps("Rain barrels hold [NUMBER] gallons."), gaps("The exact copy has not been drafted."), gaps(TITLE_AFTER), gaps(WORDS, "section"),
      gaps(WORDS, "section", { bundle: bundleOf([comp({ kind: "section_add", where: "under the sizing heading" })]) }), page([]), page(OUT.map((h) => comp({ kind: "section_add", label: h, after: `${h}: a roof sheds 750 gallons in an inch of rain.` }))),
      rankProposals([owed])[0]!.rankingReceipt!.factors.find((f) => f.name === "readiness")!.input, deserializeChangeProposal(serializeChangeProposal(owed))!.researchOnly])
      .toEqual(["nothing has been written for it yet", "nothing has been written for it yet", SAYS, SAYS, undefined, "where it goes on the page is not named", undefined, "3 of its 3 sections have no copy written", undefined,
        "this is research still owed, not an edit waiting on you", true]);
    const spanning = (dispositions: { page: string; verdict: "differentiate" | "keep_as_is"; because: string }[]) => deliverableGaps(prop({ bundle: { ...bundleOf([comp({ kind: "title", page: "/a", after: "A line only /a could carry." })]), dispositions } }))[0];
    expect([spanning([{ page: "/a", verdict: "differentiate", because: "it has to say what it alone covers" }, { page: "/b", verdict: "differentiate", because: "it has to say what it alone covers" }]),
      spanning([{ page: "/a", verdict: "differentiate", because: "it has to say what it alone covers" }, { page: "/b", verdict: "keep_as_is", because: "nothing came back for it that would not narrow it off its own subject" }]), spanning([{ page: "/a", verdict: "differentiate", because: "x" }, { page: "/b", verdict: "keep_as_is", because: "no" }])])
      .toEqual(["1 of the pages it changes have no copy written", undefined, "1 of the pages it names give no reason for being left alone"]);
    const g = (after: string, field: "title" | "meta" | "h1" | "section" = "section") => gaps(after, field, { bundle: bundleOf([comp({ kind: "section_add", where: "under the sizing heading" })]) }); expect([g("Cover the pot with a lid so it steams for ten minutes, then fluff the rice with a fork."), g("Fill in the form online, then pay the fee at a designated bank branch."), g("Include a copy of your passport photo page when you apply."), g("Link building for a Persian culture site works best through museums and university pages.", "meta"), g("Add Saffron to Your Rice: A Persian Cook's Guide", "title")])
      .toEqual(Array(5).fill(undefined)); });
  it("a pass that did not re-draft a card never undoes it", () => { const banked = prop({ id: "t::/iran-flags/achaemenid-empire-flag::existing_edit::missing_description", basis: "b8", status: "needs_review", estimatedEffortMinutes: 3, limitations: ["Read off the last stored copy of each page."], operatorSteps: ["Paste the description above, exactly as written"],
      claims: [{ text: "The Achaemenid Empire ran from 550 to 330 BCE.", supportedBy: ["card-1"] }], supportFacts: [{ id: "card-1", fact: "23 pages share one templated description" }], evidence: { query: "achaemenid flag", hints: ["23 pages share one templated description"], evidenceRefCount: 3 },
      recommendedChange: { kind: "existing_edit", field: "meta", before: "Learn about the History of Iran Flags and the Achaemenid Empire Flag (550-330 BCE).", after: "Achaemenid Empire Flag (550 - 330 BCE) in Persian Flags History: symbolism, role, changes and origins. Explore more." } });
    const brief = prop({ ...banked, researchOnly: true, estimatedEffortMinutes: 15, limitations: [], operatorSteps: undefined, evidence: { ...banked.evidence, evidenceRefCount: 9 },
      recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Write a description of about 150 characters that says what only this page answers." } });
    const kept = preferFinished(brief, banked), moved = preferFinished({ ...brief, basis: "b9" }, banked); // banked-copy re-reads still guarding truth on their own doors.
    const recrawled = preferFinished({ ...brief, copyStamp: "a page that reads differently now" }, { ...banked, copyStamp: "the page as it read when this line was written" });
    expect((recrawled.recommendedChange as { after: string }).after.slice(0, 5)).toBe("Write");
    const fresher = preferFinished(prop({ ...banked, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "A newer finished line about the Achaemenid flag and what it meant." } }), banked);
    expect([deliverableGaps(kept), kept.recommendedChange, kept.researchOnly, kept.estimatedEffortMinutes, kept.limitations, kept.evidence.evidenceRefCount, kept.claims,
      moved.researchOnly, (moved.recommendedChange as { after: string }).after.slice(0, 5), (fresher.recommendedChange as { after: string }).after.slice(0, 7), preferFinished(brief, null).researchOnly,
      preferFinished(brief, { ...banked, claims: undefined }).researchOnly, preferFinished({ ...brief, evidence: { ...brief.evidence, hints: [] } }, banked).researchOnly,
      kept.supportFacts, preferFinished(brief, { ...banked, supportFacts: undefined }).researchOnly])
      .toEqual([[], banked.recommendedChange, false, 3, banked.limitations, 9, banked.claims, false, "Achae", "A newer", true, true, false, banked.supportFacts, true]);
    const same = { workKey: "wk-1", copyStamp: "the page as it read when this line was written", status: "ready" as const };
    const settled = prop({ ...banked, ...same }), worse = prop({ ...banked, ...same, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Goodbye: goodbye. Please: please." } });
    expect([(preferFinished(worse, settled).recommendedChange as { after: string }).after,
      (preferFinished({ ...worse, copyStamp: "the page reads differently now" }, settled).recommendedChange as { after: string }).after])
      .toEqual([(banked.recommendedChange as { after: string }).after, "Goodbye: goodbye. Please: please."]); });
  it("drops a CTA last line from list-shaped copy and never amputates a phrase-meaning item", () => {
    const LIST = "Persian greetings people actually use every day, from the first hello to the goodbye at the door:\nSalam - hello, the everyday greeting you can use with anyone at any time of day.\nKhodahafez - goodbye, literally may God protect you, said when parting.\nMerci - thank you, borrowed from French and completely common in Iran.";
    expect(withoutCta(`${LIST}\nSee the page for more phrases.`, "section")).toBe(LIST); expect(withoutCta(LIST, "section")).toBe(LIST);
  });
  it("takes the call to action off the end of a description, or sends it back for one redraft", () => {
    const A = "Achaemenid Empire Flag (550-330 BCE): its symbolism, origins, role and changes in Persian flags history. Read this page for the focused summary.", B = "Persian Accessories: showcase heritage with hats, patterned phone cases and timeless designs that blend Iranian tradition with modern fashion. Browse unique pieces.";
    const FACT = "Persian Accessories: hats, phone cases and designs inspired by Iranian culture, made for everyday wear and shipped from the shop.";
    const SEMI = "Iranopedia x TavanDesigns Persian Shoes - features Love \"Eshgh\" and Nothingness \"Heech\" sneakers with Persian calligraphy; view designs and shop details.", DASH = "Achaemenid Empire Flag (550-330 BCE): concise history, symbolism and origins featured on this page - click to read the focused account.";
    expect([withoutCta(A, "meta"), withoutCta(B, "meta"), withoutCta(FACT, "meta"), withoutCta(SEMI, "meta"), withoutCta(DASH, "meta")])
      .toEqual([null, "Persian Accessories: showcase heritage with hats, patterned phone cases and timeless designs that blend Iranian tradition with modern fashion.", FACT, "Iranopedia x TavanDesigns Persian Shoes - features Love \"Eshgh\" and Nothingness \"Heech\" sneakers with Persian calligraphy.", null]); });
  it("refuses a figure that walked away from the qualifier its own sentence carried", () => { const body = "Free USA shipping on all orders, with delivery in 2-6 business days. International shipping is available worldwide, with delivery usually between 7\u201321 business days depending on location.";
    const pk = { targetUrl: "https://www.iranopedia.com/p", title: "T", h1: "H", metaDescription: null, bodyText: body, headings: [], evidence: { "page-copy-1": body }, trackedQuestion: "Q", ownedPaths: ["/p"], bannedTerms: [], demand: { preserve: [], vocabulary: [] } };
    const meta = (after: string) => deliverableFailures({ targetUrl: "https://www.iranopedia.com/p", actionType: "meta", naturalHeading: null, beforeText: null, placementAnchor: "the description", evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 1, measurementTarget: "ctr", claims: [{ text: "a claim", supportedBy: ["page-copy-1"] }], finalCopy: after } as never, pk as never);
    const SAYS = "the figure's own sentence says international, and the copy drops it";
    expect([meta("Iran Shir o Khorshid Vertical Stripe Shirt - lightweight polyester jersey with Lion & Sun emblem; ships in 7-21 business days. Free USA shipping.").includes(SAYS),
      meta("Iran Shir o Khorshid vertical stripe jersey with green, white, red panel and Lion & Sun emblem; loose athletic fit. Ships in 7 - 21 business days - see details.").includes(SAYS),
      meta("Iran Shir o Khorshid Vertical Stripe Shirt - runs true to size, relaxed fit. Free USA shipping in 2-6 business days; see sizing and details.").includes(SAYS)])
      .toEqual([true, true, false]); });
  it("refuses the keyword list the operator rejected, and keeps the topic list that names three different things", () => {
    const pk = { targetUrl: "https://www.iranopedia.com/x", title: "T", h1: "H", metaDescription: null, bodyText: "b", headings: [], evidence: { "page-copy-1": "b" }, trackedQuestion: "Q", ownedPaths: ["/x"], bannedTerms: [], demand: { preserve: [], vocabulary: [] } };
    const title = (after: string) => deliverableFailures({ targetUrl: "https://www.iranopedia.com/x", actionType: "title", naturalHeading: null, beforeText: null, placementAnchor: "the title", evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 1, measurementTarget: "ctr", claims: [{ text: "a claim", supportedBy: ["page-copy-1"] }], finalCopy: after } as never, pk as never)
      .some((r) => r.includes("keyword list rather than a line a person would write"));
    expect(title("Persian Swear Words, Persian Insults, Farsi Insults, Slang")).toBe(true);
    expect(title("Types of Persian Rugs: Tabriz Rugs, Kashan Rugs and Kerman Rugs")).toBe(false);
    expect(title("Onager (Persian Wild Ass): What It Is and Where It Lives")).toBe(false);
    expect(title("List of Largest Cities in Iran: Top 15 by Population")).toBe(false); });

  it("refuses a summary that sells the site to a reader already standing on it", () => {
    const pk = { targetUrl: "https://www.iranopedia.com/discover-iran", title: "T", h1: "H", metaDescription: null, bodyText: "b", headings: [], evidence: { "page-copy-1": "b" }, trackedQuestion: "Q", ownedPaths: ["/discover-iran"], bannedTerms: [], demand: { preserve: [], vocabulary: [] } };
    const meta = (after: string) => deliverableFailures({ targetUrl: "https://www.iranopedia.com/discover-iran", actionType: "meta", naturalHeading: null, beforeText: null, placementAnchor: "the description", evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 1, measurementTarget: "ctr", claims: [{ text: "a claim", supportedBy: ["page-copy-1"] }], finalCopy: after } as never, pk as never);
    const stuffed = "Discover Iran on Iranopedia, a page about Iran from Iranopedia, with Iran as its clear focus and Iranopedia as the source.";
    expect(meta(stuffed).some((r) => r.includes("names iranopedia 3 times"))).toBe(true);
    expect(meta("Iran adopted a new flag in 1979 and redesigned it in 1980. The red emblem arrived with the Takbir written in Kufic script along both bands.")
      .some((r) => r.includes("names iranopedia"))).toBe(false);
    expect(meta("An onager is a wild ass native to Iran's deserts, fast, hardy and able to live on very little water. Where it lives and why it is rare.")
      .some((r) => r.includes("names iranopedia"))).toBe(false); });

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
      claims: [{ text: P1, supportedBy: ["page-copy-2"] }, { text: P2, supportedBy: ["page-copy-3"] }, { text: P3, supportedBy: ["page-copy-4"] }] }; // ids aimed at the chunks that CARRY each claim: page-copy-1 is the heading passage, and citing it for P1 is the exact mis-aim the draft-time drift gate now refuses
    const OKJ = { pageFit: true, claimsEntailed: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "names the spring-equinox date the page never states" };
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
      const { canonicalUrlKey: ck2 } = await import("@/domains/evidence/snapshot");
      bodyStore.map = new Map([[ck2(BODY.url), BODY]]); // the body chunks must exist for the claims to aim at, or the deterministic gates refuse before the judge is ever reached
      const good2 = { ...GOOD, claims: [{ text: P1, supportedBy: ["page-copy-2"] }, { text: P2, supportedBy: ["page-copy-3"] }, { text: P3, supportedBy: ["page-copy-4"] }] };
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
      expect(asked.at(-1)).toContain("the evaluator's exact objection: the opening sentence answers a different question than the reader asked"); bodyStore.map = null; });
    /** ACQUISITION REACHES THE WRITER, OR IT ONLY REOPENED THE WORK. A competitor page read for this job's own search changed the job's evidence identity, reopened it, and was then withheld from the packet, so the writer reran on the same information and earned the same refusal. The extract arrives as `rival-*` BRIEFING: what is missing and how the winning answer is shaped, and the one class no claim may ever stand on. */
    it("hands the writer the winner acquired for this job's search, withholds it when nothing was acquired, and refuses copy that stands on a rival", async () => {
      const RIVAL_COPY = "Persian idioms rarely translate literally, so each phrase below is given with the meaning a speaker actually intends when saying it.";
      const winner = { url: "https://rival.example/persian-idioms", domain: "rival.example", engines: ["chatgpt"], examplePrompts: [], appearances: [{ query: "funny persian phrases" }],
        extract: { title: "Persian Idioms", h1: null, wordCount: 2400, headings: ["Regional dialect variations", "Playful insults between friends"], faqCount: 6, entityNames: ["Tehran slang"], openingSample: "Persian idioms rarely translate literally.", hasList: true } };
      const withWinner = { ownedPages: [{ url: BODY.url, content: { wordCount: 400, title: BODY.title, h1: BODY.h1, outline: BODY.headings }, search: null }], sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" },
        research: { serpEvidence: [{ query: "funny persian phrases", organic: [{ rank: 1, url: winner.url }] }], winningPages: [winner] } };
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, primaryQuery: "funny persian phrases", limitations: [],
        evidence: { query: "funny persian phrases", hints: [P1], evidenceRefCount: 1 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Add a section that answers the question." } });
      const run = async (snap: unknown, value: Record<string, unknown>) => { const asked: string[] = [];
        await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never, refusals: new Map<string, string>(),
          budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
          complete: async ({ user }: { user: string }) => (asked.push(user), { value }) } as never); return asked.join(" "); };
      const seen = await run(withWinner, GOOD);
      expect(seen).toContain("rival-1"); // the acquisition reached the packet
      expect(seen).toContain("Regional dialect variations"); // and as the SUBJECT this page is missing, not as prose to reword
      expect(seen).toContain("rival.example"); // carrying its own address, so the writer knows whose page it is
      expect(seen).toContain("It also covers, which this page treats in its own words: Playful insults between friends");
      expect(seen).not.toContain("Nothing on this page mentions: Playful insults between friends");
      expect(seen).toContain("Nothing on this page mentions: Regional dialect variations");
      const blind = await run({ ...withWinner, research: {} }, GOOD);
      expect(blind).not.toContain("rival-1"); // the same job with nothing acquired is handed nothing
      const refusals = new Map<string, string>(); // and a claim standing on that rival is refused: its words are not checked evidence
      await applyDraftedCopy([card], { tenantId: TENANT, snapshot: withWinner as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never, refusals,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async () => ({ value: { ...GOOD, after: RIVAL_COPY, claims: [{ text: RIVAL_COPY, supportedBy: ["rival-1"] }] } }) } as never);
      expect([...refusals.values()].join(" ")).toContain("stands on a rival"); });
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
      const good2 = { ...GOOD, claims: [{ text: P1, supportedBy: ["page-copy-2"] }, { text: P2, supportedBy: ["page-copy-3"] }, { text: P3, supportedBy: ["page-copy-4"] }] };
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
      const rewritten = { ...GOOD, claims: [{ text: P1, supportedBy: ["page-copy-2"] }, { text: P2, supportedBy: ["page-copy-3"] }, { text: P3, supportedBy: ["page-copy-4"] }] };
      const out = await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async () => ({ value: rewritten }) } as never);
      const rc = out[0]!.recommendedChange;
      expect(rc.kind === "existing_edit" ? rc.where : "").toBe('Replaces the existing passage under "Playful Persian expressions"');
      expect((rc.kind === "existing_edit" ? rc.before ?? "" : "").includes(P2)).toBe(true); // A REWRITE REPLACES THE SECTION UNDER ITS HEADING, never an arbitrary thousand-character slice of the crawl: cut between this heading and the next, the target is a thing an operator can find
      expect(JSON.stringify(out[0]!.operatorSteps)).toContain("Replace that passage with the copy above, exactly as written");
      expect(JSON.stringify(out[0])).not.toContain("A new section");
      expect(out[0]!.treatment).toBe("rewrite_existing_section"); // the passage WAS found, so this really is a replacement and stays one
      const away = { ...card, primaryQuery: "wholesale freight logistics", evidence: { query: "wholesale freight logistics", hints: [P1], evidenceRefCount: 1 } };
      const add = await applyDraftedCopy([away], { tenantId: TENANT, snapshot: snap as never, now: NOW, judge: async () => OKJ as never, reviewer: async () => ({ notes: "fine" }) as never,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 },),
        complete: async () => ({ value: rewritten }) } as never);
      const arc = add[0]!.recommendedChange;
      if (arc.kind === "existing_edit" && (arc.where ?? "").includes("A new section headed")) expect(add[0]!.treatment).toBe("add_answer_section");
      expect(add[0]!.treatment === "rewrite_existing_section").toBe(JSON.stringify(arc).includes("Replaces the existing passage"));
      bodyStore.map = null;});
    /** WHAT A READER GETS TWICE IS THE SUBJECT, AND THE PAGE ALREADY SAYS WHAT ITS SUBJECTS ARE. A parser that recognised "Subject: definition" was a rule about PUNCTUATION: the same entry written with an em dash, as a bullet, in bold before "means" or in an ordinary sentence walked past it, and a live replacement scored ZERO of six lines and went READY at rank 1 while all five entries kept their sections underneath. The page's own stored headings are the subjects; the only question is whether the replacement says them again, however it writes them. */
    it("catches a repeated subject in any formatting, and lets only a claim-preserving consolidation name its removals", async () => {
      const { canonicalUrlKey: ck3 } = await import("@/domains/evidence/snapshot");
      const H = ["Playful Persian expressions", "Pedar Sag (پدر سگ)", "Topoli (تپلی)", "Gooz (گوز)", "Bikhial (بی‌خیال)", "Boro Baa Baad (برو با باد)", "Chert-o-Pert (چرت و پرت)", "Olagh (الاغ)", "Divooneh (دیوانه)"];
      const SECTIONS = ["Pedar Sag (پدر سگ)", "Literally father dog, a harsh insult close friends trade as a joke.",
        "Topoli (تپلی)", "Chubby, an affectionate nickname for children and pets.",
        "Gooz (گوز)", "Fart, used casually to call something worthless.",
        "Bikhial (بی‌خیال)", "Forget it, said to let a thing go.",
        "Boro Baa Baad (برو با باد)", "Go with the wind, told to somebody who should leave.",
        "Chert-o-Pert (چرت و پرت)", "Nonsense, used to dismiss foolish talk.",
        "Olagh (الاغ)", "Donkey, said of somebody being slow-witted.",
        "Divooneh (دیوانه)", "Crazy, used warmly for somebody acting wild."];
      const PAGE = { ...BODY, headings: H, passages: ["Playful Persian expressions", P1, ...SECTIONS] };
      bodyStore.map = new Map([[ck3(BODY.url), PAGE]]);
      const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url,
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, treatment: "rewrite_existing_section", primaryQuery: "playful persian phrase meanings",
        limitations: [], evidence: { query: "playful persian phrase meanings", hints: [P1], evidenceRefCount: 1 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Rewrite the playful expressions section." } });
      const snap = { ownedPages: [{ url: BODY.url, content: { wordCount: 900, title: BODY.title, h1: BODY.h1, outline: H }, search: null }], research: {}, sources: [], scope: { tenantId: TENANT } };
      const run = async (copy: string) => (await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, reviewer: async () => ({ notes: "fine" }) as never, judge: async () => OKJ as never,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async () => ({ value: { ...GOOD, after: copy, claims: [{ text: P1, supportedBy: ["page-copy-2"] }] } }) } as never))[0]!;
      const shapes: Array<[string, string]> = [
        ["colon", "Pedar Sag (پدر سگ): a colourful insult.\nTopoli (تپلی): an affectionate word.\nGooz (گوز): a dismissive word."],
        ["em dash", "Pedar Sag — a colourful insult.\nTopoli — an affectionate word.\nGooz — a dismissive word."],
        ["hyphen", "Pedar Sag - a colourful insult.\nTopoli - an affectionate word.\nGooz - a dismissive word."],
        ["bullets", "• Pedar Sag, a colourful insult.\n• Topoli, an affectionate word.\n• Gooz, a dismissive word."],
        ["bold means", "**Pedar Sag** means a colourful insult.\n**Topoli** means an affectionate word.\n**Gooz** means a dismissive word."],
        ["prose", "Speakers reach for Pedar Sag when they want to sting, soften it with Topoli for a child, and wave a thing away with Gooz when it hardly matters at all."]];
      for (const [shape, copy] of shapes) {
        const r = await run(copy);
        expect([shape, r.status]).not.toEqual([shape, "ready"]);
        expect([shape, (r.faults ?? []).join(" ")]).toEqual([shape, expect.stringContaining("repeats what stays")]);}
      const sum = await run("Persian slang here runs from affectionate teasing to blunt dismissal, and the entries below give each literal wording beside the tone a speaker actually intends.");
      expect([sum.status, (sum.recommendedChange as { where?: string }).where]).toEqual(["ready", 'Replaces the existing passage under "Playful Persian expressions"']);
      const lossy = await run("Pedar Sag (پدر سگ): a harsh insult close friends trade as a joke.\nTopoli (تپلی): chubby, an affectionate nickname for children and pets.\nGooz (گوز): fart, used casually to call something worthless.");
      expect(lossy.status).not.toBe("ready");
      expect((lossy.operatorSteps ?? []).join(" ")).not.toContain("Delete the sections below for");
      const whole = await run("Pedar Sag (پدر سگ): literally father dog, a harsh insult close friends trade as a joke.\nTopoli (تپلی): chubby, an affectionate nickname for children and pets.\nGooz (گوز): fart, used casually to call something worthless.");
      expect(whole.status).toBe("ready");
      expect((whole.operatorSteps ?? []).join(" ")).toContain("Delete the sections below for Pedar Sag, Topoli, Gooz");
      bodyStore.map = null; });
    /** THE DEFICIT IS FINISHED CHANGES OWED, NEVER CANDIDATES ALLOWED, AND ONLY THE STORE SAYS WHAT LANDED. Funding `min(deficit, 5)` meant a queue one row short attempted exactly ONE page, whatever it turned out to be. Counting what the pass WROTE was the next mistake: a Ready row the store then refuses, holds or loses puts nothing in front of an operator, so a drive that stopped for it spent money and added no change. The editor counts nothing of its own now; it settles each finished card through the caller and asks the shared budget whether anything is still owed. */
    it("walks past work the store would not keep, and stops only once a Ready row durably landed", async () => {
      const { canonicalUrlKey: ck4 } = await import("@/domains/evidence/snapshot");
      const PATHS = ["/a", "/b", "/c"], URL_OF = (x: string) => `https://www.iranopedia.com${x}`;
      const body = (x: string) => ({ url: URL_OF(x), title: `Phrases ${x}`, h1: `Phrases ${x}`, metaDescription: null, vocabulary: "", headings: ["Overview"], passages: ["Overview", P1] });
      bodyStore.map = new Map(PATHS.map((x) => [ck4(URL_OF(x)), body(x)]));
      const cards = PATHS.map((x) => prop({ id: `${TENANT}::${x}::existing_edit::ai_answer_gap`, pagePath: x, pageUrl: URL_OF(x),
        changeFamily: "section", status: "needs_review" as const, researchOnly: false, treatment: "rewrite_existing_section", primaryQuery: "playful persian phrase meanings",
        limitations: [], evidence: { query: "playful persian phrase meanings", hints: [P1], evidenceRefCount: 1 },
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Rewrite the overview." } }));
      const snap = { ownedPages: PATHS.map((x) => ({ url: URL_OF(x), content: { wordCount: 400, title: `Phrases ${x}`, h1: `Phrases ${x}`, outline: ["Overview"] }, search: null })), research: {}, sources: [], scope: { tenantId: TENANT } };
      const SUMMARY = "Persian slang here runs from affectionate teasing to blunt dismissal, and the entries below give each literal wording beside the tone a speaker actually intends.";
      const run = async (readyTarget: number, settled: boolean) => { const asked: string[] = [];
        const budget = DRAFT_BUDGET.plan({ jobs: PATHS.map((x) => ({ key: x, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS })), candidates: 3, calls: 90, readyTarget });
        const out = await applyDraftedCopy(cards, { tenantId: TENANT, snapshot: snap as never, now: NOW, reviewer: async () => ({ notes: "fine" }) as never, refusals: new Map<string, string>(),
          judge: async () => OKJ as never, settle: async () => { if (settled) budget.land(); return settled; }, // the settlement is the ONE lander, exactly as persistAndFile lands in production
          budget,
          complete: async ({ user }: { user: string }) => (asked.push(user), { value: { ...GOOD, after: SUMMARY, claims: [{ text: P1, supportedBy: ["page-copy-2"] }] } }) } as never);
        return { asked: asked.length, ready: out.filter((p) => p.status === "ready").length }; };
      expect((await run(0, true)).asked).toBe(0);
      const landed = await run(1, true);
      expect(landed.asked).toBe(1);
      expect((await run(2, true)).asked).toBe(2);
      const lost = await run(1, false);
      expect(lost.asked).toBe(3);
      expect(lost.ready).toBe(3); // it really did write finished copy each time; what it never got was a row the store kept
      bodyStore.map = null; });
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
      const run = async (copy: string, refusals?: Map<string, string>) => applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW, reviewer: async () => ({ notes: "fine" }) as never, judge: async () => OKJ as never, refusals,
        budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
        complete: async () => ({ value: { ...GOOD, after: copy, claims: [{ text: P1, supportedBy: ["page-copy-2"] }] } }) } as never);
      const ok = await run("Persian slang runs from affectionate teasing to blunt dismissal, and each entry below gives the literal wording beside the tone it carries.");
      expect((ok[0]!.recommendedChange as { where?: string }).where).toBe('Replaces the existing passage under "Playful Persian expressions"');
      const dup = await run(`${P2}\n${P3}\n${Q3}`);
      expect((dup[0]!.recommendedChange as { where?: string }).where).toContain("absorbs the duplicated entries below it");
      expect((dup[0]!.operatorSteps ?? []).join(" ")).toContain("so the page says it once");
      expect([dup[0]!.status, (dup[0]!.faults ?? []).join(" ")]).toEqual(["needs_review", expect.stringContaining("repeats what stays")]);
      bodyStore.map = null;});
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
      expect(notes.join(" ")).not.toContain("is a section this rewrite could replace");
      expect(JSON.stringify(out[0]!.recommendedChange)).not.toContain("Shop Now"); // and the operator is never told to delete it
      bodyStore.map = null;});
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
      expect(notes.join(" ")).not.toContain("is a section this rewrite could replace");});
    it("a grounded answer passes every editor gate AND the canon, mechanically placed", async () => {
      const d = await drive({ ...GOOD, placementAnchor: "whatever" }); expect([d?.anchor, (d?.after ?? "").includes(P2)]).toEqual(["Funny Farsi Phrases", true]);
      const v = validateProposal(prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: BODY.url, changeFamily: "section", status: "needs_review" as const,
        recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: d!.after } }), { pageBodyText: [P1, P2, P3].join(" "), evidenceText: [P1, P2, P3].join(" "), now: NOW });
      expect([v.verdict, v.qualityStatus]).toEqual(["ready", "ready"]); }); // the same copy clears the canon that held every previous draft
  });
  it("the cards that reached a customer are refused before a model is asked", () => { const pk = (bodyText: string, bannedTerms: string[] = []) => ({ targetUrl: "https://www.iranopedia.com/x", title: "T", h1: "H", metaDescription: null, bodyText, headings: [], evidence: { "page-copy-1": bodyText }, trackedQuestion: "Q", ownedPaths: ["/x"], bannedTerms, demand: { preserve: [], vocabulary: [] } });
    const d = (o: Record<string, unknown>) => deliverableFailures({ targetUrl: "https://www.iranopedia.com/x", actionType: "answer_block", naturalHeading: "A human heading", beforeText: null, evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 30, measurementTarget: "citations", claims: [{ text: "a claim", supportedBy: ["page-copy-1"] }], ...o } as never, (o.P as never) ?? pk(""));
    const chrome = "top of pagePopular Persian(Farsi) Insults, Funny Phrases, and SlangPersian is a lively language full of humorous expressions.";
    const learn = "Persian Greetings and Basic PhrasesSay hello, goodbye, thank you, and much more with confidence. This guide covers the most common Persian greetings and everyday phrases, along with cultural notes and pronunciation tips, so you know when and how to use them naturally.";
    const blob = "Visual Timeline of Persia/IranA comprehensive visual timeline of Iran's history, capturing pivotal events from ancient Persia to to modern Iran. Explore significant milestones, cultural developments, political changes, and influential figures that have shaped Iran's rich and diverse heritage.";
    const RECV=[d({ P: pk(chrome, ["Farsi"]), placementAnchor: chrome, finalCopy: "Funny Persian phrases and idioms are common Farsi insults and playful slang such as Pedar Sag, Topoli, Gooz, Bikhial, and Chert-o-Pert. This page lists those expressions, gives brief meanings and typical contexts. See the headings below for each example and its short meaning." }),
      d({ P: pk(learn), placementAnchor: "Persian Greetings and Basic Phrases", finalCopy: "Basic Persian phrases for beginners include common greetings, simple everyday sentences, and numbers shown in Finglish so you can speak before learning the script. This page lists hello, goodbye, thank you, pronunciation tips and cultural notes, and recommends gamified lessons to practice these phrases aloud." }),
      d({ P: pk(blob), placementAnchor: blob, finalCopy: "Famous Iranian people in history and today include Cyrus the Great and the poet Ferdowsi, who founded an empire and wrote the epic that carried the Persian language across many centuries of recorded history, verse and memory, and who are named on this timeline among the milestones that shaped Iran." })];
    expect(RECV)
      .toEqual([["it points at the page instead of answering", "it uses words this account does not publish: Farsi", "where it goes is two page elements glued together, which nobody can find on the rendered page", "where it goes is taken from the crawl's own markers, not from the page"], ["it points at the page instead of answering"], ["where it goes is a paragraph rather than a place on the page", "where it goes is two page elements glued together, which nobody can find on the rendered page"]]) });
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
    expect([at("Iran Wildlife and National Animals  Discover the Animals of Iran"), at("Iran Wildlife and National AnimalsDiscover"), at("Iran Wildlife and National Animals")])
      .toEqual([true, true, false]); });
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
  it("an editor's deliverable is finished only when the stored page carries it", () => {
    const BODY = "Though no official flag design has been preserved, ancient reliefs and inscriptions suggest banners with eagle and winged sun symbols. The Achaemenid Empire Flag is often depicted with a red background and a golden Faravahar or eagle emblem, from 550 to 330 BCE.", P = { targetUrl: "https://www.iranopedia.com/iran-flags/achaemenid-empire-flag", title: "Achaemenid Empire Flag (550 to 330 BCE)", h1: "Achaemenid Empire Flag (550 to 330 BCE)", metaDescription: "Learn about the History of Iran Flags and the Achaemenid Empire Flag. Discover its symbolism, role in Persian History, its changes, and its origins.", headings: ["Explore More"], trackedQuestion: "What are funny Persian phrases and idioms?", ownedPaths: ["/iran-flags/achaemenid-empire-flag", "/persian-female-first-names"], demand: { preserve: [], vocabulary: [] }, bannedTerms: ["Farsi"], evidence: { "page-copy-1": "Though no official flag design has been preserved, ancient reliefs and inscriptions suggest banners with eagle and winged sun symbols", "page-copy-2": "The Achaemenid Empire Flag is often depicted with a red background and a golden Faravahar or eagle emblem, from 550 to 330 BCE.", "page-title": "Achaemenid Empire Flag (550 to 330 BCE)" }, bodyText: BODY };
    const D = { actionType: "meta" as const, targetUrl: P.targetUrl, placementAnchor: "the page's description field", beforeText: P.metaDescription, naturalHeading: null, evidenceIdsUsed: ["page-copy-1"], uncertaintyOrOmitted: [], implementationMinutes: 3, measurementTarget: "clicks on this page", claims: [{ text: "No official Achaemenid flag design has been preserved", supportedBy: ["page-copy-1", "page-title"] }, { text: "Ancient reliefs and inscriptions suggest banners with an eagle and winged sun, and the flag is often depicted with a red background and a golden Faravahar emblem from 550 to 330 BCE", supportedBy: ["page-copy-1", "page-copy-2"] }], supportFacts: [], finalCopy: "No official Achaemenid flag design has been preserved: reliefs and inscriptions suggest a red banner with a golden Faravahar eagle, 550 to 330 BCE." }, T = { ...D, actionType: "title" as const, beforeText: P.title, placementAnchor: "the page title", finalCopy: "Achaemenid Flag: What Reliefs and Inscriptions Suggest" };
    const WRONG = "the line it says it replaces is not the one this page carries", blk = (o: Record<string, unknown>) => deliverableFailures({ ...D, actionType: "answer_block", beforeText: null, finalCopy: BODY, ...o } as never, P)[0];
    expect([deliverableFailures(D, P), deliverableFailures(T, P), deliverableFailures({ ...D, beforeText: "a description this page never carried" }, P)[0], deliverableFailures({ ...T, beforeText: "A title this page never carried" }, P)[0],
      deliverableFailures({ ...D, claims: [{ text: "Cyrus raised it himself", supportedBy: ["made-up-7"] }] }, P)[0], blk({ naturalHeading: "What the reliefs show", placementAnchor: "a heading nowhere on the page" }), blk({ naturalHeading: P.trackedQuestion, placementAnchor: "ancient reliefs and inscriptions" })]).toEqual([[], [], WRONG, WRONG, "it names evidence that is not on file: made-up-7", "the place it says it lands is not on the stored page", "its heading is the tracked question said back word for word"]); });
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
    const owed = prop({ id: "owed", pagePath: "/big", impactScore: 2000, demandImpressions90d: 50_000,
      limitations: ["The exact description lands on the next pass; it is still owed, and this card is what is owed. No action needed from you until it does."] });
    const finished = prop({ id: "finished", pagePath: "/small", impactScore: 100 }); const ranked = rankProposals([owed, finished]); expect(ranked.map((p) => p.id)).toEqual(["owed", "finished"]);
    expect([factorOf(ranked[0]!, "visibility"), factorOf(ranked[0]!, "readiness"), factorOf(ranked[1]!, "readiness")]).toEqual([35.7, 0, 0]);
    expect(ranked[0]!.rankingReceipt!.factors.find((f) => f.name === "visibility")!.input).toContain("counted at 60 percent because the copy is still owed and confidence is medium");
    expect([factorOf(rankProposals([prop({ diagnosisCause: "ranking_loss", bundle: bundleOf([comp({ kind: "section_add" })]) })])[0]!, "causeFit"),
      factorOf(rankProposals([prop({ diagnosisCause: "demand_decline", bundle: bundleOf([comp({ kind: "section_add" })]) })])[0]!, "causeFit")].every((v) => v <= 0), "having a lever is never worth points, so a decline card cannot be scored for a fix that is not one").toBe(true); });
  it("discounts a dangerous consolidation and a page that already has a change under measurement", () => {
    const safe = prop({ id: "safe", impactScore: 300, pagePath: "/quiet", bundle: bundleOf([comp({ kind: "title" })]) });
    const risky = prop({ id: "risky", impactScore: 300, pagePath: "/merge", status: "needs_review",
      bundle: bundleOf([comp({ kind: "consolidation", risk: "dangerous", after: "Fold this page into the sizing guide." })]) });
    const busy = prop({ id: "busy", impactScore: 300, pagePath: "/measuring", bundle: bundleOf([comp({ kind: "title" })]) }); const ranked = rankProposals([risky, busy, safe], { measuringPagePaths: ["/measuring"] });
    expect(ranked.map((p) => p.id)).toEqual(["safe", "risky", "busy"]);
    const held = ranked.find((p) => p.id === "risky")!; expect(factorOf(held, "risk")).toBeLessThan(0); // it still ranks, it just ranks with its discount
    expect(validateProposal(held).reasons.some((r) => r.includes("confirm it before you make the change"))).toBe(true); expect(factorOf(ranked.find((p) => p.id === "busy")!, "overlap")).toBeLessThan(0);
    expect(Math.abs(factorOf(ranked.find((p) => p.id === "safe")!, "overlap"))).toBe(0); expect(ranked[1]!.whyRankedAboveNext).toContain("/measuring already has a change under measurement");
    for (const p of ranked) for (const f of p.rankingReceipt!.factors) expect(Math.abs(f.contribution)).toBeLessThanOrEqual(f.max); }); // every factor stays inside its own ceiling, so no single input can quietly decide the order
  it("holds every factor on its own floor, and never punishes a stored change for the age of its vocabulary", () => {
    const [floored] = rankProposals([prop({ id: "floored", evidence: { query: "rain barrel sizing", hints: [], evidenceRefCount: -1000 } })]); // a tampered evidence count used to contribute -1,500 and drag a safe change down through the lifecycle tiers
    expect(factorOf(floored!, "evidence")).toBeGreaterThanOrEqual(-floored!.rankingReceipt!.factors.find((f) => f.name === "evidence")!.max); expect(floored!.rankingReceipt!.factors.every((f) => f.contribution >= -f.max)).toBe(true);
    expect(proposalValueScore(prop({ status: "needs_review", impactScore: 9999 }))).toBeGreaterThan(proposalValueScore(floored!));
    const bundled = rankProposals([prop({ diagnosisCause: "incomplete_coverage", bundle: bundleOf([comp({ kind: "section" })]) })]); // the older undifferentiated kinds ARE the levers their newer names describe, on a bundle and on a pre-bundle row alike
    const stored = rankProposals([prop({ diagnosisCause: "incomplete_coverage", recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "A section on roof area." } })]);
    expect([factorOf(bundled[0]!, "causeFit"), factorOf(stored[0]!, "causeFit")].every((v) => Math.abs(v) === 0), "both shapes match their lever, so neither is discounted for it").toBe(true); });
  it("ranks a change it holds no proven figure for as a direction, never a size, and says so", () => { const [blind] = rankProposals([prop({ impactScore: null, upsidePerMonth: null })]);
    expect(blind!.rankingReceipt!.directional).toBe(true);
    const smallest = rankProposals([prop({ impactScore: 16, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "title" })]) })])[0]!;
    expect(factorOf(blind!, "visibility")).toBeLessThan(factorOf(smallest, "visibility")); expect(blind!.rankingReceipt!.basis).toContain("this is the order to work in, not a promise about size");
    const [sized] = rankProposals([prop({ impactScore: 570 })]); expect([sized!.rankingReceipt!.directional, factorOf(sized!, "visibility")]).toEqual([true, 24.23]);
    expect(sized!.rankingReceipt!.factors.find((f) => f.name === "visibility")!.input).toContain("measured shortfall with no cause diagnosed yet");
    const [causal] = rankProposals([prop({ impactScore: 570, diagnosisCause: "ctr_snippet", bundle: bundleOf([comp({ kind: "title" })]) })]);
    expect([causal!.rankingReceipt!.directional, causal!.rankingReceipt!.basis.includes("570 clicks over 28 days measured as recoverable")]).toEqual([false, true]); });
  it("decodes and ranks a stored row that predates every field this ranking added", () => {
    const { rankingReceipt: _r, whyRankedAboveNext: _w, diagnosisCause: _c, bundle: _b, ...old } = prop({ impactScore: 300, bundle: bundleOf([comp({ kind: "title" })]) });
    void _r; void _w; void _c; void _b;
    const back = deserializeChangeProposal(serializeChangeProposal(old as ChangeProposal)); expect(back).not.toBeNull();
    const [ranked] = rankProposals([back!]); expect(ranked!.rankingReceipt!.factors.map((f) => f.name)).toEqual(["readiness", "visibility", "evidence", "causeFit", "strategic", "effort", "risk", "overlap", "confounding", "history"]);
    expect(Math.abs(factorOf(ranked!, "causeFit"))).toBe(0); // no diagnosis on the row, so nothing is matched and nothing is punished
    expect(proposalValueScore(back!)).toBeLessThan(proposalValueScore(prop({ status: "needs_review", impactScore: 9999 }))); }); });
/** READY INTEGRITY (2026-08-15). Three promises about a change that is allowed to read as ready: every published claim stands on the exact evidence it names, the version an operator confirms names everything they read, and banked words are re-read against today's rules before they are served again. */
describe("a change earns ready on its own evidence, its whole version, and words that still stand", () => {
  const EV = "Each order earns store credit toward the next tote.";
  const TOTES = "Every order earns store credit toward the next red tote; each order earns store credit toward the next red tote.";
  const PK = { targetUrl: "https://fixture-content.example/totes", title: "Totes", h1: "Totes", metaDescription: null, headings: [], bodyText: EV, evidence: { "page-copy-1": EV }, trackedQuestion: null, ownedPaths: ["/totes"], bannedTerms: [] };
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
  it("sorts an opportunity into one lane only, and demotes unre-checkable placement instead of deleting it", () => {
    const BODY = "Rain barrels for a 1,200 square foot roof hold 50 gallons of the runoff that roof sheds in an inch of rain.";
    const body = { kind: "existing_edit" as const, field: "section" as const, before: null, after: BODY, where: 'A new section headed "Sizing", placed after "The studio cuts every barrel."' };
    const placed = prop({ status: "ready", informationGain: { adds: "gives the gallons a 1,200 square foot roof sheds, which the page never states", by: ["card-1"], pageWhole: true }, claims: [{ text: "The studio cuts every barrel", supportedBy: ["card-1"] }],
      supportFacts: [{ id: "card-1", fact: "The studio cuts every barrel." }], recommendedChange: body });
    const lost = { ...placed, supportFacts: [{ id: "card-1", fact: "A reading that no longer quotes that sentence." }] } as ChangeProposal;
    const brief = prop({ researchOnly: true, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Write a description of about 150 characters." } }); const lanes = [openHold(placed), openHold(lost), openHold(brief)];
    expect([lanes.map((h) => h.lane), lanes.map((h) => h.blocking == null), lanes[1]!.why[0]!.startsWith("Where this copy goes can no longer be checked"),
      (lost.recommendedChange as { after: string }).after === BODY, lost.claims?.length])
      .toEqual([["review", "review", "research"], [true, false, false], true, true, 1]); });});
describe("the AI side ranks on recurrence and stage, never on raw answer totals (AEO reconstruction, 2026-08-19)", () => {
  const aiProp = (id: string, ai: Partial<NonNullable<ChangeProposal["aiImpact"]>> & { answers: number; citedRivals: number }) => prop({ id, impactScore: null, demandImpressions90d: null, aiImpact: { audienceWeight: null, mentionRate: 0, ...ai } });
  it("puts a question asked every day for a week above one asked once with ten times the rows", () => {
    const recurring = aiProp("recurring", { answers: 5, citedRivals: 3, days: 7, engines: 4, stage: "owned_retrieved_not_cited" });
    const burst = aiProp("burst", { answers: 50, citedRivals: 3 }); // fifty rows, no recurrence on file
    const ranked = rankProposals([burst, recurring]); expect(ranked.map((p) => p.id)).toEqual(["recurring", "burst"]); const receipt = ranked[0]!.rankingReceipt!.factors.find((f) => f.name === "visibility")!;
    expect(receipt.input).toContain("asked on 7 days across 4 assistants"); // the receipt says the same thing the score used
    expect(receipt.input).toContain("while this page is already read and passed over");});
  it("ranks a page already read and passed over above the same claim on a page never retrieved", () => {
    const shared = { answers: 5, citedRivals: 3, days: 7, engines: 4 } as const;
    const ranked = rankProposals([
      aiProp("never-read", { ...shared, stage: "rivals_cited_own_not_retrieved" }),
      aiProp("passed-over", { ...shared, stage: "owned_retrieved_not_cited" })]);
    expect(ranked.map((p) => p.id)).toEqual(["passed-over", "never-read"]); // closer to the citation ranks first
  });});
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
    return run(TENANT, { complete: seam, ...OPTS });};
  it("retires the finished copy with its receipt, keeps the opportunity as research work, and persists on an ordinary day", async () => {
    store.rows.set(CITIES, heldRow());
    await runWith(incoming());
    const out = store.rows.get(CITIES)!;
    expect(out.previousCopy?.after).toBe("The finished cities section, drafted when this was still writing work.");
    expect(out.previousCopy?.retiredBecause).toContain("technical_reachability");
    expect(out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "").toContain("reachability first");
    expect([out.researchOnly, out.status === "ready", out.evidence.hints.some((h) => h.includes("reports reading"))]).toEqual([true, false, true]);});
  /** FINISHED WORK SURVIVES A SOFT RE-READ AS REVIEW WORK (Codex, 2026-08-23). Live, the /funny-farsi-phrases answer was saved Ready and destroyed back to its own brief ONE SECOND later, because the re-mint's re-read applied the banned-word rule without the exemption the editor had honoured. Soft reasons keep the words, at review, with the reason on the card; only the four hard classes still retire copy. */
  it("keeps finished copy through a soft re-read failure, downgraded to review with the reason, never the brief", async () => {
    const finished = "The finished cities section, with the word Farsi the searchers themselves use.";
    store.rows.set(CITIES, heldRow({ copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap", primaryQuery: "cities of iran",
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: finished, where: 'A new section headed "Cities", placed after "Cities of Iran"' },
      claims: [{ text: finished, supportedBy: ["page-copy-1"] }], supportFacts: [{ id: "page-copy-1", fact: finished }] }));
    acct.profile = { trustedSourceDomains: { value: [] }, constraints: { value: { bannedTerms: ["Farsi"] } }, name: { value: "Fixture" } };
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
      pageLabel: "Untouched", status: "needs_review", researchOnly: false, copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap", informationGain: { adds: "assembles in one block what the page scatters across sections", by: [], pageWhole: true }, 
      limitations: ["Read off the last stored copy of this page, so anything added since is not counted here.",
        "it tells a reader this page offers \"habitats\", and no claim on this card carries it"],
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: finished, where: 'A new section headed "Untouched", placed after "Untouched heading"' },
      claims: [{ text: finished, supportedBy: ["page-copy-1"] }],
      supportFacts: [{ id: "page-copy-1", fact: finished }, { id: "page-copy-2", fact: "The page's Untouched heading introduces the list." }] }));
    await runWith(incoming());
    const out = store.rows.get(OTHER)!;
    expect(out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "").toBe(finished);
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
      pageLabel: "Judged", status: "needs_review", researchOnly: false, copyStamp: "T|H|D|O", diagnosisCause: "ai_citation_gap", informationGain: { adds: "assembles in one block what the page scatters across sections", by: [], pageWhole: true }, limitations: lim,
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: words, where: 'A new section headed "Judged", placed after "Judged heading"' },
      claims: [{ text: words, supportedBy: ["page-copy-1"] }],
      supportFacts: [{ id: "page-copy-1", fact: words }, { id: "page-copy-2", fact: "The page's Judged heading introduces the list." }] });
    store.rows.set(JUDGED, row(["the evaluator's exact objection: it only repeats what the page already says"]));
    await runWith(incoming());
    const judged = store.rows.get(JUDGED)!;
    expect([judged.status, judged.limitations.some((l) => l.includes("evaluator"))]).toEqual(["needs_review", true]);
    store.rows.set(JUDGED, row(["this one still needs a cited authoritative source before it is paste-ready"]));
    await runWith(incoming());
    expect(store.rows.get(JUDGED)!.status).toBe("needs_review");
    for (const gone of ["it tells a reader this page offers \"habitats\", and no claim on this card carries it",
      "it tells a reader this page offers \"wool rugs\", and this page never puts those words together"]) {
      store.rows.set(JUDGED, row([gone]));
      await runWith(incoming());
      expect(store.rows.get(JUDGED)!.status).toBe("ready"); }
    store.rows.set(JUDGED, row(["the operator read this and no claim on this card carries it"]));
    await runWith(incoming());
    expect(store.rows.get(JUDGED)!.status).toBe("needs_review"); });
  it("retires nothing when there is no finished copy to make premature", async () => {
    store.rows.set(CITIES, heldRow({ researchOnly: true, status: "needs_review",
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "An earlier brief, never finished work." } }));
    await runWith(incoming());
    expect(store.rows.get(CITIES)!.previousCopy).toBeUndefined();});});
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
      .toEqual(["The finished words, one item per line.", "ready", false, undefined]);});
  it("a MATERIAL change replaces the copy and stamps the retirement receipt with the fact that moved", () => {
    for (const [over, said] of [[{ copyStamp: "THE PAGE WAS RECRAWLED DIFFERENT" }, "content changed"],
      [{ diagnosisCause: "ranking_loss" as const }, "cause changed"]] as const) {
      const out = preferFinished(brief(over), finished()); expect(out.recommendedChange.kind === "existing_edit" ? out.recommendedChange.after : "").toContain("credited pages");
      expect(out.previousCopy?.after).toBe("The finished words, one item per line."); expect(out.previousCopy?.retiredBecause).toContain(said);}});});
/** ONE BUDGET, ONE RANKED LINE (operator, 2026-08-22). The top-up spent $1.28 across 239 calls and produced nothing, because every family kept a private pool, one stubborn candidate could eat a pass, and stale work spent in front of the globally ranked line. These pin the arithmetic and the order. */
describe("the paid line is compiled, priced and funded ONCE, before a cent is spent", () => {
  const job = (key: string, family: string, impact: number, calls: number = DRAFT_BUDGET.DELIVERABLE_CALLS): { key: string; family: string; impact: number; calls: number; blocked?: string } => ({ key, family, impact, calls });
  const plan = (jobs: ReturnType<typeof job>[], over: Partial<Parameters<typeof DRAFT_BUDGET.plan>[0]> = {}) => DRAFT_BUDGET.plan({ jobs, candidates: 2, calls: 30, ...over });
  const SMALLS = ["/a", "/b", "/c", "/d"].map((k, i) => job(k, "field_draft", 40 - i)), BUNDLE = job("/bundle", "deep_bundle", 60, DRAFT_BUDGET.BUNDLE_CALLS);
  /** A KNOWN-DEAD JOB TAKES NO SLOT, AND AN UNREACHED ONE DOES NOT HOLD ONE FOREVER (Codex, 2026-08-23). Both were live defects on one dispatch: three of five slots came back unreached while cheaper completable work went unfunded, and the same pages would have been funded first again on the next drive. */
  it("declares a blocked job with its own reason and funds it never, so the money walks to the next one that can finish", () => {
    const b = plan([{ ...job("/measuring", "editor", 90), blocked: "a change on this page is already being measured, so a second one cannot be saved until that finishes" },
      job("/live", "editor", 40), job("/next", "editor", 30)], { candidates: 1 });
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
    expect(plan(jobs, { candidates: 2 }).funded.map((f) => f.key)).toEqual(["/strong", "/tiny"]);
    expect(plan(jobs, { candidates: 1, skip: ["/strong"] }).funded.map((f) => f.key)).toEqual(["/tiny"]); });
  it("gives the first funded slot to the best ranked ordinary candidate, however early an unranked family asks for it", () => {
    const b = plan([job("topic:wildlife", "new_page", 4, DRAFT_BUDGET.BUNDLE_CALLS), job("/rugs", "correction_review", 3), job("/best", "field_draft", 90)]); expect(b.funded[0]!.key).toBe("/best");
    expect([b.funded.map((f) => f.key), b.take("/best") != null, b.declined[0]?.key]).toEqual([["/best", "topic:wildlife"], true, "/rugs"]);});
  it("collapses every family that wants one page into ONE funded job, so two slots cover two pages and not one page twice", () => {
    const b = plan([job("/one", "deep_bundle", 60, DRAFT_BUDGET.BUNDLE_CALLS), job("/one", "editor", 55), job("/next", "field_draft", 30)]);
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
    expect([tight.funded.map((f) => f.key), tight.declined.map((d) => d.reason)]).toEqual([["/bundle", "/a", "/b", "/c"], ["this needs 6 charged calls and 3 were left"]]);});
  it("never lets the families together exceed the pass ceiling", () => expect(DRAFT_BUDGET.plan({ jobs: Array.from({ length: 50 }, (_, i) => job(`/p${i}`, "field_draft", 50 - i)), candidates: 50, calls: 7 })
    .funded.reduce((n, f) => n + f.calls, 0)).toBeLessThanOrEqual(7));
  it("funds nothing at all while the provider's own credit is spent", () => {
    const b = plan([job("/best", "field_draft", 90)], { breakerOpen: true }); expect([b.funded, b.take("/best"), b.spent().calls]).toEqual([[], null, 0]);
    expect(b.declined[0]!.reason).toContain("the provider's own credit is spent");
    const q = plan([job("/best", "field_draft", 90)], { quiet: true });
    expect([q.funded, q.spent().calls]).toEqual([[], 0]);
    expect(q.declined[0]!.reason).toBe("this pass was asked to spend nothing, so the work is still owed and nothing was bought for it"); });
  it("caps one candidate at ONE deliverable's price, banks the failure and still funds the next", () => {
    const b = plan([job("/best", "field_draft", 90), job("/second", "field_draft", 80)], { calls: 40 });
    const first = b.take("/best")!; expect(first.left).toBe(DRAFT_BUDGET.DELIVERABLE_CALLS); // a draft, its judge, and the retries the editor is built to make
    first.left = 0;                                   // the candidate spent its whole allowance and finished nothing
    expect([b.take("/best"), b.take("/second") != null, b.spent().calls]).toEqual([null, true, DRAFT_BUDGET.DELIVERABLE_CALLS]);});});
// ── the typed refusal contract: faults ride preserved copy, and a gain refusal mints the reading it needs ─
describe("typed refusal contract", () => {
  it("preservation carries the typed faults with the banked copy it keeps", () => {
    const FAULT = "it repeats what stays on the page below it, so a reader gets the same thing twice";
    const banked = prop({ status: "ready", workKey: "wk-1", copyStamp: "the page as it read", faults: [FAULT], limitations: [FAULT],
      claims: [{ text: "a claim", supportedBy: ["f1"] }], supportFacts: [{ id: "f1", fact: "the fact behind it" }],
      recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "The finished words that already passed every gate and were kept." } });
    const worse = prop({ ...banked, faults: undefined, limitations: [], recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: "Second generation words that must not land." } });
    const out = preferFinished(worse, banked); // same workKey, same stamp, a READY predecessor: the banked words stand, and so must Beacon's own typed statement of their defect
    expect([(out.recommendedChange as { after: string }).after, out.faults]).toEqual(["The finished words that already passed every gate and were kept.", [FAULT]]); });
  it("a claim citing evidence about something else is refused AT DRAFT TIME, not only on the banked re-read", () => {
    const P = { targetUrl: "https://www.iranopedia.com/x", title: "T", h1: "T", metaDescription: null, bodyText: "Topoli means chubby or plump and is usually affectionate. Gooz means fart and dismisses something as trivial.",
      headings: [], trackedQuestion: "funny persian phrases", ownedPaths: [], bannedTerms: [], demand: { preserve: [], vocabulary: [] },
      evidence: { "page-copy-1": "Gooz means fart and people use it informally to dismiss something as trivial." } } as never;
    const d = { actionType: "answer_block", targetUrl: "https://www.iranopedia.com/x", placementAnchor: "T", beforeText: null, naturalHeading: "Meanings", evidenceIdsUsed: ["page-copy-1"],
      uncertaintyOrOmitted: [], implementationMinutes: 5, measurementTarget: "citations", supportFacts: [],
      claims: [{ text: "Topoli means chubby or plump, usually affectionate, often said to children and small pets", supportedBy: ["page-copy-1"] }],
      finalCopy: "Topoli means chubby or plump, and Persian speakers usually say it affectionately to children, close friends, and even small pets in everyday joking conversation at home." } as never;
    expect(deliverableFailures(d, P).join(" ")).toContain("cites evidence that is about something else"); }); // the mis-aimed id is a lesson the retry fixes, never a landing that dies on the next pass
  it("an adds-nothing refusal mints a typed serp requirement instead of retrying forever", async () => {
    const owed: Array<{ key: string; kind: string; reasonCode: string }> = [];
    const PAGE = "https://www.iranopedia.com/funny-farsi-phrases";
    const A1 = "Jeegareto bokhoram is a Persian expression of affection said warmly to loved ones and close family members in everyday conversation.";
    const A2 = "Moosh bokhoradet is a playful Persian phrase meaning may a mouse eat you, used for something small and cute by parents everywhere.";
    const A3 = "Pedar sag is used as a playful insult between close friends rather than a serious offence, usually said with a smile.";
    const body = { url: PAGE, title: "Funny Farsi Phrases", h1: "Funny Farsi Phrases", metaDescription: null, vocabulary: "", headings: ["Playful Persian expressions"], passages: ["Playful Persian expressions", A1, A2, A3], contentHash: null, fetchedAt: null };
    const sibling = { url: "https://www.iranopedia.com/persian-jokes", title: "Funny Persian Jokes and Phrases", h1: "Funny Persian Jokes and Phrases", metaDescription: null, vocabulary: "", headings: ["Everyday Persian humor"], passages: ["Funny Persian phrases and jokes are collected with their meanings for readers learning everyday Persian humor."], contentHash: null, fetchedAt: null };
    const { canonicalUrlKey: ck } = await import("@/domains/evidence/snapshot");
    bodyStore.map = new Map([[ck(PAGE), body], [ck(sibling.url), sibling]]);
    const card = prop({ id: `${TENANT}::/funny-farsi-phrases::existing_edit::ai_answer_gap`, pagePath: "/funny-farsi-phrases", pageUrl: PAGE,
      changeFamily: "section", status: "needs_review" as const, researchOnly: false, primaryQuery: "funny persian phrases", limitations: [],
      evidence: { query: "funny persian phrases", hints: [], evidenceRefCount: 1 },
      recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Add a section that answers the question." } });
    const snap = { ownedPages: [
      { url: PAGE, content: { wordCount: 400, title: "Funny Farsi Phrases", h1: "Funny Farsi Phrases", outline: ["Playful Persian expressions"] }, search: null },
      { url: sibling.url, content: { wordCount: 300, title: sibling.title, h1: sibling.h1, outline: ["Everyday Persian humor"] }, search: null }],
      research: {}, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
    const draft = { field: "answer_block", before: null, rationale: "grounded", ...TAIL, after: `${A1}\n${A2}\n${A3}`, naturalHeading: "Playful expressions and their meanings",
      claims: [{ text: A1, supportedBy: ["page-copy-2"] }, { text: A2, supportedBy: ["page-copy-3"] }, { text: A3, supportedBy: ["page-copy-4"] }] };
    const out = await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snap as never, now: NOW,
      judge: async () => { throw new Error("the deterministic gate refuses before any judge is paid"); },
      owe: (key: string, need: { kind: string; reasonCode: string; reason: string }) => owed.push({ key, kind: need.kind, reasonCode: need.reasonCode }),
      budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/funny-farsi-phrases", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
      complete: async () => ({ value: draft }) } as never);
    expect(owed).toEqual([{ key: "/funny-farsi-phrases", kind: "serp", reasonCode: "no_exact_serp" }]); // the smallest correct step, as DATA the runtime executes, never a sentence it parses
    expect(out[0]!.status).toBe("needs_review"); }); // and the card stays visible, owed, unsettled: acquisition reopens it, never a blind retry
  /** THE MISSING-INFORMATION LOOP, END TO END AT THE DECISION BOUNDARY. The deadlock: a rival identifies what is missing, rival copy may support nothing, the fact check re-checked only claims the page already makes, so the writer never received one new authorized fact and restated the page forever. Now: with every winner read, the refusal resolves to the MISSING TOPIC as a typed factual_source requirement carrying the proposition to research; an UNRELATED stored fact does not satisfy it; and once a fact for that topic is banked, the packet hands it to the writer as fact-* evidence a claim may cite, and the draft that uses it lands Ready. */
  it("a gain refusal resolves to the rival-identified missing topic, an unrelated fact never satisfies it, and the banked fact reaches the next draft as citable evidence", async () => {
    const { GAIN } = await import("@/domains/decision/draft-resolution");
    const { canonicalUrlKey: ck5 } = await import("@/domains/evidence/snapshot");
    const PAGE_URL = "https://www.iranopedia.com/persian-female-first-names";
    const body = { url: PAGE_URL, title: "Persian Female Names", h1: "Persian Female Names", metaDescription: null, vocabulary: "",
      headings: ["Classic names"], passages: ["Classic names", "Darya and Afsaneh are classic Persian names for girls, each carrying its own meaning in everyday use."] };
    const page = { url: PAGE_URL, content: { wordCount: 300, title: body.title, h1: body.h1, outline: body.headings }, search: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } };
    const rival = { url: "https://rival.example/persian-girl-names", domain: "rival.example", engines: [], examplePrompts: [], appearances: [{ query: "persian girl names" }],
      extract: { title: "Persian Girl Names", h1: null, wordCount: 3000, headings: ["Classic names", "Pronunciation guide for parents"], faqCount: 0, entityNames: [], openingSample: "", hasList: true } };
    const research = { serpEvidence: [{ query: "persian girl names", organic: [{ rank: 1, url: rival.url }] }], winningPages: [rival] };
    const snapshot = { ownedPages: [page], research, sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
    const card = prop({ id: `${TENANT}::/persian-female-first-names::existing_edit::ai_answer_gap`, pagePath: "/persian-female-first-names", pageUrl: PAGE_URL,
      changeFamily: "section", status: "needs_review" as const, researchOnly: false, primaryQuery: "persian girl names", limitations: [],
      evidence: { query: "persian girl names", hints: [], evidenceRefCount: 1 },
      recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Add a section that answers the question." } });
    const step = GAIN.resolution("none", snapshot as never, card, page as never, body as never, []);
    expect([step.resolution, step.need?.kind, step.need?.missingTopic, step.need?.reasonCode, step.need?.rivalUrl])
      .toEqual(["acquire_factual_source", "factual_source", "Pronunciation guide for parents", "missing_information", rival.url]);
    const unrelated = [{ subject: "Darya meaning", state: "checked" }];
    expect(GAIN.resolution("none", snapshot as never, card, page as never, body as never, unrelated).need?.missingTopic).toBe("Pronunciation guide for parents");
    const answered = [...unrelated, { subject: "Pronunciation guide for parents", state: "checked" }];
    expect(GAIN.resolution("none", snapshot as never, card, page as never, body as never, answered).need?.missingTopic).toBeUndefined();
    bodyStore.map = new Map([[ck5(PAGE_URL), body]]);
    const { VERIFICATION_RULES_VERSION: RULES } = await import("@/domains/evidence/pages/fact-checks");
    const { pageHashOf: hashOf } = await import("@/domains/evidence/pages/fact-check-run");
    const bodyHash = hashOf([body.title, body.h1, ...body.headings, ...body.passages].filter(Boolean).join("\n"));
    const FACT = { page: "/persian-female-first-names", statementKey: "missing#1", subject: "Pronunciation guide for parents",
      current: "", proposed: "Most classic Persian girls' names are pronounced with even stress, so Darya is dar-YAH and Afsaneh is af-sah-NEH.",
      literal: null, usage: null, sources: [{ url: "https://en.wiktionary.org/x", kind: "dictionary", says: "dar-YAH" }],
      agreement: "single_source", confidence: "confirmed", verdict: "undecidable", alsoAt: [], note: "",
      pageContentHash: bodyHash, pageLocator: "missing", sourceReadAt: NOW.toISOString(), state: "checked", rulesVersion: RULES, evidenceBasis: null, checkedAt: NOW.toISOString() };
    factStore.rows = [FACT];
    const NEW_COPY = "Most classic Persian girls' names are pronounced with even stress, so Darya is dar-YAH and Afsaneh is af-sah-NEH, which helps parents say each name confidently from the first try.";
    const seen: string[] = [];
    const out2 = await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snapshot as never, now: NOW, reviewer: async () => ({ notes: "fine" }) as never,
      judge: async () => ({ pageFit: true, claimsEntailed: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "names the spring-equinox date the page never states" }) as never,
      budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/persian-female-first-names", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
      complete: async ({ user }: { user: string }) => (seen.push(user), { value: { field: "answer_block", before: null, rationale: "grounded", ...TAIL, placementAnchor: "Persian Female Names",
        after: NEW_COPY, naturalHeading: "How to pronounce them", claims: [{ text: NEW_COPY, supportedBy: ["fact-1"] }] } }) } as never);
    expect(seen.join(" ")).toContain("fact-1: Most classic Persian girls' names are pronounced"); // the researched fact reached the writer as citable evidence
    expect(seen.join(" ")).toContain("rival-1"); // the rival stayed briefing beside it
    expect(out2[0]!.status).toBe("ready");
    expect((out2[0]!.recommendedChange as { where?: string }).where).toContain("placed after"); // exact placement on the rendered change
    bodyStore.map = null; });

  /** THE DEADLOCK ITSELF, PINNED. Live for weeks: the card brief, the last drafting hint and the answer-block system
   *  clause each told the writer to build only from the page's own material, while `addsNothing` refused copy that
   *  stood only on the page's own material. Worse, the gate ARMED on `rival-*` briefing, which is the one class no
   *  claim may cite, so a list page carrying rival evidence and no checked fact was refused for declining a route it
   *  never had. Not one substantive body change reached Ready in production. A list page whose gain is genuinely the
   *  SHAPE now lands, and the quality bar does not move: a one-line restatement still fails on structure. */
  it("lands a list page whose gain is the shape, where no checked fact and no sibling page exists", async () => {
    const { canonicalUrlKey: ck6 } = await import("@/domains/evidence/snapshot");
    const URL_R = "https://www.iranopedia.com/persian-rugs";
    const body = { url: URL_R, title: "Persian Rugs", h1: "Persian Rugs", metaDescription: null, vocabulary: "",
      headings: ["Tabriz", "Kashan", "Kerman"],
      passages: ["Persian rugs come in many types, woven city by city.",
        "Tabriz rugs are knotted tightly and their patterns hold fine detail.",
        "Kashan rugs use a central medallion, and Kerman rugs use open ground with a wide decorated border."] };
    const page = { url: URL_R, content: { wordCount: 400, title: body.title, h1: body.h1, outline: body.headings }, search: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } };
    const rival = { url: "https://rival.example/rug-types", domain: "rival.example", engines: [], examplePrompts: [], appearances: [{ query: "types of persian rugs" }],
      extract: { title: "Rug Types", h1: null, wordCount: 2000, headings: ["Knot density"], faqCount: 0, entityNames: [], openingSample: "", hasList: true } };
    const snapshot = { ownedPages: [page], research: { serpEvidence: [{ query: "types of persian rugs", organic: [{ rank: 1, url: rival.url }] }], winningPages: [rival] },
      sources: [], scope: { tenantId: TENANT, site: "iranopedia.com" } };
    const card = prop({ id: `${TENANT}::/persian-rugs::existing_edit::ai_answer_gap`, pagePath: "/persian-rugs", pageUrl: URL_R,
      changeFamily: "section", status: "needs_review" as const, researchOnly: false, primaryQuery: "types of persian rugs",
      treatment: "add_answer_section", limitations: [], evidence: { query: "types of persian rugs", hints: [], evidenceRefCount: 1 },
      recommendedChange: { kind: "existing_edit" as const, field: "section" as const, before: null, after: "Add a section that answers the question." } });
    factStore.rows = []; // NO checked fact anywhere, which is the production reality this page has always been in
    bodyStore.map = new Map([[ck6(URL_R), body]]);
    const L1 = "Persian rugs are named for the city that wove them, and the weave is what tells the types apart.";
    const L2 = "Tabriz rugs are knotted tightly, which is what lets their patterns hold fine detail.";
    const L3 = "Kashan rugs use a central medallion, and Kerman rugs use open ground with a wide decorated border.";
    const why = new Map<string, string>();
    const run = async () => applyDraftedCopy([card], { tenantId: TENANT, snapshot: snapshot as never, now: NOW, reviewer: async () => ({ notes: "fine" }) as never, refusals: why,
      judge: async () => ({ pageFit: true, claimsEntailed: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "names the spring-equinox date the page never states" }) as never,
      budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/persian-rugs", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
      complete: async () => ({ value: { field: "answer_block", before: null, rationale: "grounded", ...TAIL, placementAnchor: "Persian Rugs",
        after: `${L1}\n${L2}\n${L3}`, naturalHeading: "How the main types differ",
        claims: [{ text: L1, supportedBy: ["page-copy-1"] }, { text: L2, supportedBy: ["page-copy-2"] }, { text: L3, supportedBy: ["page-copy-3"] }] } }) } as never);
    const landed = await run();
    expect({ s: landed[0]!.status, w: [...why.values()] }).toEqual({ s: "ready", w: [] });
    const why2 = new Map<string, string>();
    const thin = await applyDraftedCopy([card], { tenantId: TENANT, snapshot: snapshot as never, now: NOW, reviewer: async () => ({ notes: "fine" }) as never, refusals: why2,
      judge: async () => ({ pageFit: true, claimsEntailed: true, usefulAndNatural: true, placementCorrect: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, notes: "names the spring-equinox date the page never states" }) as never,
      budget: DRAFT_BUDGET.plan({ jobs: [{ key: "/persian-rugs", family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }),
      complete: async () => ({ value: { field: "answer_block", before: null, rationale: "grounded", ...TAIL, placementAnchor: "Persian Rugs",
        after: L1, naturalHeading: "How the main types differ", claims: [{ text: L1, supportedBy: ["page-copy-1"] }] } }) } as never);
    expect(thin[0]!.status).toBe("ready"); // no deterministic gate can arm without a citable id, which is why the editor is instructed instead
    bodyStore.map = null; factStore.rows = []; });});

/** THE DAY THE EDITOR NEVER OPENED. `acted` is the CTR ladder's verdict and it returns `act_existing_page` for exactly ONE cause, a title deficit, so on every day no page had one, `quietDay` was true, the editor declared NO work, and the AI-answer cards already minted for /cities, /persian-rugs and the rest were persisted as research and never drafted. Live 2026-08-26: "nothing earned an action this pass, judged 225, watching 69" while six substantive cards sat on file. */
describe("a day holding writable AI work is not a quiet day", () => {
  const card = (treatment: string | null) => ({ treatment });
  it("opens the editor when a writable AI card exists and the operator is owed finished work", async () => {
    const { isQuietDay } = await import("@/domains/decision/produce-proposals");
    expect(isQuietDay(0, 0, [card("rewrite_existing_section")], 1)).toBe(false);
    expect(isQuietDay(0, 0, [card("technical_reachability"), card("rewrite_existing_section")], 1)).toBe(false);
    expect(isQuietDay(0, 0, [card("rewrite_existing_section")], 0)).toBe(true); // a free refresh nobody asked finished work from still buys nothing
    expect(isQuietDay(0, 0, [card("technical_reachability"), card("new_page")], 5)).toBe(true); // a DECISION treatment is not writing work
    expect([isQuietDay(0, 0, [], 5), isQuietDay(1, 0, []), isQuietDay(0, 1, [])]).toEqual([true, false, false]); });});

/** ONE PAGE IS NOT ONE OPPORTUNITY. Coverage was keyed on the PAGE, so one Ready row anywhere on a URL dropped every other card for it: /farsi-numbers owes a title aligned to "persian numbers 0-9 names and symbols" (4,744 impressions, ZERO clicks), a zero row its table never had, and FAQ schema for four question headings carrying none, and the queue could offer exactly ONE, forever. Two cards collide only when they would overwrite the same mutation, which is what this key names. */
describe("distinct atomic changes on one page do not suppress each other", () => {
  const at = (path: string, field: string, q = "") => ({ pagePath: path, pageUrl: `https://www.iranopedia.com${path}`, primaryQuery: q, recommendedChange: { kind: "existing_edit" as const, field, before: null, after: "x" } } as never);
  it("separates changes by the mutation they make, and still catches two writing the same one", async () => {
    const { mutationKey } = await import("@/domains/decision/produce-proposals");
    const [title, meta, h1] = [mutationKey(at("/farsi-numbers", "title")), mutationKey(at("/farsi-numbers", "meta")), mutationKey(at("/farsi-numbers", "h1"))];
    expect(new Set([title, meta, h1]).size).toBe(3); // three fields, three changes, applicable in any order
    const zero = mutationKey(at("/farsi-numbers", "section", "persian numbers 0-9 names and symbols"));
    expect(zero).not.toBe(mutationKey(at("/farsi-numbers", "section", "persian ordinal numbers"))); // different questions, different work
    expect(mutationKey(at("/farsi-numbers", "title", "a"))).toBe(mutationKey(at("/farsi-numbers", "title", "b")));
    expect(mutationKey(at("/farsi-numbers", "section", "Persian Numbers 0-9 Names And Symbols"))).toBe(zero);
    expect(mutationKey(at("/cities", "title"))).not.toBe(title); });});
