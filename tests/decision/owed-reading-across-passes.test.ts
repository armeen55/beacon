/** A SETTLED ROW WHOSE WINNERS NOBODY HAS READ, on three consecutive passes with no new evidence, then on the
 *  pass after a drive reads them. THE REAL STORE (over an in-memory Postgres) INSIDE THE REAL PASS, so the
 *  ladder, the merge, the persistence door and the runtime's buying list are all asked at once. The last group
 *  of arms asks the one question the rest assume: can the reading the stamp names actually be bought, on the
 *  shape production carried at 09:03Z on 2026-09-06 (a results page on file for a SIBLING phrasing, its winner
 *  read whole, none for the row's own search). Two synthetic accounts with unrelated subjects. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";

const db = vi.hoisted(() => ({ tables: new Map<string, Record<string, unknown>[]>(), client: {} as Record<string, unknown> }));
const env = vi.hoisted(() => ({ snap: null as unknown, tenant: "acct-reef" }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => db.client }));
vi.mock("@/lib/logger", () => ({ log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => ({ ...(await orig<Record<string, unknown>>()), readFactChecks: async () => [] }));
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadOwnedPageBodies: async () => { throw new Error("no body store in this fixture"); } }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: env.tenant, domain: `${env.tenant}.example`, growth_goal: null }), basisTag: () => "basis_rv3" }));

import { supabaseFake, type Row } from "../helpers/supabase-fake";
import { loadChangeProposals } from "@/domains/decision/proposal-store";
import { nextObligation } from "@/domains/decision/obligation";
import { preferFinished } from "@/domains/decision/completeness";
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import { demandRecoveryCards } from "@/domains/decision/producers/demand-recovery";

Object.assign(db.client, supabaseFake({ rows: (t) => { if (!db.tables.has(t)) db.tables.set(t, []); return db.tables.get(t) as Row[]; },
  insertDefaults: () => ({ created_at: "2026-09-01T00:00:00.000Z" }) }));
(db.client as { rpc: unknown }).rpc = async () => ({ data: "saved", error: null });

const NOW = new Date("2026-09-06T13:00:00.000Z");
const SITES = [
  { t: "acct-reef", page: "/tide-pool-guide", q: "tide pool safety", sibling: "safety in tide pools" },
  { t: "acct-loom", page: "/blackwork-stitches", q: "blackwork stitch order", sibling: "order of blackwork stitches" },
] as const;
type Site = (typeof SITES)[number];

const owned = (s: Site) => ({ url: `${s.t}.example${s.page}`, content: { title: "Guide", metaDescription: null, h1: "Guide", h2: [], outline: ["What to bring"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-09-01T00:00:00.000Z" },
  search: { clicks90d: 40, impressions90d: 3000, ctr90d: 0.013, position90d: 9, topQueries: [{ query: s.q, impressions: 3000, clicks: 40, position: 9 }] }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } });

const snapshot = (s: Site, serpQuery: string, winningPages: unknown[] = []): EvidenceSnapshot => ({
  scope: { tenantId: s.t, site: `${s.t}.example`, builtAt: NOW.toISOString() }, aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 },
  sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], evidenceHash: "rv3",
  research: { ...emptyResearchEvidence(), winningPages,
    serpEvidence: [{ query: serpQuery, observedAt: "2026-09-05T00:00:00.000Z", organic: [1, 2, 3].map((i) => ({ rank: i, domain: `rival-${i}.example`, url: `https://rival-${i}.example/x`, title: `A page about ${serpQuery}` })), aiOverview: [], aiMode: [], paa: [], related: [] }] } as never,
  ownedPages: [owned(s)] as never } as never);

/** Byte for byte the shape demand-recovery mints (producers/demand-recovery.ts:141), with what is on file stamped. */
const card = (s: Site, over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${s.t}::${s.page}::existing_edit::demand_recovery`, tenantId: s.t, kind: "existing_edit", pagePath: s.page,
  pageUrl: `https://${s.t}.example${s.page}`, pageLabel: s.page, primaryQuery: s.q, opportunityType: "Rebuild lost ground",
  changeFamily: "section", status: "needs_review", winnersOnFile: "unread", treatment: "add_answer_section",
  diagnosisCause: "ranking_loss", causeFinding: { cause: "ranking_loss", action: "act_existing_page", evidenceKeys: ["gsc"], competingExplanations: [{ cause: "ctr_snippet", reason: "the click rate held while the position fell" }], falsifier: "If the page returns to its old position and the clicks do not follow, the ground was not the cause.", explanation: "The page slid on its own results for this search.", notConsidered: [] } as never,
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." },
  researchOnly: true, research: { missing: "Strengthen this page's coverage of the search it lost.", next: "The exact wording lands here once the editor writes it." },
  whyItMatters: "This page lost clicks on a search it used to earn.", operatorSteps: [], estimatedEffortMinutes: 30,
  riskLevel: "low", confidence: "low", limitations: ["The loss is measured from this account's own history."],
  evidence: { query: s.q, hints: [], evidenceRefCount: 1 }, impactScore: 400, upsidePerMonth: null,
  basis: "basis_rv3", publish: "manual", createdAt: NOW.toISOString(), copyStamp: "Guide|Guide||What to bring", ...over });

/** One ordinary pass over this account, with the recovery producer minting the row this review is about. */
const drive = async (s: Site, onFile: "none" | "unread" | "read") => {
  vi.resetModules(); env.tenant = s.t; env.snap = snapshot(s, s.q);
  vi.doMock("@/domains/decision/producers/demand-recovery", () => ({ demandRecoveryCards: async () => ({ cards: [card(s, { winnersOnFile: onFile })], complete: true, window: { earlyDays: 400, earlyFrom: null, earlyTo: null }, losses: [] }) }));
  const other = card(s, { id: `${s.t}::${s.page}-two::existing_edit::ai_answer_gap`, pagePath: `${s.page}-two`, pageUrl: `https://${s.t}.example${s.page}-two`, primaryQuery: `${s.q} at night`, winnersOnFile: undefined, obligation: undefined, impactScore: 10 });
  vi.doMock("@/domains/decision/producers/extra", () => ({ extraQueuePass: async () => ({ run: { cards: [other], complete: true, held: [], needsOwnPage: [], families: ["ai_answer_gap"] }, unitLoad: null }) }));
  const { produceProposalsForTenant: run } = await import("@/domains/decision/produce-proposals");
  const out = await run(s.t, { now: NOW, bypassCache: true, produce: true, maxDrafts: 0, persist: true, complete: async () => ({ value: {} }) } as never);
  if (process.env.RV3_DEBUG) console.log("RV3", out.outcome, out.persisted, [...db.tables.keys()], JSON.stringify(db.tables.get("change_proposals") ?? []).slice(0, 400));
  const stored = (await loadChangeProposals(s.t)).get(`${s.t}::${s.page}::existing_edit::demand_recovery`)!;
  const row = (db.tables.get("change_proposals") ?? []).find((r) => r.id === `${s.t}::${s.page}::existing_edit::demand_recovery`) ?? null;
  return { owed: (out.paid.evidenceOwed ?? []).map((n) => [n.kind, n.query, n.reasonCode]), obligation: stored?.obligation ?? null, version: (row?.proposal_version as number | undefined) ?? null };
};

/** The row as it stands on file before this review's passes: settled, with what is on file stamped on it.
 *  Written through the REAL store, which is itself the first arm: the settlement may not survive it. */
const seed = async (s: Site, onFile: "none" | "unread" | "read") => {
  const { saveChangeProposal } = await import("@/domains/decision/proposal-store");
  const settled = card(s, { winnersOnFile: onFile, obligation: { kind: "terminal", reason: "no substantive gap named" } });
  const answer = await saveChangeProposal(settled);
  const stored = (await loadChangeProposals(s.t)).get(settled.id) ?? null;
  return { answer, obligation: stored?.obligation ?? null };
};

beforeEach(() => { db.tables.clear(); });

describe("the settled row whose winners nobody has read, three passes with no new evidence", () => {
  const read = (s: Site) => ({ kind: "evidence", need: { kind: "competitor_page", query: s.q, reasonCode: "no_winner_to_read" } });
  const results = (s: Site) => ({ kind: "evidence", need: { kind: "serp", query: s.q, reasonCode: "no_winner_to_read" } });

  it.each(SITES)("$t: a results page on file and nothing read off it owes the winner read, unchanged on passes one, two and three", async (s) => {
    const at0 = await seed(s, "unread");
    const one = await drive(s, "unread"), two = await drive(s, "unread"), three = await drive(s, "unread");
    expect([at0.obligation, one.obligation, two.obligation, three.obligation], "nothing about this row's evidence moved, so its typed next step may not move either").toEqual([read(s), read(s), read(s), read(s)]);
    expect([one.owed, two.owed, three.owed], "and the same reading reaches the one list the runtime's buy loops read on every pass")
      .toEqual([[["competitor_page", s.q, "no_winner_to_read"]], [["competitor_page", s.q, "no_winner_to_read"]], [["competitor_page", s.q, "no_winner_to_read"]]]);
  });

  it.each(SITES)("$t: no results page on file at all owes that results page, unchanged on passes one, two and three", async (s) => {
    const at0 = await seed(s, "none");
    const one = await drive(s, "none"), two = await drive(s, "none"), three = await drive(s, "none");
    expect([at0.obligation, one.obligation, two.obligation, three.obligation]).toEqual([results(s), results(s), results(s), results(s)]);
    expect([one.owed, two.owed, three.owed]).toEqual([[["serp", s.q, "no_winner_to_read"]], [["serp", s.q, "no_winner_to_read"]], [["serp", s.q, "no_winner_to_read"]]]);
  });

  it.each(SITES)("$t: the row is written once and re-saved by nothing while its evidence stands still", async (s) => {
    await seed(s, "unread");
    const one = await drive(s, "unread"), two = await drive(s, "unread"), three = await drive(s, "unread");
    expect([typeof one.version, one.version, two.version, three.version], "a pass that buys nothing may not write a new version of the same row").toEqual(["number", one.version, one.version, one.version]);
  });

  it.each(SITES)("$t: and the drive that reads the winners discharges the reading rather than owing it again", async (s) => {
    await seed(s, "unread"); await drive(s, "unread"); await drive(s, "unread");
    const after = await drive(s, "read");
    expect([after.obligation, after.owed], "a reading that landed is not owed again, and the row goes back to the ladder below it")
      .toEqual([{ kind: "draft" }, []]);
  });
});

/** THE CARRY IN completeness.ts settledStep, asked on its own two edges. */
describe("the carry of the owed reading across a re-mint", () => {
  const owedRead = { kind: "evidence", need: { kind: "competitor_page", query: SITES[0].q, reasonCode: "no_winner_to_read" } } as const;
  it("carries onto a re-mint of the same work and is discharged by the purchase, never carried past it", () => {
    const prior = card(SITES[0], { winnersOnFile: "unread", obligation: owedRead as never });
    const stillUnread = preferFinished(card(SITES[0], { winnersOnFile: "unread" }), prior);
    const nowRead = preferFinished(card(SITES[0], { winnersOnFile: "read" }), prior);
    expect([nextObligation(stillUnread), nextObligation(nowRead)]).toEqual([owedRead, { kind: "draft" }]);
  });

  it("never carries onto a row whose work identity moved", () => {
    const prior = card(SITES[0], { winnersOnFile: "unread", obligation: owedRead as never });
    const moved = preferFinished(card(SITES[0], { winnersOnFile: "unread", copyStamp: "Guide|Guide moved||What to bring now" }), prior);
    expect(moved.obligation, "a pass that moves the identity arrives with no obligation and the ladder decides again from nothing").toBeUndefined();
  });

  it("a row that carries the reading and no stamp of what is on file keeps owing it for ever", () => {
    const noStamp = card(SITES[0], { winnersOnFile: undefined, obligation: owedRead as never });
    expect(nextObligation(noStamp)).toEqual(owedRead);
  });
});

/** CAN THE READING THE STAMP NAMES ACTUALLY BE BOUGHT, and does the purchase discharge it? `winnersOnFile` was
 *  decided over the WHOLE group (the label and its vocabulary) while the reading it names and the stamp that
 *  discharges it were both asked of the label alone, so a group whose results page is on file under a SIBLING
 *  phrasing was stamped `unread`, owed the winners of a search no results page exists for, and could never be
 *  discharged: the winning-pages unit reads what a results page on file ranks, and nothing on file ranks for
 *  this query. All three doors ask the row's own search now, so this shape owes the results page it really
 *  lacks and the sibling's own winner read settles nothing for it. Driven through the REAL producer. */
describe("the reading the unread rung names, against what is really on file", () => {
  const unit = (s: Site) => ({ label: s.q, vocabulary: [s.q, s.sibling], queries: [], pages: [`${s.t}.example${s.page}`],
    history: { earlyClicksPerDay: 4, recentClicksPerDay: 0.5, lostClicksPerMonth: 105, earlyImpressions: 5000, recentImpressions: 4800,
      priorTopPage: `${s.t}.example${s.page}`, currentTopPage: `${s.t}.example${s.page}`, pageSwapped: false,
      earlyPosition: 3.1, recentPosition: 8.4, pageEarlyPosition: 3.1, pageRecentPosition: 8.4, pageShareEarly: 0.9, pageShareRecent: 0.9 },
    volume: null, serp: null, prompts: [], fanouts: [], winningPages: [], recoverableClicks: 60, tensions: [],
    audience: { impressions90d: 5000, aiAnswers: 0, lostClicksPerMonth: 105 }, seededBy: "search" as const });

  const mint = async (s: Site, snap: EvidenceSnapshot, serpForUnit: unknown) => {
    const run = await demandRecoveryCards({ tenantId: s.t, snapshot: snap, now: NOW,
      preloaded: { units: [{ ...unit(s), serp: serpForUnit }], historyWindow: { earlyDays: 400, earlyFrom: "2026-01-01", earlyTo: "2026-04-01" } } as never });
    return run.cards[0] ?? null;
  };
  const sibSerp = { winners: [{ rank: 1, domain: "rival-1.example", url: "https://rival-1.example/x" }], paa: [], related: [], observedAt: "2026-09-05T00:00:00.000Z" };

  it.each(SITES)("$t: a group whose only results page is a sibling phrasing's owes the results page for its own search first", async (s) => {
    const snap = snapshot(s, s.sibling); // the results page on file is the SIBLING's, never this row's own search
    const minted = await mint(s, snap, sibSerp);
    expect(minted?.winnersOnFile, "no results page for this row's own search is on file, so nothing can read its winners yet").toBe("none");
  });

  it.each(SITES)("$t: and the winner read that lands for the sibling never discharges it", async (s) => {
    const readSibling = [{ url: "https://rival-1.example/x", domain: "rival-1.example", engines: [], examplePrompts: [],
      appearances: [{ kind: "serp_organic", query: s.sibling, rank: 1, citedUrl: "https://rival-1.example/x", observedAt: "2026-09-05T00:00:00.000Z" }],
      extract: { url: "https://rival-1.example/x", wordCount: 900, mainText: "The winner's own words about the sibling phrasing.", truncated: false, fetchedAt: "2026-09-06T00:00:00.000Z" }, readOutcome: null }];
    const minted = await mint(s, snapshot(s, s.sibling, readSibling), sibSerp);
    const owes = minted ? nextObligation({ ...minted, obligation: { kind: "terminal", reason: "no substantive gap named" } }) : null;
    expect(owes?.kind === "evidence" ? [owes.need.kind, owes.need.query] : null, "a purchase named for a search with no results page on file can never be discharged, so it is owed and bought again on every drive")
      .toEqual(["serp", s.q]);
  });
});
