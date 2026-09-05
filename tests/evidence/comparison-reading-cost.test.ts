/** WHAT THE CONFIRMING READING IS BOUGHT AGAINST, AND WHAT IT SPENDS (campaign review, 2026-09-05).
 *
 *  The campaign's own kill condition is "the comparison reading costs more than 0.05 USD per job", so what the
 *  reading spends has to be measurable on the job that bought it. Three things decide that:
 *  1. THE KEY. `callStructuredLLM` keys the cache on {tenantId, promptId, promptVersion, kind, system, user} and
 *     `readComparison` folds each winner's held text into `user`, so a winner whose content moved is a different
 *     call. It folds `held`, the first READING_CHARS (4,000) of the winner's main text, NOT the whole capture the
 *     extract holds, so a change PAST that cut re-served the earlier reading for ever. The winner now carries a key
 *     over its whole main text and the prompt carries that key, so any word moving anywhere is a new reading.
 *  2. THE MONEY ON A MISS. `readComparison` took no allowance, so its real requests and real dollars reached no
 *     page meter and the kill condition could not be read off the number that would prove it.
 *  3. THE MONEY ON A HIT. The caller spends one attempt before the call and, unlike the writer, never gave it back
 *     when the answer came out of the cache, so a cached reading starved the card that paid for it.
 *
 *  TWO SYNTHETIC ACCOUNTS with unrelated subjects and different languages: a rule that holds for one is not a rule.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
/** ONE IN-MEMORY CACHE FOR THE WHOLE FILE, injected at the module boundary so production carries no test seam: the
 *  drafter resolves no cache under vitest, which is exactly why the hit-versus-miss economics were never pinned. */
const CACHE_ROWS = new Map<string, unknown>();
vi.mock("@/domains/decision/llm/call-cache", async (orig) => {
  const actual = await orig<typeof import("@/domains/decision/llm/call-cache")>();
  return { ...actual, resolveCacheImpl: () => ({
    read: async (_t: string, k: string) => (CACHE_ROWS.has(k) ? { key: k, value: CACHE_ROWS.get(k) } as never : null),
    write: async (_t: string, e: { key: string; value: unknown }) => { CACHE_ROWS.set(e.key, e.value); },
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
const owned = (s: Site) => ({ url: s.own, text: `${s.ownHeads.join(" ")} ${s.ownPassages.join(" ")}`, headings: s.ownHeads, passages: s.ownPassages });
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
  it.each(SITES)("$t: a winner whose words moved is a different reading, so an unchanged winner is never bought twice", async (s) => {
    const asked: string[] = [];
    const complete = async (req: { user?: string; messages?: { content?: string }[] }) => {
      asked.push(req.user ?? req.messages?.map((m) => m.content ?? "").join("\n") ?? "");
      return { value: { observations: [] } };
    };
    for (const prose of [s.early, s.moved]) {
      const c = jobComparison(research(s, prose), s.queries, owned(s));
      expect(c.verdict).toBe("names"); // a candidate exists, so the reading is worth buying
      await readComparison(c, { url: s.own, passages: s.ownPassages }, { tenantId: `${s.t}::key`, complete: complete as never });
    }
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain(s.early);
    expect(asked[1]).toContain(s.moved);
    expect(asked[0]).not.toEqual(asked[1]); // the prompt is the cache key's own input, so the key moved with the page
  });

  it.each(SITES)("$t: a word that moves past the part one reading is shown is still a different reading", async (s) => {
    const asked: string[] = [];
    const complete = async (req: { user?: string }) => { asked.push(req.user ?? ""); return { value: { observations: [] } }; };
    /* PAST THE CUT (campaign review, 2026-09-05): the prompt carries the first 4,000 characters of the winner, so a
     * page that rewrote only what stands after that served the earlier answer for ever. The filler below is the same
     * in both captures; only the sentence after 4,000 characters differs. */
    const filler = `${s.early} `.repeat(Math.ceil(4_200 / (s.early.length + 1)));
    const before = jobComparison(research(s, `${filler}${s.tail}`), s.queries, owned(s));
    const after = jobComparison(research(s, `${filler}${s.tail.toUpperCase()}`), s.queries, owned(s));
    expect([before.winners[0]!.held === after.winners[0]!.held, before.winners[0]!.bodyKey === after.winners[0]!.bodyKey],
      "the part a reading is shown is identical, and the key over the whole capture is not").toEqual([true, false]);
    for (const c of [before, after]) await readComparison(c, { url: s.own, passages: s.ownPassages }, { tenantId: `${s.t}::past`, complete: complete as never });
    expect(asked).toHaveLength(2);
    expect(asked[0]).not.toEqual(asked[1]); // so the cache key moved and the second reading is bought against the page as it stands
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
