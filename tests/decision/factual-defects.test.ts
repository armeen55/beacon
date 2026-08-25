import { describe, expect, it, vi, beforeEach } from "vitest";
const checks = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/lib/llm-call-cache", () => ({ readLlmCallCache: async () => null, writeLlmCallCache: async () => {}, llmCallCacheKey: () => "k", recentLlmCallTexts: async () => [] }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => {
  const real = await orig<typeof import("@/domains/evidence/pages/fact-checks")>();
  return { ...real, readFactChecks: async () => checks.rows };
});
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
describe("a page's own statements against their sources", () => {
  beforeEach(() => { checks.rows = []; });
  it("mints the same card twice from the same banked checks, so a pass never overwrites the last one", async () => {
    checks.rows = [check()];
    const a = await factualDefectCards({ tenantId: "t", snapshot, now: NOW }); const b = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(a.cards).toHaveLength(1);
    expect(JSON.stringify(a.cards)).toBe(JSON.stringify(b.cards)); // deterministic: the store is the author
    expect(a.cards[0]!.id).toBe("t::/persian-female-first-names::existing_edit::factual_correction");
    expect(a.cards[0]!.bundle!.components[0]).toMatchObject({ kind: "factual_correction", before: "Goddess, divine and strong.", after: "Legend, myth, fable in Persian." });
  });
  it("mints nothing off a stale page version, an unread source, history, or replaced verification rules", async () => {
    const cards = async () => (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards;
    for (const over of [{ pageContentHash: "hash-of-a-page-that-has-since-changed" }, { sourceReadAt: null },
      { state: "superseded" }, { rulesVersion: 2 }]) { checks.rows = [check(over)]; expect(await cards()).toHaveLength(0); }
  });
  it("refuses to replace published words on anything less than a confirmed, source-backed contradiction", async () => {
    checks.rows = [check({ confidence: "likely" }), check({ subject: "Ava", confidence: "disputed" }),
      check({ subject: "Sholeen", confidence: "unsupported", proposed: null }),
      check({ subject: "Negar", verdict: "page_correct" }),
      check({ subject: "Mona", sources: [{ url: "https://babynames.example/mona", kind: "babyname", says: "beautiful" }] })];
    const run = await factualDefectCards({ tenantId: "t", snapshot, now: NOW });
    expect(run.cards).toHaveLength(0); // nothing authorized is nothing minted, never a card with a guess on it
  });
  it("says what it is holding back and never claims the loss belongs to it", async () => {
    checks.rows = [check(), check({ subject: "Ava", confidence: "disputed", proposed: "Voice, sound" }),
      check({ subject: "Sholeen", confidence: "unsupported", proposed: null })];
    const card = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!; expect(card.diagnosisCause).toBe("factual_error");
    expect(card.impactScore).toBeNull(); // an accuracy defect claims no clicks
    expect(card.causeFinding!.notConsidered.map((x) => x.cause)).toContain("ranking_loss"); expect(card.bundle!.risks.join(" ")).toContain("1 more entries are contested");
    expect(card.bundle!.receipt.missing.join(" ")).toContain("Sholeen");
  });
  it("says how many corrections are waiting behind the batch instead of dropping them", async () => {
    checks.rows = Array.from({ length: 55 }, (_, i) => check({ subject: `Name${String(i).padStart(2, "0")}` }));
    const card = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!; expect(card.bundle!.components).toHaveLength(40);
    expect(card.opportunityType).toContain("15 more confirmed after this"); expect((card.operatorSteps ?? []).join(" ")).toContain("15 more confirmed corrections are waiting");
    expect(card.limitations.join(" ")).toContain("are not lost and are not silently dropped");
  });
  it("shows the worst first, never the alphabet", async () => {
    checks.rows = [
      check({ subject: "Zulu", verdict: "page_wrong", agreement: "multiple_agree", alsoAt: ["the FAQ"] }),
      check({ subject: "Alpha", verdict: "page_imprecise", agreement: "single_source",
        sources: [{ url: "https://en.wikipedia.org/x", kind: "encyclopedia", says: "x" }] }),
    ];
    const card = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!; expect(card.bundle!.components.map((c) => c.label)).toEqual(["Zulu", "Alpha"]);
  });
  it("mints nothing for a page this account does not own", async () => {
    checks.rows = [check({ page: "/not-mine" })];
    expect((await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards).toHaveLength(0);
  });
});
describe("a correction bundle survives the round trip", () => {
  it("decodes back out of the store, so a new receipt kind can never make a ghost row", async () => {
    const { serializeChangeProposal, deserializeChangeProposal } = await import("@/domains/decision/contracts");
    checks.rows = [check()];
    const card = (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!; expect(card.bundle!.receipt.items[0]!.kind).toBe("independent_source");
    const back = deserializeChangeProposal(serializeChangeProposal(card)); expect(back?.bundle?.receipt.items[0]!.kind).toBe("independent_source");
  });
});
/** BEACON PERFORMS THE SENSE REVIEW, NEVER THE OPERATOR (operator, 2026-08-22): a clean reviewed bundle arrives ready; one failed component is held WITH its reason and never erases the valid ones; an unaffordable review promotes nothing and says why. `complete` is the gateway's own test seam. */
describe("the correction bundle is reviewed by Beacon itself", () => {
  const three = () => { checks.rows = [check(), check({ subject: "Bahar", current: "Spring wind.", proposed: "Spring, the season, in Persian." }),
    check({ subject: "Ciara", current: "Dark one.", proposed: "It's mean 'dark'." })]; };
  const complete = (ok: boolean[]) => async () => ({ value: { rulings: ok.map((publish, index) => ({ index, publish, reason: publish ? "reads naturally against its source" : "the replacement is ungrammatical" })) } });
  const mint = async () => { three(); return (await factualDefectCards({ tenantId: "t", snapshot, now: NOW })).cards[0]!; };
  const review = (ok: boolean[]) => async () => reviewFactualBundle(await mint(), { tenantId: "t", now: NOW, complete: complete(ok) });
  it("mints at $0 and never promotes on its own: the review is a separate ranked candidate", async () => {
    const card = await mint(); expect([card.status, card.bundle!.components.length]).toEqual(["needs_review", 3]);
    expect(card.limitations[0]).toContain("never for the operator to do Beacon's checking");
  });
  it("promotes a clean reviewed bundle to ready, and holds a failed component with its reason", async () => {
    const clean = await review([true, true, true])(); expect([clean.status, clean.bundle!.components.length]).toEqual(["ready", 3]);
    expect(clean.limitations[0]).toContain("Beacon's own reviewer"); const mixed = await review([true, true, false])();
    expect([mixed.status, mixed.bundle!.components.length]).toEqual(["ready", 2]); expect(mixed.bundle!.receipt.missing.join(" ")).toContain("Held by Beacon's own review, Ciara: the replacement is ungrammatical");
    // EVERY COUNT SPEAKS FOR THE SURVIVORS: a ready card never announces corrections its bundle does not render.
    expect([mixed.opportunityType, mixed.bundle!.objective]).toEqual(["2 sourced corrections on /persian-female-first-names", "2 statements on /persian-female-first-names stop contradicting their own sources."]);
    expect(mixed.operatorSteps!.join(" ")).toContain("Work through the 2 corrections");
  });
  // A REVIEW THAT HOLDS EVERYTHING HOLDS THE BUNDLE WHOLE: zero-piece bundles fail the contract schema on read back, a vanished card over an unreadable row. The pieces stay, unpromoted, each reason on file.
  it("keeps every piece and stays unpromoted when the review holds all of them", async () => {
    const all = await review([false, false, false])(); expect([all.status, all.bundle!.components.length]).toEqual(["needs_review", 3]);
    expect(all.limitations[0]).toContain("held all of them"); expect(all.bundle!.receipt.missing.filter((m) => m.startsWith("Held by Beacon's own review"))).toHaveLength(3);
  });
  it("promotes nothing when the review cannot be read, and never charges the operator with the checking", async () => {
    const dark = await reviewFactualBundle(await mint(), { tenantId: "t", now: NOW, complete: async () => ({ error: "refused", retryable: false }) }); expect([dark.status, dark.bundle!.components.length]).toEqual(["needs_review", 3]);
    expect(dark.limitations[0]).toContain("never for the operator to do Beacon's checking");
  });
});
