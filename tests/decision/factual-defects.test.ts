import { describe, expect, it, vi, beforeEach } from "vitest";
const checks = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/lib/llm-call-cache", () => ({ readLlmCallCache: async () => null, writeLlmCallCache: async () => {}, llmCallCacheKey: () => "k", recentLlmCallTexts: async () => [] }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>();
  return { ...real, readFactChecks: async () => checks.rows };});
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<typeof import("@/domains/evidence/pages/owned-context")>()), // THE PAGE AS DECISION CAN SEE IT: a correction is work only while the page still says what it objected to.
  loadOwnedPageBodies: async () => new Map([[PAGE, { title: "Persian female names", h1: null, headings: [], passages: ["Afsaneh means Goddess, divine and strong."] }]]) }));
import { FACTUAL_DEFECTS } from "@/domains/decision/producers/factual-defects";
const factualDefectCards = FACTUAL_DEFECTS.cards, reviewFactualBundle = FACTUAL_DEFECTS.review;
import { pageHashOf } from "@/domains/evidence/pages/fact-check-run";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
const NOW = new Date("2026-08-17T00:00:00.000Z");
const PAGE = "https://x.example/persian-female-first-names";
const LIVE_HASH = pageHashOf(["Persian female names", "Afsaneh means Goddess, divine and strong."].join("\n"));
const snapshot = { scope: { site: "x.example" }, ownedPages: [{ url: PAGE, search: { impressions90d: 100 } }] } as unknown as EvidenceSnapshot;
const check = (over: Record<string, unknown> = {}) => ({
  page: "/persian-female-first-names", statementKey: String(over.subject ?? "Afsaneh").toLowerCase(),
  pageContentHash: LIVE_HASH, evidenceBasis: "basis_x::d8", state: "checked", rulesVersion: 3,
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
  beforeEach(() => { checks.rows = []; });
  it("turns forty sourced corrections into forty separately ranked changes that nothing can retire together", async () => {
    // ONE CORRECTION IS ONE CHANGE (operator, 2026-08-26). Forty of these used to be ONE row of forty components. On
    // 2026-08-23 a stale sweep withdrew that row with "the producer that owns this family rewrote it and did not
    // re-emit this card" and all forty of the operator's best work died in a single write.
    checks.rows = many(40);
    const { cards } = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(cards).toHaveLength(40);
    expect(new Set(cards.map((c) => c.id)).size, "each correction owns its own row").toBe(40);
    // NO SHARED MUTATION, so the store cannot collapse them and the queue cannot deduplicate them onto one page slot.
    expect(new Set(cards.map((c) => [...mutationFootprint(c)].join("|"))).size).toBe(40);
    expect(footprintsOverlap(cards[0]!, cards[1]!)).toBe(false);
    // NO BUNDLE, so the stale sweep (which only reaches rows carrying one) can never take them.
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
    expect(card!.supportFacts?.[0]!.fact).toContain("behindthename.com");
    expect(card!.claims?.[0]!.supportedBy).toEqual(["fact-1"]);
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
    expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0); });
});
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
  it("promotes nothing when the review cannot be read, and loses nothing", async () => {
    const cards = await cardsOf(2);
    const out = await reviewFactualBundle(cards, { tenantId: "t", now: NOW, attempts: { left: 4 }, complete: async () => ({ status: "failed" as const, error: "unreadable" }) });
    expect(out.map((c) => c.status)).toEqual(["needs_review", "needs_review"]);
    expect(out.map((c) => c.id)).toEqual(cards.map((c) => c.id)); });
});
