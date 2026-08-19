/** PRODUCT - THE DETERMINISTIC REPLAY HARNESS. Fixture provider ENVELOPES are driven through the REAL registry parsers, the REAL funnel executors, the REAL snapshot assembler and the REAL decision pass, with only the persistence and drafting seams faked. Nothing here mocks a parser, reads a source string, pins operator copy, or opens a socket: the last test proves the whole path made ZERO network calls. /*/
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
const env = vi.hoisted(() => ({ snap: null as unknown, saved: [] as ChangeProposal[], store: new Map<string, ChangeProposal>() }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
vi.mock("@/domains/evidence/pages/owned-context", () => ({ loadOwnedPageBodies: async (_t: string, urls: string[]) => new Map(urls.map((u) => [u, { url: u, title: "Kite Festival", metaDescription: null, openingSample: "What happens at a kite festival.", cardTexts: [], entityNames: [], internalLinks: [], fetchedAt: "2026-07-20T09:00:00.000Z" }])) }));
vi.mock("@/domains/decision/proposal-store", async () => ({ ...(await vi.importActual<typeof import("@/domains/decision/proposal-store")>("@/domains/decision/proposal-store")),
  loadChangeProposals: async () => env.store, saveChangeProposal: async (p: ChangeProposal) => { env.saved.push(p); env.store.set(p.id, p); return "saved" as const; } }));
vi.mock("@/domains/decision/produce-bundle", () => ({ produceBundleForSnapshot: async () => ({ status: "none", reason: "the deep bundle has its own suite" }) }));
vi.mock("@/domains/account", async (orig) => ({ ...(await orig() as object), loadBusinessProfile: async () => null, getTenant: async () => ({ id: "replay-tenant", domain: "atlaspedia.example", growth_goal: null }), basisTag: () => "basis_replay" }));
import type { Account } from "@/domains/account";
import { canonicalPairOf, type AiObservationRecord, type DueObservation } from "@/domains/evidence/ai-visibility/ai-observations";
import { parseCapability, type CachedCallResult, type CapabilityKey, type ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
import { parsePageIntersection } from "@/domains/evidence/page-intersection";
import { dominantPageType, freshnessAt, pageTypeVotesOf, type SerpRow } from "@/domains/evidence/serp-shape";
import { freshnessMsFor } from "@/domains/evidence/freshness";
import { keywordDiscoveryUnit } from "@/domains/evidence/funnel/discovery";
import { projectFunnelEvidence, promptObservationUnit, serpAnalysisUnit } from "@/domains/evidence/funnel/observe";
import type { FunnelDeps } from "@/domains/evidence/funnel/shared";
import type { FunnelResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import { buildTopicInvestigations } from "@/domains/evidence/topic-investigation";
import { readCoverage } from "@/domains/decision/coverage-pass";
import { produceProposalsForTenant } from "@/domains/decision/produce-proposals";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
import * as fx from "../fixtures/replay";
const { BASIS, GAP_QUERY, GAP_URL, RIVAL_A, SITE, TENANT, TWIN_URL, WINNER_QUERY, WINNER_URL } = fx;

const NOW_MS = Date.parse("2026-07-21T00:00:00.000Z"), NOW = new Date(NOW_MS);
/** Every socket a replay could reach, in ONE place, for the whole file. */
const net: string[] = []; let realFetch: typeof fetch;
beforeAll(() => { realFetch = globalThis.fetch; globalThis.fetch = (async (u: RequestInfo | URL) => { net.push(String(u)); throw new Error("a replay may never reach the network"); }) as typeof fetch; });
afterAll(() => { globalThis.fetch = realFetch; });
const parsed = <K extends CapabilityKey>(cap: K, envelope: ProviderEnvelope) => parseCapability(cap, envelope)!;

describe("fixture envelopes drive the REAL registry parsers", () => {
  it("keeps a consumer answer's fan-outs as fan-outs, and its retrieved results out of its citations", () => {
    const a = parsed("llm_scraper_chatgpt", fx.scraperAnswer());
    expect(a.fanOutQueries).toEqual(["what happens at a kite festival", "kite festival food traditions"]); // the queries the engine ran, never the question I asked
    expect(a.fanOutQueries).not.toContain(GAP_QUERY);
    expect(a.citations!.map((c) => c.url)).toEqual(fx.CITED_SOURCES.map((s) => s.url)); // CITED sources only
    for (const r of fx.RETRIEVED_ONLY) expect(JSON.stringify(a.citations)).not.toContain(r.domain); // retrieved and cited are different claims
    expect(a.retrievedResults!.map((r) => r.domain)).toEqual(fx.RETRIEVED_ONLY.map((r) => r.domain)); // retrieved pages are KEPT, on their own channel
    expect(a.brandMentions).toEqual(["Atlaspedia", "Rival A"]); // the brands the engine itself named
    expect([a.modelServed, a.webSearchReported, a.answerText!.includes("Dawn flying")]).toEqual(["gpt-4o-search", true, true]); // the whole markdown answer, and web results really in hand
    const dry = parsed("llm_scraper_chatgpt", fx.scraperAnswer({ sources: null, searchResults: null, brandEntities: null }));
    expect([dry.citations, dry.retrievedResults, dry.brandMentions, dry.webSearchReported]).toEqual([null, null, null, null]); // this endpoint reports no web-search flag, so silence stays silence
  });
  it("reads one standardized answer shape for all four engines, and keeps not-observable apart from observed-zero", () => {
    const four = (["llm_chatgpt", "llm_claude", "llm_gemini", "llm_perplexity"] as const).map((k) => parsed(k, fx.llmAnswer()));
    expect(new Set(four.map((a) => JSON.stringify(a))).size).toBe(1); // the engines differ in the ASK, never the answer shape
    expect([four[0]!.citations!.map((c) => c.domain), four[0]!.webSearchReported, four[0]!.fanOutQueries]).toEqual([["rival-a.example"], true, ["kite festival opening times"]]);
    const bare = parsed("llm_perplexity", fx.llmAnswer({ fanOut: null, webSearch: null, annotations: [] }));
    expect([bare.fanOutQueries, bare.webSearchReported, bare.citations]).toEqual([null, null, []]); // not observable is null; observed zero is []
  });
  it("reads an organic results page with its AI Overview, its questions, its related searches and its page-type votes", () => {
    const s = parsed("serp_organic", fx.serpOrganic());
    expect(s.organic.map((o) => o.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]); // rank_group IS the position; rank_absolute counts ads and packs
    expect(s.organic.find((o) => o.domain === SITE)!.url).toBe(`https://${GAP_URL}`);
    expect(s.aiOverview!.references.map((r) => r.domain)).toEqual(["rival-a.example", "wikipedia.example"]);
    expect(s.aiOverview!.excerpt).toBe("Kite festivals open at dawn and end with lanterns.");
    expect(s.paaQuestions.map((p) => p.question)).toEqual(["What do people eat at a kite festival", "When did kite festivals start"]);
    expect(s.relatedSearches).toEqual(["kite festival food", "kite festival dates", "paper lantern guide"]);
    const row: SerpRow = { query: GAP_QUERY, observedAt: fx.OBSERVED_AT, organic: s.organic, aiOverview: [], aiMode: [], paa: [], related: [] };
    const votes = pageTypeVotesOf([row]); // one vote per DOMAIN, and a result that classifies as nothing votes for nothing
    expect(votes).toEqual([{ pageType: "informational_guide", domains: 2 }, { pageType: "forum", domains: 1 }, { pageType: "list", domains: 1 }, { pageType: "product", domains: 1 }]);
    expect(dominantPageType(votes)).toBe("mixed"); // five domains, no majority: mixed is the honest answer
  });
  it("keeps every keyword metric the batch was paid for, and leaves an absent metric absent", () => {
    const k = parsed("labs_ranked_keywords", fx.keywordBatch([{}, { keyword: WINNER_QUERY, volume: 900, difficulty: 12, intent: "commercial", rankedUrl: `https://${WINNER_URL}`, rankedRank: 3 }]));
    expect([k[0]!.keyword, k[0]!.searchVolume, k[0]!.difficulty, k[0]!.intent, k[0]!.competitionLevel]).toEqual([GAP_QUERY, 2400, 31, "informational", "low"]);
    expect([k[0]!.rankedUrl, k[0]!.rankedRank, k[1]!.rankedUrl, k[1]!.rankedRank]).toEqual([`https://${GAP_URL}`, 6, `https://${WINNER_URL}`, 3]); // the page that ACTUALLY ranks, and its organic position
    expect([k[0]!.monthlySearches!.length, k[0]!.monthlySearches!.filter((m) => m.volume === null).length]).toEqual([12, 1]); // a twelve-month trend with one unknown month still unknown
    const blank = parsed("labs_keyword_overview", fx.keywordBatch([{ volume: null, difficulty: null, intent: null, trend: null, rankedUrl: null }]))[0]!;
    expect([blank.searchVolume, blank.difficulty, blank.intent, blank.monthlySearches, blank.rankedUrl]).toEqual([null, null, null, null, null]); // never a fake zero
  });
  it("names which requested page rode which comparison slot only when the ask that bought it is in hand", () => {
    const ask = { pages: [`https://${GAP_URL}`, RIVAL_A], intersection_mode: "union" as const };
    const envelope = fx.pageIntersection([{ keyword: "kite festival food", slots: { 1: { url: `https://${GAP_URL}`, rank: 6 }, 2: { url: RIVAL_A, rank: 2 } } },
      { keyword: "lantern release", volume: 320, slots: { 2: { url: RIVAL_A, rank: 4 } } }]);
    const withAsk = parsePageIntersection(envelope, ask);
    expect(withAsk.pages).toEqual([{ page: 1, url: `https://${GAP_URL}` }, { page: 2, url: RIVAL_A }]);
    expect(withAsk.keywords.map((k) => [k.keyword, k.searchVolume, k.mainIntent, k.ranks.map((r) => r.page)])).toEqual([["kite festival food", 500, "informational", [1, 2]], ["lantern release", 320, "informational", [2]]]);
    expect(parsed("labs_page_intersection", envelope).pages).toEqual([]); // through the registry hook the ask is not carried, so the slots read EMPTY rather than guessed
  });
  it("reads a competitor body it can get, and claims nothing at all about one it cannot", () => {
    const readable = parsed("onpage_content_parsing", fx.competitorPageBody());
    expect([readable.title, readable.h1, readable.hasTable, readable.wordCount > 40]).toEqual(["Kite Festival Traditions Explained", "Kite festival traditions", true, true]);
    expect(readable.headings).toEqual(["Kite festival traditions", "What families bring", "When the lanterns go up"]);
    expect(readable.openingSample).toContain("A kite festival is a spring gathering");
    const dark = parsed("onpage_content_parsing", fx.unreadablePageBody());
    expect([dark.title, dark.h1, dark.wordCount, dark.headings, dark.openingSample, dark.hasTable]).toEqual([null, null, 0, [], null, false]);
  });
});

// ── the replay through the REAL funnel executors ─────────────────────────────
const PROMPTS = [{ id: "p1", text: "where can I see a kite festival" }];
/** Runtime's daily plan: the ONLY thing the observation unit will act on. */
const DUE: DueObservation[] = PROMPTS.flatMap((p) => (["chatgpt", "claude", "gemini", "perplexity"] as const).map((engine) => ({ promptId: p.id, version: 1, text: p.text, engine, slot: 0 as const, day: "2026-07-21" })));
const evidenceOf = (envelope: ProviderEnvelope, cacheKey: string): CachedCallResult => ({ state: "ok", envelope, costUsd: 0.01, cacheKey, modelServed: null });
/** The ONE provider seam: a capability in, a fixture ENVELOPE out. The real registry parser runs behind it. */
const replayProvider: NonNullable<FunnelDeps["callProvider"]> = async (cap: CapabilityKey, input: unknown) => {
  const kw = (input as { keyword?: string }).keyword ?? "";
  if (cap === "llm_scraper_chatgpt") return evidenceOf(fx.scraperAnswer(), "ck-scraper");
  if (cap.startsWith("llm_")) return evidenceOf(fx.llmAnswer({ model: cap }), `ck-${cap}`);
  if (cap.startsWith("serp_")) return evidenceOf(fx.serpOrganic({ keyword: kw }), `ck-serp-${kw}`);
  return evidenceOf(fx.keywordBatch([{}, { keyword: WINNER_QUERY, volume: 900, intent: "commercial" }, { keyword: "kite festival food", volume: 480 }]), `ck-${cap}`);
};
async function replayFunnel(): Promise<{ evidence: FunnelResearchEvidence; statuses: string[]; observed: AiObservationRecord[] }> {
  const store = fx.memFunnelStore();
  const observed: AiObservationRecord[] = [];
  const deps: FunnelDeps = { ...store.deps, callProvider: replayProvider, keywordIdeas: async () => [], now: () => NOW_MS,
    loadProfile: async () => fx.replayProfile(), getAccount: async () => ({ domain: SITE } as Account), loadCrawl: async () => null,
    recordObservation: async (rec) => { observed.push(rec); },
    collectTask: async () => evidenceOf(fx.llmAnswer(), "ck-collect"),
    loadPageQueries: async () => fx.agendaFromDecay([{ decay: fx.gscGain(), queries: [{ query: WINNER_QUERY, impressions: 25000, clicks: 2365, position: 4 }] },
      { decay: fx.gscDecline(), queries: [{ query: GAP_QUERY, impressions: 6000, clicks: 180, position: 4.1 }] }]) };
  const cursor = { basis: BASIS };
  const statuses = [(await keywordDiscoveryUnit(deps)(TENANT, cursor, 60_000)).status, (await promptObservationUnit(deps, DUE)(TENANT, cursor, 60_000)).status,
    (await serpAnalysisUnit(deps)(TENANT, cursor, 60_000)).status];
  const state = store.peek()!;
  // The winners are the SAME fixture bodies, read through the SAME parser: one readable, one the publisher refused.
  state.winningPages = [fx.winningPage(RIVAL_A, GAP_QUERY, parsed("onpage_content_parsing", fx.competitorPageBody())), fx.blockedWinner("https://rival-b.example/blog/spring-kites", GAP_QUERY)];
  // The snapshot's AI evidence is the canonical record the executors just wrote, mapped by the same pure shape production reads, never the working window.
  return { evidence: { ...projectFunnelEvidence(state, NOW_MS), aiObservations: observed.filter((o) => o.status === "observed" && o.answer_hash != null).map(canonicalPairOf) }, statuses, observed };
}

describe("the replay drives the REAL funnel executors, not a mock of them", () => {
  it("lands every fixture shape in the research evidence with its provenance intact", async () => {
    const { evidence, statuses } = await replayFunnel();
    expect(statuses).toEqual(["done", "done", "done"]);
    const consumer = evidence.aiObservations.find((o) => o.observationMode === "consumer_search")!;
    expect([consumer.promptText, consumer.fanOutQueries]).toEqual([PROMPTS[0]!.text, ["what happens at a kite festival", "kite festival food traditions"]]); // the question I asked, and the queries the engine ran, never confused
    expect(consumer.citations!.map((c) => c.domain)).toEqual(["rival-a.example", SITE]);
    expect(new Set(evidence.aiObservations.map((o) => o.engine))).toEqual(new Set(["chatgpt", "claude", "gemini", "perplexity"]));
    const gap = evidence.retainedKeywords.find((k) => k.query === GAP_QUERY)!;
    expect([gap.searchVolume, gap.intent, gap.difficulty, gap.competitionLevel]).toEqual([2400, "informational", 31, "low"]); // bought once, carried whole
    expect(Object.keys(gap)).not.toContain("monthlySearches"); // the paid twelve-month trend survives the parser and stops at the funnel row
    const serp = evidence.serpEvidence.find((s) => s.query === GAP_QUERY)!;
    expect([serp.organic.find((o) => o.domain === SITE)!.rank, serp.paa.length, serp.related.length, serp.aiOverview.length]).toEqual([6, 2, 3, 2]);
    expect(evidence.winningPages.map((w) => [w.extract !== null, w.readOutcome?.state ?? null])).toEqual([[true, null], [false, "robots_blocked"]]); // a body in hand, and one honestly refused
    expect(evidence.receipt.retained).toBeGreaterThan(0);
  });
  it("stores the consumer answer WHOLE: the full text, the journey, the receipt and the identity of what it was read from", async () => {
    const { observed } = await replayFunnel();
    const consumer = observed.find((o) => o.observation_mode === "consumer_search" && o.status === "observed")!;
    expect([consumer.engine, consumer.site, consumer.reporting_day, consumer.sample_slot]).toEqual(["chatgpt", SITE, "2026-07-21", 0]);
    expect(consumer.answer_text).toBe(parsed("llm_scraper_chatgpt", fx.scraperAnswer()).answerText); // the ANSWER, not a hash of one
    expect(consumer.journey.cited_sources!.map((c) => c.domain)).toEqual(["rival-a.example", SITE]);
    expect(consumer.journey.retrieved_results!.map((r) => r.domain)).toEqual(fx.RETRIEVED_ONLY.map((r) => r.domain)); // read and not credited, kept apart from cited
    expect([consumer.journey.brand_mentions, consumer.journey.fan_outs!.length, consumer.journey.web_search_reported]).toEqual([["Atlaspedia", "Rival A"], 2, true]);
    expect([consumer.cache_key, consumer.cost_usd, consumer.analysis]).toEqual(["ck-scraper", 0.01, null]); // the envelope it came from, what it cost, and no verdict yet
    expect(consumer.prompt_text).toBe(PROMPTS[0]!.text);
  });
  it("checks the search that is SLIPPING before the one that is climbing", async () => {
    const { evidence } = await replayFunnel();
    expect(evidence.serpEvidence.slice(0, 2).map((s) => s.query)).toEqual([GAP_QUERY, WINNER_QUERY]); // the declining page's own query is bought first
  });
});

// ── the replay through the REAL decision pass ────────────────────────────────
const EDIT = { field: "title", before: "Kite Festival", after: "Kite Festival Traditions: What Happens From Dawn to Lanterns", confidence: "high",
  rationale: "The stored title is two words and misses the traditions searchers ask about.", risks: ["keep the title readable"],
  evidenceRefs: [{ source: "gsc", detail: "many views for kite festival traditions with a low click rate" }],
  operatorSteps: ["Replace the page title field with the new value"], proofPlan: { metrics: ["clicks", "position"], windowsDays: [7, 14, 28], controls: "comparable unchanged pages" } };
const drafter = (): { complete: CompleteFn; calls: () => number } => { let n = 0; return { complete: async () => { n += 1; return { value: EDIT as never }; }, calls: () => n }; };

describe("the replayed evidence reaches the REAL decision kernel", () => {
  it("assembles one snapshot, names the pages that compete with each other, and dates every body it holds", async () => {
    const { evidence } = await replayFunnel();
    const snapshot = fx.replaySnapshot({ gsc: [...fx.gscCannibalPair(), fx.gscStableWinner()], research: evidence,
      wix: [fx.ownedBody(GAP_URL, "Kite Festival"), fx.ownedBody(TWIN_URL, "Kite Festival Food"), fx.staleOwnedBody()] });
    // BIGGEST FIRST, not alphabetical: a split is read one address at a time and the page most shown for that search leads it.
    expect(snapshot.cannibalization[0]).toEqual({ query: GAP_QUERY, competingUrls: [GAP_URL, TWIN_URL], note: `2 of your pages compete for "${GAP_QUERY}", so pick one owner and point the rest at it.` });
    expect(fx.replaySnapshot({ gsc: fx.gscCannibalPair().map((r) => ({ ...r, topQueries: r.topQueries.map((k) => ({ ...k, impressions: 49 })) })), research: evidence, wix: [] }).cannibalization).toEqual([]); // 49 views against 49 is two pages barely shown, not a split
    const dated = (url: string) => freshnessAt(snapshot.ownedPages.find((p) => p.url === url)!.content!.fetchedAt, NOW_MS, freshnessMsFor("owned_page"));
    expect([dated(GAP_URL), dated(fx.STALE_URL)]).toEqual(["current", "stale"]); // one body read this week, one read in the spring
    expect(buildTopicInvestigations(snapshot).length).toBeGreaterThan(0);
  });
  it("judges the replayed gap, says what it is still missing, and drafts the change the evidence earned", async () => {
    const { evidence } = await replayFunnel();
    const snapshot = fx.replaySnapshot({ gsc: [fx.gscCtrGap(), fx.gscStableWinner()], research: evidence, wix: [fx.ownedBody(GAP_URL, "Kite Festival")] });
    const read = await readCoverage(snapshot, TENANT, { basis: BASIS, maxQueries: 3, now: NOW });
    expect([read.needs.map((n) => [n.query, n.requirement]), read.decided!.decision.verdict, read.waitingUntil]).toEqual([[["lantern festival guide", "exact_serp"]], "do_nothing", null]); // the researched subject reaches a final answer and buys nothing more, and the one search a page of theirs is still losing clicks on becomes a subject of its own
    const unlooked = fx.replaySnapshot({ gsc: [fx.gscCtrGap()], research: { ...evidence, serpEvidence: [] }, wix: [fx.ownedBody(GAP_URL, "Kite Festival")] });
    const blind = await readCoverage(unlooked, TENANT, { basis: BASIS, maxQueries: 3, now: NOW });
    expect([blind.decided, blind.needs.map((n) => n.requirement)]).toEqual([null, ["exact_serp", "exact_serp"]]); // strip the looks and the same pass names the searches that would move it, instead of guessing
    env.snap = snapshot; env.saved = []; env.store = new Map();
    const seam = drafter(); const res = await produceProposalsForTenant(TENANT, { complete: seam.complete, now: NOW, bypassCache: true });
    const gap = res.candidates.find((c) => c.pageUrl === `https://${GAP_URL}`)!;
    expect([gap.action, gap.query, gap.gap, gap.recoverableClicks]).toEqual(["act_existing_page", GAP_QUERY, "ctr_deficit", 300]);
    expect(gap.readiness).toEqual({ gsc: true, ownedCopy: true, serp: true, winners: 1, body: false }); // the replayed results page and the ONE readable winner are what make this judgeable
    expect(res.candidates.find((c) => c.pageUrl === `https://${WINNER_URL}`)?.action).toBe("watch"); // a page already beating the clicks its positions earn is watched, never worked
    expect([res.outcome, seam.calls(), res.proposals.every((p) => p.status === "needs_review"), res.noDraft]).toEqual(["proposals_persisted", 5, true, 1]); // FIVE drafting calls: one for the page the evidence earned, one for the drafted description pass behind the $0 cards, and THREE fed-back retries each told every refusal so far; a draft the gates refuse is WITHDRAWN, and every queue row sits at needs_review
  });
  it("made ZERO network calls for the whole replay", () => { expect(net).toEqual([]); });
});
