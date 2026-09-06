/** WINNING-PAGE PATTERN (V1 Truth Convergence Phase 3): what the pages that already win a search have in common, learned without copying one of them. Each pin states what the reading may say about those pages and what it may never say. Fixtures only, zero network: the gateway is seamed as case-synthesis seams it. */
import { describe, it, expect, vi } from "vitest";
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} })); // Budget is not this file's subject: always-allowed, no-op hermetic seam.
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
    entityNames: ["Tabriz", "Kashan"], hasList: true, hasTable: false, ...over },});
const WINNERS = [
  page("guide.example", ["What a Persian rug is", MADE, CARE]),
  page("museum.example", ["What a Persian rug is", MADE, "Where they come from"]),
  page("weavers.example", [MADE, CARE, "How to tell a real one"]),
  page("atlas.example", ["What a Persian rug is", CARE, "Where they come from"]),];
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
  uniqueNotCommon: [{ detail: "one of them lays the knot counts out in a table", seenOn: [1] }], ...over,});
/** A completion seam that answers with one fixed reading and counts how many times it actually ran. */
const seam = (value: unknown): { complete: CompleteFn; calls: () => number } => { let calls = 0; return { calls: () => calls, complete: async () => { calls += 1; return { value }; } }; };
const memoryCache = (): CacheImpl => { const rows = new Map<string, LlmCallCacheEntry>(); return { read: async (t, k) => rows.get(`${t}|${k}`) ?? null, write: async (t, e) => void rows.set(`${t}|${e.key}`, e), recentTexts: async () => [] }; };
describe("the facts I read off the winning pages myself", () => {
  it("carries what the read captured and fills in nothing it did not", () => {
    const [first] = facts(); expect([first!.domain, first!.headings, first!.questionHeadings, first!.entities]).toEqual(["guide.example", ["What a Persian rug is", MADE, CARE], ["What a Persian rug is", MADE], ["Tabriz", "Kashan"]]);
    expect([first!.wordCount, first!.faqCount, first!.hasList, first!.hasTable, first!.hasSchema]).toEqual([1400, 3, true, false, true]);
    const unread = extractPageFacts([{ url: "https://blocked.example/rugs", domain: "blocked.example", extract: null }])[0]!; // A PAGE I NEVER READ IS NOT A PAGE OF ZEROES. Every scalar is null and every list is empty, so nothing downstream can read "no sections, no words, no structured data" off a page nobody ever fetched.
    expect(unread).toEqual({ domain: "blocked.example", titleTokens: [], headings: [], questionHeadings: [], entities: [], wordCount: null, faqCount: null, hasList: null, hasTable: null, hasSchema: null, opening: null });
    const legacy = extractPageFacts([{ url: "https://old.example/rugs", extract: { title: "Persian rugs", h1: null, wordCount: 900, headings: ["Where they come from"], faqCount: 0 } }])[0]!; // A row stored before those fields existed reads the same way: absent, never false.
    expect([legacy!.hasList, legacy!.hasTable, legacy!.hasSchema, legacy!.opening, legacy!.faqCount, legacy!.domain]).toEqual([null, null, null, null, 0, "old.example"]);
    const cards = extractPageFacts([{ url: "https://cards.example/rugs", extract: { headings: [], cardTexts: ["Tabriz rug", "Kashan rug"], entityNames: [] } }])[0]!; expect([cards!.hasList, cards!.hasSchema]).toEqual([true, false]); }); }); // A read that banked cards but no list flag still knows it saw a list; one that banked no structured data says so.
describe("a ranked page with a different intent teaches nothing", () => {
  /** A page ranks for a search for many reasons and only one of them is that it answers it. The comparison is the one the demand classifier proved over 227 owned pages: a word carrying a RELATION rather than a subject, a period, a comparison, a rank, a meaning or a defining role, has to be matched by what the page actually carries. A search naming no relation asks nothing of a rival, which is the falsifier a vocabulary-overlap rule failed. */
  it.each(["tenant-one", "tenant-two"])("drops a winner that answers a different period from the one the search names, keeps a rival whose words differ but whose question is the same, and buys nothing once too few publishers are left [%s]", async (tenant) => {
    const since = (domain: string) => page(domain, ["The flag since the revolution", "Colours and emblem today"], { title: "The flag today", h1: "The flag today", openingSample: "The present flag was adopted after the revolution and has not changed since.", entityNames: ["Tehran"] });
    const before = (domain: string) => page(domain, ["The flag before the revolution", "The lion and sun"], { title: "The flag before 1979", h1: "The flag before 1979", openingSample: "Before 1979 the flag carried the lion and sun at its centre.", entityNames: ["Lion and Sun"] });
    const mixed = extractPageFacts([before("a.example"), since("b.example"), before("c.example"), since("d.example")]);
    const asked = seam(reading({ commonHeadings: [], commonEntities: [], ownedGaps: [], uniqueNotCommon: [], disagreements: [], questionsAnswered: [] }));
    const out = await readWinningPattern(mixed, ownedFacts(), tenant, { complete: asked.complete, label: "iran flag before 1979" });
    expect([out, asked.calls()], "two of the four answer the period the search never asked about, so under three publishers nothing is read and nothing is spent").toEqual([null, 0]);
    const allBefore = extractPageFacts([before("a.example"), before("c.example"), before("e.example"), before("f.example")]);
    const paid = seam(reading({ commonHeadings: [], commonEntities: [], ownedGaps: [], uniqueNotCommon: [], disagreements: [], questionsAnswered: [] }));
    const taught = await readWinningPattern(allBefore, ownedFacts(), tenant, { complete: paid.complete, label: "iran flag before 1979" });
    expect([taught?.winners, taught?.publishers], "four pages that do answer that period are read exactly as before").toEqual([4, ["a.example", "c.example", "e.example", "f.example"]]);
    const idioms = seam(reading()); // THE FALSIFIER: a rival titled "Persian Idioms" is the SAME question in different words, and a rule about shared vocabulary dropped it. This one asks nothing of a search that names no relation.
    const sameQuestion = await readWinningPattern(extractPageFacts([page("idioms.example", ["What a Persian idiom is", MADE, CARE], { title: "Persian Idioms", h1: "Persian Idioms" }), WINNERS[1]!, WINNERS[2]!, WINNERS[3]!]), ownedFacts(), tenant, { complete: idioms.complete, label: "funny persian phrases" });
    expect([sameQuestion?.winners, sameQuestion?.publishers[0]], "a search naming no relation asks nothing of a rival, so the differently worded page still teaches").toEqual([4, "idioms.example"]);
    const unlabelled = seam(reading({ commonHeadings: [], commonEntities: [], ownedGaps: [], uniqueNotCommon: [], disagreements: [], questionsAnswered: [] })); const nothingAsked = await readWinningPattern(mixed, ownedFacts(), tenant, { complete: unlabelled.complete });
    expect(nothingAsked?.winners, "and a case with no search on file compares no intents at all, exactly as before").toBe(4); });
});
describe("the one reading a case may buy", () => {
  it("says what four winning pages share, counts them itself, and names the sites without the reading ever seeing one", async () => {
    const s = seam(reading()); const out = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete });
    expect([out?.winners, out?.publishers, s.calls()]).toEqual([4, ["guide.example", "museum.example", "weavers.example", "atlas.example"], 1]);
    expect([out?.archetype, out?.commonHeadings[0]?.seenOn, out?.ownedGaps[0]?.gap, out?.fingerprint.length]).toEqual(["informational_guide", [0, 1, 2], "your page never explains how one is made", 16]);});
  it("comes off the pass's attempt budget, and an empty budget reads nothing", async () => { // AND IT IS PAID FOR OUT OF THE PASS'S OWN POOL. This was the one charged Decision call the attempt budget never saw, so a pass that reached a verdict spent one more call than its own receipt could account for. Spent BEFORE the call, and an exhausted pool buys nothing at all.
    const pool = { left: 1 }, s = seam(reading()); const first = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete, attempts: pool });
    const second = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete, attempts: pool, cacheImpl: memoryCache() });
    expect([first?.winners, Math.max(0, pool.left), second, s.calls()]).toEqual([4, 0, null, 1]); });
  it("throws the WHOLE reading away for a stranger, a quotation, or a claim no page it cited carries", async () => {
    const RUN = "a hand knotted floor covering woven in Iran"; // A pattern is an abstraction: it may cite only pages I showed it, it may not hand a line back word for word (in ANY field, including the four the run check never used to read), and it may not claim a section or a named thing is on a page that does not carry it. Eight words in a row IS that page's line.
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
      { commonEntities: [{ entity: "Isfahan", seenOn: [0] }] },];
    for (const one of bad) expect(await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading(one)).complete }), JSON.stringify(one)).toBeNull();
    const good = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading()).complete }); expect([good?.ownedGaps[0]?.seenOn, good?.commonHeadings[1]?.heading]).toEqual([[0, 1, 2], CARE]); }); // And an honest reading survives all of it, so every refusal above is about the defect and nothing else.
  it("never re-votes a shape the results already settled, and writes no gap about a page it was never shown", async () => {
    expect(await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading()).complete, pageType: "list" })).toBeNull(); // The reading says informational_guide; the results counted a list, and the deterministic count wins.
    const agreed = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading()).complete, pageType: "informational_guide" }); expect([agreed?.archetype, agreed?.winners]).toEqual(["informational_guide", 4]);
    expect(await readWinningPattern(facts(), null, "t_fixture", { complete: seam(reading()).complete })).toBeNull(); const quiet = await readWinningPattern(facts(), null, "t_fixture", { complete: seam(reading({ ownedGaps: [] })).complete }); // With no page of my own supplied, "your page has no care section" is about a page it never saw.
    expect([quiet?.ownedGaps, quiet?.winners]).toEqual([[], 4]); });
  /** THE ASK MAY NOT ORDER WHAT THE CHECK THROWS AWAY (production 07:30Z, 2026-09-06). A topic whose verdict is a new page has no page of this account's to supply, and the ask still ended "and what my own page is missing against them", so the reading was ordered to fill ownedGaps and the gap check threw the whole reading away for filling it, twice, on a topic holding seven read winners. The check stands; the ask now says what was supplied. */
  it.each(["host-one", "host-two"])("asks for gaps against my own page only where one was supplied, and a reading that fills them anyway still dies twice [%s]", async (tenant) => {
    const asked: string[] = []; const capture = (value: unknown): CompleteFn => async ({ user }) => { asked.push(user); return { value }; };
    const blind = await readWinningPattern(facts(), null, tenant, { complete: capture(reading({ ownedGaps: [] })) });
    const mine = await readWinningPattern(facts(), ownedFacts(), tenant, { complete: capture(reading()) });
    let refusals = 0; const doomed = await readWinningPattern(facts(), null, tenant, { complete: capture(reading()), refused: () => { refusals += 1; } });
    expect([asked[0]!.includes("my own page is missing"), asked[0]!.includes("ownedGaps must be an empty list"), asked[1]!.includes("my own page is missing"), blind?.winners, blind?.ownedGaps, mine?.ownedGaps.length, doomed, asked.length, refusals],
      "with no page of my own supplied the ask no longer orders gaps against one, and the reading of four winners stands; with one supplied the ask is unchanged; and a reading that lists gaps for a page nobody showed it is still thrown away, retried once and settled as refused")
      .toEqual([false, true, true, 4, [], 1, null, 4, 1]); });
  it("asks the same question once: winners that did not move buy no second reading", async () => {
    const s = seam(reading()); const cacheImpl = memoryCache(); const first = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete, cacheImpl });
    const again = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete, cacheImpl }); expect([first?.fingerprint, again?.fingerprint, s.calls()]).toEqual([first?.fingerprint, first?.fingerprint, 1]); });
  it("asks nothing at all under three publishers I could actually read", async () => {
    const s = seam(reading()); const twoRead = [...WINNERS.slice(0, 2), { url: "https://blocked.example/rugs", domain: "blocked.example", extract: null }];
    expect(await readWinningPattern(extractPageFacts(twoRead), ownedFacts(), "t_fixture", { complete: s.complete })).toBeNull();
    const twoSites = [WINNERS[0]!, page("guide.example", ["What a Persian rug is"]), WINNERS[1]!, page("museum.example", [CARE])]; // Four pages from two sites are two sites' house style, and this file never calls that a pattern.
    expect(await readWinningPattern(extractPageFacts(twoSites), ownedFacts(), "t_fixture", { complete: s.complete })).toBeNull();
    expect(s.calls()).toBe(0); // and not one cent was spent reaching either answer
  }); });
