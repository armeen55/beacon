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
  loadOwnedPageBodies: async () => { if (store.bodyFails) throw new Error("the page bodies could not be read");
    return new Map([[PAGE, { title: "Persian female names", h1: null, headings: [], passages: ["Afsaneh means Goddess, divine and strong."] }]]); } }));
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
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
const NOW = new Date("2026-08-17T00:00:00.000Z");
const PAGE = "https://x.example/persian-female-first-names";
const LIVE_HASH = pageHashOf(["Persian female names", "Afsaneh means Goddess, divine and strong."].join("\n"));
const snapshot = { scope: { site: "x.example" }, ownedPages: [{ url: PAGE, search: { impressions90d: 100 } }] } as unknown as EvidenceSnapshot;
const check = (over: Record<string, unknown> = {}) => ({
  page: "/persian-female-first-names", statementKey: String(over.subject ?? "Afsaneh").toLowerCase(),
  pageContentHash: LIVE_HASH, evidenceBasis: "basis_x::d8", state: "checked", rulesVersion: VERIFICATION_RULES_VERSION,
  sourceReadAt: "2026-08-17T00:00:00.000Z", pageLocator: null, subject: "Afsaneh", current: "Goddess, divine and strong.",
  proposed: "Legend, myth, fable in Persian.", language: "Persian", literal: "legend", usage: null,
  sources: [{ url: "https://www.behindthename.com/name/afsaneh", kind: "dictionary", says: "legend, myth or fable in Persian" },
    { url: "https://en.wiktionary.org/wiki/افسانه", kind: "dictionary", says: "fable" }],
  agreement: "multiple_agree", confidence: "confirmed", verdict: "page_wrong", alsoAt: [], note: "",
  checkedAt: "2026-08-17T00:00:00.000Z", ...over });
import { mutationFootprint, footprintsOverlap } from "@/domains/decision/mutation-footprint";
const many = (n: number) => Array.from({ length: n }, (_, i) =>
  check({ subject: `Name${i}`, current: `Wrong meaning ${i}.`, proposed: `Right gloss ${i}.`,
    sources: [{ url: `https://en.wiktionary.org/w${i}`, kind: "dictionary", says: `it means right gloss ${i}` }] }));
describe("a page's own statements against their sources", () => {
  beforeEach(() => { checks.rows = []; store.rows = []; store.withdrew = []; store.why = []; store.bodyFails = false; });
  it("a correction whose evidence stopped being current is withdrawn, and a page nobody could read is left alone", async () => {
    const live = "t::/persian-female-first-names::existing_edit::fact-afsaneh";
    const dead = "t::/persian-female-first-names::existing_edit::fact-darya";
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
    store.withdrew = []; store.bodyFails = true;
    await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(store.withdrew).toEqual([]); });

  it("turns forty sourced corrections into forty separately ranked changes that nothing can retire together", async () => {
    checks.rows = many(40);
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards).toHaveLength(40);
    expect(new Set(cards.map((c) => c.id)).size, "each correction owns its own row").toBe(40);
    expect(new Set(cards.map((c) => [...mutationFootprint(c)].join("|"))).size).toBe(40);
    expect(footprintsOverlap(cards[0]!, cards[1]!)).toBe(false);
    expect(cards.every((c) => c.bundle === undefined)).toBe(true);
    expect(cards.every((c) => !/batch/i.test(c.opportunityType))).toBe(true); });
  it("gives every correction its exact current wording, its replacement, its place and its source", async () => {
    checks.rows = [check({ alsoAt: ["the FAQ answer on this page"] })];
    const [card] = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards;
    expect(card!.recommendedChange).toMatchObject({ kind: "existing_edit", field: "section",
      before: "Goddess, divine and strong.", after: "Legend, myth, fable in Persian." });
    expect((card!.recommendedChange as { where?: string }).where).toContain('The "Afsaneh" entry');
    expect((card!.recommendedChange as { where?: string }).where).toContain("the FAQ answer on this page");
    expect(card!.supportFacts?.map((f) => f.id)).toEqual(["fact-1", "fact-2"]);
    expect(card!.supportFacts?.[0]!.fact).toContain('behindthename.com/name/afsaneh says: "legend, myth or fable in Persian"');
    expect(card!.claims?.[0]!.supportedBy).toEqual(["fact-1", "fact-2"]);
    expect(card!.status, "Beacon's own reviewer has not read it yet, so it is not offered as finished").toBe("needs_review"); });
  it("a hypothesis or a homograph derivation never authorizes a flat replacement", async () => {
    const src = (says: string) => [{ url: "https://en.wikipedia.org/x", kind: "encyclopedia", says }];
    checks.rows = [check({ subject: "Maryam", proposed: "beloved", sources: src('The name may have originated from the root mr "love; beloved"') }),
      check({ subject: "Ariana", proposed: "Most holy", sources: src('The name Ariana is the Latinized form of the Ancient Greek name Ariadne ("most holy")') }),
      check({ subject: "Aryana", proposed: "silver", sources: src('Ariana is sometimes used as a Welsh name, an elaboration of Welsh: arian "silver."') }),
      check({ subject: "Leila", proposed: "Night", sources: src('The name Laila comes from the Arabic word layl, which means "night"') })];
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
    // EVERY MATERIAL WORD COMES FROM THE AUTHORITATIVE SET. An authoritative source contributing ONE word while
    // an ordinary publisher supplies the decisive one is still incomplete provenance: live, Parisa published
    // "beautiful like a fairy" off an encyclopedia saying only "fairy-like".
    const two = (a: Record<string, string>, b: Record<string, string>) => [a, b] as never;
    const src = (kind: string, says: string) => ({ url: `https://x.example/${kind}${says.length}`, kind, says });
    const parisa = check({ subject: "Parisa", current: "Meaning:Fairy-like, ethereal, or angelic.", proposed: "like a fairy; beautiful like a fairy",
      sources: two(src("encyclopedia", "Parisā ( Persian : پریسا, lit. ' fairy-like ' ) is a Persian feminine given name."),
        src("publisher", '"Parisa" means "like a fairy" or "beautiful like a fairy."')) });
    expect(unauthorizedReason(parisa as never), "the live Parisa record").toContain("do not carry every word of the proposal");
    expect(unauthorizedReason(check({ subject: "Aryana", proposed: "silver", literal: "silver",
      sources: two(src("dictionary", "Aryana is a Persian feminine given name."), src("publisher", "Aryana means silver.")) }) as never)).toContain("do not carry every word");
    expect(unauthorizedReason(check({ subject: "Aryana", proposed: "silver",
      sources: two(src("dictionary", 'Aryana means "silver".'), src("publisher", "A popular name this year.")) }) as never), "authoritative carries all, weak corroborates").toBeNull();
    expect(unauthorizedReason(check({ subject: "Aryana", proposed: "bright silver",
      sources: two(src("dictionary", 'Aryana means "silver".'), src("encyclopedia", "The name reads as bright.")) }) as never), "two authoritative sources together").toBeNull();
    expect(unauthorizedReason(check({ subject: "Aryana", proposed: "silver",
      sources: two(src("news", "Aryana means silver."), src("news", "Aryana means silver.")) }) as never)).toContain("no authoritative source");
    const { glossCarriedBy } = await import("@/domains/evidence/pages/fact-checks");
    expect(glossCarriedBy("Light", ["reading it is a delight"]), "delight is not light").toBe(false);
    expect(glossCarriedBy("Gods", ["the goddess of dawn"]), "goddess is not gods").toBe(false);
    expect(glossCarriedBy("founded 1979", ["established in 1,979 by decree", "founded by decree"])).toBe(true);
    expect(glossCarriedBy("Studies", ["the study of names"])).toBe(true);
    expect(glossCarriedBy("Shining", ["the name shines brightly"])).toBe(true);
    expect(glossCarriedBy("Sea", ["totally unrelated quote"]), "no vacuous pass on a short gloss").toBe(false);
    expect(glossCarriedBy("Sea", ['darya means "sea"'])).toBe(true); });

  it("mints nothing off a stale page version, an unread source, history, or replaced verification rules", async () => {
    for (const bad of [{ pageContentHash: "stale" }, { sourceReadAt: null }, { state: "history" }, { rulesVersion: 1 }]) {
      checks.rows = [check(bad)];
      expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0); } });
  it("refuses to replace published words on anything less than a confirmed, source-backed contradiction", async () => {
    for (const bad of [{ verdict: "page_correct" }, { confidence: "disputed" }, { confidence: "unsupported" },
      { proposed: null }, { current: "" }, { sources: [] }]) {
      checks.rows = [check(bad)];
      expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0); } });
  it("shows the worst first, never the alphabet", async () => {
    checks.rows = [check({ subject: "Aaa", agreement: "single_source", alsoAt: [] }),
      check({ subject: "Zzz", agreement: "multiple_agree", alsoAt: ["the FAQ"] })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards[0]!.opportunityType).toContain("Zzz"); });
  it("mints nothing for a page this account does not own", async () => {
    checks.rows = [check({ page: "/not-ours" })];
    expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0); });});
describe("Beacon reviews its own corrections, one page at a time", () => {
  beforeEach(() => { checks.rows = []; });
  const cardsOf = async (n: number) => { checks.rows = many(n); return (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards; };
  it("clears a correction to ready, holds another with its reason, and never charges the operator with the checking", async () => {
    const cards = await cardsOf(3);
    // PUBLISH IS DERIVED FROM THE CLAIM RULINGS, never taken from the model: a reviewer that says publish while
    // ruling the claim unsupported is not a pass, and a ruling that never came is not silence in Beacon's favour.
    const ok = (i: number) => ({ index: i, publish: true, reason: "reads cleanly and matches its source",
      claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "the quoted passage carries the corrected meaning" }] });
    const complete = async () => ({ status: "drafted" as const, value: { rulings: [ok(0),
      { index: 1, publish: false, reason: "the replacement contradicts its own source", claims: [{ claim: 0, factIds: ["fact-1"], entailed: false, why: "the passage says something else" }] }, ok(2)] } });
    // A REVIEWER ANSWERING THE OLD COARSE SHAPE AUTHORIZES NOTHING: publish is derived from claim rulings, so a
    // verdict carrying none of them is silence about every claim rather than a yes to all of them.
    const coarse = async () => ({ status: "drafted" as const, value: { rulings: [0, 1, 2].map((i) => ({ index: i, publish: true, reason: "reads cleanly" })) } });
    const old = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete: coarse });
    expect(old.map((c) => c.status), "publish alone is not entailment").toEqual(old.map(() => "needs_review"));
    // THE RETURNED MAPPING IS CHECKED, NOT TIDIED. A ruling naming a claim that does not exist and a fact nobody
    // banked, marked entailed, cleared every card while the producer wrote a clean authorization from its OWN
    // ids: self-authorization wearing a reviewer's name. Each shape below must hold the card instead.
    const rule = (over: Record<string, unknown>) => async () => ({ status: "drafted" as const, value: { rulings: cards.map((_c, i) => ({
      index: i, publish: true, reason: "looks fine", claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "carried" }], ...over })) } });
    const promoted = async (over: Record<string, unknown>) => (await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: rule(over) })).filter((c) => c.status === "ready");
    for (const [what, over] of [["a claim number nobody made", { claims: [{ claim: 99, factIds: ["fact-1"], entailed: true, why: "w" }] }],
      ["evidence nobody banked", { claims: [{ claim: 0, factIds: ["wrong-fact"], entailed: true, why: "w" }] }],
      ["a claim ruled twice", { claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "w" }, { claim: 0, factIds: ["fact-1"], entailed: true, why: "w" }] }],
      ["a claim the row never made, alongside the real one", { claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "w" }, { claim: 1, factIds: ["fact-1"], entailed: true, why: "w" }] }],
      ["the reviewer's own no", { claims: [{ claim: 0, factIds: ["fact-1"], entailed: false, why: "the passage says something else" }] }],
      ["a sense refusal over an entailed claim", { publish: false, reason: "reads badly" }]] as const)
      expect(await promoted(over), `${what} authorizes nothing`).toEqual([]);
    // AND NOTHING RETURNED IS SILENTLY DROPPED: a ruling for a component nobody asked about was ignored, so a
    // response could carry anything at all beside the real ones and still clear the batch.
    const withStray = async () => ({ status: "drafted" as const, value: { rulings: [...cards.map((_c, i) => ({ index: i, publish: true, reason: "fine",
      claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "carried" }] })),
      { index: 99, publish: true, reason: "about nothing here", claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "w" }] }] } });
    expect((await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: withStray })).filter((c) => c.status === "ready"),
      "a ruling about a component nobody asked about").toEqual([]);
    // AND WHAT IS BANKED IS WHAT THE REVIEWER RETURNED: the ids come back from the ruling, not from the row.
    const earned = await promoted({ claims: [{ claim: 0, factIds: ["fact-1"], entailed: true, why: "the quoted passage carries it" }] });
    expect(earned.length, "an exact ruling still earns Ready").toBeGreaterThan(0);
    expect(earned[0]!.semanticReview!.claims).toEqual([{ i: 0, by: ["fact-1"], entailed: true }]);
    // A CARD STANDING ON TWO PASSAGES MUST BE RULED AGAINST BOTH: naming only one of them is a different
    // question than the claim asks, and every named id is banked, so nothing else catches this.
    checks.rows = [check({ subject: "Pair", current: "Wrong.", proposed: "Right.",
      sources: [{ url: "https://en.wiktionary.org/a", kind: "dictionary", says: "it means right" }, { url: "https://en.wikipedia.org/b", kind: "encyclopedia", says: "also right" }] })];
    const two = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards;
    expect(two[0]!.claims![0]!.supportedBy.length, "the card really declares two").toBe(2);
    const ruleTwo = (ids: string[]) => async () => ({ status: "drafted" as const, value: { rulings: [{ index: 0, publish: true, reason: "fine",
      claims: [{ claim: 0, factIds: ids, entailed: true, why: "carried" }] }] } });
    expect((await reviewFactualBundle(two, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: ruleTwo(["fact-1"]) })).filter((c) => c.status === "ready"),
      "ruled against one of the two passages the claim names").toEqual([]);
    const both = (await reviewFactualBundle(two, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: ruleTwo(["fact-2", "fact-1"]) })).filter((c) => c.status === "ready");
    expect(both[0]!.semanticReview!.claims, "and both, in any order, is what it banks").toEqual([{ i: 0, by: ["fact-1", "fact-2"], entailed: true }]);
    // AND THE REVIEWER WAS ACTUALLY SHOWN WHAT IT RULED ON: the canonical claim, its own fact ids, and the exact passage behind each.
    let shown = ""; await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 9 },
      complete: async (i: { user: string }) => { shown = i.user; return { status: "drafted" as const, value: { rulings: [{ index: 0, publish: false, reason: "n", claims: [{ claim: 0, factIds: ["fact-1"], entailed: false, why: "n" }] }] } }; } });
    expect(shown).toContain("claim 0:");
    expect(shown).toContain("must be entailed by exactly these fact ids: fact-1");
    expect(shown, "the exact passage, not an anonymous source blob").toMatch(/fact-1: "[^"]{10,}/);
    // AND THE PRODUCTION DOOR AGREES AFTER A REAL SAVE AND RELOAD, not a serializer round trip: the mapping the
    // reviewer returned is what comes back, the row is still Ready, and the one servability verdict holds nothing.
    const roundTrip = async (p: ChangeProposal) => { db.rows = []; await saveChangeProposal(p);
      return (await loadChangeProposal("t", p.id))!; };
    // THE PERSISTED AUTHORIZATION CONTRACT IS ITS OWN NUMBER, not a prompt cache version: it read
    // draft.factual_review, which would have governed the substantive editor's receipts by accident.
    const { PROMPT_REGISTRY } = await import("@/domains/decision/llm/prompt-registry");
    expect(REVIEW_CONTRACT).not.toBe(PROMPT_REGISTRY["draft.factual_review"]);
    // AND A PROMPT WHOSE RESPONSE CONTRACT CHANGED CARRIES A NEW VERSION, or an answer shaped for the old one is
    // served from cache and refused on arrival: the editor stopped returning `claimsEntailed` at v3.
    expect(PROMPT_REGISTRY["draft.editor_judgement"]).toBeGreaterThanOrEqual(3);
    const live = await roundTrip(earned[0]!);
    expect(live.semanticReview!.claims, "the reviewer's own mapping survived the store").toEqual([{ i: 0, by: ["fact-1"], entailed: true }]);
    expect([live.status, openHold(live).blocking], "and it is still offered").toEqual(["ready", null]);
    // The same path refuses each defective receipt, and the store will not keep `ready` on any of them.
    for (const [what, broken] of [
      // LITERALLY 2: the prompt, schema, packet, validation and persistence all changed after v2, so a receipt
      // banked under the broken implementation must not be able to look current.
      ["a receipt banked under an earlier contract", { ...earned[0]!, semanticReview: { ...earned[0]!.semanticReview!, version: 3 } }],
      ["a mapping naming evidence the claim does not", { ...earned[0]!, semanticReview: { ...earned[0]!.semanticReview!, claims: [{ i: 0, by: ["fact-9"], entailed: true }] } }],
      ["a reading written for other words", { ...earned[0]!, semanticReview: { ...earned[0]!.semanticReview!, of: `${copyKey(earned[0]!)}x` } }]] as const) {
      const held2 = await roundTrip(broken as ChangeProposal);
      expect([held2.status !== "ready", openHold(held2).blocking != null], what).toEqual([true, true]);
    }
    // A TRANSPORT FAILURE BANKS NOTHING and fabricates no receipt.
    const dead = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 9 }, complete: async () => ({ status: "refused" as const }) });
    expect(dead.filter((c) => c.status === "ready" || c.semanticReview), "no reading, no receipt").toEqual([]);
    const out = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete });
    expect(out.map((c) => c.status)).toEqual(["ready", "needs_review", "ready"]);
    expect(out[1]!.limitations[0]).toContain("Held by Beacon's own review");
    expect(out[1]!.recommendedChange, "a held correction keeps its exact words").toEqual(cards[1]!.recommendedChange); });
  it("a sourced gloss is shaped into the line it replaces, and only its shape", async () => {
    const q1 = (says: string) => [{ url: "https://en.wikipedia.org/y", kind: "encyclopedia", says }];
    checks.rows = [check({ subject: "Noor", current: "Meaning:Bright, radiant, or glowing.", proposed: "light", sources: q1('The name Noor means "light"') }),
      check({ subject: "Leila", current: "Meaning:Beauty, purity, and tranquility.", proposed: "Night; dark", sources: [...q1('layl means "night", or "dark"'), { url: "https://x.example/l", kind: "publisher", says: 'night; dark' }] }),
      check({ subject: "Alborz", current: "Alborz\nMeaning:Shining like a heavenly flower.", proposed: "Mountain Rampart", sources: q1('from Hara Barazaiti, meaning "Mountain Rampart"') })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    const by = new Map(cards.map((c) => [c.id.split("fact-")[1], c]));
    const rc = (k: string) => by.get(k)!.recommendedChange as { before: string; after: string };
    expect(rc("noor")).toMatchObject({ before: "Meaning:Bright, radiant, or glowing.", after: "Meaning:Light." });
    expect(rc("leila").after, "a semicolon list becomes the page's own prose").toBe("Meaning:Night, or dark.");
    expect(rc("alborz")).toMatchObject({ before: "Meaning:Shining like a heavenly flower.", after: "Meaning:Mountain Rampart." });
    expect(by.get("noor")!.limitations[0], "nothing deterministic holds a composed line").toContain("has not read this correction yet");
    const { staleCopyReasons } = await import("@/domains/decision/drafted-copy");
    expect(staleCopyReasons(by.get("noor")!, new Map(), []).filter((r) => r.includes("its copy is"))).toEqual([]);
    expect(staleCopyReasons({ ...by.get("noor")!, changeFamily: "answer_gap" }, new Map(), []).join(" ")).toContain("its copy is");
    const { openHold } = await import("@/domains/decision/completeness");
    expect(openHold(by.get("leila")!).need, "two quoted sources honestly clear the second-source ask").toBeUndefined();
    expect(openHold(by.get("noor")!).need?.reasonCode).toBe("single_source"); });

  it("an empty answer never reaches the paid call, and the reviewer reads the exact quotes", async () => {
    checks.rows = [check({ subject: "Jasmine", current: "Meaning:Water lily, pure and serene.", proposed: "Jasmine",
        sources: [{ url: "https://en.wikipedia.org/j", kind: "encyclopedia", says: "the name Jasmine" }] }),
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

  it("promotes nothing when the review cannot be read, and loses nothing", async () => {
    const cards = await cardsOf(2);
    const out = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete: async () => ({ status: "failed" as const, error: "unreadable" }) });
    expect(out.map((c) => c.status)).toEqual(["needs_review", "needs_review"]);
    expect(out.map((c) => c.id)).toEqual(cards.map((c) => c.id)); });});
