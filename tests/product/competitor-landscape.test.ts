/** PRODUCT - who the competition actually is, and when buying more research stops paying. Pure projections only: no network and no clock but the snapshot's own builtAt; the profile round trip runs on an injected in-memory row, so a pin the operator types survives a save and a reload. /*/
import { describe, it, expect, beforeEach, vi } from "vitest";
/** The durable adjudication cache, in memory: the landscape now settles "is this actually a business competing with you" and must never re-ask an unchanged one. */
const STORE = vi.hoisted(() => ({ rows: new Map<string, unknown[]>() }));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string, _fallback: unknown, o: { tenantId?: string } = {}) => STORE.rows.get(`${name}:${o.tenantId}`) ?? [],
  writeStore: async (name: string, data: unknown[], o: { tenantId?: string } = {}) => void STORE.rows.set(`${name}:${o.tenantId}`, data) }));
import { buildTopicInvestigations, classifyDomain, competitorLandscape, competitorOverrideLine, parseCompetitorOverrides, type CompetitorKind, type CompetitorOverride } from "@/domains/evidence";
import { emptyResearchEvidence, type FunnelResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import { __resetBusinessProfileCacheForTests, loadBusinessProfile, saveBusinessProfile, setBusinessProfileRepositoryForTests, type BusinessProfile, type CompetitorRef } from "@/domains/account/business-profile";
const SITE = "myshop.example", BUILT = "2026-07-26T00:00:00.000Z", FRESH = "2026-07-25T00:00:00.000Z", QUERY = "best rain barrel";
const sig = (o: Partial<Parameters<typeof classifyDomain>[1]> = {}) => ({ serpAppearances: 0, aiCitations: 0, competingQueries: 0, isOwned: false, ...o });
const snap = (research: FunnelResearchEvidence = emptyResearchEvidence(), over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  scope: { tenantId: "t", site: SITE, builtAt: BUILT }, sources: [], ownedPages: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [],
  contentGaps: [], internalLinkOpportunities: [], aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 }, research, evidenceHash: "fixture", ...over });
const won = (domain: string, query: string, rank: number) => ({ kind: "serp_organic" as const, query, promptId: null, promptText: null, engine: null, rank, citedUrl: `https://${domain}/a`, observedAt: FRESH, modelServed: null });
const page = (domain: string, appearances: ReturnType<typeof won>[], extra: Record<string, unknown> = {}) => ({ url: `https://${domain}/a`, domain, engines: [], examplePrompts: [], extract: null, appearances, ...extra });
const DEMAND: EvidenceSnapshot["keywordDemand"] = [{ query: QUERY, searchVolume: 4400, source: "dataforseo", competition: null, competitionLevel: null, gscImpressions: 600 }];
describe("what a domain that keeps showing up actually is", () => {
  // ONE case per group, in the order the rules fire: facts about the domain first, then what the evidence says it does to you. A stranger reading `why` learns what to do about it.
  const TABLE: [string, ReturnType<typeof sig>, CompetitorKind][] = [
    [SITE, sig({ isOwned: true, competingQueries: 9 }), "owned"], ["cityofboston.gov", sig({ serpAppearances: 4, competingQueries: 4 }), "government_educational"],
    ["reddit.com", sig({ serpAppearances: 6, competingQueries: 6 }), "social_community"], ["www.amazon.com", sig({ serpAppearances: 5, competingQueries: 5 }), "marketplace_directory"],
    ["rival.example", sig({ serpAppearances: 4, competingQueries: 3, overlap: "same_business" }), "commercial_competitor"], ["standards.example", sig({ aiCitations: 7 }), "citation_authority"],
    ["en.wikipedia.org", sig({ serpAppearances: 2, aiCitations: 1, competingQueries: 1 }), "publisher"], ["seenonce.example", sig({ serpAppearances: 1 }), "irrelevant_unknown"]];
  it.each(TABLE)("puts %s in one group and says why", (domain, signals, kind) => {
    const row = classifyDomain(domain, signals); expect(row.kind).toBe(kind); expect(row.domain).toBe(domain.replace(/^www\./, ""));
    expect(row.why).toMatch(/\d/); // a number the operator can check, and never a lab word
    expect(row.why).not.toMatch(/SERP|experiment|control|baseline|treatment/i); });
  it("calls a rival a rival only once its own pages say so, a source a source for being cited, and lets neither outrank a fact", () => {
    // RECURRENCE NOMINATES, IT DOES NOT DECIDE. Ranking for three of your searches used to be the whole proof, so any stranger who recurred was handed over as somebody to go and beat. Now the inspection of its pages is what makes it a competitor, and without one the row says so out loud.
    expect(classifyDomain("rival.example", sig({ competingQueries: 3 }))).toMatchObject({ kind: "irrelevant_unknown", ambiguous: true });
    expect(classifyDomain("rival.example", sig({ competingQueries: 3 })).why).toContain("I am reading its pages to see whether it actually sells what you sell");
    expect(classifyDomain("rival.example", sig({ competingQueries: 3, overlap: "same_business" })).why).toContain("it offers what you offer to the same customers, and it wins 3");
    expect(classifyDomain("rival.example", sig({ competingQueries: 3, overlap: "not_a_business" })).kind).toBe("publisher");
    expect(classifyDomain("standards.example", sig({ aiCitations: 7 })).why).toContain("Engines quote it 7 times as a source and it never ranks against you");
    // No amount of ranking turns a city hall or a forum into a business you can take customers from.
    expect(classifyDomain("data.cambridge.gov.uk", sig({ competingQueries: 8 })).kind).toBe("government_educational"); expect(classifyDomain("old.reddit.com", sig({ competingQueries: 8 })).kind).toBe("social_community"); });
  // PIN (E, packet 10 + 11): AN ENCYCLOPEDIA IS NEVER A COMPETITOR (recurrence alone used to make one, so Beacon told operators to go and outrank Britannica), ROLE EVIDENCE decides everything else, and a domain doing both strongly is said to be unsettled rather than filed under whichever rule ran first.
  it("10 + 11: decides on role evidence, never on recurrence, and admits when the evidence points both ways", () => {
    // A FACT ABOUT THE DOMAIN OUTRANKS EVERY VERDICT, so even a reading that says "same business" cannot make an encyclopedia, a city hall, a forum or a marketplace into somebody an operator can take customers from.
    for (const d of ["britannica.com", "en.wikipedia.org", "merriam-webster.com", "npr.org", "nyc.gov", "reddit.com", "www.amazon.com"]) {
      expect(classifyDomain(d, sig({ competingQueries: 9, serpAppearances: 12, overlap: "same_business" })).kind, d).not.toBe("commercial_competitor");
    }
    expect(classifyDomain("nyc.gov", sig({ competingQueries: 9 })).kind).toBe("government_educational"); expect(classifyDomain("britannica.com", sig({ competingQueries: 1, aiCitations: 6 })).kind).toBe("citation_authority");
    expect(classifyDomain("shop.example", sig({ competingQueries: 4, aiCitations: 0, overlap: "same_business" })).kind).toBe("commercial_competitor");
    expect(classifyDomain("guide.example", sig({ competingQueries: 0, aiCitations: 5 })).kind).toBe("citation_authority"); expect(classifyDomain("shop.example", sig({ competingQueries: 4, overlap: "same_business" })).ambiguous).toBeUndefined();
    const both = classifyDomain("hybrid.example", sig({ competingQueries: 4, aiCitations: 6 }));
    expect([both.ambiguous, both.kind]).toEqual([true, "citation_authority"]); // quoted is what the evidence actually supports, and it is still unsettled
    expect(classifyDomain("seen-once.example", sig({ competingQueries: 1, aiCitations: 1 })).kind).toBe("irrelevant_unknown");
  });
});
/** The same evidence seen four ways: a case-wide domain look saying rival.example ranks for FOUR keywords, two winning-page sightings of it, an AI block citing source.example twice, and the answer analysis counting that same source three times. */
const LANDSCAPE = (): FunnelResearchEvidence => ({ ...emptyResearchEvidence(),
  caseCompetitors: [{ caseId: "c1", keywordsAsked: 6, domains: [{ domain: "rival.example", avgPosition: 3, rating: null, keywordsCount: 4 }], observedAt: FRESH, receipt: "r1", served: "cache" }],
  winningPages: [page("rival.example", [won("rival.example", QUERY, 1), won("rival.example", "rain barrel sizing", 2)]), page("weak.example", [won("weak.example", QUERY, 6)])],
  serpEvidence: [{ query: QUERY, observedAt: FRESH, organic: [], paa: [], related: [], aiMode: [],
    aiOverview: [{ url: "https://source.example/x", domain: "source.example", title: null }, { url: "https://source.example/y", domain: "source.example", title: null }] }] });
const ANALYSIS = { competitors: [{ url: "https://source.example/x", domain: "source.example", citationCount: 3, distinctPrompts: 2, engines: ["chatgpt"], examplePrompts: [] }] };
/** The same rival, with pages I have ALREADY read: the only evidence that can turn a recurring domain into a competitor. */
const READ = { title: "Rain barrels for sale", h1: "Rain barrels", wordCount: 800, headings: ["Prices", "Delivery"], faqCount: 0, metaDescription: "Buy rain barrels", openingSample: "We sell rain barrels." };
const INSPECTED = (): FunnelResearchEvidence => ({ ...LANDSCAPE(), winningPages: [page("rival.example", [won("rival.example", QUERY, 1), won("rival.example", "rain barrel sizing", 2)], { extract: READ })] });
describe("the competitor landscape", () => {
  beforeEach(() => STORE.rows.clear());
  it("holds one row per domain and never adds four views of the same evidence together", async () => {
    const rows = await competitorLandscape(snap(LANDSCAPE(), ANALYSIS));
    expect(rows.map((r) => r.domain)).toEqual(["rival.example", "weak.example", "source.example"]); // strongest recurrence first
    expect(rows[0]!.evidence.competingQueries).toBe(4); // four keywords from the case look, two queries from the pages: the stronger view, not the sum
    expect(rows[2]!.evidence.aiCitations).toBe(3); // two citations on the results page, three in the analysis: three, never five
    expect(rows.map((r) => r.kind)).toEqual(["irrelevant_unknown", "irrelevant_unknown", "citation_authority"]); }); // nothing of rival.example's has been read, so it is not yet anybody's rival
  it("settles a nominated domain once against its own pages, caches that verdict, and never buys a second reading of unchanged evidence", async () => {
    let asked = 0; const ask = async () => (asked += 1, { verdict: "same_business" as const, reason: "It sells rain barrels to homeowners, exactly as you do.", model: "gpt-5-mini" });
    const settled = await competitorLandscape(snap(INSPECTED(), ANALYSIS), [], ask); expect(settled[0]).toMatchObject({ domain: "rival.example", kind: "commercial_competitor" });
    expect(settled[0]!.why).toContain("it offers what you offer to the same customers"); const again = await competitorLandscape(snap(INSPECTED(), ANALYSIS), [], ask);
    expect([asked, again[0]!.kind]).toEqual([1, "commercial_competitor"]); // the same evidence asks nobody a second time
    const row = (STORE.rows.get("competitor-overlap:t") ?? [])[0] as Record<string, unknown>;
    expect(row).toMatchObject({ domain: "rival.example", verdict: "same_business", decidedBy: "gpt-5-mini", evidenceIds: ["https://rival.example/a"], reason: "It sells rain barrels to homeowners, exactly as you do." });
    expect([typeof row.evidenceHash, typeof row.decidedAt]).toEqual(["string", "string"]); }); // keyed by the evidence, and stamped with when I decided it
  it("reads a domain that sells nothing of yours as a publisher, and spends nothing at all when nobody can inspect it", async () => {
    const publishes = await competitorLandscape(snap(INSPECTED(), ANALYSIS), [], async () => ({ verdict: "not_a_business" as const, reason: "It publishes articles and sells nothing.", model: "gpt-5-mini" }));
    expect(publishes[0]).toMatchObject({ domain: "rival.example", kind: "publisher" });
    STORE.rows.clear();
    const rendered = await competitorLandscape(snap(INSPECTED(), ANALYSIS)); // a page render passes no adjudicator, so it cannot spend a cent
    expect([rendered[0]!.kind, rendered[0]!.ambiguous, STORE.rows.size]).toEqual(["irrelevant_unknown", true, 0]); });
  it("gives the operator the last word on any domain, on every later read, and buys no reading to second-guess them", async () => {
    let asked = 0;
    const rules: CompetitorOverride[] = [{ domain: "weak.example", action: "pin" }, { domain: "rival.example", action: "exclude" },
      { domain: "source.example", action: "correct", kind: "publisher" }, { domain: "hunch.example", action: "pin" }];
    expect((await competitorLandscape(snap(INSPECTED(), ANALYSIS), rules, async () => (asked += 1, null))).find((r) => r.domain === "rival.example")).toBeUndefined();
    expect(asked).toBe(0); // an excluded, pinned or corrected domain is never inspected
    // The zero above is the OVERRIDE at work, not an adjudicator that was never reachable: the same pass with the exclusion lifted inspects exactly once, which is what makes the zero worth believing.
    STORE.rows.clear();
    await competitorLandscape(snap(INSPECTED(), ANALYSIS), rules.filter((r) => r.domain !== "rival.example"), async () => (asked += 1, null)); expect(asked).toBe(1);
    const rows = await competitorLandscape(snap(LANDSCAPE(), ANALYSIS), rules); expect(rows.find((r) => r.domain === "rival.example")).toBeUndefined();
    expect(rows.find((r) => r.domain === "weak.example")).toMatchObject({ kind: "commercial_competitor", why: expect.stringContaining("You pinned this") });
    expect(rows.find((r) => r.domain === "source.example")).toMatchObject({ kind: "publisher", why: "You set this, so I hold it as a publisher." });
    expect(rows.find((r) => r.domain === "hunch.example")?.evidence.serpAppearances).toBe(0); }); // a pin that silently vanishes is a lie
});
describe("the corrections box", () => {
  it("reads the three instructions an operator can give", () => {
    const { overrides, errors } = parseCompetitorOverrides("pin fixer.example\nexclude spam.example\nBig.Example is a Publisher\n"); expect(errors).toEqual([]);
    expect(overrides).toEqual([{ domain: "fixer.example", action: "pin" }, { domain: "spam.example", action: "exclude" }, { domain: "big.example", action: "correct", kind: "publisher" }]); });
  it("says exactly what it could not read, and keeps the lines it could", () => {
    const { overrides, errors } = parseCompetitorOverrides("beat everyone\npin over there\nbig.example is a wombat\nexclude keep.example"); expect(overrides).toEqual([{ domain: "keep.example", action: "exclude" }]);
    expect(errors[0]).toBe('I could not read "beat everyone". Write one instruction per line: "pin example.com", "exclude example.com", or "example.com is a publisher".');
    expect(errors[1]).toContain('"over there" is not a domain I can use'); expect(errors[2]).toContain('I do not have a group called "wombat"'); });
});
describe("a correction survives a save and a reload", () => {
  let row: Record<string, unknown> | null = null;
  beforeEach(() => { row = null; __resetBusinessProfileCacheForTests();
    setBusinessProfileRepositoryForTests({ load: async () => row, save: async (_id, p) => { row = p as unknown as Record<string, unknown>; return { ok: true }; } }); });
  it("round trips pin, exclude and a corrected group back to the exact lines typed", async () => {
    const typed = "pin fixer.example\nexclude spam.example\nbig.example is a publisher";
    const stored: CompetitorRef[] = [{ name: "A rival I already knew", evidenceUrls: [] },
      ...parseCompetitorOverrides(typed).overrides.map((o) => ({ name: o.domain, evidenceUrls: [], domain: o.domain, action: o.action, kind: o.kind }))];
    const saved = await saveBusinessProfile("acct-1", { competitors: { value: stored, origin: "operator_confirmed", confidence: 1, sourceUrls: [] } } as Partial<BusinessProfile>); expect(saved.persisted).toBe(true);
    __resetBusinessProfileCacheForTests();
    const back = (await loadBusinessProfile("acct-1")).competitors.value;
    expect(back.filter((c) => !c.domain).map((c) => c.name)).toEqual(["A rival I already knew"]); // a name stays a name; only a row carrying a domain is an instruction
    expect(back.filter((c) => !!c.domain).map((c) => competitorOverrideLine({ domain: c.domain!, action: c.action ?? "pin", kind: c.kind as CompetitorKind })).join("\n")).toBe(typed); });
});
const ASKED = (): FunnelResearchEvidence => ({ ...emptyResearchEvidence(), aiObservations: [{ promptId: "p1", promptText: QUERY, engine: "chatgpt", observationMode: "standardized_response",
  modelRequested: null, modelServed: null, observedAt: FRESH, webSearchReported: null, citationsObserved: true, citations: [], fanOutQueries: [], observationId: "obs_p1", promptVersion: 1, reportingDay: "2026-07-01", answerHash: "h1", retrievedResults: null, brandMentions: null, analysis: null }] });
/** A subject I have genuinely finished investigating: a fresh exact look, priced demand I can trace back to how I found it, an engine I asked, and three separate publishers whose pages I have actually read. */
function COMPLETE(): EvidenceSnapshot {
  const HOSTS = ["rival.example", "second.example", "third.example"];
  const extract = { title: "Best rain barrel", h1: "Best rain barrel", wordCount: 900, headings: ["Sizes", "Prices"], faqCount: 0, fetchedAt: FRESH };
  return snap({ ...ASKED(),
    retainedKeywords: [{ query: QUERY, searchVolume: 4400, competition: null, competitionLevel: null, difficulty: 30, intent: "commercial", discoveredVia: "gsc" }],
    serpEvidence: [{ query: QUERY, observedAt: FRESH, aiOverview: [], aiMode: [], paa: [], related: [], organic: HOSTS.map((domain, i) => ({ rank: i + 1, domain, url: `https://${domain}/a`, title: "Best rain barrel" })) }],
    winningPages: HOSTS.map((d, i) => page(d, [won(d, QUERY, i + 1)], { extract })) }, { keywordDemand: DEMAND });
}
describe("the one thing worth buying next", () => {
  it("names the exact results page when that is the only thing missing", () => {
    const inv = buildTopicInvestigations(snap(ASKED()))[0]!; expect(inv.exactSerps).toEqual([]);
    expect(inv.nextAcquisition).toEqual({ kind: "buy_serp", subject: QUERY, why: "I have never looked at Google's results for this, so buying that one results page is what changes the answer." }); expect(inv.diminishing).toBe(false); });
  it("offers nothing while a winning page is held, says the wait in plain words, and treats a promised day that has arrived as due", () => {
    const heldTo = (retryAfter: string) => ({ ...ASKED(), serpEvidence: [{ query: QUERY, observedAt: FRESH, aiOverview: [], aiMode: [], paa: [], related: [], organic: [{ rank: 1, domain: "rival.example", url: "https://rival.example/a", title: "Best rain barrel" }] }],
      winningPages: [page("rival.example", [won("rival.example", QUERY, 1)], { readOutcome: { state: "temporarily_unavailable", attemptedAt: FRESH, retryAfter } })] });
    const inv = buildTopicInvestigations(snap(heldTo("2026-08-09T00:00:00.000Z"), { keywordDemand: DEMAND }))[0]!; expect([inv.nextAcquisition, inv.diminishing]).toEqual([null, true]);
    expect(inv.missingEvidence).toContain("A winning page here did not answer me, so I try again in a couple of weeks. Nothing here is waiting on you.");
    const due = buildTopicInvestigations(snap(heldTo(BUILT), { keywordDemand: DEMAND }))[0]!; expect([due.missingEvidence.some((m) => /try again/.test(m)), due.nextAcquisition?.kind]).toEqual([false, "read_winner"]); }); // a day that has arrived is due now, never a wait
  it("stops asking for money when nothing at all is missing", () => {
    const inv = buildTopicInvestigations(COMPLETE())[0]!; expect(inv.missingEvidence).toEqual([]); expect(inv.nextAcquisition).toBeNull(); expect(inv.diminishing).toBe(false); });
});
