/** AN ATTEMPT PAYS FOR A CALL THAT ACTUALLY LEFT THE PROCESS (campaign, 2026-09-06). Two charges nobody made came
 *  off the page's own allowance, and both starved the cards a pass exists for. THE CACHED READING: the writer's
 *  door hands an attempt back when the answer came out of the call cache and the judging never did, so a page whose
 *  pieces are already written paid one attempt per piece on every later pass for readings that reached no provider.
 *  THE FREE REFUSAL: the judging's attempt was taken at the caller's door, ahead of the deterministic half, so a
 *  draft this page's own packet refuses without any reading was charged for a reading nobody bought.
 *  Pinned through the REAL accounting path (the real editor, the real gateway, the real call cache injected at the
 *  module boundary, the real money surface), so what the allowance says here is what a card's operator would read.
 *  TWO SYNTHETIC ACCOUNTS with unrelated subjects and different languages: a rule that holds for one is not a rule. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
/** ONE IN-MEMORY CACHE FOR THE WHOLE FILE, injected at the module boundary so production carries no test seam: the
 *  drafter resolves no cache under vitest, which is why a cached reading's price had never been pinned anywhere. */
const CACHE_ROWS = new Map<string, unknown>();
vi.mock("@/domains/decision/llm/call-cache", async (orig) => {
  const actual = await orig<typeof import("@/domains/decision/llm/call-cache")>();
  return { ...actual, resolveCacheImpl: () => ({
    read: async (_t: string, k: string) => (CACHE_ROWS.has(k) ? { key: k, value: CACHE_ROWS.get(k) } as never : null),
    write: async (_t: string, e: { key: string; value: unknown }) => { CACHE_ROWS.set(e.key, e.value); }, recentTexts: async () => [] }) };
});
import { draftFieldForPage } from "@/domains/decision/drafted-copy";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";

const NOW = new Date("2026-09-06T00:00:00.000Z");
const SITES = [
  { t: "tenant-one", url: "https://alpha.example/rain-barrels", q: "rain barrel sizing", title: "Rain Barrels", h1: "Rain Barrels", heads: ["Sizing a barrel", "Overflow"],
    lines: ["A rain barrel fills from the roof area above it, so a wide roof fills one barrel in a single storm.", "An overflow hose carries the surplus away from the wall once the barrel is full."],
    line: "A rain barrel fills from the roof area above it, and an overflow hose carries the surplus away from the wall." },
  { t: "tenant-two", url: "https://beta.example/masa", q: "como se nixtamaliza el maiz", title: "Masa de maiz", h1: "Masa de maiz", heads: ["Nixtamal", "Molienda"],
    lines: ["El maiz se cuece con cal y reposa toda la noche antes de lavarlo y escurrirlo.", "La molienda en piedra deja una masa fina que se amasa a mano."],
    line: "El maiz se cuece con cal y reposa toda la noche, y la molienda en piedra deja una masa fina." },
];
type Site = (typeof SITES)[number];
const bodyOf = (s: Site) => ({ url: s.url, title: s.title, h1: s.h1, metaDescription: null, vocabulary: "", headings: s.heads, passages: s.lines, completeness: "complete" as const, contentHash: "h", fetchedAt: NOW.toISOString() });
const TAIL = { evidenceRefs: [{ source: "gsc", detail: "real page demand" }], confidence: "high", risks: [], operatorSteps: ["Replace the field"], proofPlan: { metrics: ["clicks"], windowsDays: [7, 14, 28], controls: "untouched pages" } };
/** THE WRITER'S ANSWER: this page's own summary line, its one claim aimed at the passage that carries it. `cites` names an id the packet never handed over, which is a refusal the deterministic half makes with no reading at all. */
const draft = (s: Site, cites = "page-copy-1") => ({ field: "meta", before: null, after: s.line, rationale: "The page carries no description of its own.", placementAnchor: s.title, naturalHeading: null, claims: [{ text: s.lines[0]!, supportedBy: [cites] }], ...TAIL });
/** THE READING'S ANSWER: every box true and one ruling per claim, so the piece finishes on its first round and every count below is one draft and one reading. */
const VERDICT = { pageFit: true, usefulAndNatural: true, placementCorrect: true, resolvesDiagnosis: true, implementableNow: true, improvesPage: true, wouldHandToCustomer: true, contested: false, notes: "it names the roof area and the overflow, which the heading alone does not.", resolution: "none", claims: [{ i: 0, by: ["page-copy-1"], entailed: true }] };
const READING_USD = 0.0091;
/** ONE FUNDED JOB, drawn through the real money surface, so the meter under test is reading a receipt rather than an assumption. */
const funded = (s: Site) => { const key = DRAFT_BUDGET.keyOf({ pageUrl: s.url }), budget = DRAFT_BUDGET.plan({ jobs: [{ key, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 });
  return { key, budget, allowance: budget.draw(key, DRAFT_BUDGET.DELIVERABLE_CALLS)! }; };

describe("what one attempt pays for", () => {
  /** ONE PASS OF THE REAL EDITOR over this page's own stored words, counting the readings that actually left the process: a cache hit never reaches this transport, so it is never counted here either. */
  const pass = async (s: Site, brief: string, allowance: { left: number }, value: Record<string, unknown>) => { let bought = 0;
    const piece = await draftFieldForPage({ field: "meta", body: bodyOf(s) as never, query: s.q, brief, evidenceHints: [], ownedPaths: [new URL(s.url).pathname], minutes: 3 }, { tenantId: s.t, now: NOW, attempts: allowance as never,
      complete: (async ({ user }: { user: string }) => { const reading = user.includes("THE COPY:"); if (reading) bought += 1; return { value: reading ? VERDICT : value, httpAttempts: 1, provenance: { costUsd: READING_USD } }; }) as never });
    return { piece, readings: bought }; };

  it.each(SITES)("$t: a reading that reached a provider costs one attempt, and the same reading served from the cache costs none", async (s) => {
    CACHE_ROWS.clear();
    const first = funded(s), before = first.allowance.left, real = await pass(s, "Write the description for this page.", first.allowance, draft(s));
    expect([real.piece?.after, real.readings, before - first.allowance.left, first.budget.meterOf(first.key)!.providerCalls],
      "one draft and one reading, both of them calls that left the process, both off this page's own allowance").toEqual([s.line, 1, 2, 2]);
    const second = funded(s), start = second.allowance.left, hit = await pass(s, "Write the description for this page now.", second.allowance, draft(s));
    expect([hit.piece?.after, hit.readings, start - second.allowance.left, second.budget.meterOf(second.key)!.providerCalls],
      "the brief moved so the writing is bought again and the copy did not, so the reading is served from the cache: the row keeps that attempt and its meter records no provider call for it").toEqual([s.line, 0, 1, 1]); });

  it.each(SITES)("$t: a refusal this page's own packet makes for free buys no reading, and the attempt it did not spend still pays for one", async (s) => {
    CACHE_ROWS.clear();
    const { key, budget, allowance } = funded(s), before = allowance.left, refused = await pass(s, "Write the description for this page.", allowance, draft(s, "fact-9"));
    const onWriting = before - allowance.left;
    expect([refused.piece, refused.readings, onWriting > 0, allowance.left > 1],
      "copy citing evidence nobody handed it is refused before any reading, nothing was paid to read it, and the allowance still holds enough to buy one").toEqual([null, 0, true, true]);
    const at = allowance.left, done = await pass(s, "Write the description for this page in one line.", allowance, draft(s));
    expect([done.piece?.after, done.readings, at - allowance.left, budget.meterOf(key)!.providerCalls],
      "the next pass affords the reading it was never charged for: one draft, one reading, and every call that left the process on this page's own meter").toEqual([s.line, 1, 2, onWriting + 2]); });
});
