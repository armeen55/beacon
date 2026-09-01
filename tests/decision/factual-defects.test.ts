import { describe, expect, it, vi, beforeEach } from "vitest";
const checks = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/lib/llm-call-cache", () => ({ readLlmCallCache: async () => null, writeLlmCallCache: async () => {}, llmCallCacheKey: () => "k", recentLlmCallTexts: async () => [] }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>();
  return { ...real, readFactChecks: async () => checks.rows };});
const store = vi.hoisted(() => ({ rows: [] as { id: string }[], withdrew: [] as string[], why: [] as string[], bodyFails: false }));
/** THE REAL PERSISTENCE DOOR, behind the shared fake: saveChangeProposal and loadChangeProposal below are production. */
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], client: {} as Record<string, unknown> }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
vi.mock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<typeof import("@/domains/decision/proposal-store")>()),
  loadChangeProposals: async () => new Map(store.rows.map((r) => [r.id, r])),
  withdrawChangeProposal: async (p: { id: string }, reason?: string) => { store.withdrew.push(p.id); store.why.push(reason ?? ""); return true; } }));
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<typeof import("@/domains/evidence/pages/owned-context")>()), // THE PAGE AS DECISION CAN SEE IT: a correction is work only while the page still says what it objected to.
  loadOwnedPageBodies: async (_t: string, urls: string[]) => { if (store.bodyFails) throw new Error("the page bodies could not be read"); // KEYED AS THE REAL LOADER KEYS: canonically. Raw-url keying here hid the producer reading this map with the wrong key and refusing every banked check site-wide; with this keying, every mint test below IS the regression pin for that join.
    if ((urls?.length ?? 0) > 7) return new Map(); // AND BOUNDED AS THE REAL LOADER IS BOUNDED: an over-wide ask returns nothing at all, which live starved the mint the day checks crossed seven pages.
    return new Map([[canonicalUrlKey(PAGE), { title: "Persian female names", h1: null, headings: [], passages: ["Afsaneh means Goddess, divine and strong."] }]]); } }));
import { FACTUAL_DEFECTS } from "@/domains/decision/producers/factual-defects";
import { loadChangeProposal, saveChangeProposal } from "@/domains/decision/proposal-store";
import { openHold } from "@/domains/decision/completeness";
import { REVIEW_CONTRACT, copyKey } from "@/domains/decision/proof";
import { supabaseFake } from "../helpers/supabase-fake";
import type { ChangeProposal } from "@/domains/decision/contracts";
Object.assign(db.client, supabaseFake({ rows: () => db.rows, insertDefaults: () => ({ created_at: "2026-07-01T00:00:00.000Z" }) }));
const factualDefectCards = FACTUAL_DEFECTS.cards, reviewFactualBundle = FACTUAL_DEFECTS.review;
import { pageHashOf } from "@/domains/evidence/pages/fact-check-run";
import { VERIFICATION_RULES_VERSION } from "@/domains/evidence/pages/fact-checks";
import { claimTypeOf, deriveSupport } from "@/domains/evidence/pages/claim-support";
import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";
const NOW = new Date("2026-08-17T00:00:00.000Z");
const PAGE = "https://x.example/persian-female-first-names";
const LIVE_HASH = pageHashOf(["Persian female names", "Afsaneh means Goddess, divine and strong."].join("\n"));
const snapshot = { scope: { site: "x.example" }, ownedPages: [{ url: PAGE, search: { impressions90d: 100 } }] } as unknown as EvidenceSnapshot;
/** EVERY FIXTURE EARNS ITS ARTIFACTS THE REAL WAY: each source's quote goes through the same deterministic derivation production runs, so a quote that genuinely carries its claim is supported and one that does not is refused. Nothing is hand-signed. */
type Src = { url: string; kind: string; says: string; titleContext?: string; support?: unknown };
const bless = (row: Record<string, unknown>): Record<string, unknown> => ({ ...row,
  sources: (row.sources as Src[]).map((s) => { const a = deriveSupport({ tenantId: "t", page: String(row.page),
    statementKey: String(row.statementKey), pageLocator: (row.pageLocator as string | null) ?? null,
    subject: String(row.subject), claimKind: claimTypeOf(String(row.subject), String(row.current), (row.pageLocator as string | null) ?? null),
    current: String(row.current), proposed: String(row.proposed ?? ""), url: s.url, kind: s.kind as never,
    quote: s.says, titleContext: s.titleContext ?? null }); return a ? { ...s, support: a } : s; }) });
const check = (over: Record<string, unknown> = {}) => bless({
  page: "/persian-female-first-names", statementKey: String(over.subject ?? "Afsaneh").toLowerCase(),
  pageContentHash: LIVE_HASH, evidenceBasis: "basis_x::d8", state: "checked", rulesVersion: VERIFICATION_RULES_VERSION,
  sourceReadAt: "2026-08-17T00:00:00.000Z", pageLocator: null, subject: "Afsaneh", current: "Goddess, divine and strong.",
  proposed: "Legend, myth, fable in Persian.", language: "Persian", literal: "legend", usage: null,
  sources: [{ url: "https://www.behindthename.com/name/afsaneh", kind: "dictionary", says: "the name Afsaneh means legend, myth or fable in Persian" },
    { url: "https://en.wiktionary.org/wiki/افسانه", kind: "dictionary", says: "fable" }],
  agreement: "multiple_agree", confidence: "confirmed", verdict: "page_wrong", alsoAt: [], note: "",
  checkedAt: "2026-08-17T00:00:00.000Z", ...over });
import { mutationFootprint, footprintsOverlap } from "@/domains/decision/mutation-footprint";
import { wordingOnlySuspicion } from "@/domains/decision/proof";
/** PHASE 0 TRUTH, corrected (operator, 2026-08-30): a bag of words is a SUSPICION for the reviewer, never a proof. Only the literally identical skips deterministically; "fear of God" versus "God's fear" shares tokens without sharing meaning, so the suspected card MINTS and is held for the one reviewer's materiality ruling. */
it("keeps the judge's semicolon, holds the suspected no-op for the reviewer, and skips only the literally identical", async () => {
  checks.rows = [check({ proposed: "free, free-minded; also noble", verdict: "page_imprecise", sources: [{ url: "https://en.wiktionary.org/wiki/x", kind: "dictionary", says: "the name Afsaneh means free, free-minded; also noble" }] }), check({ subject: "Yadollah", statementKey: "yadollah", current: "Hand of God", proposed: "God's hand", verdict: "page_imprecise", sources: [{ url: "https://en.wikipedia.org/wiki/Yadollah", kind: "encyclopedia", says: "the name Yadollah means God's hand" }] }),
    check({ subject: "Roshan", statementKey: "roshan", current: "Meaning: Light.", proposed: "Light", verdict: "page_imprecise", sources: [{ url: "https://en.wiktionary.org/wiki/r", kind: "dictionary", says: "the name Roshan means light" }] })];
  const out = await factualDefectCards({ tenantId: "t", snapshot, now: NOW }); const after = (out.cards.find((c) => c.id.includes("fact-afsaneh")) as { recommendedChange?: { after?: string } } | undefined)?.recommendedChange?.after ?? ""; const yad = out.cards.find((c) => c.id.includes("fact-yadollah"));
  expect([after.includes("free-minded; also noble"), after.includes("or also"), yad != null, wordingOnlySuspicion(yad as never), out.cards.some((c) => c.id.includes("fact-roshan"))], "the semicolon survives, the suspected rewording mints for the reviewer to rule, and the identical composition mints nothing").toEqual([true, false, true, true, false]);
  expect([wordingOnlySuspicion({ recommendedChange: { before: "Fear of God", after: "God's fear" } } as never), wordingOnlySuspicion({ recommendedChange: { before: "Meaning: Light.", after: "Meaning: Light" } } as never)], "equal tokens are only ever a suspicion, and a pure punctuation repair is not suspicious at all").toEqual([true, false]); });
const many = (n: number) => Array.from({ length: n }, (_, i) =>
  check({ subject: `Name${i}`, current: `Wrong meaning ${i}.`, proposed: `Right gloss ${i}.`,
    sources: [{ url: `https://en.wiktionary.org/w${i}`, kind: "dictionary", says: `Name${i} means right gloss ${i}` }] }));
describe("a page's own statements against their sources", () => {
  beforeEach(() => { checks.rows = []; store.rows = []; store.withdrew = []; store.why = []; store.bodyFails = false; });
  it("a correction whose evidence stopped being current is withdrawn, and a page nobody could read is left alone", async () => {
    const live = "t::/persian-female-first-names::existing_edit::fact-afsaneh", dead = "t::/persian-female-first-names::existing_edit::fact-darya";
    store.rows = [{ id: live }, { id: dead }, { id: "t::/other::existing_edit::fact-elsewhere" }];
    checks.rows = [check()]; // Afsaneh still authorized; Darya's row is gone, and /other was never read this pass
    await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(store.withdrew).toEqual([dead]);
    const LIFT = "The name comes from Old French jessemin, from Persian yasamin and nothing else besides";
    checks.rows = [check({ subject: "Afsaneh", proposed: LIFT, sources: [{ url: "https://en.wiktionary.org/j", kind: "dictionary", says: LIFT }] }),
      check({ subject: "Afsaneh", state: "superseded", proposed: "Nothing any quote carries" })];
    store.rows = [{ id: "t::/persian-female-first-names::existing_edit::fact-afsaneh" }]; store.withdrew = []; store.why = [];
    await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(store.why.join(" "), "the live reading's own refusal").toContain("restates the source's own sentence");
    const stripped = check() as { sources: { support?: unknown }[] }; // A ROW EVERY OLDER RULE ACCEPTS AND NO ARTIFACT SUPPORTS IS WITHDRAWN SAYING SO: exactly the passage that used to authorize silently.
    stripped.sources = stripped.sources.map((x) => ({ ...x, support: undefined }));
    checks.rows = [stripped]; store.rows = [{ id: "t::/persian-female-first-names::existing_edit::fact-afsaneh" }]; store.withdrew = []; store.why = [];
    await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(store.why.join(" "), "the support shortfall names itself").toContain("no source's own passage has been shown to support this exact claim");
    store.withdrew = []; store.bodyFails = true;
    await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(store.withdrew).toEqual([]); });

  it("turns forty sourced corrections into forty separately ranked changes that nothing can retire together", async () => {
    checks.rows = many(40);
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards).toHaveLength(40); expect(new Set(cards.map((c) => c.id)).size, "each correction owns its own row").toBe(40);
    expect(new Set(cards.map((c) => [...mutationFootprint(c)].join("|"))).size).toBe(40); expect(footprintsOverlap(cards[0]!, cards[1]!)).toBe(false);
    expect(cards.every((c) => c.bundle === undefined)).toBe(true); expect(cards.every((c) => !/batch/i.test(c.opportunityType))).toBe(true); });
  it("gives every correction its exact current wording, its replacement, its place and its source", async () => {
    checks.rows = [check({ alsoAt: ["the FAQ answer on this page"] })];
    const [card] = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards;
    expect(card!.recommendedChange).toMatchObject({ kind: "existing_edit", field: "section",
      before: "Goddess, divine and strong.", after: "Legend, myth, fable in Persian." });
    expect((card!.recommendedChange as { where?: string }).where).toContain('The "Afsaneh" entry'); expect((card!.recommendedChange as { where?: string }).where).toContain("the FAQ answer on this page");
    expect(card!.supportFacts?.map((f) => f.id)).toEqual(["fact-1", "fact-2"]); expect(card!.supportFacts?.[0]!.fact).toContain('behindthename.com/name/afsaneh says: "the name Afsaneh means legend, myth or fable in Persian"');
    expect(card!.claims?.[0]!.supportedBy).toEqual(["fact-1", "fact-2"]);
    expect(card!.status, "Beacon's own reviewer has not read it yet, so it is not offered as finished").toBe("needs_review"); });
  it("a hypothesis or a homograph derivation never authorizes a flat replacement", async () => {
    const src = (says: string) => [{ url: "https://en.wikipedia.org/x", kind: "encyclopedia", says }];
    checks.rows = [check({ subject: "Maryam", proposed: "beloved", sources: src('The name may have originated from the root mr "love; beloved"') }),
      check({ subject: "Ariana", proposed: "Most holy", sources: src('The name Ariana is the Latinized form of the Ancient Greek name Ariadne ("most holy")') }),
      check({ subject: "Aryana", proposed: "silver", sources: src('Ariana is sometimes used as a Welsh name, an elaboration of Welsh: arian "silver."') }),
      check({ subject: "Leila", proposed: "Night", sources: src('The name Leila comes from the Arabic word layl, which means "night"') })]; // THE QUOTE NAMES LEILA HERSELF: the old fixture named Laila and still minted, the exact live defect claim-support refuses now, so the clean case that SHOULD mint has to earn it.
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards.map((c) => c.id.split("fact-")[1])).toEqual(["leila"]); });
  it("the banked quote is the only text that may authorize a short gloss, and a citation is not a gloss", async () => {
    const q = (says: string) => [{ url: "https://en.wikipedia.org/z", kind: "encyclopedia", says }];
    const ALBORZ_QUOTE = "The name Alborz is derived from Hara Barazaiti, a legendary mountain in the Avesta.";
    const JQ = "The name comes from Old French jessemin, from Persian یاسمن, romanized: yāsamin";
    checks.rows = [
      check({ subject: "Alborz", proposed: "Mountain Rampart", literal: "Mountain Rampart", sources: q(ALBORZ_QUOTE) }),
      check({ subject: "Yas", current: "Meaning:Old words.", proposed: "The jasmine flower", sources: q('yās means the jasmíne-flower') }),
      check({ subject: "Jasmine", current: "Meaning:Water lily, pure and serene.", proposed: JQ, sources: q(JQ) })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards.map((c) => c.id.split("fact-")[1]), "only the quote-carried gloss mints").toEqual(["yas"]);
    const { unauthorizedReason } = await import("@/domains/evidence/pages/fact-checks");
    expect(unauthorizedReason(checks.rows[0] as never)).toContain("do not carry every word of the proposal");
    expect(unauthorizedReason(checks.rows[2] as never)).toContain("restates the source's own sentence");
    expect(unauthorizedReason(checks.rows[1] as never)).toBeNull();
    const two = (a: Record<string, string>, b: Record<string, string>) => [a, b] as never; // EVERY MATERIAL WORD COMES FROM THE AUTHORITATIVE SET. An authoritative source contributing ONE word while an ordinary publisher supplies the decisive one is still incomplete provenance: live, Parisa published "beautiful like a fairy" off an encyclopedia saying only "fairy-like".
    const src = (kind: string, says: string) => ({ url: `https://x.example/${kind}${says.length}`, kind, says });
    const parisa = check({ subject: "Parisa", current: "Meaning:Fairy-like, ethereal, or angelic.", proposed: "like a fairy; beautiful like a fairy",
      sources: two(src("encyclopedia", "Parisā ( Persian : پریسا, lit. ' fairy-like ' ) is a Persian feminine given name."),
        src("publisher", '"Parisa" means "like a fairy" or "beautiful like a fairy."')) });
    expect(unauthorizedReason(parisa as never), "the live Parisa record").toContain("do not carry every word of the proposal"); expect(unauthorizedReason(check({ subject: "Aryana", proposed: "silver", literal: "silver",
      sources: two(src("dictionary", "Aryana is a Persian feminine given name."), src("publisher", "Aryana means silver.")) }) as never)).toContain("do not carry every word");
    expect(unauthorizedReason(check({ subject: "Aryana", proposed: "silver",
      sources: two(src("dictionary", 'Aryana means "silver".'), src("publisher", "A popular name this year.")) }) as never), "authoritative carries all, weak corroborates").toBeNull();
    expect(unauthorizedReason(check({ subject: "Aryana", proposed: "bright silver",
      sources: two(src("dictionary", 'Aryana means "silver".'), src("encyclopedia", "The name reads as bright.")) }) as never), "two authoritative sources together").toBeNull();
    expect(unauthorizedReason(check({ subject: "Aryana", proposed: "silver",
      sources: two(src("news", "Aryana means silver."), src("news", "Aryana means silver.")) }) as never)).toContain("no authoritative source");
    const { glossCarriedBy } = await import("@/domains/evidence/pages/fact-checks");
    expect(glossCarriedBy("Light", ["reading it is a delight"]), "delight is not light").toBe(false); expect(glossCarriedBy("Gods", ["the goddess of dawn"]), "goddess is not gods").toBe(false);
    expect(glossCarriedBy("founded 1979", ["established in 1,979 by decree", "founded by decree"])).toBe(true); expect(glossCarriedBy("Studies", ["the study of names"])).toBe(true);
    expect(glossCarriedBy("Shining", ["the name shines brightly"])).toBe(true); expect(glossCarriedBy("Sea", ["totally unrelated quote"]), "no vacuous pass on a short gloss").toBe(false);
    expect(glossCarriedBy("Sea", ['darya means "sea"'])).toBe(true); });

  it("mints nothing off a stale page version, an unread source, history, or replaced verification rules", async () => {
    for (const bad of [{ pageContentHash: "stale" }, { sourceReadAt: null }, { state: "history" }, { rulesVersion: 1 }]) { checks.rows = [check(bad)];
      expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0); } });
  it("checks spread over more pages than one body read allows still mint, batch by batch", async () => {
    const wide = { scope: { site: "x.example" }, ownedPages: [{ url: PAGE, search: { impressions90d: 100 } }, ...Array.from({ length: 7 }, (_, i) => ({ url: `https://x.example/p${i}` }))] } as unknown as EvidenceSnapshot;
    checks.rows = [check(), ...Array.from({ length: 7 }, (_, i) => check({ page: `/p${i}`, statementKey: `s${i}`, subject: `S${i}`, pageContentHash: "elsewhere" }))];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot: wide, now: NOW });
    expect(cards.map((c) => c.id.split("fact-")[1]), "an eight-page account reads its bodies in bounded batches").toEqual(["afsaneh"]); });
  it("refuses to replace published words on anything less than a confirmed, source-backed contradiction", async () => {
    for (const bad of [{ verdict: "page_correct" }, { confidence: "disputed" }, { confidence: "unsupported" }, { proposed: null }, { current: "" }, { sources: [] }]) { checks.rows = [check(bad)];
      expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0); } });
  it("shows the worst first, never the alphabet", async () => {
    const carry = (name: string) => [{ url: `https://en.wiktionary.org/${name}`, kind: "dictionary", says: `The name ${name} means legend, myth or fable in Persian` }];
    checks.rows = [check({ subject: "Aaa", agreement: "single_source", alsoAt: [], sources: carry("Aaa") }), check({ subject: "Zzz", agreement: "multiple_agree", alsoAt: ["the FAQ"], sources: carry("Zzz") })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards[0]!.opportunityType).toContain("Zzz"); });
  /** A NARROWER SOURCE IS NOT A FALSE PAGE (operator, 2026-08-31). Live this asked the operator to spend two minutes turning "Spring, symbolizing renewal and growth" into "Spring", plus three more like it: correct, sourced, and strictly worse for the reader. Only a contradiction may take words away now. */
  it("a source that merely says less never asks the operator to make the page thinner", async () => {
    const src = (n: string, says: string) => [{ url: `https://en.wiktionary.org/${n}`, kind: "dictionary", says }];
    checks.rows = [check({ subject: "Bahar", statementKey: "bahar", current: "Meaning:Spring, symbolizing renewal and growth.", proposed: "Spring", verdict: "page_imprecise", sources: src("b", "the name Bahar means spring") }),
      check({ subject: "Delnaz", statementKey: "delnaz", current: "Meaning:Blooming with creativity.", proposed: "Loved of the heart", verdict: "page_wrong", sources: src("d", "the name Delnaz means loved of the heart") })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards.map((c) => c.id.split("fact-")[1]), "the pure narrowing is dropped and the contradiction survives").toEqual(["delnaz"]); });
  it("mints nothing for a page this account does not own", async () => { checks.rows = [check({ page: "/not-ours" })];
    expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0); });});
describe("Beacon reviews its own corrections, one page at a time", () => {
  beforeEach(() => { checks.rows = []; });
  it("names which kind of correction it is, and never calls a narrowing a falsehood", async () => {
    const src = (says: string) => [{ url: "https://en.wikipedia.org/n", kind: "encyclopedia", says }]; // TWO OF THE THREE LIVE CORRECTIONS ARE page_imprecise and every card said "X means Y, not Z". Telling a paying customer their page is wrong when the sources merely sharpen it is an overclaim. The kind is read from the STORED verdict and the two wordings, never from the copy.
    checks.rows = [
      check({ subject: "Leila", verdict: "page_wrong", current: "Meaning:Beauty and purity.", proposed: "Night; dark", sources: src('The name Leila means "night", or "dark"') }),
      check({ subject: "Noor", verdict: "page_imprecise", current: "Meaning:Bright, radiant, or glowing.", proposed: "Light", sources: src('The name Noor means "light"') }),
      check({ subject: "Mahsa", verdict: "page_imprecise", current: "Meaning:Like the moon.", proposed: "Like the moon", sources: [{ url: "https://en.wikipedia.org/n", kind: "encyclopedia", says: 'The name has the meaning "like the moon"', titleContext: "Mahsa" }] })]; // THE SAME-FETCH TITLE IDENTIFIES THE ANAPHORIC PASSAGE: the live Mahsa shape, supportable only because the fetched document's own title names her while the sentence says "the name".
    const by = new Map((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards.map((c) => [c.id.split("fact-")[1]!, c]));
    const say = (k: string) => [by.get(k)!.opportunityType, (by.get(k)!.claims ?? [])[0]!.text, by.get(k)!.whyItMatters].join(" | ");
    expect(say("leila"), "page_wrong contradicts").toContain("contradict"); expect(say("leila")).toContain("Correct what"); // A REAL FALSEHOOD KEEPS DIRECT LANGUAGE.
    expect(say("noor"), "page_imprecise sharpens").toContain("less precisely"); // A NARROWING SAYS SO, and never that the page is wrong.
    const CARRIER = new Set(["the", "and", "not", "its", "for", "with", "from", "that", "this", "was", "are"]); // ANCHORED TO ITS OWN EVIDENCE: `staleCopyReasons` refuses a claim overlapping its cited evidence by under a quarter, and a version leading with the page's current wording pushed two live corrections out of Ready reading "argues from support nobody banked".
    const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !CARRIER.has(w));
    for (const k of ["leila", "noor", "mahsa"]) { const card = by.get(k)!, mine = words((card.claims ?? [])[0]!.text);
      const its = new Set(words((card.supportFacts ?? []).map((f) => f.fact).join(" ")));
      expect(mine.filter((w) => its.has(w)).length / Math.max(1, mine.length), `${k} claim stays anchored to its evidence`).toBeGreaterThanOrEqual(0.25); }
    expect(say("noor"), "no falsehood language on a narrowing").not.toMatch(/contradict|say otherwise|wrong meaning/); expect(by.get("noor")!.opportunityType).toContain("Sharpen");
    expect(say("mahsa"), "mechanical only").toContain("broken formatting"); expect(say("mahsa")).not.toMatch(/contradict|more precisely/); // THE SAME WORDS WITH BROKEN PUNCTUATION ARE A FORMATTING REPAIR, whatever the verdict says.
    const after = (k: string) => (by.get(k)!.recommendedChange as { after: string }).after; // AND THE RENDERED REPLACEMENT IS MECHANICALLY CLEAN: one space after a Latin label, one terminal mark.
    expect([after("noor"), after("mahsa")], "the label is not glued to its value").toEqual(["Meaning: Light.", "Meaning: Like the moon."]);
    expect(after("leila")).toBe("Meaning: Night or dark.");
    const step = (k: string) => (by.get(k)!.operatorSteps ?? []).join(" | "); // AN EXACT LOCATION MAY NOT REPEAT ITSELF. Live, `also_at` held the row's OWN locator on every correction, so the Find step read "the Noor entry, and the same statement at: <the section it is already in>".
    expect(step("noor"), "the entry's own section is not a second place").not.toContain("the same statement at");
    expect(step("noor"), "and the one place it names is still named").toContain('Find the "Noor" entry');
    checks.rows = [check({ subject: "Noor", verdict: "page_imprecise", current: "Meaning:Bright.", proposed: "Light",
      pageLocator: "Girl names", alsoAt: ["Girl names", "A to Z index"], sources: src('The name Noor means "light"') })];
    const two = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!;
    expect((two.operatorSteps ?? []).join(" "), "a real second location survives").toContain("A to Z index");
    expect((two.operatorSteps ?? []).join(" "), "the duplicate does not").not.toContain("Girl names; ");
    const everything = [...by.values()].flatMap((c) => [(c.claims ?? [])[0]?.text ?? "", c.whyItMatters]); // AND A QUOTED SENTENCE CARRIES ONE TERMINAL MARK, never the page's stop plus another.
    for (const line of everything) expect(line, "no doubled stop").not.toMatch(/[.!?]"\./);
    checks.rows = [check({ subject: "Ghost", confidence: "unsupported", proposed: "anything at all" })]; // AN UNSUPPORTED ROW NEVER BECOMES CONFIDENT CORRECTION COPY: it does not mint at all.
    expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards, "unsupported mints nothing").toEqual([]);});
  const cardsOf = async (n: number) => { checks.rows = many(n); return (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards; };
  it("clears a correction to ready, holds another with its reason, and never charges the operator with the checking", async () => {
    const cards = await cardsOf(3);
    const ok = (i: number) => ({ index: i, publish: true, reason: "reads cleanly and matches its source", // PUBLISH IS DERIVED FROM THE CLAIM RULINGS, never taken from the model: a reviewer that says publish while ruling the claim unsupported is not a pass, and a ruling that never came is not silence in Beacon's favour.
      claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "the quoted passage carries the corrected meaning" }] });
    const complete = async () => ({ status: "drafted" as const, value: { rulings: [ok(0),
      { index: 1, publish: false, reason: "the replacement contradicts its own source", claims: [{ claim: 0, factIds: ["fact-1"], entailed: false, why: "the passage says something else" }] }, ok(2)] } });
    const coarse = async () => ({ status: "drafted" as const, value: { rulings: [0, 1, 2].map((i) => ({ index: i, publish: true, reason: "reads cleanly" })) } }); // A REVIEWER ANSWERING THE OLD COARSE SHAPE AUTHORIZES NOTHING: publish is derived from claim rulings, so a verdict carrying none of them is silence about every claim rather than a yes to all of them.
    const old = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete: coarse });
    expect(old.map((c) => c.status), "publish alone is not entailment").toEqual(old.map(() => "needs_review"));
    const rule = (over: Record<string, unknown>) => async () => ({ status: "drafted" as const, value: { rulings: cards.map((_c, i) => ({ // THE RETURNED MAPPING IS CHECKED, NOT TIDIED. A ruling naming a claim that does not exist and a fact nobody banked, marked entailed, cleared every card while the producer wrote a clean authorization from its OWN ids: self-authorization wearing a reviewer's name. Each shape below must hold the card instead.
      index: i, publish: true, reason: "looks fine", claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "carried" }], ...over })) } });
    const promoted = async (over: Record<string, unknown>) => (await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: rule(over) })).filter((c) => c.status === "ready");
    for (const [what, over] of [["a claim number nobody made", { claims: [{ claim: 99, factIds: ["fact-1"], entailed: true, why: "w" }] }],
      ["evidence nobody banked", { claims: [{ claim: 0, factIds: ["wrong-fact"], entailed: true, why: "w" }] }],
      ["a claim ruled twice", { claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "w" }, { claim: 0, factIds: ["fact-1"], entailed: true, why: "w" }] }],
      ["a claim the row never made, alongside the real one", { claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "w" }, { claim: 1, factIds: ["fact-1"], entailed: true, why: "w" }] }],
      ["the reviewer's own no", { claims: [{ claim: 0, factIds: ["fact-1"], entailed: false, why: "the passage says something else" }] }],
      ["a sense refusal over an entailed claim", { publish: false, reason: "reads badly" }]] as const)
      expect(await promoted(over), `${what} authorizes nothing`).toEqual([]);
    const withStray = async () => ({ status: "drafted" as const, value: { rulings: [...cards.map((_c, i) => ({ index: i, publish: true, reason: "fine", // AND NOTHING RETURNED IS SILENTLY DROPPED: a ruling for a component nobody asked about was ignored, so a response could carry anything at all beside the real ones and still clear the batch.
      claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "carried" }] })),
      { index: 99, publish: true, reason: "about nothing here", claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "w" }] }] } });
    expect((await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: withStray })).filter((c) => c.status === "ready"),
      "a ruling about a component nobody asked about").toEqual([]);
    const earned = await promoted({ claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "the quoted passage carries it" }] }); // AND WHAT IS BANKED IS WHAT THE REVIEWER RETURNED: the ids come back from the ruling, not from the row.
    expect(earned.length, "an exact ruling still earns Ready").toBeGreaterThan(0);
    expect(earned[0]!.semanticReview!.claims).toEqual([{ i: 0, by: ["fact-1"], entailed: true }]);
    checks.rows = [check({ subject: "Pair", current: "Wrong.", proposed: "Right.", // A CARD STANDING ON TWO PASSAGES MUST BE RULED AGAINST BOTH: naming only one of them is a different question than the claim asks, and every named id is banked, so nothing else catches this.
      sources: [{ url: "https://en.wiktionary.org/a", kind: "dictionary", says: "Pair means right" }, { url: "https://en.wikipedia.org/b", kind: "encyclopedia", says: "Pair also means right" }] })];
    const two = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards;
    expect(two[0]!.claims![0]!.supportedBy.length, "the card really declares two").toBe(2);
    const ruleTwo = (ids: string[]) => async () => ({ status: "drafted" as const, value: { rulings: [{ index: 0, publish: true, reason: "fine",
      claims: [{ claim: 0, factIds: ids, entailed: true, why: "carried" }] }] } });
    expect((await reviewFactualBundle(two, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: ruleTwo(["fact-1"]) })).filter((c) => c.status === "ready"),
      "ruled against one of the two passages the claim names").toEqual([]);
    const both = (await reviewFactualBundle(two, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: ruleTwo(["fact-2", "fact-1"]) })).filter((c) => c.status === "ready");
    expect(both[0]!.semanticReview!.claims, "and both, in any order, is what it banks").toEqual([{ i: 0, by: ["fact-1", "fact-2"], entailed: true }]);
    let shown = ""; await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 9 }, // AND THE REVIEWER WAS ACTUALLY SHOWN WHAT IT RULED ON: the canonical claim, its own fact ids, and the exact passage behind each.
      complete: async (i: { user: string }) => { shown = i.user; return { status: "drafted" as const, value: { rulings: [{ index: 0, publish: false, reason: "n", claims: [{ claim: 0, factIds: ["fact-1"], entailed: false, why: "n" }] }] } }; } });
    expect(shown).toContain("claim 0:");
    expect(shown).toContain("must be entailed by exactly these fact ids: fact-1");
    expect(shown, "the exact passage, not an anonymous source blob").toMatch(/fact-1: "[^"]{10,}/);
    const roundTrip = async (p: ChangeProposal) => { db.rows = []; await saveChangeProposal(p); // AND THE PRODUCTION DOOR AGREES AFTER A REAL SAVE AND RELOAD, not a serializer round trip: the mapping the reviewer returned is what comes back, the row is still Ready, and the one servability verdict holds nothing.
      return (await loadChangeProposal("t", p.id))!; };
    const { PROMPT_REGISTRY } = await import("@/domains/decision/llm/prompt-registry"); // THE PERSISTED AUTHORIZATION CONTRACT IS ITS OWN NUMBER, not a prompt cache version: it read draft.factual_review, which would have governed the substantive editor's receipts by accident.
    expect(REVIEW_CONTRACT).not.toBe(PROMPT_REGISTRY["draft.factual_review"]);
    expect([PROMPT_REGISTRY["draft.editor_judgement"] >= 3, PROMPT_REGISTRY["draft.aeo_gap"] >= 2], "a changed reader packet may not serve its old cached answers").toEqual([true, true]); // AND A PROMPT WHOSE RESPONSE CONTRACT CHANGED CARRIES A NEW VERSION, or an answer shaped for the old one is served from cache and refused on arrival: the editor stopped returning `claimsEntailed` at v3.
    const live = await roundTrip(earned[0]!);
    expect(live.semanticReview!.claims, "the reviewer's own mapping survived the store").toEqual([{ i: 0, by: ["fact-1"], entailed: true }]);
    expect([live.status, openHold(live).blocking], "and it is still offered").toEqual(["ready", null]);
    for (const [what, broken] of [ // The same path refuses each defective receipt, and the store will not keep `ready` on any of them.
      ["a receipt banked under an earlier contract", { ...earned[0]!, semanticReview: { ...earned[0]!.semanticReview!, version: 3 } }], // LITERALLY 2: the prompt, schema, packet, validation and persistence all changed after v2, so a receipt banked under the broken implementation must not be able to look current.
      ["a mapping naming evidence the claim does not", { ...earned[0]!, semanticReview: { ...earned[0]!.semanticReview!, claims: [{ i: 0, by: ["fact-9"], entailed: true }] } }],
      ["a reading written for other words", { ...earned[0]!, semanticReview: { ...earned[0]!.semanticReview!, of: `${copyKey(earned[0]!)}x` } }]] as const) {
      const held2 = await roundTrip(broken as ChangeProposal);
      expect([held2.status !== "ready", openHold(held2).blocking != null], what).toEqual([true, true]);}
    const dead = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: async () => ({ status: "refused" as const }) }); // A REVIEW THAT DID NOT COME BACK DRAFTED (refused, failed, thrown: one branch answers them all) BANKS NOTHING, fabricates no receipt, and loses no card.
    expect(dead.filter((c) => c.status === "ready" || c.semanticReview), "no reading, no receipt").toEqual([]);
    expect(dead, "no reading moves nothing").toBe(cards); // AND THE SAME ARRAY COMES BACK: a fresh copy read as "moved" upstream, so a failing pass persisted these unreviewed copies over a banked paid review and erased it. Identity is the no-rewrite receipt.
    const out = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete });
    expect(out.map((c) => c.status)).toEqual(["ready", "needs_review", "ready"]);
    expect(out[1]!.limitations[0]).toContain("Held by Beacon's own review");
    expect(out[1]!.recommendedChange, "a held correction keeps its exact words").toEqual(cards[1]!.recommendedChange); });
  it("a sourced gloss is shaped into the line it replaces, and only its shape", async () => {
    const q1 = (says: string) => [{ url: "https://en.wikipedia.org/y", kind: "encyclopedia", says }];
    checks.rows = [check({ subject: "Noor", current: "Meaning:Bright, radiant, or glowing.", proposed: "light", sources: q1('The name Noor means "light"') }),
      check({ subject: "Mahsa", current: "Meaning:Moonbeam, delicate and bright.", proposed: "like the moon", sources: q1('Mahsa means "like the moon"') }),
      check({ subject: "Shab", current: "Meaning:Darkness everlasting.", proposed: "night; dusk; evening", sources: q1('shab means "night", "dusk", or "evening"') }),
      check({ subject: "Roya", current: "Definition:Ambition and hope.", proposed: "a dream", sources: q1('Roya means "a dream"') }),
      check({ subject: "Leila", current: "Meaning:Beauty, purity, and tranquility.", proposed: "Night; dark", sources: [...q1('The name Leila means "night", or "dark"'), { url: "https://x.example/l", kind: "publisher", says: 'night; dark' }] }),
      check({ subject: "Alborz", current: "Alborz\nMeaning:Shining like a heavenly flower.", proposed: "Mountain Rampart", sources: q1('Alborz is derived from Hara Barazaiti, meaning "Mountain Rampart"') })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    const by = new Map(cards.map((c) => [c.id.split("fact-")[1], c]));
    const rc = (k: string) => by.get(k)!.recommendedChange as { before: string; after: string };
    expect(rc("noor")).toMatchObject({ before: "Meaning:Bright, radiant, or glowing.", after: "Meaning: Light." }); // THE PAGE IS AUTHORITATIVE FOR ITS VOICE, NEVER FOR ITS TYPOS (operator, 2026-08-28). The crawled span glues the label to its value; the replacement keeps the label, terminology and sentence shape, and puts the one space there rather than reproducing the page's mistake.
    checks.rows = [check({ subject: "Azadeh", current: "AzadehMeaning:Free, independent, or liberated.", proposed: "free, free-minded; also noble", sources: q1('Azadeh is a Persian female given name meaning free, free-minded also means someone noble') })]; // THE GLUED HEADING, no newline at all (render audit, 2026-08-30): the name is cut off the span exactly as the multi-line case cuts it
    const glued = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!.recommendedChange as { before: string; after: string }; expect([glued.before, glued.after.startsWith("Meaning: ")]).toEqual(["Meaning:Free, independent, or liberated.", true]);
    expect(rc("mahsa").after).toBe("Meaning: Like the moon.");
    expect(rc("leila").after, "two glosses read as a person writes them").toBe("Meaning: Night or dark.");
    expect(rc("shab").after, "three or more keep the list, and only its punctuation is Beacon's").toBe("Meaning: Night, dusk, or evening.");
    expect(rc("alborz")).toMatchObject({ before: "Meaning:Shining like a heavenly flower.", after: "Meaning: Mountain Rampart." });
    expect(rc("roya").after, "any ordinary label, not a hardcoded one").toBe("Definition: A dream."); // THE LABEL ITSELF IS THE PAGE'S, whatever it says: nothing here knows the word "Meaning".
    expect(by.get("noor")!.limitations[0], "nothing deterministic holds a composed line").toContain("has not read this correction yet");
    const { staleCopyReasons } = await import("@/domains/decision/drafted-copy");
    expect(staleCopyReasons(by.get("noor")!, new Map(), []).filter((r) => r.includes("its copy is"))).toEqual([]);
    expect(staleCopyReasons({ ...by.get("noor")!, changeFamily: "answer_gap" }, new Map(), []).join(" ")).toContain("its copy is");
    const { openHold } = await import("@/domains/decision/completeness");
    expect(openHold(by.get("leila")!).need, "two quoted sources honestly clear the second-source ask").toBeUndefined();
    expect(openHold(by.get("noor")!).need?.reasonCode).toBe("single_source"); });

  /** THE RULE IS ABOUT MECHANICAL MISTAKES, AND ONLY THOSE. The page owns its label, its terminology and its voice; what it does not own is a missing space, and what Beacon must never do is reformat an address, a clock time or another script on the way past. */
  it("holds a glued label whoever wrote it, and leaves a url, a time, Persian and prose colons exactly as the page had them", async () => {
    const q1 = (says: string) => [{ url: "https://en.wikipedia.org/y", kind: "encyclopedia", says }];
    checks.rows = [check({ subject: "Noor", current: "Meaning:Bright, radiant, or glowing.", proposed: "light", sources: q1('The name Noor means "light"') }),
      check({ subject: "Link", current: "https://x.example/persian-names", proposed: "light", sources: q1('The name Link means "light"') }),
      check({ subject: "Clock", current: "12:30 in the afternoon.", proposed: "light", sources: q1('The name Clock means "light"') }),
      check({ subject: "Parsi", current: "\u0645\u0639\u0646\u06cc:\u0631\u0648\u0634\u0646\u0627\u06cc\u06cc", proposed: "light", sources: q1('The name Parsi means "light"') }),
      check({ subject: "Prose", current: "One meaning here: the old one.", proposed: "light", sources: q1('The name Prose means "light"') })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    const by = new Map(cards.map((c) => [c.id.split("fact-")[1], c]));
    const after = (k: string) => (by.get(k)!.recommendedChange as { after: string }).after;
    expect(["link", "clock", "parsi", "prose"].map(after)).toEqual(["Light", "Light.", "\u0645\u0639\u0646\u06cc:Light", "One meaning here: Light."]); // An address is not a label, a clock time never opens one, another script keeps its own spacing, and a colon the page already spaced is left alone.
    const glued = { ...by.get("noor")!, recommendedChange: { ...by.get("noor")!.recommendedChange, after: "Meaning:Light." } } as ChangeProposal; // AND THE READY GATE HOLDS A GLUED LINE EVEN IF A FUTURE PRODUCER BYPASSES THE COMPOSER ENTIRELY.
    const ok = async () => ({ status: "drafted" as const, value: { rulings: [{ index: 0, publish: true, reason: "reads cleanly", claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "the passage carries it" }] }] } });
    const seen = async (c: ChangeProposal) => (await reviewFactualBundle([c], { tenantId: "t", now: NOW, attempts: { left: 4 }, complete: ok }))[0]!;
    const [held, clean] = [await seen(glued), await seen(by.get("noor")!)];
    expect([held.status, held.limitations[0], clean.status], "a glued label may not reach Ready, and the composed line passes the same gate")
      .toEqual(["needs_review", expect.stringContaining("runs straight into the words after it"), "ready"]); });

  it("an empty answer never reaches the paid call, and the reviewer reads the exact quotes", async () => {
    checks.rows = [check({ subject: "Jasmine", current: "Meaning:Water lily, pure and serene.", proposed: "Jasmine",
        sources: [{ url: "https://en.wikipedia.org/j", kind: "encyclopedia", says: 'the name Jasmine means "Jasmine"' }] }),
      check({ subject: "Atossa", current: "Meaning:Heavenly and radiant.", proposed: "Bestowing very richly.",
        sources: [{ url: "https://en.wikipedia.org/a", kind: "encyclopedia", says: 'Atossa means "bestowing very richly"' }] })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    let user = "";
    const complete = async (i: { user: string }) => { user = i.user;
      return { status: "drafted" as const, value: { rulings: [{ index: 0, publish: true, reason: "reads cleanly", claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "the passage carries it" }] }] } }; };
    const out = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete });
    const by = new Map(out.map((c) => [c.id.split("fact-")[1], c]));
    expect(by.get("jasmine")!.status).toBe("needs_review");
    expect(by.get("jasmine")!.limitations[0]).toContain("the name itself as the name's meaning");
    expect(by.get("atossa")!.status).toBe("ready");
    expect(user, "the reviewer was shown the banked passage, not a bare url").toContain('says: "Atossa means');
    expect(user.includes("Jasmine"), "the unfit correction never reached the paid call").toBe(false); });
});
