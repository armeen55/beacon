/** Outcome tests for the EvidenceSnapshot kernel: the CONTRACT downstream Decisions consume, never the implementation. All six mandatory sources normalize in with an honest freshness slot, owned-page and competitor evidence are both present, the AI lane is DERIVED from the canonical answers riding on the research payload (no second AI input is left to disagree with it), and the evidenceHash tracks MATERIAL evidence only. */
import { describe, it, expect } from "vitest";
import { buildEvidenceSnapshot, MANDATORY_SOURCES, type EvidenceSnapshotInput, type EvidenceSourceKind } from "./snapshot";
import { buildTopicInvestigations, reconcileResearchCases } from "./topic-investigation";
import { foldCases } from "./case-identity";
import { emptyResearchEvidence, type CanonicalPairObservation, type FunnelResearchEvidence } from "./funnel/research-evidence";
const SCOPE = { tenantId: "t_iran", site: "fixture-content.example", builtAt: "2026-07-22T00:00:00.000Z" };
const OWNED = "https://fixture-content.example/flag", KEBAB = "https://persianfood.example/kebab", EMBLEM = "what does the emblem on the iran flag mean";
const cite = (url: string) => ({ url, domain: new URL(url).hostname, title: null });
const at = <T,>(payload: T) => ({ status: "fresh" as const, lastSyncedAt: "2026-07-21T00:00:00.000Z", payload });
/** ONE canonical answer exactly as the loader hands it over: the identity, the journey, and a reading ONLY where one settled against that answer. Everything the snapshot says about AI is derived from these rows and nothing else. */
const answer = (promptId: string, engine: string, over: Partial<CanonicalPairObservation> = {}): CanonicalPairObservation => ({
  observationId: `obs_${promptId}_${engine}`, promptId, promptVersion: 2, promptText: `ask ${promptId}`, engine, modelRequested: "gpt-4o", modelServed: "gpt-4o-2026",
  observationMode: "consumer_search", reportingDay: "2026-07-21", observedAt: "2026-07-22T00:00:00.000Z", answerHash: "h", webSearchReported: true, citationsObserved: true,
  fanOutQueries: ["koobideh", "kebab koobideh"], citations: [cite(OWNED), cite(KEBAB)], retrievedResults: null, brandMentions: null, analysisHash: null, analysis: { questionsAnswered: [EMBLEM] }, ...over });
const aiEvidence = (): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), aiObservations: [answer("p1", "chatgpt", { analysis: { questionsAnswered: [EMBLEM, "iran flag colors meaning"] } }),
  answer("p2", "chatgpt"), answer("p3", "perplexity"), answer("p3", "chatgpt", { citations: [cite(OWNED)], analysis: null })] });
const HISTORY = "https://fixture-content.example/flag-history";
/** A fully-populated six-source fixture (existing owned page + a competitor the answers keep crediting). */
const fullInput = (): EvidenceSnapshotInput => ({
  scope: SCOPE,
  gsc: at([{ url: OWNED, clicks90d: 40, impressions90d: 4000, ctr90d: 0.01, position90d: 8.2, topQueries: [{ query: "iran flag meaning", impressions: 3000, clicks: 30, position: 8 }, { query: "iran flag colors", impressions: 1000, clicks: 10, position: 9 }] },
    { url: HISTORY, clicks90d: 5, impressions90d: 900, ctr90d: 0.005, position90d: 14, topQueries: [{ query: "iran flag meaning", impressions: 900, clicks: 5, position: 14 }] }]),
  ga4: at([{ url: OWNED, sessions28d: 800, engaged28d: 500, conversions28d: 12, revenueUsd: 340 }]),
  wix: at([{ url: OWNED, title: "The Iran Flag: Meaning and Colors", metaDescription: "What the Iran flag means.", h1: "The Iran Flag", h2: ["Colors", "Emblem"], outline: ["Colors", "Emblem", "History"], schemaTypes: ["Article"], hasFaq: false, faqCount: 0, wordCount: 600, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" },
    { url: HISTORY, title: "Iran Flag History Through the Ages", metaDescription: null, h1: "Iran Flag History", h2: ["Timeline"], outline: ["Timeline"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 300, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" }]),
  clarity: at([{ url: OWNED, sessions: 800, rageClicks: 20, deadClicks: 10, quickbacks: 5, scriptErrors: 3, frictionScore: 36 }]),
  dataforseo: at([{ query: "iran flag meaning", searchVolume: 5400, competition: 0.2, competitionLevel: "low" }, { query: "buy iran flag", searchVolume: 880, competition: 0.8, competitionLevel: "high" }]),
  research: at(aiEvidence()), aiAnswersUnread: false });
describe("buildEvidenceSnapshot - six-source normalization", () => {
  it("normalizes all six sources and joins owned evidence by canonical URL", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    expect(snap.sources.map((s) => s.source).sort()).toEqual([...MANDATORY_SOURCES].sort()); expect(snap.sources.every((s) => s.status === "fresh")).toBe(true);
    const flag = snap.ownedPages.find((p) => p.url === "fixture-content.example/flag")!;
    expect([flag.search?.clicks90d, flag.engagement?.revenueUsd, flag.content?.title, flag.friction?.frictionScore]).toEqual([40, 340, "The Iran Flag: Meaning and Colors", 36]); // GSC, GA4 revenue, Wix, Clarity
    expect([flag.aiCitations.count, flag.aiCitations.distinctPrompts, snap.aiCitations.rowsScanned]).toEqual([4, 3, 4]); // four credits of my own page across three questions, off the four answers themselves
    const meaning = snap.keywordDemand.find((k) => k.query === "iran flag meaning")!; // DataForSEO volume, both sources agreed, and 3000 + 900 impressions across both owned pages
    expect([meaning.searchVolume, meaning.source, meaning.gscImpressions]).toEqual([5400, "mixed", 3900]);
    expect(snap.questionDemand.find((x) => x.question.includes("emblem"))!).toMatchObject({ source: "native_ai", weight: 3, sourcePrompts: ["ask p1", "ask p2", "ask p3"] }); // the questions the ANSWERS answered, weighted by recurrence
  });
  it("surfaces competitor, cannibalization, and intent evidence", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    expect(snap.competitors.map((c) => [c.domain, c.citationCount, c.distinctPrompts])).toEqual([["persianfood.example", 3, 3]]);
    expect(snap.contentGaps.every((g) => g.kind === "unanswered_question")).toBe(true); // a cited competitor stays evidence and never becomes a page topic of its own
    const cannib = snap.cannibalization.find((c) => c.query === "iran flag meaning")!;
    expect(cannib.competingUrls).toEqual(["fixture-content.example/flag", "fixture-content.example/flag-history"]);
    expect(snap.intentClusters.find((c) => c.queries.some((qq) => qq.includes("buy")))?.intent).toBe("commercial"); });
  it("gives one answer one vote, and ranks rivals by how many QUESTIONS credit them rather than how many answers do", () => {
    const LOUD = "https://loud.example/x", STEADY = "https://steady.example/x", PAIRED = "https://paired.example/x", many = Array.from({ length: 11 }, () => cite(LOUD));
    const rows = [answer("p1", "chatgpt", { citations: [...many, cite(STEADY), cite(OWNED), cite(OWNED)] }), answer("p1", "gemini", { citations: [cite(LOUD)] }), answer("p1", "claude", { citations: [cite(LOUD)] }),
      answer("p2", "chatgpt", { citations: [cite(STEADY), cite(PAIRED)] }), answer("p3", "perplexity", { citations: [cite(STEADY), cite(PAIRED)] })];
    const snap = buildEvidenceSnapshot({ ...fullInput(), research: at({ ...emptyResearchEvidence(), aiObservations: rows }) });
    // Eleven repeats inside one answer are one answer's opinion. And ONE question answered three times (loud) must rank BELOW two questions answered once each (paired), which only ranking on distinct questions can do.
    expect([snap.ownedPages.find((p) => p.url === "fixture-content.example/flag")!.aiCitations.count, snap.competitors.map((c) => [c.domain, c.citationCount, c.distinctPrompts])])
      .toEqual([1, [["steady.example", 3, 3], ["paired.example", 2, 2], ["loud.example", 3, 1]]]); });
  it("is deterministic and hashes on material evidence, not the clock", () => {
    const base = fullInput(); const a = buildEvidenceSnapshot(base); expect(buildEvidenceSnapshot(fullInput())).toEqual(a);
    expect(buildEvidenceSnapshot({ ...base, gsc: { ...base.gsc, lastSyncedAt: "2099-01-01T00:00:00.000Z" } }).evidenceHash).toBe(a.evidenceHash);
    const changed = { ...base, gsc: { ...base.gsc, payload: base.gsc.payload.map((p, i) => (i === 0 ? { ...p, clicks90d: 9999 } : p)) } };
    expect(buildEvidenceSnapshot(changed).evidenceHash).not.toBe(a.evidenceHash); }); });
describe("buildEvidenceSnapshot - honest source states", () => {
  const empty = <T,>(payload: T) => ({ status: "empty" as const, lastSyncedAt: null, payload });
  it("keeps all six slots when every source is empty, and tells a FAILED source apart from an empty one", () => {
    const snap = buildEvidenceSnapshot({ scope: SCOPE, gsc: empty([]), wix: empty([]), clarity: empty([]), dataforseo: empty([]),
      research: empty(emptyResearchEvidence()), aiAnswersUnread: false, ga4: { status: "failed", lastSyncedAt: null, note: "GA4 read errored this run.", payload: [] } });
    const byKind = new Map<EvidenceSourceKind, string>(snap.sources.map((s) => [s.source, s.status]));
    expect([snap.sources.length, snap.ownedPages.length, byKind.get("gsc"), byKind.get("native_ai")]).toEqual([6, 0, "empty", "dormant"]); // no answer on file is DORMANT, a different claim from a clean empty read
    const ga4 = snap.sources.find((s) => s.source === "ga4")!; expect([ga4.status, ga4.note]).toEqual(["failed", "GA4 read errored this run."]); });
  it("assembles owned evidence with no AI answer at all, and claims no competitor and no question without one", () => {
    const snap = buildEvidenceSnapshot({ ...fullInput(), research: { status: "dormant", lastSyncedAt: null, payload: emptyResearchEvidence() } });
    expect([snap.ownedPages.length, snap.competitors.length, snap.questionDemand.length, snap.aiCitations.ownedCited]).toEqual([2, 0, 0, 0]); }); });
describe("evidenceHash - research material truth, not the clock", () => {
  const researchFixture = (): FunnelResearchEvidence => ({ ...aiEvidence(),
      retainedKeywords: [{ query: "koobideh recipe", searchVolume: 1200, competition: 0.3, competitionLevel: "low", difficulty: null, intent: "informational" }],
      serpEvidence: [{ observedAt: null, query: "koobideh recipe", organic: [{ rank: 1, domain: "persianfood.example", url: KEBAB, title: "Kebab" }], aiOverview: [{ url: "https://ao.example/x", domain: "ao.example", title: null }], aiMode: [], paa: [{ question: "what is koobideh", answeringDomain: "persianfood.example" }], related: ["kebab"] }],
      winningPages: [{ url: KEBAB, domain: "persianfood.example", engines: ["chatgpt"], examplePrompts: ["best koobideh recipe"], appearances: [], extract: { title: "Kebab", h1: "Koobideh Kebab", wordCount: 800, headings: ["Ingredients"], faqCount: 2 } }],
      receipt: { researched: 5, retained: 1, stale: 0, missing: 0, cached: 3, spentUsd: 0.02, freshestObservationAt: "2026-07-22T00:00:00.000Z" } });
  const hashOf = (r: FunnelResearchEvidence) => buildEvidenceSnapshot({ ...fullInput(), research: at(r) }).evidenceHash;
  it("is stable when only clocks and spend/cache counters change", () => {
    const base = hashOf(researchFixture()); const clockOnly = researchFixture(); clockOnly.aiObservations[0].observedAt = "2099-01-01T00:00:00.000Z";
    clockOnly.winningPages[0].appearances = [{ kind: "ai_answer", query: null, promptId: "p1", promptText: "x", engine: "chatgpt", rank: null, citedUrl: KEBAB, observedAt: "2099-01-01T00:00:00.000Z", modelServed: "gpt-4o-2026" }];
    clockOnly.receipt = { researched: 999, retained: 999, stale: 9, missing: 9, cached: 999, spentUsd: 9.99, freshestObservationAt: "2099-01-01T00:00:00.000Z" };
    expect(hashOf(clockOnly)).toBe(base); });
  it("changes for a settled reading, a citation URL, observation mode, served model, fan-out list, keyword volume/intent, or extract structure", () => {
    const base = hashOf(researchFixture());
    const mut = (f: (r: FunnelResearchEvidence) => void) => { const r = researchFixture(); f(r); return hashOf(r); };
    expect(mut((r) => (r.aiObservations[0].citations![0].url = "https://other.example/x"))).not.toBe(base); expect(mut((r) => (r.aiObservations[0].modelServed = "gpt-5"))).not.toBe(base);
    expect(mut((r) => (r.aiObservations[0].observationMode = "standardized_response"))).not.toBe(base); // the consumer look and the standardized answer are never the same evidence
    expect(mut((r) => (r.aiObservations[0].fanOutQueries = ["totally", "different"]))).not.toBe(base); expect(mut((r) => (r.winningPages[0].extract!.wordCount = 12345))).not.toBe(base);
    expect(mut((r) => (r.retainedKeywords[0].searchVolume = 99999))).not.toBe(base); expect(mut((r) => (r.retainedKeywords[0].intent = "commercial"))).not.toBe(base);
    expect(mut((r) => (r.aiObservations[0].analysisHash = "settled"))).not.toBe(base); // a reading that landed is new evidence even when the answer credited the very same pages
  }); });
/** TopicInvestigation: the NON-ACTIONABLE research packet - what it may claim and what it must refuse to claim. CORPUS gives this account 12 phrases, so "harbor" is its ubiquitous word and can never be the reason two topics merge. */
describe("buildTopicInvestigations - the research packet", () => {
  const NOW = "2026-07-27T00:00:00.000Z"; const OLD = "2026-01-01T00:00:00.000Z"; const src = <T,>(payload: T) => ({ status: "fresh" as const, lastSyncedAt: null, payload });
  const kwRow = (query: string) => ({ query, searchVolume: null, competition: null, competitionLevel: null, difficulty: null, intent: null, discoveredVia: "ranked" as const, seed: null }); const CORPUS = ["harbor tide chart", "harbor whale tour", "harbor ferry time", "harbor parking rate", "harbor seafood market", "harbor fishing permit", "harbor bike hire", "harbor dog beach", "harbor live music", "harbor farmer market", "harbor kayak paddle", "harbor tote bag"].map(kwRow);
  const serp = (query: string, rows: [string, string][], observedAt: string | null = NOW) => ({ query, observedAt, organic: rows.map(([url, title], i) => ({ rank: i + 1, url, domain: new URL(url).hostname, title })), aiOverview: [], aiMode: [], paa: [], related: [] });
  const obs = (promptId: string, promptText: string, fanOutQueries: string[]) => answer(promptId, "chatgpt", { promptText, fanOutQueries, citations: [], observedAt: NOW, analysis: null });
  const body = (fetchedAt: string | null, wordCount = 900) => ({ title: "T", h1: "T", wordCount, headings: ["A", "B"], faqCount: 0, fetchedAt }); type App = FunnelResearchEvidence["winningPages"][number]["appearances"][number];
  const win = (url: string, query: string, extract: FunnelResearchEvidence["winningPages"][number]["extract"], extra: App[] = []) => ({ url, domain: new URL(url).hostname, engines: [], examplePrompts: [], extract, appearances: [{ kind: "serp_organic" as const, query, promptId: null, promptText: null, engine: null, rank: 1, citedUrl: url, observedAt: NOW, modelServed: null }, ...extra] });
  const world = (over: Partial<FunnelResearchEvidence> = {}) => buildEvidenceSnapshot({
    scope: { tenantId: "t", site: "own.example", builtAt: NOW }, ga4: src([]), wix: src([]), clarity: src([]), dataforseo: src([]), aiAnswersUnread: false,
    gsc: src([{ url: "https://own.example/kayaks", clicks90d: 3, impressions90d: 400, ctr90d: 0.01, position90d: 18, topQueries: [{ query: "harbor kayak paddle", impressions: 400, clicks: 3, position: 18 }] }]),
    research: src({ ...emptyResearchEvidence(), retainedKeywords: CORPUS,
      serpEvidence: [serp("harbor kayak paddle", [["https://a.example/g", "How to paddle a kayak"], ["https://b.example/g", "Kayak paddling guide"], ["https://c.example/g", "Paddle a kayak explained"], ["https://d.example/g", "Kayak paddle tutorial"], ["https://e.example/g", "kayak paddle : r/kayak"]]),
        serp("kayak paddle harbor", [["https://f.example/x", "Kayak paddle basics"]]), // the same specific subject in other words
        serp("harbor tote bag", [["https://shop.example/product/1", "Tote one"], ["https://shop.example/product/2", "Tote two"], ["https://shop.example/product/3", "Tote three"], ["https://shop.example/product/4", "Tote four"], ["https://g.example/a", "How to choose a tote"], ["https://h.example/a", "Tote bag guide"], ["https://i.example/a", "Totes explained"]], null), // never dated: an undated look supports no page type
        serp("onager", [["https://zoo.example/onager", "Onager"], ["https://encyclo.example/onager-weapon", "Onager (weapon)"], ["https://fund.example/onager", "Onager herds of the steppe"]])],
      aiObservations: [obs("p1", "how do harbor tides work", ["how do harbor tides work", "harbor tide table"]), obs("p2", "what harbor kayak gear do beginners need", ["harbor kayak gear"])],
      winningPages: [win("https://a.example/g", "harbor kayak paddle", body(NOW)), win("https://b.example/g", "harbor kayak paddle", body(NOW)), win("https://c.example/g", "harbor kayak paddle", body(NOW)), win("https://zoo.example/onager", "onager", null), win("https://encyclo.example/onager-weapon", "onager", body(NOW, 40)), win("https://fund.example/onager", "onager", body(OLD))], ...over }) });
  const build = (over: Partial<FunnelResearchEvidence> = {}) => buildTopicInvestigations(world(over));
  const ALL = build(); const byLabel = (part: string) => ALL.find((i) => i.label.includes(part))!;
  it("groups on real lineage or one specific subject, and claims only the demand it has", () => {
    const tides = byLabel("tide"); const paddle = byLabel("kayak paddle"); expect(paddle.queries).toEqual(expect.arrayContaining(["harbor kayak paddle", "kayak paddle harbor"])); // one shared specific intent, one investigation
    expect(tides.key).not.toBe(byLabel("kayak gear").key); expect(tides.fanOuts.map((f) => f.query)).toEqual(["harbor tide table"]); // a tracked prompt is never its own fan-out
    expect(tides.fanOuts[0]).toMatchObject({ parentPromptId: "p1", parentPromptText: "how do harbor tides work", engine: "chatgpt" });
    expect(tides.demandBasis).toBe("ai"); expect(tides.demand.monthlySearchVolume).toBeNull(); expect(tides.missingEvidence.some((m) => m.includes("monthly search volume"))).toBe(true); // AI demand never implies Google demand
    expect(paddle.demandBasis).toBe("search"); expect(paddle.demand.trackedPrompts).toBe(0); expect(paddle.missingEvidence.some((m) => m.includes("AI engine"))).toBe(true); // and search demand never claims AI recurrence
  });
  it("reads what wins conservatively, and never counts a stale, thin or unread winner as present-day evidence", () => {
    const shapes = byLabel("tote"); const onager = byLabel("onager"); expect(shapes.pageTypeVotes).toEqual([{ pageType: "informational_guide", domains: 3 }, { pageType: "product", domains: 1 }]); // 4 shop URLs are ONE vote, and a shop is not a guide
    expect(shapes.pageType).toBe("unknown"); expect(shapes.serpFreshness).toBe("undated"); expect(onager.serpCoherence).toBe("mixed"); // no page type is supported without a current exact look
    expect(onager.pageType).toBe("mixed"); // two meanings are never one page-shaped topic
    expect(onager.winners.map((w) => w.extractState).sort()).toEqual(["missing", "stale", "unreadable"]); expect(onager.currentReadableWinners).toBe(0); });
  it("owes three ranked ADDRESSES before it can compare and three read BODIES before anything is written, and never emits an action", () => {
    const paddle = byLabel("kayak paddle"); expect(paddle.pageType).toBe("informational_guide"); // three read and three named: nothing about the winners is owed
    expect(paddle.currentReadableWinners).toBe(3); expect(paddle.missingEvidence.every((m) => m.includes("AI engine"))).toBe(true);
    const only = (over: Parameters<typeof build>[0]) => build(over).find((i) => i.label.includes("kayak paddle"))!.missingEvidence.filter((m) => m.includes("win"));
    expect(only({ winningPages: [win("https://a.example/g", "harbor kayak paddle", body(NOW)), win("https://b.example/g", "harbor kayak paddle", body(NOW))] }))
      .toEqual(["I can name 2 of the 3 sites that win here, so I cannot compare them against your own pages yet."]); // two addresses: the comparison is what is owed
    expect(only({ winningPages: ["a", "b", "c"].map((h, i) => win(`https://${h}.example/g`, "harbor kayak paddle", body(i === 0 ? NOW : OLD))) }))
      .toEqual(["I have read 1 of the 3 winning pages I would need before writing a page of your own."]); // three addresses, one body: only the WRITING is blocked
    const keys = (v: unknown): string[] => Array.isArray(v) ? v.flatMap(keys) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : [];
    expect(keys(ALL).filter((k) => /action|proposal|draft|recommend|status|queue|publish|outline|meta/i.test(k))).toEqual([]); });
  it("never welds unrelated subjects: one owner per anchor, so a stale row and a shared-anchor chain both stay bounded", () => {
    // A dormant row claiming one anchor from each of two live cases used to union them into ONE case in a single pass.
    const weld = foldCases([["flag", "flag meaning"], ["visa", "visa rules"]], [{ id: "inv_flag", anchors: ["flag", "flag meaning"] }, { id: "inv_visa", anchors: ["visa", "visa rules"] }, { id: "inv_old", anchors: ["flag", "visa"] }]);
    const liveIds = weld.filter((f) => f.anchors.length > 0).map((f) => f.id).sort();
    expect([liveIds, weld.flatMap((f) => f.aliases).includes("inv_old")]).toEqual([["inv_flag", "inv_visa"], true]);
    // And a chain of subjects each sharing ONE anchor with the next resolves ownership pairwise; it never cascades into one case.
    const chain = [["c1", ["x1", "x2"]], ["c2", ["x2", "x3"]], ["c3", ["x3", "x4"]], ["c4", ["x4", "x5"]], ["c5", ["x5", "x6"]]] as const;
    const out = foldCases([["x1"], ["x2"], ["x3"], ["x4"], ["x5"], ["x6"]], chain.map(([id, anchors]) => ({ id: `inv_${id}`, anchors: [...anchors] })));
    const alive = out.filter((f) => f.anchors.length > 0), owned = alive.flatMap((f) => f.anchors);
    // Pairwise resolution absorbs a neighbor that loses its every contested anchor; it never accumulates: ownership stays disjoint, no case grows past its own two anchors, and the ten never land in one case.
    expect([new Set(owned).size === owned.length, Math.max(...alive.map((f) => f.anchors.length)) <= 2, alive.length >= 3]).toEqual([true, true, true]); });
  it("keeps ONE frozen case id through enrichment, merges two on file into one canonical id plus an alias, and splits without minting a third", () => {
    const cases = reconcileResearchCases(world()); const anchorsOf = (part: string) => cases.find((c) => c.id === byLabel(part).key)!.anchors;
    const keyOf = (over: Partial<FunnelResearchEvidence>, part = "kayak paddle") => build({ cases, ...over }).find((i) => i.label.includes(part))!.key;
    // An alphabetically EARLIER query for the same subject, and a new tracked prompt beside it: the old id was a hash of the smallest query it held, so both used to rename an open case.
    const earlier = serp("aaa harbor kayak paddle", [["https://a.example/g", "x"], ["https://b.example/g", "y"], ["https://c.example/g", "z"]]);
    const frozen = byLabel("kayak paddle").key; const base = world().research.serpEvidence;
    const grown = { serpEvidence: [...base, earlier] }, fresher = { ...grown, aiObservations: [obs("p3", "harbor kayak paddle guide", [])] };
    expect([keyOf({}), keyOf(grown), keyOf(fresher)]).toEqual([frozen, frozen, frozen]);
    const two = [{ id: "inv_alpha", anchors: anchorsOf("kayak paddle").slice(0, 1) }, { id: "inv_beta", anchors: [...anchorsOf("kayak paddle"), "zz", "yy"] }];
    expect(build({ cases: two }).find((i) => i.label.includes("kayak paddle"))!.key).toBe("inv_beta"); // a merge keeps the id with the most anchors
    expect(reconcileResearchCases(world({ cases: two })).find((c) => c.id === "inv_alpha")).toEqual({ id: "inv_alpha", anchors: [], aliasOf: "inv_beta" }); // the other is a durable alias, never a third id
    // THE WHOLE LIFECYCLE: save the merged registry, come back to it in a fresh process, and the absorbed id is STILL this case's, so an answer bought under it is found rather than bought again.
    const saved = JSON.parse(JSON.stringify(reconcileResearchCases(world({ cases: two })))) as typeof cases;
    expect(build({ cases: saved }).find((i) => i.label.includes("kayak paddle"))!.aliasKeys).toEqual(["inv_alpha"]); expect([...reconcileResearchCases(world({ cases: saved }))].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...saved].sort((a, b) => a.id.localeCompare(b.id))); // and a fixpoint, never a growing pile (row ORDER is not the promise; the rows are)
    expect(reconcileResearchCases(world({ cases: [...two, { id: "inv_gamma", anchors: [], aliasOf: "inv_alpha" }] })).filter((c) => c.aliasOf).map((c) => `${c.id} ${c.aliasOf}`).sort()).toEqual(["inv_alpha inv_beta", "inv_gamma inv_beta"]); // alpha absorbed gamma and beta absorbed alpha: ONE canonical id, written back flat
    expect(reconcileResearchCases(world({ cases: [...two, ...Array.from({ length: 70 }, (_, i) => ({ id: `inv_old${i}`, anchors: [`old${i}`] }))] })).filter((c) => c.aliasOf === "inv_beta").map((c) => c.id)).toEqual(["inv_alpha"]); // the cap spends itself on dormant rows, never on an alias of a case it keeps
    // THE REGISTRY OUTRANKS THE GROUPING RULES: one row holding the anchors of two rule-made groups is ONE case, united BEFORE any id is assigned. The rules never agreed those searches were one subject, so re-partitioning them awarded the id to one half and minted a THIRD for the other, on every pass.
    const both = [...anchorsOf("kayak paddle"), ...anchorsOf("tote")];
    const united = build({ cases: [{ id: "inv_split", anchors: both }] }).filter((i) => i.key === "inv_split");
    expect([united.length, united[0]!.queries.some((q) => q.includes("tote")), united[0]!.queries.some((q) => q.includes("paddle"))]).toEqual([1, true, true]);
    // AND IT SETTLES: three consecutive reconciles, byte-identical rows every time, no third id and no movement after the first.
    let settled = reconcileResearchCases(world({ cases: [{ id: "inv_split", anchors: both }] }));
    const byId = (rows: typeof settled) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
    for (let n = 0; n < 3; n += 1) { const next = reconcileResearchCases(world({ cases: settled }));
      expect([byId(next), next.some((c) => c.id === "inv_split" && !c.aliasOf)]).toEqual([byId(settled), true]); settled = next; }
    expect(new Set(build({ cases: settled }).map((i) => i.key)).size).toBe(build({ cases: settled }).length); }); // and no two live cases ever share an id
  it("puts the pages that actually rank first, so an alphabetically earlier rank 8 is never compared instead of rank 1", () => {
    const at = (url: string, rank: number | null, kind: App["kind"] = "serp_organic") => ({ ...win(url, "harbor kayak paddle", body(NOW)),
      appearances: [{ kind, query: "harbor kayak paddle", promptId: null, promptText: null, engine: null, rank, citedUrl: url, observedAt: NOW, modelServed: null }] });
    const out = build({ winningPages: [at("https://aaa.example/g", 8), at("https://m.example/g", 1), at("https://z.example/g", 2), at("https://b.example/g", null, "ai_overview")] });
    expect(out.find((i) => i.label.includes("kayak paddle"))!.winners.map((w) => w.domain)).toEqual(["m.example", "z.example", "aaa.example", "b.example"]); }); // and a page only ever cited sorts last
  it("names the pages behind an exact look, and never reads an engine citation as a ranking", () => {
    const cite: App = { kind: "ai_overview", query: "harbor whale tour", promptId: null, promptText: null, engine: "google", rank: null, citedUrl: "https://simple.w.example/a", observedAt: NOW, modelServed: null, viaUrl: "https://wrap.example/r" };
    const tour = build({ serpEvidence: [serp("harbor whale tour", [["https://en.w.example/a", "Whale tours explained"], ["https://simple.w.example/a", "Whale tour guide"], ["https://x.example/a", "How to see whales"]])],
      winningPages: [win("https://en.w.example/a", "harbor whale tour", body(NOW), [cite]), { ...win("https://simple.w.example/a", "harbor whale tour", body(NOW)), appearances: [cite] }] }).find((i) => i.label.includes("whale"))!;
    const look = tour.exactSerps[0];
    expect(look.organicRows.map((r) => `${r.rank} ${r.domain}`)).toEqual(["1 w.example", "2 w.example", "3 x.example"]); expect(look.organicRows).toHaveLength(look.organicResults); // rank order, two subdomains of one publisher are one publisher, and every page counted is named
    expect(tour.winners[0].appearances.map((a) => a.kind)).toEqual(["serp_organic", "ai_overview"]); expect(tour.winners[0].domain).toBe("w.example"); // ranks AND is cited: both kept
    expect(tour.winners[1].appearances.map((a) => `${a.kind} ${a.rank}`)).toEqual(["ai_overview null"]); expect(tour.winners[1].appearances[0].viaUrl).toBe("https://wrap.example/r"); // cited only: never a rank
  }); });
