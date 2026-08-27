import { describe, expect, it, vi, beforeEach } from "vitest";
const checks = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/lib/llm-call-cache", () => ({ readLlmCallCache: async () => null, writeLlmCallCache: async () => {}, llmCallCacheKey: () => "k", recentLlmCallTexts: async () => [] }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>();
  return { ...real, readFactChecks: async () => checks.rows };});
const store = vi.hoisted(() => ({ rows: [] as { id: string }[], withdrew: [] as string[], bodyFails: false }));
vi.mock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<typeof import("@/domains/decision/proposal-store")>()),
  loadChangeProposals: async () => new Map(store.rows.map((r) => [r.id, r])),
  withdrawChangeProposal: async (p: { id: string }) => { store.withdrew.push(p.id); return true; } }));
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<typeof import("@/domains/evidence/pages/owned-context")>()), // THE PAGE AS DECISION CAN SEE IT: a correction is work only while the page still says what it objected to.
  loadOwnedPageBodies: async () => { if (store.bodyFails) throw new Error("the page bodies could not be read");
    return new Map([[PAGE, { title: "Persian female names", h1: null, headings: [], passages: ["Afsaneh means Goddess, divine and strong."] }]]); } }));
import { FACTUAL_DEFECTS } from "@/domains/decision/producers/factual-defects";
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
  sources: [{ url: "https://www.behindthename.com/name/afsaneh", kind: "dictionary", says: "legend" },
    { url: "https://en.wiktionary.org/wiki/افسانه", kind: "dictionary", says: "fable" }],
  agreement: "multiple_agree", confidence: "confirmed", verdict: "page_wrong", alsoAt: [], note: "",
  checkedAt: "2026-08-17T00:00:00.000Z", ...over });
import { mutationFootprint, footprintsOverlap } from "@/domains/decision/mutation-footprint";
const many = (n: number) => Array.from({ length: n }, (_, i) =>
  check({ subject: `Name${i}`, current: `Wrong meaning ${i}.`, proposed: `Right meaning ${i}.` }));
describe("a page's own statements against their sources", () => {
  beforeEach(() => { checks.rows = []; store.rows = []; store.withdrew = []; store.bodyFails = false; });
  it("a correction whose evidence stopped being current is withdrawn, and a page nobody could read is left alone", async () => {
    // A CORRECTION CARD IS NOT SELF-JUSTIFYING: minted on evidence later found to be about the wrong subject,
    // six stood Ready for ever (one cited Wikipedia's Slavic "Daria" for Persian darya).
    const live = "t::/persian-female-first-names::existing_edit::fact-afsaneh";
    const dead = "t::/persian-female-first-names::existing_edit::fact-darya";
    store.rows = [{ id: live }, { id: dead }, { id: "t::/other::existing_edit::fact-elsewhere" }];
    checks.rows = [check()]; // Afsaneh still authorized; Darya's row is gone, and /other was never read this pass
    await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(store.withdrew).toEqual([dead]);
    // FAIL-CLOSED: a failed body read must not retire every correction on the site at once.
    store.withdrew = []; store.bodyFails = true;
    await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(store.withdrew).toEqual([]); });

  it("turns forty sourced corrections into forty separately ranked changes that nothing can retire together", async () => {
    // ONE CORRECTION IS ONE CHANGE (operator, 2026-08-26): forty as ONE row died in a single stale-sweep write.
    checks.rows = many(40);
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards).toHaveLength(40);
    expect(new Set(cards.map((c) => c.id)).size, "each correction owns its own row").toBe(40);
    expect(new Set(cards.map((c) => [...mutationFootprint(c)].join("|"))).size).toBe(40);
    expect(footprintsOverlap(cards[0]!, cards[1]!)).toBe(false);
    expect(cards.every((c) => c.bundle === undefined)).toBe(true);
    // AND NO CAP: the queue is unlimited, so nothing is held back "behind this batch".
    expect(cards.every((c) => !/batch/i.test(c.opportunityType))).toBe(true); });
  it("gives every correction its exact current wording, its replacement, its place and its source", async () => {
    checks.rows = [check({ alsoAt: ["the FAQ answer on this page"] })];
    const [card] = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards;
    expect(card!.recommendedChange).toMatchObject({ kind: "existing_edit", field: "section",
      before: "Goddess, divine and strong.", after: "Legend, myth, fable in Persian." });
    expect((card!.recommendedChange as { where?: string }).where).toContain('The "Afsaneh" entry');
    expect((card!.recommendedChange as { where?: string }).where).toContain("the FAQ answer on this page");
    // ONE SUPPORT PER QUOTED SOURCE, carrying the passage itself; an empty banked quote counts for nothing.
    expect(card!.supportFacts?.map((f) => f.id)).toEqual(["fact-1", "fact-2"]);
    expect(card!.supportFacts?.[0]!.fact).toContain('behindthename.com/name/afsaneh says: "legend"');
    expect(card!.claims?.[0]!.supportedBy).toEqual(["fact-1", "fact-2"]);
    expect(card!.status, "Beacon's own reviewer has not read it yet, so it is not offered as finished").toBe("needs_review"); });
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
    const complete = async () => ({ status: "drafted" as const, value: { rulings: [{ index: 0, publish: true, reason: "reads cleanly and matches its source" },
      { index: 1, publish: false, reason: "the replacement contradicts its own source" }, { index: 2, publish: true, reason: "reads cleanly and matches its source" }] } });
    const out = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete });
    expect(out.map((c) => c.status)).toEqual(["ready", "needs_review", "ready"]);
    expect(out[1]!.limitations[0]).toContain("Held by Beacon's own review");
    expect(out[1]!.recommendedChange, "a held correction keeps its exact words").toEqual(cards[1]!.recommendedChange); });
  it("a sourced gloss is shaped into the line it replaces, and only its shape", async () => {
    // LIVE: all eight cards for the biggest recovery page were held for ever because the mint pasted the raw
    // fragment ("light") over "Meaning:Bright, radiant, or glowing."; one span swallowed the name heading.
    checks.rows = [check({ subject: "Noor", current: "Meaning:Bright, radiant, or glowing.", proposed: "light" }),
      check({ subject: "Leila", current: "Meaning:Beauty, purity, and tranquility.", proposed: "Night; dark" }),
      check({ subject: "Alborz", current: "Alborz\nMeaning:Shining like a heavenly flower.", proposed: "Mountain Rampart" })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    const by = new Map(cards.map((c) => [c.id.split("fact-")[1], c]));
    const rc = (k: string) => by.get(k)!.recommendedChange as { before: string; after: string };
    expect(rc("noor")).toMatchObject({ before: "Meaning:Bright, radiant, or glowing.", after: "Meaning:Light." });
    expect(rc("leila").after, "a semicolon list becomes the page's own prose").toBe("Meaning:Night, or dark.");
    expect(rc("alborz")).toMatchObject({ before: "Meaning:Shining like a heavenly flower.", after: "Meaning:Mountain Rampart." });
    expect(by.get("noor")!.limitations[0], "nothing deterministic holds a composed line").toContain("has not read this correction yet");
    // A point replacement is not weighed as a 15-to-400-word section; a real section stub still fails.
    const { staleCopyReasons } = await import("@/domains/decision/drafted-copy");
    expect(staleCopyReasons(by.get("noor")!, new Map(), []).filter((r) => r.includes("its copy is"))).toEqual([]);
    expect(staleCopyReasons({ ...by.get("noor")!, changeFamily: "answer_gap" }, new Map(), []).join(" ")).toContain("its copy is");
    const { openHold } = await import("@/domains/decision/completeness");
    expect(openHold(by.get("noor")!).need).toBeUndefined();
    checks.rows = [check({ subject: "Noor", current: "Meaning:Bright, radiant, or glowing.", proposed: "light",
      sources: [{ url: "https://en.wikipedia.org/wiki/Noor_(name)", kind: "encyclopedia", says: "The name Noor means \"light\"" }] })];
    const one = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!;
    expect(one.supportFacts).toHaveLength(1); expect(openHold(one).need?.reasonCode).toBe("single_source"); });

  it("an empty answer never reaches the paid call, and the reviewer reads the exact quotes", async () => {
    // The label prefix must not smuggle "Meaning:Jasmine." past the name gate, and the reviewer reads the
    // exact passages: its source-consistency charge was being asked over an empty source line.
    checks.rows = [check({ subject: "Jasmine", current: "Meaning:Water lily, pure and serene.", proposed: "Jasmine" }),
      check({ subject: "Atossa", current: "Meaning:Heavenly and radiant.", proposed: "Bestowing very richly." })];
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    let user = "";
    const complete = async (i: { user: string }) => { user = i.user;
      return { status: "drafted" as const, value: { rulings: [{ index: 0, publish: true, reason: "reads cleanly" }] } }; };
    const out = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete });
    const by = new Map(out.map((c) => [c.id.split("fact-")[1], c]));
    expect(by.get("jasmine")!.status).toBe("needs_review");
    expect(by.get("jasmine")!.limitations[0]).toContain("the name itself as the name's meaning");
    expect(by.get("atossa")!.status).toBe("ready");
    expect(user, "the reviewer was shown the banked passage, not a bare url").toContain('says: "legend"');
    expect(user.includes("Jasmine"), "the unfit correction never reached the paid call").toBe(false); });

  it("promotes nothing when the review cannot be read, and loses nothing", async () => {
    const cards = await cardsOf(2);
    const out = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete: async () => ({ status: "failed" as const, error: "unreadable" }) });
    expect(out.map((c) => c.status)).toEqual(["needs_review", "needs_review"]);
    expect(out.map((c) => c.id)).toEqual(cards.map((c) => c.id)); });});
