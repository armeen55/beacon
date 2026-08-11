/** FIVE DOORS INTO THE DEEP READ (V1 final truth repair): a page earns the deep producer through the evidence that actually accuses it, never only through a Google click
 *  gap. Pure selection: these pins run the real selectDeepCandidates and prove the doors, the dedup, the bound, and the regression path. */
import { describe, it, expect } from "vitest";
import { selectDeepCandidates } from "@/domains/decision/deep-candidates";
import type { QualifiedCandidate } from "@/domains/decision/opportunities";
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
const AI_PAGE = "https://own.example/saffron-guide";
const CTR_PAGE = "https://own.example/nowruz";
describe("the five doors into the deep read", () => {
  it("opens the AI door with no click gap anywhere: the engine's own reading is enough", () => {
    const picked = selectDeepCandidates({
      snapshot: snapshot([["where to buy saffron", ["saffron price"]], "best saffron brands"], { "saffron price": 900 }),
      candidates: [cand({ pageUrl: AI_PAGE, query: "saffron price",
        cause: cause("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "where to buy saffron" }) })],
      coverage: null, limit: 3,
    });
    expect(picked.map((p) => [p.door, p.pageUrl])).toEqual([["ai_absence", AI_PAGE]]);
    expect(picked[0]!.entry).toContain('ChatGPT answered "where to buy saffron" for your customers and never named this page, and 1 question is watched like it about "saffron price", worth about 900 searches a month.');
  });
  it("keeps one slot per page: a page arriving by the click door and the AI door drafts once, clicks first", () => {
    const both = cand({ pageUrl: AI_PAGE, query: "saffron price", action: "act_existing_page", recoverableClicks: 120,
      cause: cause("retrieved_not_cited", { cause: "retrieved_not_cited", engine: "Perplexity", promptText: "where to buy saffron" }) });
    const picked = selectDeepCandidates({ snapshot: snapshot([["where to buy saffron", ["saffron price"]]]), candidates: [both], coverage: null, limit: 3 });
    expect([picked.length, picked[0]!.door, picked[0]!.unit]).toEqual([1, "ctr_gap", "clicks"]); });
  it("holds the bound, strongest proof first, and every entry names its own door", () => {
    const picked = selectDeepCandidates({
      snapshot: snapshot([["where to buy saffron", ["saffron price"]]]),
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
      snapshot: snapshot([]),
      candidates: [
        cand({ pageUrl: CTR_PAGE, action: "act_existing_page", recoverableClicks: 300 }),
        cand({ pageUrl: AI_PAGE, action: "act_existing_page", recoverableClicks: 500 }),
      ],
      coverage: null, limit: 3,
    });
    expect(picked.map((p) => [p.door, p.pageUrl])).toEqual([["ctr_gap", AI_PAGE]]); });
  /** THE LIVE COUNTEREXAMPLE'S OWN COUNT: six answers carrying one everyday word became "I watch 7 questions like it" on the line the operator reads. Only answers that
   *  belong to THIS search may ever be counted. */
  it("counts only the questions that belong to this search, never every answer sharing one word", () => {
    const generic = ["best places to visit in iran", "iran travel advice", "iran food guide", "iran history timeline", "iran music scene", "iran visa rules"];
    const picked = selectDeepCandidates({ snapshot: snapshot([["what does the iran flag mean", ["iran flag"]], ...generic], { "iran flag": 1300 }),
      candidates: [cand({ pageUrl: "https://own.example/iran-flag", query: "iran flag",
        cause: cause("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "what does the iran flag mean" }) })],
      coverage: null, limit: 3 });
    expect([picked[0]!.entry.includes("1 question is watched like it"), /[2-9] questions are watched/.test(picked[0]!.entry), picked[0]!.strength]).toEqual([true, false, 1]); });
  it("never opens the AI door on an accusation nothing rides on: no watched question, no demand, no slot", () => {
    const picked = selectDeepCandidates({
      snapshot: snapshot([]),
      candidates: [cand({ pageUrl: AI_PAGE, query: "saffron price",
        cause: cause("ai_citation_gap", { cause: "ai_citation_gap", engine: "ChatGPT", promptText: "where to buy saffron" }) })],
      coverage: null, limit: 3,
    });
    expect(picked).toEqual([]); }); });
