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
/** WHAT A PAGE PROMISES, WHAT IT STILL LACKS AND WHAT IT SELLS (landed 2026-09-05 with three schema members, three prompt lines, three columns and no counterexample behind any of them; reviewer, round 2.5). Each pin below is the behaviour a consumer depends on, on two synthetic tenants. */
describe("the three things a reading says about a page, and what each one changes", () => {
  it.each(["tenant-one", "tenant-two"])("reads a page once per fingerprint, and re-reads a row that predates the fields instead of serving it as read for ever [%s]", async (tenant) => {
    budget.allowed = true; const db = store(), s = seam(READING);
    const first = await pageJobFor(tenant, extract("/tabriz"), { complete: s.complete, store: db });
    expect([first.reason, s.calls()], "the first pass buys the reading").toEqual(["read", 1]);
    expect([(await pageJobFor(tenant, extract("/tabriz"), { complete: s.complete, store: db })).reason, s.calls()], "and the same page under the same fingerprint is served free, for ever, without a second call").toEqual(["read", 1]);
    const held = [...db.rows.values()][0]!; db.rows.set([...db.rows.keys()][0]!, { ...held, promise: "", missing: "" }); // the shape of every row this account already holds: the fingerprint is the hash of the EXTRACT, so adding a field to what a reading SAYS does not move it
    const predates = await pageJobFor(tenant, extract("/tabriz"), { store: db, buy: false });
    expect([predates.reason, predates.job?.job], "a row written before those fields existed still describes the page and is served, and it is STALE, so the ordinary rotation refreshes it; served as read it would answer with them empty for ever and nothing would ever say so").toEqual(["stale", READING.job]);
    const s2 = seam(READING); const refreshed = await pageJobFor(tenant, extract("/tabriz"), { complete: s2.complete, store: db });
    expect([refreshed.reason, refreshed.job?.promise, refreshed.job?.missing, s2.calls()], "and one pass that can afford a reading fills them in, once").toEqual(["read", READING.promise, READING.missing, 1]); });

  it.each(["tenant-one", "tenant-two"])("hands the writer the capability a reader still cannot get here and the things the page sells, and asks for both to be left standing [%s]", async (tenant) => {
    vi.resetModules(); const url = "https://mysite.example/hand-loom", asked: string[] = [];
    const body = { url, title: "The Hand Loom", h1: "The Hand Loom", metaDescription: null, vocabulary: "", headings: ["What a hand loom is"], completeness: "complete" as const,
      passages: ["A hand loom is a frame a weaver works by hand rather than by machine.", "Every piece in the collection ships within a week."] };
    const reading = { job: "j", pageType: "product" as const, audience: "a", topics: ["hand loom", "wool frame", "weaving"], commercial: true,
      promise: "a hand loom to buy and the story behind it", missing: "what a buyer should look at to tell one loom from another", sells: ["Add to basket", "Request a shipping quote"] };
    vi.doMock("@/domains/decision/producers/page-understanding", async (orig) => ({ ...(await orig<Record<string, unknown>>()), pageStore: { read: async () => new Map([[canonicalUrlKey(url), reading]]), save: async () => true, cursor: async () => null } }));
    vi.doMock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadOwnedPageBodies: async () => new Map([[canonicalUrlKey(url), body]]) }));
    const { pageHashOf } = await import("@/domains/evidence/pages/fact-check-run"), { rulesVersionFor } = await import("@/domains/evidence/pages/fact-checks");
    const ANSWER = "A hand loom is judged by the evenness of its beater and the reach of its shafts.", SUBJECT = "how one hand loom differs from another";
    const source = { page: "/hand-loom", statementKey: SUBJECT, subject: SUBJECT, current: "", proposed: ANSWER, literal: null, usage: null, sources: [{ url: "https://reference.example/looms", kind: "encyclopedia", says: ANSWER }], agreement: "single_source", confidence: "likely", verdict: "page_correct", alsoAt: [], note: "", pageContentHash: pageHashOf([body.title, body.h1, ...body.headings, ...body.passages].join("\n")), pageLocator: "missing", sourceReadAt: "2026-09-01T00:00:00.000Z", state: "checked", rulesVersion: rulesVersionFor({ subject: SUBJECT, current: "" }), evidenceBasis: null, checkedAt: "2026-09-01T00:00:00.000Z" };
    vi.doMock("@/domains/evidence/pages/fact-checks", async (orig) => ({ ...(await orig<Record<string, unknown>>()), readFactChecks: async () => [source] }));
    const { applyDraftedCopy } = await import("@/domains/decision/drafted-copy"), { DRAFT_BUDGET } = await import("@/domains/decision/draft-budget");
    const card = { id: `${tenant}::/hand-loom::existing_edit::missing_answer`, tenantId: tenant, kind: "existing_edit", pagePath: "/hand-loom", pageUrl: url, pageLabel: "The Hand Loom", primaryQuery: "hand loom", opportunityType: "Capture clicks", changeFamily: "section", status: "needs_review", researchOnly: true,
      recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "" }, whyItMatters: "w", estimatedEffortMinutes: 5, riskLevel: "low", confidence: "medium", limitations: [], evidence: { query: "hand loom", hints: [], evidenceRefCount: 1 }, impactScore: 9, upsidePerMonth: null, publish: "manual", createdAt: "2026-07-25T00:00:00.000Z",
      causeFinding: { cause: "ai_citation_gap", action: "section", evidenceKeys: ["ai-citations"], competingExplanations: [], notConsidered: [], falsifier: "f", explanation: "e", payload: { cause: "ai_citation_gap", engine: "chatgpt", promptText: "q", missing: "how one hand loom differs from another", aeoKind: "missing_information" } } };
    const snapshot = { ownedPages: [{ url, content: { wordCount: 300, title: body.title, h1: body.h1, outline: body.headings }, search: null }], research: {}, sources: [], scope: { tenantId: tenant, site: "mysite.example" } };
    await applyDraftedCopy([card] as never, { tenantId: tenant, snapshot: snapshot as never, now: new Date("2026-09-05T00:00:00.000Z"), complete: (async ({ user }: { user: string }) => (asked.push(user), { error: "no reading", retryable: false })) as never,
      budget: DRAFT_BUDGET.plan({ jobs: [{ key: DRAFT_BUDGET.keyOf(card as never), family: "editor", impact: 9, calls: DRAFT_BUDGET.DELIVERABLE_CALLS }], candidates: 1, calls: 30 }) } as never);
    const prompt = asked.join(" ");
    expect([asked.length > 0, prompt.includes(reading.missing), prompt.includes("Add to basket; Request a shipping quote")], "the writer is told the shortfall a reading of this page named, and the conversion actions its copy must leave standing").toEqual([true, true, true]);
    expect(prompt.includes("This page sells, and these are the things it sells and the actions it asks for, every one of which must still be there afterwards"), "and the preservation rule names them out loud rather than leaving the writer to guess what a commercial page owes").toBe(true);
    expect([prompt.includes(`${SUBJECT}: ${ANSWER}`), prompt.includes(`${ANSWER} This is about "${SUBJECT}".`), prompt.includes("Judged as an answer this page does not carry, which one publisher that was read for it may stand behind, rated likely")], "and the checked statement reaches the writer under its own id AS THE SENTENCE IT IS, with the search it answers behind that sentence rather than standing in front of it as a label, still saying which bar admitted it, so a card that stands on an addition can be told from one that replaces the page's own words").toEqual([false, true, true]);
    vi.doUnmock("@/domains/decision/producers/page-understanding"); vi.doUnmock("@/domains/evidence/pages/owned-context"); vi.doUnmock("@/domains/evidence/pages/fact-checks"); vi.resetModules(); });

  it.each(["tenant-one", "tenant-two"])("reads a directory promise with no entries off the page's own stored promise, where its title alone says nothing [%s]", async (tenant) => {
    const { demandOf } = await import("@/domains/decision/drafted-copy"), { substantiveGapOf } = await import("@/domains/decision/diagnosis");
    const url = "https://mysite.example/village-poets", rows = [{ query: "list of village poets", impressions: 900 }, { query: "who are the village poets", impressions: 400 }];
    const page = { url, content: { title: "Voices of a Thousand Years", h1: "Voices of a Thousand Years", outline: [] }, search: { topQueries: rows.map((r) => ({ ...r, clicks: 0, position: 9 })) } }; // a title that names the subject nowhere, which is why the reading is the only thing that can say what this page promises
    const body = { url, title: "Voices of a Thousand Years", h1: "Voices of a Thousand Years", metaDescription: null, vocabulary: "", headings: [], completeness: "complete" as const,
      passages: ["Writing has shaped this region for a thousand years and is studied everywhere today."] }; // a page that announces a roster and delivers a paragraph about the subject instead
    const reading = { promise: "a list of the village poets who shaped the writing of the region", missing: "the poets themselves, by name", sells: [] };
    const withReading = substantiveGapOf({ primaryQuery: rows[0]!.query } as never, (demandOf as never as (...a: unknown[]) => unknown)(page, body, [], null, tenant, undefined, reading) as never);
    const titleOnly = substantiveGapOf({ primaryQuery: rows[0]!.query } as never, (demandOf as never as (...a: unknown[]) => unknown)(page, body, [], null, tenant, undefined, null) as never);
    expect([withReading?.kind, withReading?.owed ?? null], "the promise a person wrote about this page says outright that it lists the poets, and no passage delivers one, which is the false promise its own words admit to").toEqual(["false_page_promise", null]);
    expect(titleOnly?.kind, "read off its title alone the same page announces nothing, so it buys a source and never learns it had already promised the thing it lacks").toBe("missing_answer"); });
});
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

/** THE FAMILY IS THE WHOLE FAMILY (measured, 2026-09-05). A rule whose verdict depends on a page's template siblings was asked of whichever siblings the caller happened to be holding, so /california-persian-cities/beverly-hills was promoted in the hosted pass of 05:03:57Z and its sibling refused by the same rule one second later. The window is not evidence; the family is. */
describe("a verdict that depends on the template siblings is one verdict, whatever order they arrive in", () => {
  const SHELL = "Everything worth knowing about this one is gathered here, with the notes and the details that go with it. The list below is kept up to date by hand, and every entry on it carries the same short summary as the entry above. Nothing on this list is written for one entry more than for another.";
  const body = (t: string, slug: string, tail: string) => ({ url: `https://${t}.example/group/${slug}`, title: `Entry ${slug}`, h1: `Entry ${slug}`, metaDescription: null, headings: [`Entry ${slug}`], passages: [SHELL, tail], openingSample: null, vocabulary: "", cardTexts: [], faqs: [], entityNames: [], internalLinks: [], fetchedAt: null, completeness: "complete" as const, contentHash: null, heldNote: "" });
  const other = (t: string, slug: string) => ({ ...body(t, slug, ""), passages: [`A page of ${slug} sharing no sentence with any of the others and standing on its own account.`] });
  it.each(["tenant-one", "tenant-two"])("reads every sibling that shares the shell, so twelve of them in one order and in the reverse give one answer [%s]", async (tenant) => {
    const { staleCopyReasons } = await import("@/domains/decision/drafted-copy");
    const self = body(tenant, "one", "The tail mentions a gantry and a hoist in lower case."), kin = [...Array(4)].map((_, i) => body(tenant, `k${i}`, `The tail of k${i} mentions a winch and a pulley in lower case.`)), strangers = [...Array(8)].map((_, i) => other(tenant, `s${i}`));
    const row = { id: `${tenant}::/group/one::existing_edit::missing_description`, tenantId: tenant, kind: "existing_edit" as const, pagePath: "/group/one", pageUrl: self.url, pageLabel: "Entry one", primaryQuery: "entry one", opportunityType: "A search description of this page's own", changeFamily: "meta", status: "needs_review" as const, researchOnly: false, whyItMatters: "w", estimatedEffortMinutes: 1, riskLevel: "low" as const, confidence: "medium" as const, limitations: [], evidence: { query: "entry one", hints: [], evidenceRefCount: 1 }, impactScore: 1, upsidePerMonth: null, publish: "manual" as const, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z", operatorSteps: [], claims: [], supportFacts: [], recommendedChange: { kind: "existing_edit" as const, field: "meta" as const, before: "Old line.", after: "A gantry and a hoist sit alongside the rest of the entries on this one.", where: null } };
    const held = { title: "Entry one", h1: "Entry one", metaDescription: "Old line.", outline: [] }, SPUN = "more examples of the subject every sibling names";
    const ask = (order: Array<ReturnType<typeof body>>): string[] => staleCopyReasons(row as never, new Map(order.map((b) => [b.url, b])) as never, [], held as never);
    const all = [self, ...kin, ...strangers];
    expect(ask([...all]), "the same family, handed over in the reverse order, is the same family").toEqual(ask([...all].reverse()));
    expect(ask([...all]).some((r) => r.includes(SPUN)), "and with the whole family read, the line whose only specifics stand in the family slot is refused by name").toBe(true);
    const inventory = all.map((b) => b.url), asked = (order: Array<ReturnType<typeof body>>): string[] => staleCopyReasons(row as never, new Map(order.map((b) => [b.url, b])) as never, [], held as never, false, [], inventory);
    const NOT_READ = `its template siblings were not all read this pass, 3 of ${all.length - 1}, so it is not offered until they are`;
    expect([asked([...all]).some((r) => r.includes(SPUN)), asked([...all]).some((r) => r.includes("were not all read")), asked([self, ...kin.slice(0, 3)]).includes(NOT_READ), asked([self, ...kin.slice(0, 3)]).some((r) => r.includes(SPUN))],
      "handed the account's own page list, a whole family answers and says nothing about being unread, and a family three of twelve read says so and rules on nothing: one verdict or none, never two")
      .toEqual([true, false, true, false]);
    const UNREAD_SELF = "its own page was not read this pass, so it is not offered until it is"; /* A PAGE THE READ LEFT OUT IS NOT PASSED EITHER (reviewer, 2026-09-05): the body loader returned no row for three pages a capped read never reached, the rule fell silent on a missing self, and a refused description was promoted. */
    expect([asked([...kin, ...strangers]).includes(UNREAD_SELF), asked([...kin, ...strangers]).some((r) => r.includes(SPUN)), asked([]).includes(UNREAD_SELF)],
      "with other pages in hand and this one absent, the rule holds the row as unread and rules on nothing; with no page read at all it says nothing, because a read that never happened is not this page's absence")
      .toEqual([true, false, false]); });
});
