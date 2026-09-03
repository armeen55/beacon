import { describe, expect, it, vi, beforeEach } from "vitest";
/** THE STORE IS THE CURSOR, so these tests stand it up rather than pretending it away: the inventory and coverage written by one call are what the next call resumes from, exactly as a second lease would. */
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], owed: [] as Record<string, unknown>[], superseded: [] as string[],
  reopened: [] as string[], cov: null as Record<string, unknown> | null, writeFails: false }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>(); return { ...real,
    recordFactChecks: async (_t: string, _p: string, checks: Record<string, unknown>[]) => {
      if (db.writeFails) return 0; for (const c of checks) if (c.state === "superseded") db.superseded.push(String(c.subject)); db.rows.push(...checks); return checks.length; },
    recordOwedClaims: async (_t: string, _p: string, claims: Record<string, unknown>[]) => (db.owed.push(...claims), claims.length),
    reopenObsoleteChecks: async (_t: string, _p: string, stale: { statementKey: string }[]) => (db.reopened.push(...stale.map((x) => x.statementKey)), stale.length),
    supersedeStaleFacts: async (_t: string, _p: string, _h: string, present: (c: string) => boolean) => {
      const gone = db.rows.filter((r) => !present(String(r.current))); db.superseded.push(...gone.map((g) => String(g.subject))); return gone.length; },};});
import { runFactCheckUnit, runFactCheckPass, pageHashOf, claimTypeOf, sourceQueryFor, claimIdentity, tokenFingerprintOf, ATTEMPTS_PER_PASS, EXTRACT_CHUNK } from "@/domains/evidence/pages/fact-check-run";
import { rulesVersionFor, VERIFICATION_RULES_VERSION, type FactCheck, type InventoryCoverage } from "@/domains/evidence/pages/fact-checks";
import { SUPPORT_ARTIFACT_VERSION, supportFailure, supportIdentity, deriveSupport, backfillClaimSupport, type ClaimSupport, type SupportContext, type UnsupportedReason } from "@/domains/evidence/pages/claim-support"; const NOW = new Date("2026-08-18T00:00:00.000Z"); const PAGE = { url: "https://x.example/names", path: "/names", body: "Afsaneh means Goddess. Darya means Beauty." }; const reader = (byStage: { claims?: unknown; judge?: unknown }) => async (input: { system: string }) => {
  const a = input.system.startsWith("You read one web page") ? byStage.claims : byStage.judge; return (a == null ? { hold: "unavailable" } : { value: a }) as { value: Record<string, unknown> } | { hold: "unavailable" }; };
const CLAIMS = { statements: [{ subject: "Afsaneh", current: "Goddess", locator: "Afsaneh" }] }; const CONFIRMS = { verdict: "page_wrong", proposed: "Legend, myth, fable", confidence: "confirmed", note: "",
  // THE FULL v2 RULING: the quote is the defining sentence, the subject its native-script headword, the relation the dictionary's own headword colon; the validator verifies every span.
  supporting: [{ url: "https://en.wiktionary.org/x", quote: "Persian افسانه: tale, story, fable, legend, myth.", supported: true, supportSpan: "Persian افسانه: tale, story, fable, legend, myth.", subjectSpan: "افسانه", subjectFrom: "quote", relationSpan: "افسانه:", meaningSpans: ["legend", "myth", "fable"] }],
  subjects: [{ url: "https://en.wiktionary.org/x", sameEntity: true, language: "Persian", script: "افسانه", why: "the entry defines the Persian word" }] };
const SOURCE = { organic: [{ domain: "en.wiktionary.org", url: "https://en.wiktionary.org/x", title: "Afsaneh" }] }; const PASSAGE = "Persian افسانه: tale, story, fable, legend, myth."; const coverage = () => ({ readCoverage: async () => db.cov as InventoryCoverage | null, writeCoverage: async (c: InventoryCoverage) => { db.cov = c as unknown as Record<string, unknown>; return true; } }); const unit = (over: Record<string, unknown>) => runFactCheckUnit({ tenantId: "t", now: NOW, basis: "b1", deadlineAt: Date.now() + 600_000, page: PAGE, read: reader({ claims: CLAIMS, judge: CONFIRMS }), searchSources: async () => SOURCE, fetchSource: async () => ({ text: PASSAGE }), ...coverage(), ...over } as never);
/** An inventory row as the store hands it back on a later lease. */
const row = (over: Partial<FactCheck>): FactCheck => ({ page: "/names", statementKey: "k", subject: "Afsaneh", current: "Goddess", proposed: null, literal: null, usage: null, sources: [], agreement: "none_found",
  confidence: "unsupported", verdict: "undecidable", alsoAt: [], note: "", pageContentHash: pageHashOf(PAGE.body), pageLocator: null, sourceReadAt: null, state: "owed", rulesVersion: VERIFICATION_RULES_VERSION, evidenceBasis: "b1", checkedAt: NOW.toISOString(), ...over });
const reset = () => { db.rows = []; db.owed = []; db.superseded = []; db.reopened = []; db.cov = null; db.writeFails = false; };
describe("the search is the proposition", () => {
  it("the real Ahvaz claim searches the claim, and the type shapes but never erases the assertion", () => {
    const subject = "Ahvaz, Iran", current = "Ahvaz, Iran holds the record for hottest day ever in Asia at 54 °C (129 °F)"; expect(claimTypeOf(subject, current)).toBe("quantity"); // a record temperature is not a definition
    const q = sourceQueryFor(claimTypeOf(subject, current), subject, current); for (const must of ["Ahvaz", "54", "°C", "Asia", "hottest", "record"]) expect(q).toContain(must); expect(q).not.toContain("definition reference"); // the query the live run actually sent
    expect(claimTypeOf("Tehran", "was founded in 1796")).toBe("date_or_event"); const meaning = sourceQueryFor("word_meaning", "Afsaneh", "means Goddess"); expect([meaning.includes("etymology"), meaning.includes("Goddess")]).toEqual([true, true]); // the proposition survives the hint
    // A COUNT WITH NO UNIT AND A DAY WITH NO YEAR (live, /iran-flags/iran-islamic-republic-flag-history): the repetition claim typed as a dictionary definition, and both sources came back supporting nothing while the encyclopedia passage stated the count.
    const flag = (over: Partial<SupportContext>): SupportContext => ({ tenantId: "t", page: "/iran-flags/x", statementKey: "takbir", pageLocator: null, subject: "Takbir", claimKind: "quantity", current: "", proposed: "the Takbir is repeated 22 times in white Kufic script on the Islamic Republic of Iran flag", url: "https://en.wikipedia.org/wiki/Flag_of_Iran", kind: "encyclopedia", quote: "Along each band the Takbir occurs 22 times, rendered in a stylised Kufic hand.", titleContext: null, ...over }); expect([claimTypeOf("Takbir", "is repeated 22 times in Kufic script"), claimTypeOf("flag", "the change took effect on 22 Bahman"), claimTypeOf("Noor", "Meaning: Light")], "a count with no unit and a day with no year are not definitions").toEqual(["quantity", "date_or_event", "word_meaning"]);
    expect([!!deriveSupport(flag({})), deriveSupport(flag({}))?.meaningSpans], "the passage owes the NUMBER and the word beside it, never every gloss word of a claim no encyclopedia sentence would repeat").toEqual([true, ["22", "times"]]);
    expect([deriveSupport(flag({ quote: "Iran is divided into 22 provinces." })), deriveSupport(flag({ quote: "The Takbir appears on the flag of Iran." })), deriveSupport(flag({ claimKind: "date_or_event", proposed: "redesigned in 1980 and adopted in 1979", quote: "The current flag was adopted in 1980." })), deriveSupport(flag({ claimKind: "date_or_event", proposed: "the flag changed on 22 Bahman", quote: "Government offices close on 22 Bahman every year.", titleContext: "Public holidays in Iran" }))], "the number on something else, no number at all, one of the two years owed, and a date about another subject with nothing anaphoric to bridge it").toEqual([null, null, null, null]);
    expect(sourceQueryFor("quantity", "Iran", "has a population of 89 million")).toContain("89"); expect(claimIdentity("Cyrus", "founded it", "History")).not.toBe(claimIdentity("Cyrus", "died 530 BCE", "Death")); const cobra = sourceQueryFor("entity_fact", "are there cobras in iran", "", "Persian Cobra"); expect([cobra.startsWith("Persian Cobra"), cobra.includes("cobras"), sourceQueryFor("quantity", "Iran", "has a population of 89 million", "Iran Population")], "a row with no current wording searches the PAGE'S OWN SUBJECT first, so the live cobra question stops asking the world at large and coming back with army aviation; a correction carries its own wording and never takes it").toEqual([true, true, sourceQueryFor("quantity", "Iran", "has a population of 89 million")]);});});
describe("the page slot is part of the proposition", () => {
  const NAMES = "Popular Persian Male(Boy) First Names and their Meanings";
  it("lets a heading break a tie, never overrule, and keeps two roles apart in one proposition identity", () => {
    expect(claimTypeOf("Afshin", "A warrior or conqueror."), "MUTATION: drop the locator and it is lost again").toBe("definition"); // THE LIVE LOSS. The male names page writes "A warrior or conqueror." with no "Meaning:" prefix, so the entry typed as a plain definition, the query asked about a warrior and returned a biography of a general.
    expect(claimTypeOf("Afshin", "A warrior or conqueror.", NAMES), "the heading breaks the tie").toBe("word_meaning"); expect([claimTypeOf("Tehran", "Capital of Iran", "Name meaning"), claimTypeOf("Ahvaz", "holds the record for hottest day at 54 C", "History of Ahvaz"), // EXPLICIT WORDING WINS. A heading may refine what the words leave open and may never overrule what they say.
      claimTypeOf("Noor", "Meaning: Light", "Persian female name Noor"), claimTypeOf("flag", "Meaning of the colors", "Name entry")],
    "MUTATION: let the locator win and the first two of these flip").toEqual(["geography", "quantity", "word_meaning", "word_meaning"]); expect([claimTypeOf("Casing", "Brushed aluminium", "Product specifications"), claimTypeOf("Tehran", "Tehran", "Geography of Iran"), // AND IT IS THE PAGE'S OWN WORDS, not a vocabulary written for one tenant.
      claimTypeOf("Revolution", "1979", "Historical timeline"), claimTypeOf("Widget", "A small tool", "About us")],
    "universal").toEqual(["specification", "geography", "date_or_event", "definition"]); const meaning = tokenFingerprintOf("Afshin", "A warrior or conqueror.", "word_meaning"); // THE NORMALIZED ROLE IS IN THE FINGERPRINT, and the heading's prose is not.
    expect(meaning, "same words, two roles, two propositions").not.toBe(tokenFingerprintOf("Afshin", "A warrior or conqueror.", "definition")); expect(tokenFingerprintOf("Afshin", "conqueror or warrior A.", "word_meaning"), "one role, harmless reorder").toBe(meaning); expect(tokenFingerprintOf("Afshin", "A warrior or conqueror.", claimTypeOf("Afshin", "A warrior or conqueror.", "Boy names and their meanings")), "two headings that mean the same role are ONE proposition, so a heading edit mints nothing").toBe(meaning); expect(tokenFingerprintOf("Afshin", "A warrior or conqueror."), "MUTATION: without the role the two collide again").toBe(tokenFingerprintOf("Afshin", "A warrior or conqueror.", "definition")); const q = (t: Parameters<typeof sourceQueryFor>[0], sub: string, cur: string) => sourceQueryFor(t, sub, cur); // AND THE ROLE SHAPES THE QUERY WITHOUT ERASING THE PROPOSITION.
    const name = q("word_meaning", "Afshin", "A warrior or conqueror."); for (const must of ["Afshin", "warrior", "conqueror", "meaning", "origin", "etymology"]) expect(name).toContain(must); expect(q("geography", "Tehran", "Capital of Iran"), "geography asks where").toContain("location"); expect(q("date_or_event", "Tehran", "was founded in 1796"), "history asks when").toContain("period"); expect(q("quantity", "Iran", "has a population of 89 million"), "a count asks how many and still carries its own figure").toMatch(/89.*how many/);});});
describe("a usage rule is not a word meaning, and a stray colon is not a dictionary", () => {
  const EDIN = "Persian, has two personal pronouns for singular address, to ([to]) the familiar or intimate 'you' and \u0161oma ([\u222foma:]) the deferential or formal 'you'."; const ctx = (over: Partial<SupportContext>): SupportContext => ({ tenantId: "t", page: "/p", statementKey: "k", pageLocator: null, subject: "\u0161oma", claimKind: "usage_or_register", current: "", proposed: "the deferential or formal you", url: "https://era.ed.ac.uk/x", kind: "scholarly", quote: EDIN, titleContext: null, ...over });
  it("carries usage on usage language, refuses a meaning claim on it, and lets only a real headword define a word", async () => {
    expect(deriveSupport(ctx({ claimKind: "definition", subject: "Ahvaz", proposed: "a city in Khuzestan province", quote: "Ahvaz is a city in Khuzestan province." })), "a generic definition is carried by an ordinary relation and owes no dictionary vocabulary").toBeTruthy(); const owed = { page: "/p", statementKey: "k", subject: "\u0161oma", current: "", proposed: "the deferential or formal you", literal: null, usage: null, sources: [{ url: "https://era.ed.ac.uk/x", kind: "scholarly" as const, says: EDIN }], agreement: "single_source" as const, confidence: "confirmed" as const, verdict: "undecidable" as const, alsoAt: [], note: "", pageContentHash: null, pageLocator: null, sourceReadAt: "2026-09-01T00:00:00.000Z", state: "checked" as const, rulesVersion: VERIFICATION_RULES_VERSION, evidenceBasis: null, checkedAt: "2026-09-01T00:00:00.000Z" } as FactCheck;
    let banked = [owed]; const keep = async (_p: string, rs: readonly FactCheck[]): Promise<number> => (banked = [...rs], rs.length); await backfillClaimSupport("t", [{ page: "/p", statementKey: "k", onUnsupported: "reopen" }], { rows: async () => banked, rebank: keep, reopen: keep }); expect(banked[0]!.sources[0]!.support?.relationSpan, "a row that corrects nothing is classified by what it ASSERTS, so the backfill finds and stores the usage relation").toBe("address"); expect(claimTypeOf("\u0161oma", "", "used instead of to, to show respect"), "an assertion about WHEN a form is used is not a dictionary entry").toBe("usage_or_register"); const usage = deriveSupport(ctx({})); expect([!!usage, usage?.relationSpan], "carried by the source's own usage words, with no dictionary vocabulary anywhere in the passage").toEqual([true, "address"]);
    expect(deriveSupport(ctx({ claimKind: "word_meaning", proposed: "means the formal you" })), "a usage passage may not authorize a translation, and its phonetic colon may not stand in for one").toBeNull(); expect(deriveSupport(ctx({ subject: "\u0634\u0645\u0627", proposed: "used instead of \u062a\u0648 as a sign of respect", quote: "The formal gardens of Isfahan draw respect from visitors every season." })), "a passage merely containing formal and respect carries nothing").toBeNull(); const entry = ctx({ claimKind: "word_meaning", subject: "\u0627\u0641\u0633\u0627\u0646\u0647", proposed: "tale, story, fable", quote: "\u0627\u0641\u0633\u0627\u0646\u0647: tale, story, fable", kind: "dictionary" }); expect(deriveSupport(entry)?.relationSpan, "a real headword entry still defines its own word").toBe("\u0627\u0641\u0633\u0627\u0646\u0647:");
    expect(deriveSupport({ ...entry, quote: "A note about \u0627\u0641\u0633\u0627\u0646\u0647: tale, story, fable follows." }), "the same colon inside ordinary prose does not").toBeNull();
    expect(supportFailure({ ...deriveSupport(ctx({}))!, version: 2 }, ctx({})), "an artifact decided under the old question is stale, never silently trusted").toBe("stale"); });
});

describe("a missing proposition is researched, never graded", () => { beforeEach(reset);
  /** THE LOOP'S MISSING HALF, at the unit: an owed claim with NO current wording is information the page LACKS (the missing-information requirement seeds exactly these), so the unit searches the subject, reads real sources, and banks `proposed` as the researched statement with verified quotes. The judge is asked what the passages establish, never to grade an empty quotation. */
  it("an owed claim with no current wording banks the researched statement from real sources", async () => {
    db.cov = { pageContentHash: pageHashOf(PAGE.body), coveredChars: PAGE.body.length, totalChars: PAGE.body.length };
    const asked: string[] = []; const SAID = "Persian girls' names are typically chosen for meaning, drawn from nature, virtues and classical literature.";
    const missing = row({ statementKey: "missing#1", subject: "How Persian names are chosen for girls", current: "", pageLocator: "missing" });
    const judge = (verdict: string) => async (input: { system: string; user: string }) => { asked.push(input.user);
        return input.system.startsWith("You read one web page") ? { value: { statements: [] } }
          : { value: { verdict, proposed: SAID, confidence: "confirmed", note: "",
              supporting: [{ url: "https://en.wiktionary.org/x", quote: "tale, story, fable" }] } }; };
    const out = await unit({ held: [missing], read: judge("page_correct") }); expect(out.status).toBe("advanced");
    const banked = db.rows.find((r) => r.statementKey === "missing#1")!; expect([banked.state, banked.proposed, banked.rulesVersion], "banked under the rules a question the page does not answer is judged by, where the correction two tests down banks 4").toEqual(["checked", SAID, 5]);
    expect(String(banked.sources && (banked.sources as unknown[]).length)).toBe("1"); // the quote verified against the fetched passage
    expect(asked.join(" ")).toContain("The page does not answer this yet"); // researched as a gap, not compared to an empty quote
    expect([asked.join(" ").includes('The page says: ""'), asked.join(" ").includes(`This page is about: ${PAGE.body}`), asked.join(" ").includes("ONE sentence that answers this question ABOUT THAT SUBJECT")], "the judge is told what the PAGE is about and asked for one sentence from one quotable passage, which is what the live cobra row never was").toEqual([false, true, true]);
    db.rows = []; await unit({ held: [missing], read: judge("undecidable") }); const astray = db.rows.find((r) => r.statementKey === "missing#1")!;
    expect([astray.state, astray.proposed, astray.confidence], "and a statement the judge would not say answers the question is banked as no statement at all, so a confirmed undecidable row can no longer exist").toEqual(["checked", null, "likely"]); });
  /** AND THE QUOTE IT BANKS IS THE PASSAGE THAT CARRIES THE PROPOSITION, not whichever sentence the judge reached for first. Live, the judge quoted the 1979 change, wrote that the passages support the pre-1979 colours and emblem, and they did, three sentences away; the row banked `likely` and its demand row was refused every pass after that. */
  it("banks the carrying window of the fetched document, and the judge's own quote when nothing carries", async () => {
    const PROP = "Before 1979, Iran used a tricolour flag of green, white, and red with the Lion and Sun emblem at the center; it remained in use until the 1979 Islamic Revolution", CARRIES = "Before 1979 the flag of Iran was a tricolour of green, white and red charged at the center with the Lion and Sun emblem of the Islamic state.";
    const JUDGED = "Following the 1979 Islamic Revolution, the Iranian flag was changed into its current form.", FLAG = "https://en.wikipedia.org/wiki/Flag_of_Iran";
    const judge = { verdict: "page_correct", proposed: PROP, confidence: "confirmed", note: "The passages support the pre-1979 flag's colors, emblem, and replacement.", supporting: [{ url: FLAG, quote: JUDGED }], subjects: [{ url: FLAG, sameEntity: true, language: "English", script: null, why: "the article is this flag's own" }] };
    const run = async (text: string) => { reset(); db.cov = { pageContentHash: pageHashOf(PAGE.body), coveredChars: PAGE.body.length, totalChars: PAGE.body.length };
      await unit({ held: [row({ statementKey: "gap#1", subject: "iran flag before 1979", current: "", pageLocator: "missing" })], read: reader({ claims: { statements: [] }, judge }),
        searchSources: async () => ({ organic: [{ domain: "en.wikipedia.org", url: FLAG, title: "Flag of Iran" }] }), fetchSource: async () => ({ text, title: "Flag of Iran" }) });
      const r = db.rows.find((x) => x.statementKey === "gap#1") as unknown as FactCheck; return [r.sources[0]!.says, r.sources[0]!.support?.supported, r.confidence]; };
    expect(await run(`${JUDGED} A standard was fixed in 1910. The proportions were set at three to five. ${CARRIES}`), "the window three sentences past the judge's quote is what the row banks, and an encyclopedia carrier confirms it").toEqual([CARRIES, true, "confirmed"]);
    expect(await run(`${JUDGED} A standard was fixed in 1910.`), "with no carrying window the judge's own quote stands, unsupported, and the row stays an honest finding").toEqual([JUDGED, false, "likely"]);
    expect(await run((judge.supporting = [{ url: FLAG, quote: CARRIES }], `${JUDGED} ${"The national flag of the Islamic Republic of Iran is a horizontal tricolour of green, white and red with the national emblem centred on the white band. ".repeat(45)}${CARRIES}`)), "and the History passage past character 6,000 is reachable at last: the window follows the question's own words, so the judge and the selection both read the region that answers it rather than an opening about the flag that replaced it").toEqual([CARRIES, true, "confirmed"]); });
  it("sources that cannot support the missing statement leave it typed debt, never invented copy", async () => {
    db.cov = { pageContentHash: pageHashOf(PAGE.body), coveredChars: PAGE.body.length, totalChars: PAGE.body.length };
    const missing = row({ statementKey: "missing#2", subject: "Average rug knot density in Kerman", current: "", pageLocator: "missing" });
    const out = await unit({ held: [missing], read: reader({ claims: { statements: [] },
      judge: { verdict: "undecidable", proposed: "", confidence: "unsupported", note: "nothing relevant", supporting: [] } }) });
    expect(out.status).toBe("advanced");
    const banked = db.rows.find((r) => r.statementKey === "missing#2")!; expect([banked.confidence, banked.proposed]).toEqual(["unsupported", null]); }); });
describe("every failure is typed and leaves the claim owed", () => { beforeEach(reset);
  it("a failed source read leaves the row OWED, never checked", async () => {
    const out = await unit({ held: [row({ statementKey: "k1" })], fetchSource: async () => ({ hold: "capped" }) }); // sources found, reading them refused
    expect([out.status, out.failure, out.cursor?.checked, db.rows.length]).toEqual(["failed", "fetch_capped", 0, 0]); }); // unread evidence never clears a claim
  it("every provider hold keeps its own name, against the stage that took it", async () => {
    const held = [row({ statementKey: "k1" })];
    for (const hold of ["capped", "waiting", "unavailable"] as const) expect((await unit({ held, searchSources: async () => ({ hold }) })).failure).toBe(`search_${hold}`);
    expect((await unit({ held, read: reader({ claims: CLAIMS, judge: null }) })).failure).toBe("judge_unavailable");
    expect((await unit({ held, read: async () => ({ hold: "refused" as const }) })).failure).toBe("judge_refused"); // refused is not unavailable
    reset(); db.cov = null;
    expect((await unit({ read: async () => ({ hold: "capped" as const }) })).failure).toBe("extraction_capped"); // nothing inventoried yet
    expect(db.rows).toHaveLength(0); // none of them banked anything
  });
  /** THE JUDGE READS THE PASSAGE AROUND THE SUBJECT, never the first 6,000 characters of a long reference page: a subject discussed further down reached the judge in an excerpt that never named it, so a source that genuinely answers the claim could clear nothing. Where the subject is named nowhere the window follows its own words instead, and the opening stands only when none of them occurs at all. */
  it("hands the judge the words around the subject when the source discusses it past the opening", async () => {
    const filler = "unrelated preamble words ".repeat(400), text = `${filler}Afsaneh. ${PASSAGE}${filler}`; // the defining sentence sits 10,000 characters in
    let asked = ""; const read = async (i: { system: string; user: string }) => { const claims = i.system.startsWith("You read one web page"); if (!claims) asked = i.user; return { value: (claims ? CLAIMS : CONFIRMS) as Record<string, unknown> }; };
    await unit({ held: [row({ statementKey: "k1" })], read, fetchSource: async () => ({ text }) });
    expect([asked.includes(PASSAGE), asked.includes("Afsaneh."), asked.length < text.length, asked.includes('The page says: "Goddess"'), asked.includes("This page is about:")], "and a correction's own prompt is untouched: it grades the page's wording and is never told what the page is about").toEqual([true, true, true, true, false]); });
  it("only an EMPTY results page is none_found; results that fail the policy leave the claim owed", async () => {
    const held = [row({ statementKey: "k1" })]; // a page of results none of which clears the policy is unresolved, never an empty world
    const bad = await unit({ held, searchSources: async () => ({ organic: [{ domain: "babynames.example", url: "https://babynames.example/x", title: "x" }] }) });
    expect([bad.status, bad.failure, db.rows.length]).toEqual(["failed", "source_quality_unresolved", 0]);
    expect((await unit({ held, searchSources: async () => ({ organic: [] }) })).status).toBe("advanced"); // truly empty
    const r = db.rows[0] as FactCheck; expect([r.confidence, r.agreement, r.proposed]).toEqual(["unsupported", "none_found", null]);
    db.writeFails = true; expect((await unit({ held })).failure).toBe("store_write_failed");});
  /** THE PIPELINED WAIT (operator, 2026-08-30): the successor's search is POSTED while the current claim settles. The byte-identity below is load-bearing: the cache keys on the input, so if the warmed string ever drifts from the one the successor's own turn asks, the warm buys a task nothing collects. */
  it("posts the successor's search while the current claim settles, byte-identical to the query its own turn asks", async () => {
    db.cov = { pageContentHash: pageHashOf(PAGE.body), coveredChars: PAGE.body.length, totalChars: PAGE.body.length };
    const warmed: string[] = [], askedQ: string[] = [], held = [row({ statementKey: "k1" }), row({ statementKey: "k2", subject: "Darya", current: "Beauty", pageLocator: "Darya" })];
    const seam = { warmSearch: (q: string) => { warmed.push(q); }, searchSources: async (q: string) => (askedQ.push(q), SOURCE) };
    await unit({ held, ...seam });
    expect(warmed).toEqual([sourceQueryFor(claimTypeOf("Darya", "Beauty", "Darya"), "Darya", "Beauty")]); // the SUCCESSOR's proposition, exactly once, never the current claim's
    await unit({ held, skip: new Set(["k1"]), ...seam });
    expect([askedQ.at(-1), warmed.length]).toEqual([warmed[0], 1]); // its own turn asks the very string that was warmed, and with no third claim nothing further warms
  });});
describe("coverage, duplicates and diversity", () => { beforeEach(reset);
  it("a page longer than one section is NOT complete after its first chunk", async () => {
    const long = { url: "https://x.example/long", path: "/long", body: "A fact. ".repeat(2 + EXTRACT_CHUNK / 8) }; // longer than one section
    const first = await unit({ page: long, read: reader({ claims: CLAIMS, judge: CONFIRMS }) });
    expect([(db.cov as { coveredChars: number }).coveredChars, first.cursor?.pageComplete]).toEqual([EXTRACT_CHUNK, false]);
    const held = [row({ page: "/long", statementKey: claimIdentity("Afsaneh", "Goddess", "Afsaneh"),
      pageContentHash: pageHashOf(long.body), state: "checked" })];
    const second = await unit({ page: long, held, read: reader({ claims: { statements: [] }, judge: CONFIRMS }) });
    expect([(db.cov as { coveredChars: number }).coveredChars, second.status]).toEqual([long.body.length, "done"]);});
  it("a chunk that filled up to the cap has not been read, and the cursor says where it stopped", async () => {
    const entries = Array.from({ length: 60 }, (_, i) => `Name${i} Meaning: wrong meaning ${i}.`);
    const dense = { url: "https://x.example/dense", path: "/dense", body: entries.join(" ") };
    const capped = { statements: Array.from({ length: 40 }, (_, i) => ({ subject: `Name${i}`, current: `wrong meaning ${i}.`, locator: `Name${i}` })) };
    const out = await unit({ page: dense, read: reader({ claims: capped, judge: CONFIRMS }) });
    const at = (db.cov as { coveredChars: number }).coveredChars;
    expect(out.cursor?.pageComplete, "a capped chunk never completes the page").toBe(false);
    expect(at, "and it stops inside the body, not at the end of it").toBeLessThan(dense.body.length);
    expect(at, "at the fortieth statement, not at the first").toBeGreaterThan(dense.body.indexOf("Name39")); });

  it("one proposition reworded with the same content words is not acquired twice", async () => {
    const heat = tokenFingerprintOf("Ahvaz", "holds the record for hottest day at 54 °C"); expect(tokenFingerprintOf("Ahvaz", "The hottest day record, 54 °C, is held by Ahvaz")).toBe(heat);
    expect(tokenFingerprintOf("Ahvaz", "reached 54 °C in 2017")).not.toBe(heat); // not semantic: different words, different claim
    db.cov = { pageContentHash: pageHashOf(PAGE.body), coveredChars: PAGE.body.length, totalChars: PAGE.body.length };
    let searches = 0; // a duplicate proposition is superseded free, never researched again
    const out = await unit({ searchSources: async () => { searches += 1; return SOURCE; },
      held: [row({ statementKey: "a", subject: "Ahvaz", current: "hottest day record 54 °C", state: "checked" }),
        row({ statementKey: "b", subject: "Ahvaz", current: "The hottest day record, 54 °C, is held by Ahvaz", state: "owed" })] });
    expect([searches, db.superseded.includes("Ahvaz"), out.status]).toEqual([0, true, "done"]);});
  it("agreement means independent publishers, so the second fetch prefers a different source class", async () => {
    const fetched: string[] = [];
    await unit({ held: [row({ statementKey: "k1" })], fetchSource: async (url: string) => { fetched.push(url); return { text: PASSAGE }; },
      searchSources: async () => ({ organic: [["en.wikipedia.org", "en.wikipedia.org/a"], ["www.britannica.com", "britannica.com/a"],
        ["behindthename.com", "behindthename.com/a"]].map(([d, u]) => ({ domain: d!, url: `https://${u}`, title: "A" })) }) });
    expect([fetched.length, fetched[0]!.includes("wikipedia"), fetched[1]!.includes("behindthename")]).toEqual([2, true, true]); });});
describe("one pass, one global claim allowance", () => { beforeEach(reset);
  it("three eligible pages cannot exceed the global attempt allowance", async () => {
    let units = 0; const pages = ["/a", "/b", "/c"].map((p) => ({ url: `https://x.example${p}`, path: p, loadBody: async () => `${p} page body.` }));
    const out = await runFactCheckPass({ tenantId: "t", basis: "b1", deadlineAt: Date.now() + 600_000, pages, held: [],
      refreshHeld: async () => null, readCoverage: async () => null, writeCoverage: async () => true,
      read: async (i: { kind: string }) => ({ value: (i.kind === "fact_claim_extraction"
        ? (units += 1, { statements: Array.from({ length: 2 * ATTEMPTS_PER_PASS }, (_, n) => ({ subject: `S${units}${n}`, current: `claim ${units} ${n}`, locator: `L${n}` })) })
        : CONFIRMS) as Record<string, unknown> }),
      searchSources: async () => SOURCE, fetchSource: async () => ({ text: PASSAGE }) });
    expect(out.attempts).toBe(ATTEMPTS_PER_PASS); }); // the allowance TOTAL, never per page: the fixture offers double it
  it("an account whose pages have no stored words owes nothing here, and never pauses a fresh account", async () => {
    const out = await runFactCheckPass({ tenantId: "t", basis: "b1", deadlineAt: Date.now() + 600_000, held: [],
      pages: [{ url: "https://x.example/new", path: "/new", loadBody: async () => "" }],
      refreshHeld: async () => null, readCoverage: async () => null, writeCoverage: async () => true,
      read: reader({ claims: CLAIMS, judge: CONFIRMS }), searchSources: async () => SOURCE, fetchSource: async () => ({ text: PASSAGE }) });
    expect([out.status, out.attempts, out.failure]).toEqual(["done", 0, undefined]); });
  it("a failed unit ends the pass with its typed identity instead of burning the allowance", async () => {
    const out = await runFactCheckPass({ tenantId: "t", basis: "b1", deadlineAt: Date.now() + 600_000,
      pages: [{ url: "https://x.example/a", path: "/a", loadBody: async () => "A body." }],
      held: [row({ page: "/a", pageContentHash: pageHashOf("A body.") })],
      refreshHeld: async () => null, readCoverage: async () => null, writeCoverage: async () => true,
      read: reader({ claims: CLAIMS, judge: CONFIRMS }), searchSources: async () => ({ hold: "capped" }), fetchSource: async () => ({ text: PASSAGE }) });
    expect([out.status, out.failure, out.attempts]).toEqual(["failed", "search_capped", 1]); });});
describe("what may authorize replacing published words", () => { beforeEach(reset);
  it("verifies each quote in its OWN source, so a misattributed quote supports nothing", async () => {
    const weak = "Afsaneh (افسانه) is a lovely name for a girl.", two = { organic: [...SOURCE.organic, { domain: "behindthename.com", url: "https://behindthename.com/x", title: "Afsaneh" }] };
    const split = async (url: string) => ({ text: url.includes("wiktionary") ? PASSAGE : weak });
    await unit({ held: [row({ statementKey: "k1" })], searchSources: async () => two, fetchSource: split,
      read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, supporting: [{ url: "https://en.wiktionary.org/x", quote: weak }],
        subjects: [{ url: "https://en.wiktionary.org/x", sameEntity: true, language: "Persian", script: "افسانه", why: "same word" }] } }) });
    const bad = db.rows[0] as FactCheck; expect([bad.agreement, bad.confidence === "confirmed", bad.sources.find((x) => x.url.includes("wiktionary"))!.says]).toEqual(["none_found", false, ""]);
    db.rows = []; // attributed honestly, the weaker page supports it alone and still cannot confirm it
    await unit({ held: [row({ statementKey: "k1" })], searchSources: async () => two, fetchSource: split,
      read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, supporting: [{ url: "https://behindthename.com/x", quote: weak }],
        subjects: [{ url: "https://behindthename.com/x", sameEntity: true, language: "Persian", script: "افسانه", why: "same word" }] } }) });
    expect([(db.rows[0] as FactCheck).agreement, (db.rows[0] as FactCheck).confidence]).toEqual(["none_found", "likely"]); // AGREEMENT NAMES CARRIERS, NOT READERS: the only quote calls it "a lovely name for a girl" and carries none of "Legend, myth, fable", so no source stands behind the proposal
    db.rows = [];
    await unit({ held: [row({ statementKey: "k1" })] }); // a dictionary quoting its own words may confirm
    const ok = db.rows[0] as FactCheck; expect([ok.confidence, ok.state]).toEqual(["confirmed", "checked"]);
    expect(ok.sourceReadAt).not.toBeNull();
    const src = (JSON.parse(JSON.stringify(ok.sources)) as FactCheck["sources"])[0]!; // A FUTURE FACT EARNS ITS ARTIFACT INSIDE THE JUDGEMENT CALL IT ALREADY MAKES, and it survives the JSONB round trip it will live in: same identity, still valid, after JSON serialization.
    expect([src.support?.supported, src.support?.version]).toEqual([true, SUPPORT_ARTIFACT_VERSION]);
    expect(supportFailure(src.support, { tenantId: "t", page: ok.page, statementKey: ok.statementKey, pageLocator: ok.pageLocator, subject: ok.subject, claimKind: "definition", current: ok.current,
      proposed: ok.proposed ?? "", url: src.url, kind: src.kind, quote: src.says, titleContext: src.titleContext ?? null })).toBeNull(); });
  it("a passage about a different name cannot confirm this one, however alike the two are spelled", async () => {
    const daria = "Daria is a feminine given name, the Slavic form of Darius, meaning possessing goodness.";
    const darya = "Persian دریا (daryā): sea, ocean, a large body of water.";
    const enc = { organic: [{ domain: "en.wikipedia.org", url: "https://en.wikipedia.org/x", title: "Daria" }] };
    const claim = { statements: [{ subject: "Darya", current: "Beauty, elegance, and charm.", locator: "Darya" }] };
    const judged = (text: string, sameEntity: boolean, language: string, script: string | null, ruling: Record<string, unknown> = {}) => ({
      verdict: "page_wrong", proposed: "possessing goodness", confidence: "confirmed", literal: "", usage: "", note: "",
      supporting: [{ url: "https://en.wikipedia.org/x", quote: text, ...ruling }],
      subjects: [{ url: "https://en.wikipedia.org/x", sameEntity, language, script, why: "w" }] });
    await unit({ held: [row({ statementKey: "d1", subject: "Darya", current: "Beauty, elegance, and charm." })],
      searchSources: async () => enc, fetchSource: async () => ({ text: daria }),
      read: reader({ claims: claim, judge: judged(daria, false, "Slavic", null) }) });
    const wrong = db.rows[0] as FactCheck; expect([wrong.agreement, wrong.confidence === "confirmed"]).toEqual(["none_found", false]);
    expect(wrong.note).toContain("about a different subject or language");
    db.rows = [];
    await unit({ held: [row({ statementKey: "d1", subject: "Darya", current: "Beauty, elegance, and charm." })],
      searchSources: async () => enc, fetchSource: async () => ({ text: daria }),
      read: reader({ claims: claim, judge: judged(daria, true, "Persian", "دریا") }) });
    expect((db.rows[0] as FactCheck).confidence === "confirmed").toBe(false);
    db.rows = [];
    await unit({ held: [row({ statementKey: "d1", subject: "Darya", current: "Beauty, elegance, and charm." })],
      searchSources: async () => enc, fetchSource: async () => ({ text: darya }),
      read: reader({ claims: claim, judge: { ...judged(darya, true, "Persian", "دریا", { supported: true, supportSpan: darya, subjectSpan: "دریا", subjectFrom: "quote", relationSpan: "دریا (daryā):", meaningSpans: ["sea", "ocean"] }), proposed: "sea, ocean" } }) });
    const right = db.rows[0] as FactCheck; expect([right.confidence, right.proposed]).toEqual(["confirmed", "sea, ocean"]); });

  it("the site being corrected is never its own source, and a wording no source carries is not confirmed", async () => {
    const fetched: string[] = [];
    const both = { organic: [{ domain: "www.iranopedia.com", url: "https://www.iranopedia.com/persian-female-first-names", title: "Persian names" },
      { domain: "en.wikipedia.org", url: "https://en.wikipedia.org/x", title: "Maryam" }] };
    const hebrew = "Maryam: Maas (1912) proposes a derivation from Hebrew marah, to be rebellious. افسانه";
    await unit({ held: [row({ statementKey: "k1" })], searchSources: async () => both,
      page: { ...PAGE, url: "https://www.iranopedia.com/persian-female-first-names" },
      fetchSource: async (url: string) => { fetched.push(url); return { text: hebrew }; },
      read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, proposed: "beloved; wished-for child",
        supporting: [{ url: "https://en.wikipedia.org/x", quote: hebrew }],
        subjects: [{ url: "https://en.wikipedia.org/x", sameEntity: true, language: "Persian", script: "افسانه", why: "the entry is about this name" }] } }) });
    expect(fetched.some((u) => u.includes("iranopedia"))).toBe(false);
    const r = db.rows[0] as FactCheck;
    expect([r.agreement, r.confidence]).toEqual(["none_found", "likely"]); // AGREEMENT NAMES CARRIERS, NOT READERS: the quote derives Maryam from Hebrew marah, to be rebellious, and carries none of "beloved; wished-for child"
    expect(r.note).toContain("Held below confirmed:"); });

  it("a confirmed verdict the quote-bound contract refuses reopens as owed, and a carried one does not", async () => {
    const banked = (subject: string, proposed: string, says: string) => row({ statementKey: subject.toLowerCase(), subject,
      current: "Meaning:Something old.", proposed, confidence: "confirmed", verdict: "page_wrong", state: "checked",
      sources: [{ url: "https://en.wikipedia.org/r", kind: "encyclopedia", says }], sourceReadAt: NOW.toISOString() });
    const held = [banked("Alborz", "Mountain Rampart", "derived from Hara Barazaiti, a legendary mountain"),
      banked("Noor", "light", 'The name Noor means "light"')];
    await unit({ held, read: reader({ claims: { statements: [] }, judge: CONFIRMS }) });
    expect(db.reopened, "only the stranded claim re-enters research").toEqual(["alborz"]); });

  it("words found on the fetched page but past the verified quote authorize nothing", async () => {
    const page = "The name Alborz is derived from Hara Barazaiti, a legendary mountain. البرز Hara Brzati means Mountain Rampart.";
    await unit({ held: [row({ statementKey: "k1" })], fetchSource: async () => ({ text: page }),
      read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, proposed: "Mountain Rampart",
        supporting: [{ url: "https://en.wiktionary.org/x", quote: "The name Alborz is derived from Hara Barazaiti, a legendary mountain." }],
        subjects: [{ url: "https://en.wiktionary.org/x", sameEntity: true, language: "Persian", script: "البرز", why: "about this name" }] } }) });
    const r = db.rows[0] as FactCheck; expect([r.confidence, r.verdict]).toEqual(["likely", "page_wrong"]);
    expect(r.note).toContain("Held below confirmed:"); });

  it("reads the next section even while claims are owed, and a chunk that filled up does not advance past what it read", async () => {
    const body = Array.from({ length: 60 }, (_, i) => `Name${i} means Meaning${i}.`).join(" ");
    const owedAlready = Array.from({ length: 33 }, (_, i) => row({ statementKey: `owed${i}`, subject: `Old${i}`, pageContentHash: pageHashOf(body) }));
    db.cov = { pageContentHash: pageHashOf(body), coveredChars: 0, totalChars: body.length } as never;
    const found = Array.from({ length: 12 }, (_, i) => ({ subject: `Name${i}`, current: `Meaning${i}`, locator: null }));
    await unit({ page: { ...PAGE, body }, held: owedAlready, searchSources: async () => ({ hold: "unavailable" as const }),
      read: reader({ claims: { statements: found }, judge: CONFIRMS }) });
    expect(db.owed.length, "the section was inventoried rather than queued behind research").toBe(12);
    expect((db.cov as unknown as { coveredChars: number }).coveredChars).toBeGreaterThan(0);

    db.rows = []; db.owed = []; db.cov = { pageContentHash: pageHashOf(body), coveredChars: 0, totalChars: body.length } as never;
    const full = Array.from({ length: 40 }, (_, i) => ({ subject: `Name${i}`, current: `Meaning${i}`, locator: null }));
    const known = full.slice(0, 35).map((c, i) => row({ statementKey: claimIdentity(c.subject, c.current, null), subject: c.subject, current: c.current, state: "checked" as const, pageContentHash: pageHashOf(body) }));
    await unit({ page: { ...PAGE, body }, held: known, searchSources: async () => ({ hold: "unavailable" as const }),
      read: reader({ claims: { statements: full }, judge: CONFIRMS }) });
    const advanced = (db.cov as unknown as { coveredChars: number }).coveredChars; expect(advanced, "a chunk that filled up may not advance past the last statement it actually read").toBeLessThan(Math.min(body.length, 3_000)); });

  it("sets aside a claim whose sources will not resolve and reaches the next one, instead of stopping the pass", async () => {
    const body = "Alpha means one. Beta means two. Gamma means three. Delta four. Epsilon five. Zeta six.";
    const owed = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"].map((subject) => row({ statementKey: subject.toLowerCase(), subject,
      current: `${subject} means something`, pageContentHash: pageHashOf(body) }));
    db.cov = { pageContentHash: pageHashOf(body), coveredChars: body.length, totalChars: body.length } as never;
    const asked: string[] = [];
    const out = await runFactCheckPass({ tenantId: "t", basis: "b1", deadlineAt: Date.now() + 600_000, held: owed,
      pages: [{ url: PAGE.url, path: PAGE.path, loadBody: async () => body }],
      refreshHeld: async () => null, readCoverage: async () => db.cov as never, writeCoverage: async () => true,
      read: reader({ claims: { statements: [] }, judge: CONFIRMS }),
      searchSources: async (query: string) => { asked.push(query); return SOURCE; },
      fetchSource: async () => ({ hold: "refused" as const }) } as never);
    const subjects = new Set(["alpha", "beta", "gamma", "delta"].filter((n) => asked.some((q) => q.toLowerCase().includes(n))));
    expect(subjects.size, `only reached ${JSON.stringify([...subjects])} of the owed claims across ${asked.length} searches`).toBeGreaterThanOrEqual(3);
    expect(out.attempts).toBeGreaterThanOrEqual(3); expect(out.failure).not.toBe("lease_exhausted");
    expect(out.failure).toBe("fetch_refused");
    const waited: string[] = []; // A POSTED SEARCH IS THE MOST SELF-RESOLVING PER-CLAIM CONDITION THERE IS: the provider takes the task and hands it back on a free follow-up, so ending the pass on it posts ONE task per pass and leaves every other owed claim untouched (live on /persian-male-names: 167 owed, one attempt per pass).
    const wait = await runFactCheckPass({ tenantId: "t", basis: "b1", deadlineAt: Date.now() + 600_000, held: owed, pages: [{ url: PAGE.url, path: PAGE.path, loadBody: async () => body }], refreshHeld: async () => null, readCoverage: async () => db.cov as never, writeCoverage: async () => true, read: reader({ claims: { statements: [] }, judge: CONFIRMS }), searchSources: async (query: string) => { waited.push(query); return { hold: "waiting" as const }; }, fetchSource: async () => ({ hold: "refused" as const }) } as never);
    expect([waited.length >= 3, wait.attempts >= 3], "a waiting search posts for the next claim too, instead of ending the pass").toEqual([true, true]); });

  it("a source nobody read, a stale page version and replaced rules each authorize nothing", async () => {
    const { authorizedCorrections } = await import("@/domains/evidence/pages/fact-checks");
    const q = 'The name Afsaneh means "new".';
    const bare = row({ proposed: "new", verdict: "page_wrong", confidence: "confirmed", state: "checked", pageContentHash: "h1", sources: [{ url: "https://en.wiktionary.org/x", kind: "dictionary", says: q }] });
    const art = deriveSupport({ tenantId: "t", page: bare.page, statementKey: bare.statementKey, pageLocator: bare.pageLocator, subject: bare.subject, claimKind: "definition", current: bare.current, proposed: "new", url: "https://en.wiktionary.org/x", kind: "dictionary", quote: q, titleContext: null });
    const c = { ...bare, sources: [{ ...bare.sources[0]!, support: art! }] };
    expect(art?.supported, "the defining sentence derives mechanically").toBe(true);
    expect(authorizedCorrections([{ ...c, sourceReadAt: null }], undefined, "t")).toHaveLength(0); const read = { ...c, sourceReadAt: NOW.toISOString() };
    expect(authorizedCorrections([bare, { ...bare, sourceReadAt: NOW.toISOString() }], undefined, "t"), "an artifact-less confirmed correction authorizes NOTHING now").toHaveLength(0);
    expect(authorizedCorrections([read], { pageContentHash: "h1", evidenceBasis: "b1" }, "other-tenant"), "another tenant's artifact is stale here").toHaveLength(0);
    expect(authorizedCorrections([read], { pageContentHash: "h2" }, "t")).toHaveLength(0); // stale page version
    expect(authorizedCorrections([{ ...read, state: "owed" }], undefined, "t")).toHaveLength(0);
    expect(authorizedCorrections([{ ...read, rulesVersion: 1 }], undefined, "t")).toHaveLength(0); // verdict from replaced rules
    expect(authorizedCorrections([read], { pageContentHash: "h1", evidenceBasis: "b1" }, "t")).toHaveLength(1);
    const gap = (verdict: string, over: Partial<FactCheck> = {}) => authorizedCorrections([{ ...read, current: "", verdict, proposed: "Iran has AH-1 Cobra attack helicopters.", ...over } as FactCheck], undefined, "t").length, ask = { subject: "are there cobras in iran", sources: [{ url: "https://en.wikipedia.org/x", kind: "encyclopedia" as const, says: "Iran operates AH-1 Cobra attack helicopters." }] };
    expect([gap("undecidable"), gap("page_correct"), gap("page_correct", ask), gap("page_correct", { ...ask, rulesVersion: 5 }), [rulesVersionFor({ subject: "are there cobras in iran", current: "" }), rulesVersionFor({ subject: "Afsaneh", current: "" }), rulesVersionFor(read)]], "A ROW WITH NO CURRENT WORDING IS AUTHORIZED BY ITS VERDICT: the live cobra row banked confirmed on an undecidable reading whose own note said the sources are about attack helicopters, and this door let it through to the writer. AND A QUESTION IS JUDGED UNDER RULES OF ITS OWN: the same confirmed page_correct row authorizes nothing while it carries 4, the version a correction is judged under, and authorizes again once it has been judged under 5; a headword with no current wording and a correction both stay on 4, byte for byte").toEqual([0, 1, 0, 1, [5, 4, 4]]);});
  it("the real schema registry can express a claim list and a claim judgement", async () => {
    const { SCHEMA_BY_KIND } = await import("@/domains/decision/llm/schemas"); expect(SCHEMA_BY_KIND.fact_claim_extraction.safeParse({ statements: [{ subject: "A", current: "means B", locator: "A" }] }).success).toBe(true);
    expect(SCHEMA_BY_KIND.fact_claim_judgement.safeParse({ verdict: "page_wrong", confidence: "confirmed", proposed: "Legend", literal: "legend", usage: "",
      supporting: [{ url: "https://en.wiktionary.org/x", quote: "tale, story, fable", supported: true, supportSpan: "tale, story, fable", subjectSpan: "افسانه", subjectFrom: "quote", relationSpan: "افسانه:", meaningSpans: ["fable"] }], note: "",
      subjects: [{ url: "https://en.wiktionary.org/x", sameEntity: true, language: "Persian", script: "افسانه", why: "same word" }] }).success).toBe(true);
    expect(SCHEMA_BY_KIND.fact_claim_judgement.safeParse({ verdict: "page_wrong", confidence: "confirmed", proposed: "Legend", literal: "legend", usage: "",
      supporting: [{ url: "https://en.wiktionary.org/x", quote: "tale, story, fable" }], note: "",
      subjects: [] }).success, "the v1 answer shape no longer satisfies the judgement contract").toBe(false);
    expect(SCHEMA_BY_KIND.fact_claim_judgement.safeParse({ verdict: "page_wrong", confidence: "confirmed", proposed: "Legend", literal: "legend", usage: "",
      supporting: [{ url: "https://en.wiktionary.org/x", quote: "tale" }], note: "" }).success).toBe(false);
    expect(SCHEMA_BY_KIND.editor_judgement.safeParse({ statements: [] }).success).toBe(false);});
  it("reads a source through the REAL provider parser, not a shape invented to match", async () => {
    const { parseCapability } = await import("@/domains/evidence/dataforseo/capabilities");
    const envelope = { tasks: [{ result: [{ items: [{ page_content: { main_topic: [{ main_title: "Afsaneh", h_title: "Etymology", primary_content: [{ text: PASSAGE }] }] } }] }] }] };
    const p = parseCapability("onpage_content_parsing", envelope as never) as { bodyText: string | null; openingSample: string | null; headings: string[] }; const text = [p.bodyText, p.openingSample, ...p.headings].filter(Boolean).join("\n");
    await unit({ held: [row({ statementKey: "k1" })], fetchSource: async () => ({ text }) }); expect([text.includes("fable"), (db.rows[0] as FactCheck).confidence]).toEqual([true, "confirmed"]); }); });
describe("a verdict from obsolete rules is not current evidence", () => { beforeEach(reset);
  it("re-opens the live Ahvaz check produced under the old subject-only query, and leaves a current one settled", async () => {
    const AHVAZ = "Ahvaz, Iran holds the record for hottest day ever in Asia at 54 °C (129 °F)", page = { url: "https://x.example/ahvaz", path: "/ahvaz", body: `${AHVAZ} And more.` };
    const done = { pageContentHash: pageHashOf(page.body), coveredChars: page.body.length, totalChars: page.body.length }; db.cov = done;
    const old = row({ page: "/ahvaz", statementKey: "ahvaz, iran#fdbdbbc407", subject: "Ahvaz, Iran", current: AHVAZ,
      pageContentHash: pageHashOf(page.body), state: "checked", rulesVersion: 1, sourceReadAt: NOW.toISOString() });
    let asked = ""; const out = await unit({ page, held: [old], searchSources: async (q: string) => { asked = q; return SOURCE; } });
    expect([db.reopened, out.status]).toEqual([["ahvaz, iran#fdbdbbc407"], "advanced"]); // archived, owed, researched
    for (const must of ["Ahvaz", "54", "°C", "Asia", "hottest"]) expect(asked).toContain(must);
    expect([asked.includes("definition reference"), (db.rows[0] as FactCheck).rulesVersion]).toEqual([false, VERIFICATION_RULES_VERSION]);
    reset(); db.cov = done; let searches = 0;
    const settled = await unit({ page, held: [{ ...old, rulesVersion: VERIFICATION_RULES_VERSION }],
      searchSources: async () => { searches += 1; return SOURCE; } });
    expect([db.reopened, searches, settled.status]).toEqual([[], 0, "done"]); }); });
describe("the live 54 C Ahvaz results page", () => { beforeEach(reset); // the organic results the already-paid SERP returned, in order
  const LIVE = { organic: [["www.washingtonpost.com", "washingtonpost.com/a"], ["mashable.com", "mashable.com/a"],
    ["www.newarab.com", "newarab.com/a"], ["www.cnbc.com", "cnbc.com/a"], ["www.globalcitizen.org", "globalcitizen.org/a"],
    ["www.youtube.com", "youtube.com/watch"]].map(([domain, u]) => ({ domain: domain!, url: `https://${u}`, title: "Ahvaz 129F" })) };
  const WAPO = "Ahvaz, Iran reached 129 degrees Fahrenheit, a record for Asia.", CNBC = "The Iranian city recorded 54 degrees Celsius on Thursday.", split = async (url: string) => ({ text: url.includes("washingtonpost") ? WAPO : CNBC });
  it("is never an empty world, excludes the video result, and one publisher alone cannot confirm", async () => {
    const fetched: string[] = [];
    const out = await unit({ held: [row({ statementKey: "k1" })], searchSources: async () => LIVE,
      fetchSource: async (url: string) => { fetched.push(url); return split(url); },
      read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, supporting: [{ url: "https://washingtonpost.com/a", quote: WAPO }], subjects: [{ url: "https://washingtonpost.com/a", sameEntity: true, language: "English", script: null, why: "same city and event" }, { url: "https://cnbc.com/a", sameEntity: true, language: "English", script: null, why: "same city and event" }] } }) });
    expect(out.status).toBe("advanced"); // NOT none_found and NOT source_quality_unresolved
    expect([fetched.length, fetched.some((u) => u.includes("youtube"))]).toEqual([2, false]); // video excluded
    expect([(db.rows[0] as FactCheck).agreement, (db.rows[0] as FactCheck).confidence]).toEqual(["none_found", "likely"]); }); // AGREEMENT NAMES CARRIERS, NOT READERS: the quote is about a heat record and carries none of the proposed gloss
  it("never names a source behind wording no source carries", async () => {
    reset(); await unit({ read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, proposed: "a gloss no fetched passage contains anywhere" } }) }); // THE DEFECT THIS PINS, found by the operator reading the ladder: the carriers were computed correctly and then the single rung fell back to how many sources were READ, so a row whose every source had been fetched, quoted and verified, and none of which carried the proposal, still reported single_source. That names a source standing behind wording no source said. Three separate fixtures had encoded it.
    const none = db.rows[0] as FactCheck; reset(); await unit({}); const carried0 = db.rows[0] as FactCheck; // and one that DOES carry it is still a single source
    expect([none.agreement, none.confidence === "confirmed", none.sources.filter((x) => x.says.trim() !== "").length, none.note.includes("none of them carries the wording proposed here"), carried0.agreement, carried0.confidence],
      "read is not carried, the passage stays credited, the row says so, and a real carrier still counts").toEqual(["none_found", false, 1, true, "single_source", "confirmed"]);});
  it("two credible publishers with no authoritative source stay a finding, credited separately, and never reopen", async () => {
    await unit({ held: [row({ statementKey: "k1", subject: "Ahvaz", current: "Ahvaz holds the record for hottest day ever in Asia at 54 C." })], searchSources: async () => LIVE, fetchSource: split,
      read: reader({ claims: CLAIMS, judge: { ...CONFIRMS, proposed: "Ahvaz reached 129 degrees Fahrenheit, a record for Asia", supporting: [{ url: "https://washingtonpost.com/a", quote: WAPO }, { url: "https://cnbc.com/a", quote: CNBC }], subjects: [{ url: "https://washingtonpost.com/a", sameEntity: true, language: "English", script: null, why: "same city and event" }, { url: "https://cnbc.com/a", sameEntity: true, language: "English", script: null, why: "same city and event" }] } }) });
    const r = db.rows[0] as FactCheck; expect([r.agreement, r.confidence]).toEqual(["single_source", "likely"]); // AGREEMENT IS EARNED, NOT COUNTED: the Post carries the whole proposal, CNBC reports 54 Celsius on Thursday and carries none of "Ahvaz 129 Fahrenheit record Asia", so it corroborates the story and is not a second voice for this wording. Both are still read, credited and kept on the row.
    expect(r.sources.filter((x) => x.says.trim() !== "").length, "both stay credited").toBe(2);
    expect(r.sources.filter((x) => x.says.length > 0)).toHaveLength(2); // each credited with ITS OWN sentence
    db.reopened = []; await unit({ held: [{ ...r, state: "checked" } as FactCheck], read: reader({ claims: { statements: [] }, judge: CONFIRMS }) });
    expect(db.reopened).toEqual([]); }); });

/** THE LAZY BACKFILL: only selected facts are candidates, deterministic first, one direct re-read of the known source when the quote alone cannot carry it, idempotent, neighbours untouched. */
describe("backfilling support onto already-banked facts", () => {
  const mk = (key: string, subject: string, says: string, extra: Record<string, unknown> = {}): FactCheck => ({
    page: "/persian-female-first-names", statementKey: key, subject, current: `Meaning:Wrong ${subject}.`,
    proposed: subject === "Noor" ? "Light" : "Like the moon", literal: null, usage: null,
    sources: [{ url: `https://en.wikipedia.org/wiki/${subject}`, kind: "encyclopedia", says }],
    agreement: "single_source", confidence: "confirmed", verdict: "page_wrong", alsoAt: [], note: "",
    pageContentHash: "h", pageLocator: null, sourceReadAt: NOW.toISOString(), state: "checked",
    rulesVersion: VERIFICATION_RULES_VERSION, evidenceBasis: "b", checkedAt: NOW.toISOString(), ...extra } as FactCheck);
  it("banks Noor for free, lifts Mahsa on its own fetched title, reopens what nothing supports, and reruns for nothing", async () => {
    const { backfillClaimSupport } = await import("@/domains/evidence/pages/claim-support");
    const bank: FactCheck[][] = [], fetches: string[] = [];
    const rows = [mk("noor", "Noor", 'The name Noor means "light"'), mk("mahsa", "Mahsa", 'The name has the meaning "like the moon".', { sources: [{ url: "https://en.wikipedia.org/wiki/Mahsa", kind: "encyclopedia", says: 'The name has the meaning "like the moon".' }, { url: "https://x.example/bio", kind: "publisher", says: "Mahsa Amini was born in 1999." }] }),
      mk("leila", "Leila", 'Laila comes from the Arabic word layl, which means "night", or "dark".', { proposed: "Night or dark" }), mk("bystander", "Yasmin", "unrelated")];
    const deps = { rows: async () => (bank.at(-1) ?? rows).concat(), reopen: async (_p: string, r: FactCheck[]) => r.length, rebank: async (_p: string, r: FactCheck[]) => { bank.push([...(bank.at(-1) ?? rows).filter((x) => x.statementKey !== r[0]!.statementKey), ...r]); return r.length; },
      fetchSource: async (url: string) => { fetches.push(url); return url.includes("Mahsa") ? { text: 'The name has the meaning "like the moon".', title: "Mahsa" } : { text: 'Laila comes from the Arabic word layl, which means "night", or "dark".', title: "Leila (name)" }; } };
    const targets = [{ page: "/persian-female-first-names", statementKey: "noor", onUnsupported: "bank" as const }, { page: "/persian-female-first-names", statementKey: "mahsa", onUnsupported: "bank" as const }, { page: "/persian-female-first-names", statementKey: "leila", onUnsupported: "reopen" as const }];
    const out = await backfillClaimSupport("t", targets, deps); expect(out.map((o) => [o.statementKey, o.action, o.supported])).toEqual([["noor", "banked_supported", 1], ["mahsa", "banked_supported", 1], ["leila", "reopened", 0]]);
    expect(fetches, "Noor cost no fetch; Mahsa and Leila each got one direct re-read; Leila's refetched page STILL defines Laila and its title alone may not bridge two names, so it reopens").toEqual(["https://en.wikipedia.org/wiki/Mahsa", "https://en.wikipedia.org/wiki/Leila"]);
    const mahsa = bank.at(-1)!.find((r) => r.statementKey === "mahsa")!; expect([mahsa.sources[0]!.titleContext, mahsa.sources[0]!.titleContextFrom, mahsa.agreement]).toEqual(["Mahsa", "fetched_document", "single_source"]);
    expect(bank.at(-1)!.find((r) => r.statementKey === "bystander"), "neighbours byte-identical").toEqual(rows[3]);
    const wrote = bank.length; fetches.length = 0; const again = await backfillClaimSupport("t", targets.slice(0, 2), deps); // IDEMPOTENT: the second run finds every artifact current, fetches nothing, writes nothing
    expect([again.every((o) => o.action === "already_current"), bank.length, fetches.length]).toEqual([true, wrote, 0]); });
  /** AND A MISSING-INFORMATION ROW WHOSE ARTIFACTS WERE JUDGED BY THE HEADWORD RULE IS HANDED BACK ONCE. Re-deriving cannot lift a confidence decided at bank time, so only a fresh fact pass settles it; the re-banked artifact then carries the proposition identity, the row reads current, and it never comes back. */
  it("reopens a headword-judged proposition row once, in the account's own words, and passes over one already judged as a proposition", async () => {
    const PROP = "Before 1979, Iran used a tricolour flag of green, white, and red with the Lion and Sun emblem at the center; it remained in use until the 1979 Islamic Revolution", CARRIES = "Before 1979 the flag of Iran was a tricolour of green, white and red charged at the center with the Lion and Sun emblem of the Islamic state.";
    const ctx: SupportContext = { tenantId: "t", page: "/persian-female-first-names", statementKey: "gap", pageLocator: "missing", subject: "iran flag before 1979", claimKind: claimTypeOf("iran flag before 1979", PROP, "missing"), current: "", proposed: PROP, url: "https://en.wikipedia.org/wiki/Flag_of_Iran", kind: "encyclopedia", quote: CARRIES, titleContext: null };
    const headword: ClaimSupport = { version: SUPPORT_ARTIFACT_VERSION, identity: "signed under the headword rule", supported: false, reason: "subject_absent", supportSpan: "", subjectSpan: "", subjectFrom: "quote", relationSpan: "", meaningSpans: [] };
    const other: SupportContext = { ...ctx, url: "https://turkiyetoday.com/x", kind: "publisher" }; // each source's artifact is signed over ITS OWN read, so one artifact can never stand for two
    const gapRow = (a: ClaimSupport, b: ClaimSupport = a): FactCheck => ({ ...mk("gap", "iran flag before 1979", CARRIES), current: "", proposed: PROP, confidence: "likely", pageLocator: "missing", verdict: "page_correct",
      sources: [{ url: ctx.url, kind: "encyclopedia", says: CARRIES, support: a }, { url: other.url, kind: "publisher", says: CARRIES, support: b }] });
    const back: { why?: string }[] = []; const deps = (rows: FactCheck[]) => ({ rows: async () => rows, rebank: async (_p: string, r: FactCheck[]) => r.length, reopen: async (_p: string, _r: FactCheck[], why?: string) => (back.push({ why }), 1) });
    const target = [{ page: "/persian-female-first-names", statementKey: "gap", onUnsupported: "reopen" as const }];
    const first = await backfillClaimSupport("t", target, deps([gapRow(headword), mk("bystander", "Yasmin", "unrelated")]));
    expect([first[0]!.action, back.length, back[0]?.why], "two stale artifacts, so the claim is owed again once and says why").toEqual(["reopened", 1, "Reopened: support is now judged on the proposition the page lacks."]);
    const again = await backfillClaimSupport("t", target, deps([gapRow(deriveSupport(ctx)!, deriveSupport(other)!)]));
    expect([again[0]!.action, again[0]!.supported, back.length], "MUTATION: re-banked under the proposition identity it is current, so nothing is written and it is never handed back twice").toEqual(["already_current", 2, 1]);
    const flagged = [{ ...target[0]!, rulesStale: true }, { page: target[0]!.page, statementKey: "head", onUnsupported: "bank" as const, rulesStale: true }, { page: target[0]!.page, statementKey: "bystander", onUnsupported: "bank" as const, rulesStale: true }];
    const moved = await backfillClaimSupport("t", flagged, deps([gapRow(deriveSupport(ctx)!, deriveSupport(other)!), { ...mk("head", "Delnaz", "unrelated"), current: "", proposed: "Delnaz means heart's delight" }, mk("bystander", "Yasmin", "unrelated")]));
    expect([moved.map((o) => o.action), back.at(-1)!.why, back.length, rulesVersionFor({ subject: "iran flag before 1979", current: "" })], "THE RULES THAT JUDGE A MISSING ANSWER MOVED: the question is owed again once and says so, even though every artifact under it is current and nothing else would ever re-judge it; a headword row with no current wording and a correction flagged the same way are judged by their SHAPE, not by the flag, and neither is handed back; and the re-banked row carries 5, which is what the selection compares, so it is never flagged again").toEqual([["reopened", "banked_unsupported", "banked_unsupported"], "Reopened: the rules that judge a missing answer changed.", 2, 5]); });});

/** DOES THIS PASSAGE SUPPORT THIS WORDING. Verification asks whether a source was read, whether its quote exists and whether it may speak; none of that asks the one question that authorizes a correction. The model may LOCATE spans. Only this may accept them, and it accepts nothing it cannot find verbatim in the exact text that source banked, which is why a biography of a man who held a title can never authorize a given name's meaning however true the biography is. */
describe("a source supports a claim only when its own passage says so", () => {
  const NOOR = 'The name Noor means "light"', MAHSA = 'The name has the meaning "like the moon".', LAILA = 'Laila comes from the Arabic word layl, which means "night", or "dark".';
  const base: SupportContext = { tenantId: "t", page: "/n", statementKey: "noor", pageLocator: "Names", subject: "Noor", claimKind: "word_meaning", current: "Meaning:Bright, radiant, or glowing.",
    proposed: "Meaning: Light.", url: "https://en.wikipedia.org/wiki/Noor_(name)", kind: "encyclopedia", quote: NOOR, titleContext: null };
  const art = (over: Partial<ClaimSupport> = {}): ClaimSupport => ({ version: SUPPORT_ARTIFACT_VERSION, identity: "", supported: true, supportSpan: NOOR, subjectSpan: "Noor", subjectFrom: "quote", relationSpan: "means", meaningSpans: ["light"], ...over });
  /** Sign the artifact the way a banking pass would, so only the case under test is what differs. */
  const signed = (c: SupportContext, over: Partial<ClaimSupport> = {}) => {
    const a = art(over); return { ...a, identity: supportIdentity(c) }; };
  const verdict = (c: SupportContext, over: Partial<ClaimSupport> = {}) => supportFailure(signed(c, over), c);

  it("accepts an explicit definition and refuses every way a passage can fall short of one", () => {
    const mahsaCtx: SupportContext = { ...base, subject: "Mahsa", statementKey: "mahsa", quote: MAHSA,
      proposed: "Meaning: Like the moon.", url: "https://en.wikipedia.org/wiki/Mahsa" };
    const leilaCtx: SupportContext = { ...base, subject: "Leila", statementKey: "leila", quote: LAILA,
      proposed: "Meaning: Night or dark.", url: "https://en.wikipedia.org/wiki/Leila_(name)" };
    const SCATTER: SupportContext = { ...base, quote: 'Noor Inayat Khan was an operator. Nur al-Din means "light".' }; const DELIGHT: SupportContext = { ...base, quote: 'The name Noor means "delight"' };
    const SEA: SupportContext = { ...base, subject: "Darya", statementKey: "darya", proposed: "Meaning: Sea.", quote: 'The name Darya means "sea"' }; const SEARCH: SupportContext = { ...SEA, quote: 'The name Darya means "search"' };
    const cases: Array<[string, UnsupportedReason | null]> = [ ["noor explicit", verdict(base)], // THE LIVE THREE, as their own banked quotes actually read on 2026-08-29.
      ["mahsa says 'the name', never Mahsa", verdict(mahsaCtx, { supportSpan: MAHSA, subjectSpan: "The name", relationSpan: "meaning", meaningSpans: ["like the moon"] })],
      ["laila is not Leila, and edit distance is not evidence", verdict(leilaCtx, { supportSpan: LAILA, subjectSpan: "Laila", relationSpan: "means", meaningSpans: ["night", "dark"] })],
      ["mahsa with same source title", supportFailure(signed({ ...mahsaCtx, titleContext: "Mahsa" }, { supportSpan: MAHSA, subjectSpan: "Mahsa", subjectFrom: "title", relationSpan: "meaning", meaningSpans: ["like the moon"] }), { ...mahsaCtx, titleContext: "Mahsa" })], // The same anaphoric passage DOES carry, when the same source read banked a title naming the subject.
      ["a title that never names the subject", supportFailure(signed({ ...mahsaCtx, titleContext: "Persian given names" }, { supportSpan: MAHSA, subjectSpan: "Mahsa", subjectFrom: "title", relationSpan: "meaning", meaningSpans: ["like the moon"] }), { ...mahsaCtx, titleContext: "Persian given names" })],
      ["a meaning span nobody wrote in this passage", verdict(base, { meaningSpans: ["moon"] })],
      ["spans real, but not the words the proposal needs", verdict(base, { meaningSpans: ["name"] })],
      ["a relation the passage never states", verdict({ ...base, quote: "Noor Inayat Khan was a wartime radio operator." }, { supportSpan: "Noor Inayat Khan was a wartime radio operator.", relationSpan: "was", meaningSpans: ["light"] })],
      ["an empty quote", verdict({ ...base, quote: "" }, { supportSpan: "", subjectSpan: "Noor", meaningSpans: ["light"] })],
      ["a source that ruled itself unsupported", verdict(base, { supported: false, reason: "subject_absent" })],
      ["support assembled from two unrelated sentences", supportFailure(signed(SCATTER, { supportSpan: 'Noor means "light"', subjectSpan: "Noor", relationSpan: "means", meaningSpans: ["light"] }), SCATTER)], // SEMANTIC REASSEMBLY, the failure the whole contract exists to stop: "Noor", "means" and "light" are each genuinely in this quote, but only across two sentences about different people, and the carrying sentence has to be STITCHED to exist. v1 accepted exactly this.
      ["a proposal whose word is only a substring of the passage's", supportFailure(signed(DELIGHT, { supportSpan: 'The name Noor means "delight"', meaningSpans: ["delight"] }), DELIGHT)],
      ["a three letter gloss the passage carries", supportFailure(signed(SEA, { supportSpan: 'The name Darya means "sea"', subjectSpan: "Darya", meaningSpans: ["sea"] }), SEA)],
      ["a three letter gloss the passage only looks like it carries", supportFailure(signed(SEARCH, { supportSpan: 'The name Darya means "search"', subjectSpan: "Darya", meaningSpans: ["search"] }), SEARCH)],
      ["the same artifact offered for another tenant", supportFailure(signed(base), { ...base, tenantId: "other" })],
    ];
    expect(cases).toEqual([
      ["noor explicit", null], ["mahsa says 'the name', never Mahsa", "subject_absent"], ["laila is not Leila, and edit distance is not evidence", "subject_absent"],
      ["mahsa with same source title", null], ["a title that never names the subject", "subject_absent"], ["a meaning span nobody wrote in this passage", "span_not_verbatim"],
      ["spans real, but not the words the proposal needs", "meaning_absent"], ["a relation the passage never states", "relation_absent"],
      ["an empty quote", "empty_quote"], ["a source that ruled itself unsupported", "subject_absent"], ["support assembled from two unrelated sentences", "not_localized"],
      ["a proposal whose word is only a substring of the passage's", "meaning_absent"], ["a three letter gloss the passage carries", null],
      ["a three letter gloss the passage only looks like it carries", "meaning_absent"], ["the same artifact offered for another tenant", "stale"],
    ]);
  });

  /** THE LIVE /iran-flags DEAD END. This row's `subject` is the QUESTION that was researched, which no source sentence ever contains, so the headword rule banked subject_absent through three paid cycles while the judge's own note read "the passages support the pre-1979 flag's colors, emblem, and replacement". A row that corrects nothing owes its PROPOSITION's content, never a headword. */
  it("carries a proposition the page lacks on content share, leaves the gloss and the correction on the headword rule, and signs the two apart", () => {
    const PROP = "Before 1979, Iran used a tricolour flag of green, white, and red with the Lion and Sun emblem at the center; it remained in use until the 1979 Islamic Revolution", CARRIES = "Before 1979 the flag of Iran was a tricolour of green, white and red charged at the center with the Lion and Sun emblem of the Islamic state.";
    const gap = (over: Partial<SupportContext> = {}): SupportContext => ({ ...base, statementKey: "flag", subject: "iran flag before 1979", claimKind: "date_or_event", current: "", proposed: PROP, url: "https://en.wikipedia.org/wiki/Flag_of_Iran", quote: CARRIES, ...over });
    const carried = deriveSupport(gap()), thin = gap({ quote: "Following the 1979 Islamic Revolution, the national banner was changed into its current form." }), AZADEH = 'Azadeh means free, free-minded; also noble, stated less precisely as "Meaning:Free, independent, or liberated."', REPLACEMENT = "Following the 1979 Islamic Revolution, the Iranian flag was changed into its current form. The national flag of the Islamic Republic of Iran is a horizontal tricolour of green, white and red with the national emblem centred on the white band."; // the thin quote carries two of the eleven distinguishing stems, a passage about the change alone; REPLACEMENT is THE FLAG THAT REPLACED THE ONE BEING CLAIMED, live on Flag_of_Iran and banked as confirmed support for it (reviewer, 2026-09-02), six of whose shared words are vocabulary any passage about either flag carries
    expect([!!carried, carried?.supportSpan === CARRIES, carried?.meaningSpans.length, supportFailure(carried, gap()), deriveSupport(gap({ quote: REPLACEMENT, proposed: PROP.replace("1979 Islamic Revolution", "1979 revolution") })), deriveSupport(gap({ quote: REPLACEMENT }))?.meaningSpans.length], "7 of the 10 words the question does NOT supply, so the whole banked passage is the span and the artifact validates under the rule that minted it; the passage about the flag that REPLACED it carries five of nine and is refused, and the residual is named here: end the same proposal on the Islamic Revolution and its own vocabulary lifts that window to exactly six of ten, the bar itself").toEqual([true, true, 7, null, null, 6]);
    expect([deriveSupport(thin), supportFailure({ ...carried!, identity: supportIdentity(thin), supportSpan: thin.quote, subjectSpan: "Islamic", meaningSpans: ["Islamic"] }, thin)], "and a passage naming the revolution alone carries nothing").toEqual([null, "proposition_absent"]);
    expect([deriveSupport(gap({ proposed: "tale, story, fable" })), deriveSupport(gap({ subject: "kire khar meaning", proposed: "Kire khar is a crude Persian insult." })), deriveSupport(gap({ subject: AZADEH, proposed: "Azadeh is a Persian female given name meaning free or free-minded, and also someone noble.", quote: "Azadeh is a Persian female given name meaning free or free-minded, and also someone noble." })), supportIdentity(gap({ subject: AZADEH }))], "a three word gloss the passage never carries is not support; a name with a gloss for a subject is a headword row that never takes this route at all, however long the gloss is; and its identity carries no marker, so the four live name rows keep the artifacts, the authorization and the Ready card they already have").toEqual([null, null, null, "899889f8ff3b70e9202dd6e7828882d75bef887c4aee4e4dd89d742f2308b88a"]);
    const HISTORY = "The Lion and Sun emblem was charged on the centre band of the green, white and red tricolour that Iran flew until the revolution of 1979.", ONE = "Before the 1979 revolution, Iran's flag was a green, white and red tricolour bearing the Lion and Sun emblem.", BOTH = `${ONE} It was replaced after the revolution by the current flag of the Islamic Republic, which carries the Takbir twenty-two times.`; expect([!!deriveSupport(gap({ proposed: ONE, quote: HISTORY })), deriveSupport(gap({ proposed: BOTH, quote: HISTORY }))], "ONE PASSAGE CARRIES THE ANSWER, at the 0.6 bar this contract keeps: the History sentence carries six of the seven words the question does not supply, and the composite the live judge assembled from two sources carries six of sixteen, because the half about what replaced the flag is in no passage at all").toEqual([true, null]);
    expect([verdict(base), supportIdentity(base), supportIdentity(gap())], "MUTATION: drop the marker and the second hash moves back onto the first rule; a correction's is pinned byte for byte, so no banked correction artifact goes stale").toEqual([null, "32aadde8e93bfc1337c2f54bcd4f4f86f605d7a4798901fd40466c2a7a55ec13", "cd4c65c0a308528e07650fc3329a04f9a22019a74c0767666a0b45076f205893"]); });

  it("retires itself the moment any input it was signed over moves", () => {
    const good = signed(base); const moved: Array<[string, Partial<SupportContext>]> = [["the proposed wording", { proposed: "Meaning: Radiance." }], ["the quote", { quote: 'The name Noor means "lamp"' }],
      ["the source", { url: "https://example.org/other" }], ["the title context", { titleContext: "Noor" }], ["the claim it was written for", { statementKey: "mahsa", subject: "Mahsa" }]];
    expect(moved.map(([what, over]) => [what, supportFailure(good, { ...base, ...over })])).toEqual(moved.map(([what]) => [what, "stale"]));
    expect(supportFailure(good, base)).toBeNull(); // and stands while nothing moved
  });
});
