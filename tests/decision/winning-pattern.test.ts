import { describe, it, expect, vi } from "vitest";
const projection = vi.hoisted(() => ({ cost: 0 }));
import { extractPageFacts, readWinningPattern } from "@/domains/decision/winning-pattern";
import type { WinningPatternRead } from "@/domains/decision/llm/schemas";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
import type { CacheImpl, LlmCallCacheEntry } from "@/domains/decision/llm/call-cache";
import { pageExtractFrom } from "@/domains/evidence/funnel/research-evidence";
const CARE = "Caring for a Persian rug";
const MADE = "How a Persian rug is made from wool and silk in the villages of Iran";
const page = (domain: string, headings: string[], over: Record<string, unknown> = {}) => ({
  url: `https://${domain}/persian-rugs`, domain, appearances: [{ kind: "serp_organic", query: "persian rug care", promptText: null, rank: 1, observedAt: "2026-07-20T00:00:00.000Z" }],
  extract: { title: "Persian rugs explained", h1: "Persian rugs explained", wordCount: 1400, headings,
    faqCount: 3, openingSample: "A Persian rug is a hand knotted floor covering woven in Iran by families who have done it for generations.",
    entityNames: ["Tabriz", "Kashan"], metaDescription: "Learn the craft and care of Persian rugs.", schemaTypes: ["Article"], internalLinkCount: 7, externalLinkCount: 2, fetchedAt: "2026-07-20T00:00:00.000Z", mainText: "Rug makers use wool and silk. Gentle washing protects the fibres; Tabriz workshops use local designs.", truncated: false, hasList: true, hasTable: false, ...over },});
const WINNERS = [
  page("guide.example", ["What a Persian rug is", MADE, CARE]),
  page("museum.example", ["What a Persian rug is", MADE, "Where they come from"]),
  page("weavers.example", [MADE, CARE, "How to tell a real one"]),
  page("atlas.example", ["What a Persian rug is", CARE, "Where they come from"]),];
const OWNED = page("mysite.example", ["Our rug collection"], { hasList: false, entityNames: [] });
const facts = () => extractPageFacts(WINNERS);
const ownedFacts = () => extractPageFacts([OWNED])[0]!;
const reading = (over: Partial<WinningPatternRead> = {}): WinningPatternRead => ({
  archetype: "informational_guide",
  commonHeadings: [{ heading: "how one is made, step by step", seenOn: [0, 1, 2] }, { heading: CARE, seenOn: [0, 2, 3] }],
  commonEntities: [{ entity: "Tabriz", seenOn: [0, 1, 2] }],
  questionsAnswered: ["What is a Persian rug?"],
  openingPattern: "Each of them answers the question plainly in its first sentence before it explains anything else.",
  ownedGaps: [{ gap: "your page never explains how one is made", seenOn: [0, 1, 2] }],
  disagreements: ["Some of them treat the region as the subject and others treat the craft as the subject."],
  uniqueNotCommon: [{ detail: "one of them lays the knot counts out in a table", seenOn: [1] }], ...over,});
const seam = (value: unknown): { complete: CompleteFn; calls: () => number } => { let calls = 0; return { calls: () => calls, complete: async () => { calls += 1; return { httpAttempts: 1, value }; } }; }; // A SEAM ANSWERS FOR THE TRANSPORT EXACTLY AS THE GATEWAY DOES (reviewer, 2026-09-06): it stamps `httpAttempts` 0 before the wire and 1 once it is touched, and a stand-in that reports nothing is saying no request left the process, which is now the one thing that hands an attempt back.
const memoryCache = (): CacheImpl => { const rows = new Map<string, LlmCallCacheEntry>(); return { read: async (t, k) => rows.get(`${t}|${k}`) ?? null, write: async (t, e) => void rows.set(`${t}|${e.key}`, e), recentTexts: async () => [] }; };
describe("the held content reaches the funded reader", () => {
  it("keeps body-only information, capture uncertainty and actual schema observations distinct", async () => {
    const held = extractPageFacts([page("a.example", [CARE], { entityNames: [], schemaTypes: ["FAQPage"] }), page("b.example", [CARE], { schemaTypes: [], truncated: true }), { url: "https://c.example/rugs", extract: pageExtractFrom({ title: "Persian rugs", h1: null, word_count: 900, schema_entity_names: ["Tabriz"] }) }]);
    let shown = "";
    await readWinningPattern(held, ownedFacts(), "fixture", { complete: async ({ user }) => { shown = user; return { httpAttempts: 1, value: reading({ commonHeadings: [], commonEntities: [], ownedGaps: [], uniqueNotCommon: [] }) }; } });
    expect(held.map((f) => [f.hasSchema, f.scope])).toEqual([[true, "complete"], [false, "partial"], [null, "unknown"]]);
    expect(shown, "one complete publisher plus two incomplete reads is unknown and never spends on a fake comparison").toBe("");
    const capture = (mainHtml: string, complete: boolean) => ({ version: 1 as const, mainHtml, complete, jsonLd: [] }), blocks = "<ul><li>Wool</li></ul><table><tr><td>Silk</td></tr></table>";
    for (const [sourceCapture, vocabulary, cards, expected] of [[capture(blocks, true), "WoolSilk", [], [true, true]], [capture(blocks, false), "WoolSilk", [], [true, true]], [capture("<p>Wool</p>", true), "Wool", [], [false, false]], [capture("<p>Wool</p>", false), "Wool", [], [null, null]], [capture(blocks, true), "Different capture", [], [null, null]], [undefined, "Wool", [], [null, null]], [undefined, "Wool", ["Wool"], [null, null]]] as const) { const f = extractPageFacts([{ url: "https://mysite.example/rugs", body: { title: "Rugs", h1: "Rugs", headings: [], passages: [vocabulary], vocabulary, completeness: sourceCapture?.complete === false ? "partial" : "complete", cardTexts: cards, entityNames: [], sourceCapture } as never }])[0]!; const rival = extractPageFacts([{ url: "https://rival.example/rugs", extract: pageExtractFrom({ title: "Rugs", h1: "Rugs", word_count: 0, body_text: vocabulary, content_capture: sourceCapture, card_texts: [...cards], table_count: 999 }) }])[0]!; expect([[f.hasList, f.hasTable], [rival.hasList, rival.hasTable]], JSON.stringify(sourceCapture)).toEqual([expected, expected]); let input = ""; await readWinningPattern(facts(), f, "fixture", { cacheImpl: memoryCache(), complete: async ({ user }) => { input = user; return { httpAttempts: 1, value: reading({ ownedGaps: [] }) }; } }); expect(input).toContain(`"hasList":${expected[0]},"hasTable":${expected[1]}`); }
    expect(await readWinningPattern(facts(), { ...ownedFacts(), scope: "partial" }, "fixture", { complete: seam(reading()).complete })).toBeNull();
  });
});
describe("structural consensus is evidence, not a formatting preference", () => {
  const listReading = () => reading({ archetype: "list", commonHeadings: [], commonEntities: [], ownedGaps: [{ gap: "name the rug-care steps", seenOn: [0, 1] }], openingPattern: "" });
  const listDelta = (pattern: Awaited<ReturnType<typeof readWinningPattern>>) => pattern?.brief?.deltas.find((d) => d.dimension === "list");
  it("records a list delta only for a settled list task, a strict distinct-publisher majority, and explicit complete-page absence", async () => {
    const winners = extractPageFacts([page("a.example", [CARE], { hasList: true }), page("b.example", [CARE], { hasList: true }), page("c.example", [CARE], { hasList: false })]);
    const good = await readWinningPattern(winners, ownedFacts(), "fixture", { complete: seam(listReading()).complete, label: "persian rug care", pageType: "list" });
    expect(listDelta(good)).toEqual(expect.objectContaining({ action: "add_structured_list", confidence: "validated_observation", sources: expect.arrayContaining([winners[0]!.sourceId, winners[1]!.sourceId]) }));
    const unsuitable = await readWinningPattern(winners, ownedFacts(), "fixture", { complete: seam(reading({ commonHeadings: [], commonEntities: [], ownedGaps: [], openingPattern: "" })).complete, label: "persian rug care", pageType: "informational_guide" });
    expect(listDelta(unsuitable), "a prose-guide task does not inherit list work merely because rivals happen to use lists").toBeUndefined();
    const unknownOwned = await readWinningPattern(winners, { ...ownedFacts(), scope: "partial", hasList: false }, "fixture", { complete: seam(listReading()).complete, label: "persian rug care", pageType: "list" });
    expect(unknownOwned, "a partial owned page cannot prove the list absent and therefore cannot carry owned gaps at all").toBeNull();
  });
  it("gives one publisher one vote and lets no partial capture vote", async () => {
    const duplicate = extractPageFacts([page("a.example", [CARE], { hasList: true }), page("www.a.example", [CARE], { hasList: true }), page("b.example", [CARE], { hasList: false }), page("c.example", [CARE], { hasList: false })]);
    const once = await readWinningPattern(duplicate, ownedFacts(), "fixture", { complete: seam(listReading()).complete, label: "persian rug care", pageType: "list" });
    expect([once?.winners, listDelta(once)], "two addresses from one publisher remain one vote").toEqual([3, undefined]);
    const partial = extractPageFacts([page("a.example", [CARE], { hasList: true }), page("b.example", [CARE], { hasList: false }), page("c.example", [CARE], { hasList: false }), page("d.example", [CARE], { hasList: true, truncated: true }), page("e.example", [CARE], { hasList: true, truncated: true })]);
    const known = await readWinningPattern(partial, ownedFacts(), "fixture", { complete: seam(listReading()).complete, label: "persian rug care", pageType: "list" });
    expect([known?.winners, listDelta(known)], "partial captures never enter the denominator or the supporters").toEqual([3, undefined]);
  });
});
describe("a ranked page with a different intent teaches nothing", () => {
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
  it("comes off the pass's attempt budget, and an empty budget reads nothing", async () => { // AND IT IS PAID FOR OUT OF THE PASS'S OWN POOL. This was the one charged Decision call the attempt budget never saw, so a pass that reached a verdict spent one more call than its own receipt could account for. Spent BEFORE the call, and an exhausted pool buys nothing at all.
    const pool = { left: 1 }, s = seam(reading()); const first = await readWinningPattern(facts(), { ...ownedFacts(), mainText: "Gentle washing protects rug fibres. ".repeat(1400) }, "t_fixture", { complete: async (a) => (projection.cost = a.spend.estimatedUsd, s.complete(a)), attempts: pool });
    expect(projection.cost).toBeGreaterThan(0.02);
    const second = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: s.complete, attempts: pool, cacheImpl: memoryCache() });
    expect([first?.winners, Math.max(0, pool.left), second, s.calls()]).toEqual([4, 0, null, 1]); });
  it("throws the WHOLE reading away for a stranger, a quotation, or a claim no page it cited carries", async () => {
    const RUN = "a hand knotted floor covering woven in Iran"; // A pattern is an abstraction: it may cite only pages I showed it, it may not hand a line back word for word (in ANY field, including the four the run check never used to read), and it may not claim a section or a named thing is on a page that does not carry it. Eight words in a row IS that page's line.
    const swapped = MADE.replace("villages", "towns"); // one word swapped is still their line, and 65 chars
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
    const good = await readWinningPattern(extractPageFacts([...WINNERS, page("archive.example", [MADE, CARE])]), ownedFacts(), "t_fixture", { complete: seam(reading()).complete, label: "persian rug care" }); const b = good?.brief, first = b?.sources[0], delta = b?.deltas.find((d) => d.dimension === "owned_delta"), question = b?.deltas.find((d) => d.dimension === "questions"), opening = b?.deltas.find((d) => d.dimension === "opening"); expect([good?.publishers.length, b?.query, first && [first.url, first.passage, first.title, first.meta, first.h1, first.opening, first.sections.length, first.entities?.[0], first.list, first.table, first.schema?.[0], first.links.internal, first.links.external, first.citations[0]?.query, first.freshness], delta && [delta.action, delta.sources.length, delta.confidence], b?.owed]).toEqual([5, "persian rug care", ["https://guide.example/persian-rugs", "A Persian rug is a hand knotted floor covering woven in Iran by families who have done it for generations.", "Persian rugs explained", "Learn the craft and care of Persian rugs.", "Persian rugs explained", "A Persian rug is a hand knotted floor covering woven in Iran by families who have done it for generations.", 3, "Tabriz", true, false, "Article", 7, 2, "persian rug care", "2026-07-20T00:00:00.000Z"], ["resolve_reader_delta", 3, "bounded_reader"], expect.arrayContaining(["title", "meta", "h1", "list", "table", "schema", "links"])]); expect([question?.sources.length, opening?.sources.length, delta?.sources.every((id) => b?.sources.some((source) => source.sourceId === id && !!source.url && !!source.publisher && !!source.passage))]).toEqual([3, 5, true]); }); // And an honest reading survives all of it, so every refusal above is about the defect and nothing else.
  it("never re-votes a shape the results already settled, and writes no gap about a page it was never shown", async () => {
    expect(await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading()).complete, pageType: "list" })).toBeNull(); // The reading says informational_guide; the results counted a list, and the deterministic count wins.
    const agreed = await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(reading()).complete, pageType: "informational_guide" }); expect([agreed?.archetype, agreed?.winners]).toEqual(["informational_guide", 4]);
    expect(await readWinningPattern(facts(), null, "t_fixture", { complete: seam(reading()).complete })).toBeNull(); const quiet = await readWinningPattern(facts(), null, "t_fixture", { complete: seam(reading({ ownedGaps: [] })).complete }); // With no page of my own supplied, "your page has no care section" is about a page it never saw.
    expect([quiet?.ownedGaps, quiet?.winners]).toEqual([[], 4]); });
  it("asks nothing at all under three publishers I could actually read", async () => {
    const s = seam(reading()); const twoRead = [...WINNERS.slice(0, 2), { url: "https://blocked.example/rugs", domain: "blocked.example", extract: null }];
    expect(await readWinningPattern(extractPageFacts(twoRead), ownedFacts(), "t_fixture", { complete: s.complete })).toBeNull();
    const twoSites = [WINNERS[0]!, page("guide.example", ["What a Persian rug is"]), WINNERS[1]!, page("museum.example", [CARE])]; // Four pages from two sites are two sites' house style, and this file never calls that a pattern.
    expect(await readWinningPattern(extractPageFacts(twoSites), ownedFacts(), "t_fixture", { complete: s.complete })).toBeNull();
    expect(s.calls()).toBe(0); // and not one cent was spent reaching either answer
  });
  it("accepts a strict majority only after three distinct complete publishers are readable", async () => {
    const three = extractPageFacts([WINNERS[0]!, WINNERS[2]!, WINNERS[1]!]), majority = reading({ commonHeadings: [{ heading: CARE, seenOn: [0, 1] }], commonEntities: [], ownedGaps: [], uniqueNotCommon: [] }), accepted = await readWinningPattern(three, ownedFacts(), "t_fixture", { complete: seam(majority).complete });
    expect([accepted?.winners, accepted?.commonHeadings[0]?.seenOn]).toEqual([3, [0, 1]]);
    expect(await readWinningPattern(facts(), ownedFacts(), "t_fixture", { complete: seam(majority).complete }), "two of four publishers is not a strict majority and is never called common").toBeNull();
  });
  it("does not let unread evidence occupy a publisher or comparison seat", async () => {
    const unread = { ...page("a.example", [CARE]), extract: null };
    const partial = page("b.example", [CARE], { truncated: true });
    const completeA = page("a.example", [CARE]);
    const completeC = page("c.example", [CARE]);
    const completeD = page("d.example", [CARE]);
    const reader = seam(reading({ commonHeadings: [{ heading: CARE, seenOn: [0, 1] }], commonEntities: [], ownedGaps: [], uniqueNotCommon: [] }));

    const result = await readWinningPattern(
      extractPageFacts([unread, partial, completeA, completeC, completeD]),
      ownedFacts(),
      "t_fixture",
      { complete: reader.complete },
    );

    expect(reader.calls()).toBe(1);
    expect(result?.publishers).toEqual(["a.example", "c.example", "d.example"]);
  }); });
