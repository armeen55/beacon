/** WHAT AN ATTEMPT PAYS FOR, ASKED ADVERSARIALLY (reviewer, 2026-09-06). Can a refund exceed what a door took, can a door give back an attempt it never spent, what does a call that never left the process cost, and does a reading that never arrived reach the caller's unsettled mark? FIVE answers were wrong: the day's cap refused a call and the page paid an attempt for it, a judging that threw was filed as a refusal Beacon had made, which the day memory counts as settling the job, an answer the drafter refused before any transport was charged for a call its own receipt counted at zero, and a reading that threw WHERE IT STOOD escaped the editor entirely, because a bare `.catch` never attaches to a function that throws before it returns a promise, and a receipt stamped `off`, `blocked_budget` or `cached` beside real dollars was refunded its attempt AND dropped from the dollars, so the money left both halves of the meter at once and no receipt could name it.
 *  Through the REAL money surface, the REAL editor and the REAL gateway, on two synthetic accounts with unrelated
 *  subjects and different languages: a rule that holds for one of them is not a rule. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
const cap = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => (cap.allowed ? { allowed: true, remaining: 10 } : { allowed: false, reason: "the day's cap is reached" }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => null, basisTag: () => "basis_rv3" }));
const gap = vi.hoisted(() => ({ answer: null as unknown, body: null as unknown })); // the provider answer and the stored page the diagnosis door reads, supplied at the gateway seam so the producer itself is the real one
vi.mock("@/domains/evidence/pages/owned-context", () => ({ loadOwnedPageBodies: async (_t: string, urls: string[]) => { const { canonicalUrlKey } = await import("@/domains/evidence/snapshot"); return new Map(gap.body ? urls.map((u) => [canonicalUrlKey(u), gap.body]) : []); } }));
vi.mock("@/domains/decision/llm/structured-drafter", async (real) => { const m = await real<typeof import("@/domains/decision/llm/structured-drafter")>(); return { ...m, callStructuredLLM: async (o: { kind: string }) => (o.kind === "aeo_gap" ? gap.answer : m.callStructuredLLM(o as never)) }; }); // every other kind still goes to the real gateway, so the doors below are not mocked out from under themselves

import { DRAFT_BUDGET } from "@/domains/decision/draft-budget"; import { AI_CASE_COPY } from "@/domains/decision/producers/ai-cases";
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
    expect([{ status: "drafted" }, { status: "validation_failed" }, null, undefined, { cached: false }].map((a) => door(s, a)), "none of these says nothing left the process, so every one keeps the attempt it took")
      .toEqual(Array.from({ length: 5 }, () => "charged, calls 0, dollars 0"));
  });
});

/** ONE DOOR, READ OFF BOTH HALVES AT ONCE: take the attempt, let the answer come back, put it on the dollars, then ask for the attempt back. */
const door = (s: Site, answer: unknown) => { const { key, budget, allowance } = funded(s), before = allowance.left;
  allowance.left -= 1; allowance.record(answer); DRAFT_BUDGET.refundIfNoCallMade(allowance, answer); const m = budget.meterOf(key);
  return `${allowance.left === before ? "refunded" : "charged"}, calls ${m?.providerCalls ?? 0}, dollars ${m?.costUsd ?? 0}`; };

/** THE RULE AS THE FILE ITSELF STATES IT (draft-budget.ts:225): an attempt pays for a call that ACTUALLY LEFT THE
 *  PROCESS, and `recordOn` beside it keeps that same call off the dollars, so the two halves read ONE predicate. */
const STAMPS = [{ status: "off", attempts: 1 }, { status: "blocked_budget", attempts: 1 }, { status: "drafted", cached: true, attempts: 1 }, { status: "drafted", attempts: 0 }] as const;
describe("a call that never left the process", () => {
  it.each(SITES)("$t: the day's cap refuses the call, so the attempt it did not buy comes back", async (s) => {
    cap.allowed = false;
    try {
      const { key, budget, allowance } = funded(s), before = allowance.left;
      await readWinningPattern(winners(s), null, s.t, { complete: (async () => ({ value: {}, httpAttempts: 1 })) as never, now: NOW, label: s.q, attempts: allowance });
      expect([budget.meterOf(key)?.providerCalls ?? 0, before - allowance.left], "the meter records no provider call, so the allowance may not record one either").toEqual([0, 0]);
    } finally { cap.allowed = true; }
  });

  /** THE COST GUARD SITS ON THE PREDICATE, NOT ON ONE OF ITS CLAUSES (reviewer, 2026-09-06, finding 3). `off`, `blocked_budget` and `cached` answered on the status alone, so an answer stamped one of those beside real dollars was handed its attempt back here AND dropped from the dollars by `recordOn`: the same money left both halves at once and no receipt anywhere could name it. Asked as the cross product of the four stamps and the money, at both halves, on one funded page each. */
  it.each(SITES)("$t: the cost guard is on the predicate itself, so no stamp refunds an attempt beside real dollars", (s) => {
    expect(STAMPS.flatMap((x) => [0.02, 0].map((costUsd) => door(s, { ...x, costUsd }))), "a receipt that names money is a call that left the process whatever it calls itself, so it stays on the dollars and keeps the attempt it bought; the same stamp naming none is the call nobody made, and it comes back")
      .toEqual(["charged, calls 1, dollars 0.02", "refunded, calls 0, dollars 0", "charged, calls 1, dollars 0.02", "refunded, calls 0, dollars 0",
        "charged, calls 1, dollars 0.02", "refunded, calls 0, dollars 0", "charged, calls 0, dollars 0.02", "refunded, calls 0, dollars 0"]);
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

describe("a receipt that names money", () => {
  it.each(SITES)("$t: is never refunded, under any stamp and any shape of the number", (s) => {
    expect([...STAMPS, { status: "drafted", cached: true, attempts: 0 }].map((x) => door(s, { ...x, costUsd: 0.02 })),
      "the dollars are asked first and of every clause, so an answer that names money keeps the attempt it bought however it describes itself, and the dollars stay on the page's own record")
      .toEqual(["charged, calls 1, dollars 0.02", "charged, calls 1, dollars 0.02", "charged, calls 1, dollars 0.02", "charged, calls 0, dollars 0.02", "charged, calls 0, dollars 0.02"]);
  });

  it.each(SITES)("$t: the same stamps naming no money are the call nobody made, and they come back", (s) => {
    expect(STAMPS.map((x) => door(s, { ...x, costUsd: 0 })), "nothing left the process, so the attempt is handed back and no call and no dollar reaches the record")
      .toEqual(Array.from({ length: 4 }, () => "refunded, calls 0, dollars 0"));
  });
});

describe("a receipt with no dollars and no stamp", () => {
  it.each(SITES)("$t: is charged, and both halves of the meter say the same thing about it", (s) => {
    expect(door(s, { status: "drafted", attempts: 1, costUsd: 0 }), "a call that left the process and came back free is still a call: the attempt stays spent and the record names the request, which is the arithmetic the refund and the dollars share").toBe("charged, calls 1, dollars 0");
  });

  it.each(SITES)("$t: MEASURED: an answer that says nothing at all is charged and put on no request", (s) => {
    expect([door(s, {}), door(s, null)], "MEASURED, not endorsed: an object with no attempts field is not a zero-request receipt, so it keeps its attempt and adds no call, and a thrown call answering null keeps its attempt and reaches no record at all. Both charge, which is the safe direction; neither can be read back as what it cost").toEqual(["charged, calls 0, dollars 0", "charged, calls 0, dollars 0"]);
  });
});

/** AND THE PASS'S DIAGNOSIS PURSE IS THE SAME DOOR (reviewer, 2026-09-06, sixth pass). It gave a unit back on the cache flag alone, through a private clause spelled `AeoMeter.refund()` that took no answer at all, so no cost could gate it and the day cap refusing a call before the wire still cost the pass a reading it never bought. The private clause is deleted and the purse's `left` is written through the one rule, exactly as every other paid door writes its allowance. Driven through the REAL producer with the provider answer supplied at the gateway seam. */
describe("the pass's diagnosis purse", () => {
  const RULING = { kind: "already_answered", ownedIds: ["own-1"], evidenceIds: [], missing: "", explanation: "the page already answers it" };
  const reading = async (s: Site, answer: unknown) => { const meter = AI_CASE_COPY.aeoMeter(2); gap.answer = answer;
    gap.body = { passages: [...s.lines], faqs: [], completeness: "complete", contentHash: "h" };
    const d = await AI_CASE_COPY.diagnoseGap({ tenantId: s.t, caseKey: `fanout:${s.t}`, query: s.q, stage: "owned_retrieved_not_cited", pageUrl: s.url, observationIds: ["o1"], passages: [s.lines[1]!], meter, persist: true, now: NOW } as never);
    const m = meter.spent(); return `${d ? "ruled" : "no ruling"}, units ${m.attempted}, back ${m.givenBack}, left ${m.left}`; };

  it.each(SITES)("$t: a cached, refused or switched-off reading costs the pass no unit, and a real call costs exactly one", async (s) => {
    const spent: string[] = []; for (const answer of [{ status: "off" }, { status: "blocked_budget" }, { status: "drafted", cached: true, value: RULING }, { status: "drafted", attempts: 1, value: RULING }]) spent.push(await reading(s, answer));
    expect(spent, "a unit pays for a reading that actually left the process, so the model being off, the day cap refusing the call and the cache serving it all hand the unit back for the next case, and only the call that reached the provider is charged")
      .toEqual(["no ruling, units 0, back 1, left 2", "no ruling, units 0, back 1, left 2", "ruled, units 0, back 1, left 2", "ruled, units 1, back 0, left 1"]);
  });

  it.each(SITES)("$t: and a reading that names real dollars keeps its unit, whatever its stamp says", async (s) => {
    expect(await reading(s, { status: "drafted", cached: true, attempts: 1, costUsd: 0.004, value: RULING }),
      "the cost guard reaches this door now: money on the receipt means the call left the process whatever the stamp says, so the unit it bought stays spent")
      .toBe("ruled, units 1, back 0, left 1");
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
  const rowOf = (s: Site) => ({ id: `${s.t}::${new URL(s.url).pathname}::existing_edit::missing_description`, recommendedChange: { kind: "existing_edit", field: "meta", before: null, after: s.line }, primaryQuery: s.q, estimatedEffortMinutes: 3, limitations: [], claims: [{ text: s.lines[0]!, supportedBy: ["fact-1"] }], supportFacts: [{ id: "fact-1", fact: s.lines[0]! }] });

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
    const out = await reviewFinishedCopy(rowOf(s) as never, { tenantId: s.t, now: NOW, judge: (() => { throw new Error("the reading never came back"); }) as never }).catch((e: unknown) => e);
    expect([out instanceof Error, (out as { row: unknown; detail: string }).detail], "the review lane takes a reading too, so a throw there says the same thing about the words and banks nothing").toEqual([false, "no reading of these words came back, so nothing was banked"]);
  });

  /** AND IT TAKES NO ATTEMPT OF ITS OWN, so no path through it may hand one back: a refund without a take is money invented (reviewer, 2026-09-06). */
  it.each(SITES)("$t: takes nothing and gives nothing back, whether the reading answers, refuses or throws", async (s) => {
    const moved: number[] = [];
    for (const judge of [async () => ({ ...VERDICT, cached: true }), async () => null, () => { throw new Error("the reading never came back"); }]) {
      const { allowance } = funded(s), before = allowance.left;
      await reviewFinishedCopy(rowOf(s) as never, { tenantId: s.t, now: NOW, attempts: allowance as never, judge: judge as never }).catch(() => null); moved.push(allowance.left - before); }
    expect(moved, "this lane never decrements the allowance at its own door, so it may not increment one either").toEqual([0, 0, 0]);
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

  /** WHERE THE RESOLVED-PROMISE WRAP COULD HAVE MOVED THE MONEY (reviewer, 2026-09-06): starting the reading inside `Promise.resolve().then(...)` defers the CALL, and these two ask whether it deferred the take or the give-back with it. */
  it.each(SITES)("$t: the attempt is already taken when the reading starts and is back once it answers cached", async (s) => {
    const { allowance } = funded(s), before = allowance.left; let atCall = -1;
    const out = await pass(s, allowance, async () => (atCall = allowance.left, { ...VERDICT, cached: true }));
    expect([out.piece?.after, before - atCall, before - allowance.left], "both attempts are taken before the reading starts, and the reading's own comes back on a cache hit").toEqual([s.line, 2, 1]);
  });

  it.each(SITES)("$t: a reading that throws where it stands still pays its attempt and still leaves the card owed", async (s) => {
    const { allowance } = funded(s), before = allowance.left, out = await pass(s, allowance, () => { throw new Error("the reading never came back"); }).then((r) => ({ threw: null as unknown, ...r }), (e) => ({ threw: e, piece: undefined, unsettled: new Set<string>() }));
    expect([out.threw, out.unsettled.has(s.url), before - allowance.left > 0], "a throw is a reading that never came, so the attempt it bought is spent exactly as a rejection's is and the card is owed again").toEqual([null, true, true]);
  });

  it.each(SITES)("$t: a reading served from the cache costs nothing and the finished line still comes back", async (s) => {
    const { allowance } = funded(s), before = allowance.left;
    const out = await pass(s, allowance, async () => ({ ...VERDICT, cached: true }));
    expect([out.piece?.after, before - allowance.left], "one call left the process for the writing and none for the reading").toEqual([s.line, 1]);
  });
});
