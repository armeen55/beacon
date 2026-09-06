/** WHAT AN ATTEMPT PAYS FOR, ASKED ADVERSARIALLY (reviewer, 2026-09-06). Can a refund exceed what a door took, can a door give back an attempt it never spent, what does a call that never left the process cost, and does a reading that never arrived reach the caller's unsettled mark? Four answers were wrong: the day's cap refused a call and the page paid an attempt for it, a judging that threw was filed as a refusal Beacon had made, which the day memory counts as settling the job, an answer the drafter refused before any transport was charged for a call its own receipt counted at zero, and a reading that threw WHERE IT STOOD escaped the editor entirely, because a bare `.catch` never attaches to a function that throws before it returns a promise.
 *  Through the REAL money surface, the REAL editor and the REAL gateway, on two synthetic accounts with unrelated
 *  subjects and different languages: a rule that holds for one of them is not a rule. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
const cap = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => (cap.allowed ? { allowed: true, remaining: 10 } : { allowed: false, reason: "the day's cap is reached" }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => null, basisTag: () => "basis_rv3" }));

import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";
import { draftFieldForPage, reviewFinishedCopy } from "@/domains/decision/drafted-copy";
import { extractPageFacts, readWinningPattern } from "@/domains/decision/winning-pattern";
import { callStructuredLLM } from "@/domains/decision/llm/structured-drafter";

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

  /** AND THE CLASS THE THREE NAMED STATUSES MISS. The drafter refuses an answer with no account before it touches the cache, the cap or the wire, and says so on the receipt as `attempts: 0, costUsd: 0`; the gateway stamps that same count 0 for a credit hold, a paused account and a schema nothing can convert. The meter reads the count and records no call; the refund read the status and charged one. Asked here through the REAL drafter, with a transport that would stamp its own attempt if anything ever reached it. */
  it.each(SITES)("$t: an answer refused before any transport puts nothing on the dollars, so it may not cost an attempt either", async (s) => {
    const { key, budget, allowance } = funded(s), before = allowance.left;
    allowance.left -= 1; // every paid door takes the attempt before the call, so this is the shape the refund has to answer
    const refusedBeforeTransport = await callStructuredLLM({ kind: "editor_judgement", tenantId: "", system: "read these words", user: s.q, grounded: s.line, now: NOW, complete: (async () => ({ httpAttempts: 1, value: {} })) as never });
    allowance.record(refusedBeforeTransport); DRAFT_BUDGET.refundIfNoCallMade(allowance, refusedBeforeTransport);
    expect([budget.meterOf(key)?.providerCalls ?? 0, before - allowance.left, (refusedBeforeTransport as { attempts?: number }).attempts ?? -1], "the meter says no request left the process, and the two halves of one rule must agree about that").toEqual([0, 0, 0]);
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

  /** HOW A READING NEVER ANSWERS IS NOT PART OF THE FACT (reviewer, 2026-09-06). `acceptDeliverable` guarded the judging with `.catch`, which only ever catches a REJECTED promise, so a judge that threw where it stood took the whole pass down with it: the exception left the editor with the attempt already spent, no card was marked owed, and the caller saw a throw where every other reading failure arrives as a typed transport refusal. */
  it.each(SITES)("$t: a judge that throws where it stands leaves the card owed, exactly as one that rejects does", async (s) => {
    const { allowance } = funded(s), unsettled = new Set<string>();
    const sync = await pass(s, allowance, () => { throw new Error("the reading never came back"); }, unsettled).then((r) => ({ threw: null as unknown, ...r }), (e) => ({ threw: e, piece: undefined, unsettled }));
    expect([sync.threw, unsettled.has(s.url)], "a reading that never arrived says nothing about the words whichever way it failed, so the card comes back tomorrow rather than taking the whole pass down with it").toEqual([null, true]);
  });

  it.each(SITES)("$t: and the door that reads finished words answers a throw the same way, so a rule asked at one door is asked at both", async (s) => {
    const row = { id: `${s.t}::${new URL(s.url).pathname}::existing_edit::missing_description`, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: s.line }, primaryQuery: s.q, estimatedEffortMinutes: 3, limitations: [], claims: [{ text: s.lines[0]!, supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: s.lines[0]! }] };
    const out = await reviewFinishedCopy(row as never, { tenantId: s.t, now: NOW, judge: (() => { throw new Error("the reading never came back"); }) as never }).catch((e: unknown) => e);
    expect([out instanceof Error, (out as { row: unknown; detail: string }).detail], "the review lane takes a reading too, so a throw there says the same thing about the words and banks nothing").toEqual([false, "no reading of these words came back, so nothing was banked"]);
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
