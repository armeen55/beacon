/** THE PAGE JOB: one DURABLE sentence saying what a page is for, why a missing one is missing, how the whole site gets reached over passes, and the fit checks that read it. Each pin states what a job may change about a decision and what a MISSING one  may never change: nothing a caller cannot name a reason for. Fixtures only, zero network, zero database. */
import { describe, it, expect, vi } from "vitest";
const budget = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ recordSpend: async () => {},
  checkBudget: async () => (budget.allowed ? { allowed: true, remaining: 10 } : { allowed: false, reason: "cap reached" }) }));
import { linkFit, loadPageJobs, pageJobFor, sectionFit, type OwnedPageJob } from "@/domains/decision/producers/page-job";
import type { PageUnderstanding } from "@/domains/decision/producers/page-understanding";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import type { CompleteFn } from "@/domains/decision/llm/structured-drafter";
const extract = (path: string, h1 = "Tabriz, Iran") => ({ url: `https://mysite.example${path}`, title: "Tabriz, Iran: what to know before you go", h1, headings: ["Tabriz population", "Tabriz climate", "Things to see in Tabriz"], wordCount: 737 });
const READING = { job: "This page tells a traveller what the city of Tabriz is like before they visit.", pageType: "city" as const, audience: "travellers planning a trip to Iran", topics: ["Tabriz", "iran travel", "city guide"], commercial: false, promise: "a guide to what the city of Tabriz is like", missing: "what a visitor should do on a first day there", sells: [] };
/** A completion seam that answers with one fixed reading and counts how many times it actually ran. */
const seam = (value: unknown): { complete: CompleteFn; calls: () => number } => { let calls = 0; return { calls: () => calls, complete: async () => { calls += 1; return { value }; } }; };
/** The durable store, in memory. `remember: false` is a site whose readings never land, which forces every pass to buy afresh and makes the rotation visible. */
const store = (remember = true) => { const rows = new Map<string, PageUnderstanding>(); let at: string | null = null;
  return { rows, at: () => at, read: async (_t: string, urls: readonly string[]) => new Map([...rows].filter(([k]) => urls.some((u) => canonicalUrlKey(u) === k))),
    save: async (_t: string, r: PageUnderstanding) => { if (remember) rows.set(canonicalUrlKey(r.url), r); return true; },
    cursor: async (_t: string, next?: string | null) => (next === undefined ? at : (at = next ? canonicalUrlKey(next) : null)) }; };
const job = (over: Partial<OwnedPageJob> = {}): OwnedPageJob => ({ ...READING, topics: ["tabriz", "iran travel", "city guide"], url: "https://mysite.example/tabriz", ...over });
/** Six readings of one account, the shape of a site about one country: "persian", "iranian" and "iran" are on most of its pages, which is why sharing one of them with a search proves nothing. */
const page = (url: string, pageType: OwnedPageJob["pageType"], job: string, audience: string, topics: string[]): OwnedPageJob => ({ url: `https://mysite.example/${url}`, pageType, job, audience, topics, commercial: pageType === "product", promise: job, missing: `what ${topics[0]} costs`, sells: pageType === "product" ? ["add to basket"] : [] });
const PAINTERS = page("painters", "guide", "Introduces the Persian painters of Iran and their work.", "art lovers", ["persian painter", "iranian art", "painting"]);
const POETS = page("poets", "list", "Lists the Persian poets of Iran who shaped Iranian writing.", "readers", ["persian poet", "poetry", "literature"]);
const RUGS = page("rugs", "product", "Sells hand woven Persian rugs made in Iran.", "rug buyers", ["persian rug", "carpet", "weaving"]);
const SCIENCE = page("science", "guide", "Explains what Iranian scientists have contributed to modern technology.", "students", ["iranian science", "technology", "research"]);
const POPULATION = page("population", "guide", "Reports how many people live in each city of Iran.", "researchers", ["iran population", "demographics", "city"]);
const CORPUS: ReadonlyMap<string, OwnedPageJob> = new Map([PAINTERS, POETS, RUGS, SCIENCE, POPULATION,
  page("music", "guide", "Explains Persian music and the instruments Iranian players use.", "listeners", ["persian music", "instrument", "musician"])].map((j) => [canonicalUrlKey(j.url), j]));
describe("what one page is for, held durably", () => {
  it("reads a page once, keeps the reading, and serves it free afterwards even when the cache is gone", async () => {
    budget.allowed = true; const s = seam(READING), db = store();
    const first = await pageJobFor("t_fixture", extract("/tabriz"), { complete: s.complete, store: db }); expect([first.reason, first.job?.pageType, first.job?.topics, s.calls(), db.rows.size]).toEqual(["read", "city", ["tabriz", "iran travel", "city guide"], 1, 1]);
    const again = await pageJobFor("t_fixture", extract("/tabriz"), { complete: s.complete, store: db }); // the row IS the answer: nothing is bought twice
    expect([again.reason, again.job?.job, s.calls()]).toEqual(["read", READING.job, 1]);
    const changed = await pageJobFor("t_fixture", extract("/tabriz", "Tabriz, Iran: 2026 update"), { store: db, buy: false }); expect([changed.reason, changed.job?.job]).toEqual(["stale", READING.job]);}); // A page that CHANGED under its reading is still answered, labelled stale, until a pass can afford a fresh one.
  it("says WHY a page has no job instead of answering null five different ways", async () => {
    budget.allowed = true; const db = store();
    expect((await pageJobFor("t_fixture", { url: "https://mysite.example/unread" }, { store: db })).reason).toBe("unreadable"); expect((await pageJobFor("t_fixture", extract("/a"), { store: db })).reason).toBe("not_asked");
    expect((await pageJobFor("t_fixture", extract("/b"), { complete: seam({ ...READING, topics: ["tabriz", "iran"] }).complete, store: db })).reason).toBe("refused"); // Two subject words is below the schema's floor of three, so the whole reading is refused rather than half kept.
    budget.allowed = false; expect((await pageJobFor("t_fixture", extract("/c"), { complete: seam(READING).complete, store: db })).reason).toBe("unaffordable"); budget.allowed = true;
    expect([(await pageJobFor("t_fixture", extract("/d"), { store: db, buy: false })).reason, db.rows.size]).toEqual(["unaffordable", 0]);});
  it("buys what one pass is allowed, then resumes the rotation where it stopped and wraps around the site", async () => {
    budget.allowed = true; const db = store(false); const six = Array.from({ length: 6 }, (_, i) => extract(`/page-${i}`));
    const pass = async (): Promise<[number, string | null]> => { const s = seam(READING); await loadPageJobs("t_fixture", six, { complete: s.complete, store: db, maxNewReads: 2, priority: 0 }); return [s.calls(), db.at()]; };
    const [bought, first] = await pass(), [, second] = await pass(), [, third] = await pass();
    expect([bought, first, second, third]).toEqual([2, "mysite.example/page-2", "mysite.example/page-4", "mysite.example/page-0"]);});}); // Two readings a pass, starting at the page after the last one paid for. Six pages, three passes, back to the beginning.
describe("what a job changes, and what a missing one may never change", () => {
  it("keeps a section off a page that is not for it and off a rail an essay never goes on", () => {
    const CITY = job({ pageType: "city", topics: ["tabriz population", "famous landmarks and attractions"] }), TIMELINE = page("timeline", "guide", "An interactive visual timeline of the famous people and events of Iran for readers.", "history readers", ["visual timeline", "dynasties", "wars and invasions"]); // THE SHAPES, none named in the code: one word this whole site carries is not a tie, a shop rail is no place for an essay, and NO VERDICT WITHOUT A READING (what "unknown" licenses is the caller's decision, made on the typed reason). A PAGE ABOUT ONE THING IS NOT THE ANSWER ABOUT EVERYTHING AROUND IT either (a city page covers landmarks, so overlap alone handed it a whole country's), and a page answers for its SUBJECTS, never the prose around them, so a history timeline is not a famous-people page.
    expect([sectionFit(POPULATION, ["population", "demographic"], CORPUS), sectionFit(job(), ["tabriz", "travel"]), sectionFit(PAINTERS, ["persian", "musician"], CORPUS),
      sectionFit(POETS, ["persian", "book"], CORPUS), sectionFit(RUGS, ["iran", "travel", "guide"], CORPUS), sectionFit(SCIENCE, ["iranian", "culture", "tradition"], CORPUS),
      sectionFit(POPULATION, ["beautiful", "city", "iran"], CORPUS), sectionFit(null, ["tabriz"]), sectionFit(undefined, ["tabriz"]),
      sectionFit(CITY, ["landmark"], CORPUS, "what are the most famous landmarks in iran"), sectionFit(CITY, ["landmark"], CORPUS, "what are the most famous landmarks in tabriz"),
      sectionFit(TIMELINE, ["famous", "people", "history"], CORPUS, "who are some famous iranian people in history")])
      .toEqual(["fits", "fits", "off_topic", "off_topic", "wrong_type", "off_topic", "off_topic", "unknown", "unknown", "wrong_type", "fits", "wrong_type"]); // TIMELINE reads wrong_type now: a GUIDE is scoped to its own name like a city is (the /karaj travel guide walked past the city rule on its model-assigned type), and this fixture's bare "/timeline" address shares no word with the ask. Refused for scope instead of coverage; still never minted.
    const KARAJ = page("karaj", "guide", "Provide travelers with essential information about Karaj's history, tourist attractions, climate, population, things to do, outdoor activities, festivals, and FAQs before they go.", "travelers", ["karaj history", "population", "climate", "tourist attractions and landmarks", "things to do"]); // THE LIVE 2026-08-16 CASE, exactly as stored: /karaj typed "guide" with a landmarks topic may not answer a country-wide landmarks question, and still answers one that names Karaj.
    expect([sectionFit(KARAJ, ["landmark"], CORPUS, "What are the most famous landmarks in Iran?"),
      sectionFit(KARAJ, ["landmark"], CORPUS, "what are the most famous landmarks in karaj")]).toEqual(["wrong_type", "fits"]); });
  it("lets what was asked for decide which shape of page can answer it, and never fires a roster on a bare word", () => {
    const RUGW = ["persian", "rug", "carpet"];
    expect([sectionFit(RUGS, RUGW, CORPUS, "where can I buy a persian rug"), sectionFit(RUGS, RUGW, CORPUS)]).toEqual(["fits", "wrong_type"]); // A REQUEST TO BUY, LANDING ON THE PAGE THAT SELLS IT, FITS: the rail rule ran before the request was read at all, so the one shape a shopping ask can be answered by was unreachable. Asked nothing, the rail rule stands.
    expect([sectionFit(POETS, ["persian", "poet"], CORPUS, "list of persian poets"), // A DIRECTORY ASK STILL NEEDS A HUB OR A LIST, and a guide is still not one however well its subjects match.
      sectionFit(PAINTERS, ["persian", "painter"], CORPUS, "reliable sources for learning about persian painters")]).toEqual(["fits", "wrong_type"]);
    expect([sectionFit(SCIENCE, ["iranian", "science"], CORPUS, "all I want to know about iranian science"), // AND AN ORDINARY QUESTION IS NOT A ROSTER for carrying "all" or "every": those sent plain guide questions to the hub-and-list gate, which refused them everywhere.
      sectionFit(SCIENCE, ["iranian", "science"], CORPUS, "should I read about iranian science every day")]).toEqual(["fits", "fits"]); });
  it("keeps a body link off a page the words do not belong to, and off a dictionary page from a stranger", () => {
    const target = job({ url: "https://mysite.example/persian-words", pageType: "translation", topics: ["farsi words", "persian phrases"], job: "Gives the English meaning of common Farsi words.", audience: "people learning Farsi" });
    const related = job({ url: "https://mysite.example/farsi", topics: ["farsi words", "learning persian"], job: "Explains how to start learning Farsi.", audience: "beginners" }), stranger = job({ url: "https://mysite.example/tabriz" });
    expect([linkFit(target, related, ["farsi", "word"]), linkFit(target, stranger, ["farsi", "word"]), linkFit(job(), stranger, ["saffron"])]).toEqual(["fits", "wrong_type", "off_topic"]);
    const horse = job({ url: "https://mysite.example/caspian-horse", topics: ["caspian horse", "horse breed"], job: "Describes the Caspian horse breed of Iran.", audience: "horse lovers" }); // THE CASPIAN HORSE CLASS: the horse page covers the anchor perfectly, and the names page sharing not one of its subjects still may not link to it. A link is a claim two pages share a subject, read BOTH ways.
    const names = job({ url: "https://mysite.example/persian-male-names", topics: ["persian male names", "baby names"], job: "Lists Persian male first names with meanings.", audience: "parents" });
    expect(linkFit(horse, names, ["caspian", "horse"])).toBe("off_topic"); expect([linkFit(null, stranger, ["farsi"]), linkFit(target, null, ["farsi"])]).toEqual(["unknown", "unknown"]);});});
