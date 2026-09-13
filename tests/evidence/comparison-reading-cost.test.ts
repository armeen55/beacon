/** Comparison identity tracks changes anywhere in a held winner, not only its prompt excerpt.
 * Real receipts charge the owning job; validated cache reuse refunds its attempt at zero cost.
 * Two unrelated synthetic accounts protect both promises without provider calls. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
/** ONE IN-MEMORY CACHE FOR THE WHOLE FILE, injected at the module boundary so production carries no test seam: the
 *  drafter resolves no cache under vitest, which is exactly why the hit-versus-miss economics were never pinned. */
const CACHE_ROWS = new Map<string, unknown>();
vi.mock("@/domains/decision/llm/call-cache", async (orig) => {
  const actual = await orig<typeof import("@/domains/decision/llm/call-cache")>();
  return { ...actual, resolveCacheImpl: () => ({
    read: async (_t: string, k: string) => (CACHE_ROWS.get(k) as never ?? null),
    write: async (_t: string, e: { key: string; value: unknown }) => { CACHE_ROWS.set(e.key, e); },
    recentTexts: async () => [] }) };
});
import { jobComparison } from "@/domains/evidence/comparison";
import { readComparison } from "@/domains/decision/llm/structured-drafter";
import { DRAFT_BUDGET } from "@/domains/decision/draft-budget";

const SITES = [
  { t: "tenant-one", own: "https://alpha.example/harbour-seals", win: "https://rivalone.example/seals",
    queries: ["where harbour seals haul out"], ownHeads: ["Where they haul out"],
    ownPassages: ["Harbour seals haul out on the sand bars below the point."],
    early: "Harbour seals haul out on gravel spits at low tide, and wardens close the eastern spit through the pupping season.",
    moved: "Harbour seals haul out on gravel spits at low tide, and wardens close the western shelf through the pupping season.",
    tail: "The eastern spit reopens once the last pup has moulted and the wardens lift the marker buoys.",
    gap: "Pupping season closures" },
  { t: "tenant-two", own: "https://beta.example/telares", win: "https://rivaldos.example/urdimbre",
    queries: ["como se monta la urdimbre"], ownHeads: ["Como se monta la urdimbre"],
    ownPassages: ["La urdimbre se monta con doce hilos por centimetro."],
    early: "La urdimbre se monta hilo por hilo sobre el peine, y la tension se ajusta con contrapesos colgados detras del telar.",
    moved: "La urdimbre se monta hilo por hilo sobre el peine, y la tension se ajusta con pesas de plomo sujetas al bastidor.",
    tail: "Los contrapesos se retiran cuando la primera trama sujeta el ancho completo de la tela.",
    gap: "Contrapesos para el ancho" },
];
type Site = (typeof SITES)[number];
const research = (s: Site, prose: string) => ({
  serpEvidence: [{ query: s.queries[0]!, observedAt: null, organic: [{ rank: 1, url: s.win, domain: new URL(s.win).hostname, title: null }], aiOverview: [], aiMode: [], paa: [], related: [] }],
  winningPages: [{ url: s.win, domain: new URL(s.win).hostname, engines: [], examplePrompts: [], appearances: [{ query: s.queries[0]! }],
    extract: { title: "Winner", h1: null, wordCount: 2100, headings: [s.gap], faqCount: 0, entityNames: [], hasList: false, hasTable: false,
      mainText: prose, truncated: false, heldChars: prose.length, totalChars: prose.length, h3s: [], schemaTypes: [] } }],
}) as never;
const owned = (s: Site) => ({ url: s.own, text: `${s.ownHeads.join(" ")} ${s.ownPassages.join(" ")}`, headings: s.ownHeads, passages: s.ownPassages, complete: true });
/** ONE FUNDED JOB, drawn through the real money surface, so what the meter says is what a card's operator would read. */
const funded = (key: string) => {
  const budget = DRAFT_BUDGET.plan({ jobs: [{ key, family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 });
  return { budget, allowance: budget.draw(key, DRAFT_BUDGET.DELIVERABLE_CALLS)! };
};
/** A TRANSPORT THAT REPORTS WHAT IT REALLY DID, the way the gateway does: one request that left the process and what
 *  that request cost, so the meter under test is reading a receipt rather than an assumption. */
const READING_USD = 0.0091;
const answered = async () => ({ value: { observations: [] }, httpAttempts: 1, provenance: { costUsd: READING_USD } });

describe("the confirming reading is bought against the winner it read", () => {
  it.each(SITES)("$t: visible and unshown changes in either page move the reading identity", async (s) => {
    const filler = `${s.early} `.repeat(Math.ceil(4_900 / (s.early.length + 1))), ownFiller = `${s.ownPassages[0]} `.repeat(Math.ceil(4_900 / (s.ownPassages[0]!.length + 1)));
    const pairs = [
      [jobComparison(research(s, s.early), s.queries, owned(s)), jobComparison(research(s, s.moved), s.queries, owned(s))],
      [jobComparison(research(s, `${filler}${s.tail}`), s.queries, owned(s)), jobComparison(research(s, `${filler}${s.tail.toUpperCase()}`), s.queries, owned(s))],
      [jobComparison(research(s, s.early), s.queries, { ...owned(s), passages: [ownFiller], text: `${ownFiller}${s.tail}` }), jobComparison(research(s, s.early), s.queries, { ...owned(s), passages: [ownFiller], text: `${ownFiller}${s.tail.toUpperCase()}` })],
    ];
    for (const [i, pair] of pairs.entries()) {
      const asked: string[] = [], [before, after] = pair;
      const complete = async (req: { user?: string }) => { asked.push(req.user ?? ""); return { value: { observations: [] } }; };
      if (i === 0) expect([before!.verdict, after!.verdict, before!.winners[0]!.held.includes(s.early), after!.winners[0]!.held.includes(s.moved)]).toEqual(["names", "names", true, true]);
      else { const a = i === 1 ? before!.winners[0]! : before!.owned!, b = i === 1 ? after!.winners[0]! : after!.owned!; expect([a.held === b.held, a.bodyKey === b.bodyKey], "unchanged excerpts cannot reuse a ruling against a changed capture").toEqual([true, false]); }
      for (const c of pair) await readComparison(c!, { url: s.own, passages: s.ownPassages }, { tenantId: `${s.t}::identity-${i}`, complete: complete as never });
      expect(asked).toHaveLength(2); expect(asked[0]).not.toEqual(asked[1]);
      if (i === 0) { expect(asked[0]).toContain(s.early); expect(asked[1]).toContain(s.moved); }
    }
  });

  it.each(SITES)("$t: a bought reading lands on the page's own meter, and a cached one costs nothing and gives the attempt back", async (s) => {
    CACHE_ROWS.clear();
    const key = `${s.own}::body`;
    const first = funded(key), before = first.allowance.left;
    const c = jobComparison(research(s, s.early), s.queries, owned(s));
    first.allowance.left -= 1; // the caller pays before the call, exactly as the writer's door pays
    const paid = await readComparison(c, { url: s.own, passages: s.ownPassages }, { tenantId: `${s.t}::meter`, complete: answered as never, attempts: first.allowance });
    const bought = first.budget.meterOf(key)!;
    expect([bought.ops, bought.providerCalls, bought.costUsd, first.allowance.left], "one request, one provider call, its real dollars on the page's own meter, and the attempt stays spent").toEqual([1, 1, READING_USD, before - 1]);

    const second = funded(key), start = second.allowance.left;
    second.allowance.left -= 1;
    const again = await readComparison(c, { url: s.own, passages: s.ownPassages }, { tenantId: `${s.t}::meter`, complete: answered as never, attempts: second.allowance });
    const hit = second.budget.meterOf(key)!;
    expect([hit.ops, hit.providerCalls, hit.costUsd, second.allowance.left], "the same reading again is one recorded request that reached no provider, cost nothing, and gave its attempt back").toEqual([1, 0, 0, start]);
    expect(JSON.stringify([again.verdict, again.winners.map((w) => w.observations)])).toBe(JSON.stringify([paid.verdict, paid.winners.map((w) => w.observations)])); // and what a cache hit serves is what the paid call served
  });
});
