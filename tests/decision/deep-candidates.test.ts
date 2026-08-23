/** FIVE DOORS INTO THE DEEP READ (V1 final truth repair): a page earns the deep producer through the evidence that actually accuses it, never only through a Google click gap. Pure selection: these pins run the real selectDeepCandidates and prove the doors, the dedup, the bound, and the regression path. */
import { describe, it, expect } from "vitest";
import { selectDeepCandidates } from "@/domains/decision/deep-candidates";
import { compileCandidates, type QualifiedCandidate } from "@/domains/decision/opportunities";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
import type { CauseFinding } from "@/domains/decision/diagnosis";
const cause = (c: CauseFinding["cause"], payload?: unknown): CauseFinding =>
  ({ cause: c, action: null, evidenceKeys: ["k1"], competingExplanations: [], notConsidered: [],
    falsifier: "f", explanation: "e", ...(payload === undefined ? {} : { payload }) }) as CauseFinding;
const cand = (over: Partial<QualifiedCandidate>): QualifiedCandidate =>
  ({ action: "watch", recoverableClicks: 0, reason: "r", cause: cause("no_problem"), ...over }) as QualifiedCandidate;
/** The smallest snapshot the selector reads: watched questions with citations observed, demand, no pages. */
const snapshot = (prompts: Array<string | [string, string[]]>, volumeByQuery: Record<string, number> = {}): EvidenceSnapshot =>
  ({ ownedPages: [],
    research: { retainedKeywords: [], aiObservations: prompts.map((p) => { const [promptText, fanOutQueries] = Array.isArray(p) ? p : [p, null];
      return { promptText, fanOutQueries, citationsObserved: true, citations: [] }; }) },
    keywordDemand: Object.entries(volumeByQuery).map(([query, searchVolume]) => ({ query, searchVolume })),
  }) as unknown as EvidenceSnapshot;
/** ONE owned page carrying enough real search evidence to be judged, for the pins that run the real diagnosis. */
const pageSnap = (url: string): EvidenceSnapshot => ({ ...snapshot([]),
  ownedPages: [{ url, content: { title: "Persian male names", metaDescription: null, h1: null, h2: [], outline: [], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: null },
    search: { clicks90d: 763, impressions90d: 40_000, ctr90d: 0.019, position90d: 7.5, topQueries: [{ query: "persian male names", impressions: 40_000, clicks: 763, position: 7.5 }] },
    engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } }],
  cannibalization: [], keywordDemand: [] }) as unknown as EvidenceSnapshot;
const AI_PAGE = "https://own.example/saffron-guide";
const CTR_PAGE = "https://own.example/nowruz";
describe("the four doors into the deep read", () => {
  // AI EVIDENCE NO LONGER OPENS A DEEP DOOR (2026-08-19): the staged case path in producers/extra.ts is the ONE AEO decision path, so a citation-gap candidate with no click gap earns no deep slot here, and the same page still enters by the click door when a real gap rides it.
  it("never opens a deep door on AI evidence alone: the staged case path owns AEO", () => {
    const picked = selectDeepCandidates({
      candidates: [cand({ pageUrl: AI_PAGE, query: "saffron price",
        cause: cause("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "where to buy saffron" }) })],
      coverage: null, limit: 3,
    });
    expect(picked).toEqual([]);
  });
  it("keeps one slot per page: a page carrying AI evidence and a click gap drafts once, by the click door", () => {
    const both = cand({ pageUrl: AI_PAGE, query: "saffron price", action: "act_existing_page", recoverableClicks: 120,
      cause: cause("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "where to buy saffron" }) });
    const picked = selectDeepCandidates({ candidates: [both], coverage: null, limit: 3 }); expect([picked.length, picked[0]!.door, picked[0]!.unit]).toEqual([1, "ctr_gap", "clicks"]); });
  it("holds the bound, strongest proof first, and every entry names its own door", () => {
    const picked = selectDeepCandidates({
      candidates: [
        cand({ pageUrl: CTR_PAGE, action: "act_existing_page", recoverableClicks: 300 }),
        cand({ pageUrl: AI_PAGE, query: "saffron price",
          cause: cause("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "where to buy saffron" }) }),
        cand({ pageUrl: "https://own.example/haft-seen", query: "haft seen table", recoverableClicks: 80,
          cause: cause("cannibalization", { cause: "cannibalization", competingPaths: ["/a", "/b"] }) }),
      ],
      coverage: null, limit: 2,
    });
    expect([picked.map((p) => p.door), picked[0]!.entry.includes("about 300 clicks short"), picked[1]!.entry.includes("2 of your own pages come up")]).toEqual([["ctr_gap", "cannibalization"], true, true]);
  });
  it("keeps the single-door regression path byte-stable: only the click door qualifying picks the old page", () => {
    const picked = selectDeepCandidates({
      candidates: [
        cand({ pageUrl: CTR_PAGE, action: "act_existing_page", recoverableClicks: 300 }),
        cand({ pageUrl: AI_PAGE, action: "act_existing_page", recoverableClicks: 500 }),
      ],
      coverage: null, limit: 3,
    });
    expect(picked.map((p) => [p.door, p.pageUrl])).toEqual([["ctr_gap", AI_PAGE]]); });
  /** DOOR 5 WAS UNREACHABLE FOR A GENERATION: nothing anywhere assigned `gap: "recent_decline"`, so the door that finds a page which was earning and stopped could never open. compileCandidates assigns it now, off the page's own two four week windows, and these two pins run the real thing end to end. */
  /** The page's own rate, so the click curve finds nothing wrong and the fall is the only thing left to see: exactly the state a fitted curve puts a real account in. */
  const ownRate = { expectedCtrAt: () => 763 / 40_000 };
  it("opens the fallen door on a page that was earning and stopped, ranked on what it actually lost", () => {
    const FALLEN = "https://own.example/persian-male-names";
    // THE LIVE CASE: 191 clicks gone on a page whose position never moved, which is a 20 percent dip and clears no share floor on its own.
    const decline = new Map([[FALLEN, { clicksNow: 763, clicksPrior: 954, positionNow: 7.5, positionPrior: 7.2, impressionsNow: 40_000, impressionsPrior: 41_000, windowEnd: "2026-08-01" }]]);
    const candidates = compileCandidates(pageSnap(FALLEN), { decline, curve: ownRate });
    expect([candidates[0]!.gap, candidates[0]!.recoverableClicks]).toEqual(["recent_decline", 191]); // the REAL lost clicks, never a curve distance
    expect(candidates[0]!.reason).toContain("This page earned 191 fewer clicks in the last four weeks than in the four weeks before, and it holds the same position it held then (7.2 to 7.5), so the ranking is not what changed.");
    const picked = selectDeepCandidates({ candidates, coverage: null, limit: 3 });
    // THE DOOR CARRIES THE SPAN THE FALL WAS MEASURED OVER, or the producer refuses every page it picks and the door burns a slot on every pass producing nothing.
    expect([picked.map((p) => p.door), picked[0]!.evidence.window]).toEqual([["recent_decline"], "the four weeks to 2026-08-01, against the four weeks before"]);
    // Its sentence is the FALL, never a curve distance: this door is opened by what the page lost.
    expect(picked[0]!.entry).toContain("about 191 fewer clicks than the four weeks before"); expect(picked[0]!.entry).not.toContain("under what its positions usually earn"); });
  it("never says leave it alone over a page that just shed 191 clicks", () => {
    const BEATS = "https://own.example/persian-male-names"; // a page beating its curve, so the wording is settled and the honest verdict was do_nothing
    const decline = new Map([[BEATS, { clicksNow: 763, clicksPrior: 954, positionNow: 7.5, positionPrior: 7.2, impressionsNow: 40_000, impressionsPrior: 41_000 }]]);
    const c = compileCandidates(pageSnap(BEATS), { decline, curve: { expectedCtrAt: () => 0.001 } })[0]!;
    expect([c.action, c.gap]).toEqual(["watch", "recent_decline"]); // a fall is never do_nothing
    expect(c.reason).not.toContain("Leave it alone"); expect(c.reason).toContain("191 fewer clicks"); });
  it("never calls a small page's wobble a fall: the floors decide, not the direction", () => {
    const SMALL = "https://own.example/quiet";
    // Down 60 percent and off 30 clicks: real movement, and nothing an operator should be sent at.
    const decline = new Map([[SMALL, { clicksNow: 12, clicksPrior: 30, positionNow: 9, positionPrior: 4, impressionsNow: 900, impressionsPrior: 2_000 }]]); const c = compileCandidates(pageSnap(SMALL), { decline, curve: ownRate })[0]!;
    expect([c.gap, selectDeepCandidates({ candidates: [c], coverage: null, limit: 3 })]).toEqual([undefined, []]); }); });
