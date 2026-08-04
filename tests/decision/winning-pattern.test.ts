/** WINNING-PAGE PATTERN (V1 Truth Convergence Phase 3): what the pages that already win a search have in common, learned without copying one of them. Each pin states
 *  what the reading may say about those pages and what it may never say. Fixtures only, zero network: the gateway is seamed as case-synthesis seams it. */
import { describe, it, expect, vi } from "vitest";
// Budget is not this file's subject: always-allowed, no-op hermetic seam.
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
import { extractPageFacts, readWinningPattern } from "@/domains/decision/winning-pattern";
import type { WinningPatternRead } from "@/domains/decision/llm/schemas";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { CacheImpl, LlmCallCacheEntry } from "@/domains/decision/llm/call-cache";
/** The heading every winner carries, and the one long enough that handing it back is a quote. */
const CARE = "Caring for a Persian rug";
const MADE = "How a Persian rug is made from wool and silk in the villages of Iran";
/** One page as the funnel already read it. */
const page = (domain: string, headings: string[], over: Record<string, unknown> = {}) => ({
  url: `https://${domain}/persian-rugs`, domain,
  extract: { title: "Persian rugs explained", h1: "Persian rugs explained", wordCount: 1400, headings,
    faqCount: 3, openingSample: "A Persian rug is a hand knotted floor covering woven in Iran by families who have done it for generations.",
    entityNames: ["Tabriz", "Kashan"], hasList: true, hasTable: false, ...over },
});
const WINNERS = [
  page("guide.example", ["What a Persian rug is", MADE, CARE]),
  page("museum.example", ["What a Persian rug is", MADE, "Where they come from"]),
  page("weavers.example", [MADE, CARE, "How to tell a real one"]),
  page("atlas.example", ["What a Persian rug is", CARE, "Where they come from"]),
];
const OWNED = page("mysite.example", ["Our rug collection"], { hasList: false, entityNames: [] });
const facts = () => extractPageFacts(WINNERS);
const ownedFacts = () => extractPageFacts([OWNED])[0]!;
/** A reading that names only pages it was shown, and says everything in its own words. */
const reading = (over: Partial<WinningPatternRead> = {}): WinningPatternRead => ({
  archetype: "informational_guide",
  commonHeadings: [{ heading: "how one is made, step by step", seenOn: [0, 1, 2] }, { heading: CARE, seenOn: [0, 2, 3] }],
  commonEntities: [{ entity: "Tabriz", seenOn: [0, 1] }],
  questionsAnswered: ["What is a Persian rug?"],
  openingPattern: "Each of them answers the question plainly in its first sentence before it explains anything else.",
  ownedGaps: [{ gap: "your page never explains how one is made", seenOn: [0, 1, 2] }],
  disagreements: ["Some of them treat the region as the subject and others treat the craft as the subject."],
  uniqueNotCommon: [{ detail: "one of them lays the knot counts out in a table", seenOn: [1] }],
  ...over,
});
/** A completion seam that answers with one fixed reading and counts how many times it actually ran. */
const seam = (value: unknown): { complete: CompleteFn; calls: () => number } => { let calls = 0; return { calls: () => calls, complete: async () => { calls += 1; return { value }; } }; };
const memoryCache = (): CacheImpl => { const rows = new Map<string, LlmCallCacheEntry>(); return { read: async (t, k) => rows.get(`${t}|${k}`) ?? null, write: async (t, e) => void rows.set(`${t}|${e.key}`, e), recentTexts: async () => [] }; };
describe("the facts I read off the winning pages myself", () => {
  it("carries what the read captured and fills in nothing it did not", () => {
    const [first] = facts();
    expect([first!.domain, first!.headings, first!.questionHeadings, first!.entities]).toEqual(["guide.example", ["What a Persian rug is", MADE, CARE], ["What a Persian rug is", MADE], ["Tabriz", "Kashan"]]);
    expect([first!.wordCount, first!.faqCount, first!.hasList, first!.hasTable, first!.hasSchema]).toEqual([1400, 3, true, false, true]);
    // A PAGE I NEVER READ IS NOT A PAGE OF ZEROES. Every scalar is null and every list is empty, so nothing downstream can read "no sections, no words, no structured
    // data" off a page nobody ever fetched.
    const unread = extractPageFacts([{ url: "https://blocked.example/rugs", domain: "blocked.example", extract: null }])[0]!;
    expect(unread).toEqual({ domain: "blocked.example", titleTokens: [], headings: [], questionHeadings: [], entities: [],
      wordCount: null, faqCount: null, hasList: null, hasTable: null, hasSchema: null, opening: null });
    // A row stored before those fields existed reads the same way: absent, never false.
    const legacy = extractPageFacts([{ url: "https://old.example/rugs", extract: { title: "Persian rugs", h1: null, wordCount: 900, headings: ["Where they come from"], faqCount: 0 } }])[0]!;
    expect([legacy!.hasList, legacy!.hasTable, legacy!.hasSchema, legacy!.opening, legacy!.faqCount, legacy!.domain]).toEqual([null, null, null, null, 0, "old.example"]);
    // A read that banked cards but no list flag still knows it saw a list; one that banked no structured data says so.
    const cards = extractPageFacts([{ url: "https://cards.example/rugs", extract: { headings: [], cardTexts: ["Tabriz rug", "Kashan rug"], entityNames: [] } }])[0]!;
    expect([cards!.hasList, cards!.hasSchema]).toEqual([true, false]);
  });
});
describe("the one reading a case may buy", () => {
  it("says what four winning pages share, counts them itself, and names the sites without the reading ever seeing one", async () => {
    const s = seam(reading());
    const out = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete });
    expect([out?.winners, out?.publishers, s.calls()]).toEqual([4, ["guide.example", "museum.example", "weavers.example", "atlas.example"], 1]);
    expect([out?.archetype, out?.commonHeadings[0]?.seenOn, out?.ownedGaps[0]?.gap, out?.fingerprint.length]).toEqual(["informational_guide", [0, 1, 2], "your page never explains how one is made", 16]);
  });
  it("throws the WHOLE reading away for a stranger, a quotation, or a claim no page it cited carries", async () => {
    // A pattern is an abstraction: it may cite only pages I showed it, it may not hand a line back word for word (in ANY field, including the four the run check never
    // used to read), and it may not claim a section or a named thing is on a page that does not carry it. Eight words in a row IS that page's line.
    const RUN = "a hand knotted floor covering woven in Iran";
    const swapped = MADE.replace("villages", "towns"); // one word swapped is still their line, and 65 chars
    expect(swapped.length).toBe(65); // under the old sixty-character bar this walked through untouched
    const bad: Partial<WinningPatternRead>[] = [
      { commonHeadings: [{ heading: "how one is made", seenOn: [0, 4] }] },              // a page I never showed it
      { ownedGaps: [{ gap: "your page never explains how one is made", seenOn: [9] }] },
      { commonEntities: [{ entity: "Tabriz", seenOn: [0, 7] }] },
      { commonHeadings: [{ heading: MADE, seenOn: [0, 1, 2] }] },                        // handed back verbatim
      { commonHeadings: [{ heading: swapped, seenOn: [0, 1, 2] }] },
      { openingPattern: "They open by saying a Persian rug is a hand knotted floor covering woven in Iran by families." },
      { disagreements: [`Some of them treat ${RUN} as the subject and others do not.`] },
      { ownedGaps: [{ gap: `your page never says ${RUN}`, seenOn: [0, 1, 2] }] },
      { questionsAnswered: [`What is ${RUN}?`] },
      { uniqueNotCommon: [{ detail: `one of them opens by calling it ${RUN}`, seenOn: [1] }] },
      { commonHeadings: [{ heading: "shipping and returns", seenOn: [0, 1] }] },         // on no page it cited
      { commonEntities: [{ entity: "Isfahan", seenOn: [0] }] },
    ];
    for (const one of bad) expect(await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading(one)).complete }), JSON.stringify(one)).toBeNull();
    // And an honest reading survives all of it, so every refusal above is about the defect and nothing else.
    const good = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading()).complete });
    expect([good?.ownedGaps[0]?.seenOn, good?.commonHeadings[1]?.heading]).toEqual([[0, 1, 2], CARE]);
  });
  it("never re-votes a shape the results already settled, and writes no gap about a page it was never shown", async () => {
    // The reading says informational_guide; the results counted a list, and the deterministic count wins.
    expect(await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading()).complete, pageType: "list" })).toBeNull();
    const agreed = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading()).complete, pageType: "informational_guide" });
    expect([agreed?.archetype, agreed?.winners]).toEqual(["informational_guide", 4]);
    // With no page of my own supplied, "your page has no care section" is about a page it never saw.
    expect(await readWinningPattern(facts(), null, "t_fixture", { complete: seam(reading()).complete })).toBeNull();
    const quiet = await readWinningPattern(facts(), null, "t_fixture", { complete: seam(reading({ ownedGaps: [] })).complete });
    expect([quiet?.ownedGaps, quiet?.winners]).toEqual([[], 4]); });
  it("asks the same question once: winners that did not move buy no second reading", async () => {
    const s = seam(reading()); const cacheImpl = memoryCache();
    const first = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete, cacheImpl });
    const again = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete, cacheImpl });
    expect([first?.fingerprint, again?.fingerprint, s.calls()]).toEqual([first?.fingerprint, first?.fingerprint, 1]);
  });
  it("asks nothing at all under three publishers I could actually read", async () => {
    const s = seam(reading());
    const twoRead = [...WINNERS.slice(0, 2), { url: "https://blocked.example/rugs", domain: "blocked.example", extract: null }];
    expect(await readWinningPattern(extractPageFacts(twoRead), ownedFacts(), "t_fixture", { complete: s.complete })).toBeNull();
    // Four pages from two sites are two sites' house style, and this file never calls that a pattern.
    const twoSites = [WINNERS[0]!, page("guide.example", ["What a Persian rug is"]), WINNERS[1]!, page("museum.example", [CARE])];
    expect(await readWinningPattern(extractPageFacts(twoSites), ownedFacts(), "t_fixture", { complete: s.complete })).toBeNull();
    expect(s.calls()).toBe(0); // and not one cent was spent reaching either answer
  });
});
