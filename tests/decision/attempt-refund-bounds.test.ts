/** WHAT AN ATTEMPT PAYS FOR, ASKED ADVERSARIALLY (reviewer, 2026-09-06). Can a refund exceed what a door took, can a door give back an attempt it never spent, what does a call that never left the process cost, and does a reading that never arrived reach the caller's unsettled mark? Two answers were wrong: the day's cap refused a call and the page paid an attempt for it, and a judging that threw was filed as a refusal Beacon had made, which the day memory counts as settling the job.
 *  Through the REAL money surface, the REAL editor and the REAL gateway, on two synthetic accounts with unrelated
 *  subjects and different languages: a rule that holds for one of them is not a rule. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
const cap = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => (cap.allowed ? { allowed: true, remaining: 10 } : { allowed: false, reason: "the day's cap is reached" }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => null, basisTag: () => "basis_rv3" }));

import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { draftFieldForPage } from "@/domains/decision/drafted-copy";
import { extractPageFacts, readWinningPattern } from "@/domains/decision/winning-pattern";

const NOW = new Date("2026-09-06T13:00:00.000Z");
const SITES = [
  { t: "acct-reef", url: "https://acct-reef.example/tide-pool-guide", q: "tide pool safety", title: "Tide pools", h1: "Tide pools", heads: ["What to bring", "When to go"],
    lines: ["A falling tide opens the pools for about two hours before the water turns.", "Rubber soles hold on wet rock where smooth soles slide."],
    line: "A falling tide opens the pools for about two hours, and rubber soles hold on the wet rock." },
  { t: "acct-loom", url: "https://acct-loom.example/blackwork-stitches", q: "blackwork stitch order", title: "Blackwork", h1: "Blackwork", heads: ["Ordre des points", "Tension"],
    lines: ["Le trait de contour se pose avant le remplissage pour tenir la forme.", "Une tension egale evite que le fil ne tire le tissu."],
    line: "Le trait de contour se pose avant le remplissage, et une tension egale evite que le fil ne tire le tissu." },
] as const;
type Site = (typeof SITES)[number];

const bodyOf = (s: Site) => ({ url: s.url, title: s.title, h1: s.h1, metaDescription: null, vocabulary: "", headings: s.heads, passages: s.lines, completeness: "complete" as const, contentHash: "h", fetchedAt: NOW.toISOString() });
const TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };
const draft = (s: Site) => ({ field: "meta", before: null, after: s.line, rationale: "The page carries no description of its own.", placementAnchor: s.title, naturalHeading: null, claims: [{ text: s.lines[0]!, supportedBy: ["page-copy-1"] }], ...TAIL });
const VERDICT = { pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, contested: false, notes: "it names the tide window and the soles, which the heading alone does not.", resolution: "none", claims: [{ i: 0, by: ["page-copy-1"], entailed: true }] };
const winners = (s: Site) => extractPageFacts([1, 2, 3].map((n) => ({ url: `https://w${n}.example/x`, domain: `w${n}.example`,
  extract: { title: s.q, h1: s.q, wordCount: 1200, headings: [...s.heads, "What to do first"], faqCount: 2, openingSample: s.lines[0]!, entityNames: [s.title], hasList: true, hasTable: false } })) as never);

/** ONE FUNDED JOB, drawn through the real money surface. */
const funded = (s: Site, calls = DRAFT_BUDGET.DELIVERABLE_CALLS) => { const key = DRAFT_BUDGET.keyOf({ pageUrl: s.url }), budget = DRAFT_BUDGET.plan({ jobs: [{ key, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 });
  return { key, budget, allowance: budget.draw(key, calls)! }; };

describe("a refund gives back the attempt the door took, and never more", () => {
  it.each(SITES)("$t: a door that took nothing is given nothing back", (s) => {
    const { allowance } = funded(s), before = allowance.left;
    DRAFT_BUDGET.refundIfNoCallMade(allowance, { cached: true });
    DRAFT_BUDGET.refundIfNoCallMade(allowance, { cached: true });
    expect(allowance.left, "an allowance may never hold more than the page was funded for").toBe(before);
  });

  it.each(SITES)("$t: one take refunded twice gives back exactly one", (s) => {
    const { key, budget, allowance } = funded(s), before = allowance.left;
    allowance.left -= 1;
    DRAFT_BUDGET.refundIfNoCallMade(allowance, { cached: true });
    DRAFT_BUDGET.refundIfNoCallMade(allowance, { cached: true });
    expect([allowance.left, budget.spent().calls, budget.meterOf(key)], "the second give-back lands nothing, and nothing on the meter says a call was made").toEqual([before, 0, null]);
  });

  it.each(SITES)("$t: an answer that was not served from the cache is never refunded", (s) => {
    const { allowance } = funded(s), before = allowance.left;
    allowance.left -= 1;
    for (const answer of [{ status: "drafted" }, { status: "validation_failed" }, null, undefined, { cached: false }]) DRAFT_BUDGET.refundIfNoCallMade(allowance, answer);
    expect(allowance.left).toBe(before - 1);
  });
});

/** THE RULE AS THE FILE ITSELF STATES IT (draft-budget.ts:225): an attempt pays for a call that ACTUALLY LEFT THE
 *  PROCESS. `recordOn` three lines above knows three ways nothing left it (`off`, `blocked_budget`, a cache hit)
 *  and keeps all three off the dollars; `refundIfNoCallMade` knows only the cache hit, so the two halves of one rule
 *  answer the same question differently, and a page whose day cap is reached spends its whole allowance on calls
 *  nobody made. */
describe("a call that never left the process", () => {
  it.each(SITES)("$t: the day's cap refuses the call, so the attempt it did not buy comes back", async (s) => {
    cap.allowed = false;
    try {
      const { key, budget, allowance } = funded(s), before = allowance.left;
      await readWinningPattern(winners(s), null, s.t, { complete: (async () => ({ value: {}, httpAttempts: 1 })) as never, now: NOW, label: s.q, attempts: allowance });
      expect([budget.meterOf(key)?.providerCalls ?? 0, before - allowance.left], "the meter records no provider call, so the allowance may not record one either").toEqual([0, 0]);
    } finally { cap.allowed = true; }
  });
});

/** THE JUDGING'S ATTEMPT, TAKEN INSIDE `acceptDeliverable` (drafted-copy.ts:253). */
describe("the judging's own attempt", () => {
  const pass = async (s: Site, allowance: { left: number }, judge: unknown, unsettled = new Set<string>()) => {
    const piece = await draftFieldForPage({ field: "meta", body: bodyOf(s) as never, query: s.q, brief: "Write the description for this page.", evidenceHints: [], ownedPaths: [new URL(s.url).pathname], minutes: 3 },
      { tenantId: s.t, now: NOW, attempts: allowance as never, unsettled, settleKey: s.url, ...(judge ? { judge: judge as never } : {}),
        complete: (async () => ({ value: draft(s), httpAttempts: 1, provenance: { costUsd: 0.004 } })) as never });
    return { piece, unsettled };
  };

  it.each(SITES)("$t: a judge that never answers costs one attempt a round, and the receipt names only the writing", async (s) => {
    const { key, budget, allowance } = funded(s), before = allowance.left;
    const out = await pass(s, allowance, async () => { throw new Error("the reading never came back"); });
    expect([out.piece, before - allowance.left, budget.meterOf(key)?.providerCalls ?? 0], "three rounds, each buying a writing and a reading: six attempts gone against three calls the meter can name, and no words")
      .toEqual([null, 6, 3]);
  });

  it.each(SITES)("$t: and a deliverable is never left half judged: the words the writing bought are still owed", async (s) => {
    const { allowance } = funded(s);
    const out = await pass(s, allowance, async () => { throw new Error("the reading never came back"); });
    expect(out.unsettled.has(s.url), "a reading that never arrived says nothing about the words, so the card is owed again rather than refused").toBe(true);
  });

  it.each(SITES)("$t: an allowance with one attempt left buys the writing and answers spent for the reading, and the card is left unsettled", async (s) => {
    const { allowance } = funded(s, 1);
    const out = await pass(s, allowance, null);
    expect([out.piece, allowance.left, out.unsettled.has(s.url)], "the pass ran out mid deliverable, so nothing is settled against these words").toEqual([null, 0, true]);
  });

  it.each(SITES)("$t: a reading served from the cache costs nothing and the finished line still comes back", async (s) => {
    const { allowance } = funded(s), before = allowance.left;
    const out = await pass(s, allowance, async () => ({ ...VERDICT, cached: true }));
    expect([out.piece?.after, before - allowance.left], "one call left the process for the writing and none for the reading").toEqual([s.line, 1]);
  });
});
