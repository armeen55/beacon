/** RV2 review: a settled row whose winners nobody has read, driven through the REAL pass, on two synthetic
 *  accounts with unrelated subjects. The row's own results page IS on file (that is what "unread" means:
 *  a results page bought for the group, nothing read off it), which is the production shape B5's due-work
 *  change is about. What the pass writes onto the row, and what reaches the runtime's buying list, is asked here. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChangeProposal } from "@/domains/decision/contracts";
import type { EvidenceSnapshot } from "@/domains/evidence/snapshot";
const store = vi.hoisted(() => ({ rows: new Map<string, ChangeProposal>(), withdrawn: new Set<string>() }));
const env = vi.hoisted(() => ({ snap: null as unknown }));
vi.mock("@/domains/decision/llm/adjudicator-budget", () => ({ checkBudget: async () => ({ allowed: true, remaining: 10 }), recordSpend: async () => {} }));
vi.mock("@/domains/decision/llm/winner-memory", () => ({ buildWinnerFewShots: async () => "", buildWinnerFewShotsWithPattern: async () => ({ fragment: "", patternHint: null }) }));
vi.mock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadChangeProposals: async () => store.rows,
  saveChangeProposal: async (p: ChangeProposal, _t?: unknown, keep?: (r: ChangeProposal) => void) => { store.rows.set(p.id, p); keep?.(p); return "saved"; },
  withdrawnProposalIds: async () => store.withdrawn, withdrawChangeProposal: async () => true }));
vi.mock("@/domains/evidence/snapshot-loader", () => ({ loadEvidenceSnapshot: async () => env.snap }));
vi.mock("@/domains/evidence/pages/fact-checks", async (orig) => ({ ...(await orig<Record<string, unknown>>()), readFactChecks: async () => [] }));
vi.mock("@/domains/evidence/pages/owned-context", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadOwnedPageBodies: async () => { throw new Error("no body store in this fixture"); } }));
vi.mock("@/domains/account", () => ({ loadBusinessProfile: async () => null, getTenant: async () => ({ id: "acct-reef", domain: "acct-reef.example", growth_goal: null }), basisTag: () => "basis_rv2" }));
import { emptyResearchEvidence } from "@/domains/evidence/funnel/research-evidence";
import { shapeBackingOf } from "@/domains/decision/drafted-copy";
import { nextObligation } from "@/domains/decision/obligation";

const NOW = new Date("2026-09-06T09:00:00.000Z");
const SITES = [
  { t: "acct-reef", page: "/tide-pool-guide", q: "tide pool safety", lead: ["Tide pool safety for families", "Tide pool safety rules", "Tide pool safety and the rocks"] },
  { t: "acct-loom", page: "/blackwork-stitches", q: "blackwork stitch order", lead: ["Blackwork stitch order explained", "Blackwork stitch order for beginners", "Blackwork stitch order and tension"] },
] as const;

const owned = (s: (typeof SITES)[number]) => ({ url: `${s.t}.example${s.page}`, content: { title: "Guide", metaDescription: null, h1: "Guide", h2: [], outline: ["What to bring"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 900, internalLinks: [], fetchedAt: "2026-09-01T00:00:00.000Z" },
  search: { clicks90d: 40, impressions90d: 3000, ctr90d: 0.013, position90d: 9, topQueries: [{ query: s.q, impressions: 3000, clicks: 40, position: 9 }] }, engagement: null, friction: null, aiCitations: { count: 0, distinctPrompts: 0, engines: [] } });

const snapshot = (s: (typeof SITES)[number], titles: readonly string[]): EvidenceSnapshot => ({
  scope: { tenantId: s.t, site: `${s.t}.example`, builtAt: NOW.toISOString() }, aiCitations: { ownedCited: 0, competitorCited: 0, engines: [], rowsScanned: 0 },
  sources: [], competitors: [], keywordDemand: [], questionDemand: [], intentClusters: [], cannibalization: [], contentGaps: [], internalLinkOpportunities: [], evidenceHash: "rv2",
  research: { ...emptyResearchEvidence(), serpEvidence: [{ query: s.q, observedAt: "2026-09-05T00:00:00.000Z", organic: titles.map((title, i) => ({ rank: i + 1, domain: `rival-${i + 1}.example`, url: `https://rival-${i + 1}.example/x`, title })), aiOverview: [], aiMode: [], paa: [], related: [] }] } as never,
  ownedPages: [owned(s)] as never,
} as never);

/** The producer's own card, byte for byte the shape demand-recovery mints (producers/demand-recovery.ts:141). */
const card = (s: (typeof SITES)[number], over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${s.t}::${s.page}::existing_edit::demand_recovery`, tenantId: s.t, kind: "existing_edit", pagePath: s.page,
  pageUrl: `https://${s.t}.example${s.page}`, pageLabel: s.page, primaryQuery: s.q, opportunityType: "Rebuild lost ground",
  changeFamily: "section", status: "needs_review", winnersOnFile: "unread", treatment: "add_answer_section",
  diagnosisCause: "ranking_loss", causeFinding: { cause: "ranking_loss", action: "act_existing_page", evidenceKeys: ["gsc"], competingExplanations: [{ cause: "ctr_snippet", reason: "the click rate held while the position fell" }], falsifier: "If the page returns to its old position and the clicks do not follow, the ground was not the cause.", explanation: "The page slid on its own results for this search.", notConsidered: [] } as never,
  recommendedChange: { kind: "existing_edit", field: "section", before: null, after: "The exact wording has not been written yet." },
  researchOnly: true, research: { missing: "Strengthen this page's coverage of the search it lost.", next: "The exact wording lands here once the editor writes it." },
  whyItMatters: "This page lost clicks on a search it used to earn.", operatorSteps: [], estimatedEffortMinutes: 30,
  riskLevel: "low", confidence: "low", limitations: ["The loss is measured from this account's own history."],
  evidence: { query: s.q, hints: [], evidenceRefCount: 1 }, impactScore: 400, upsidePerMonth: null,
  basis: "basis_rv2", publish: "manual", createdAt: NOW.toISOString(), copyStamp: "Guide|Guide||What to bring", ...over });

const drive = async (s: (typeof SITES)[number], titles: readonly string[]) => {
  vi.resetModules();
  vi.doMock("@/domains/decision/producers/demand-recovery", () => ({ demandRecoveryCards: async () => ({ cards: [card(s)], complete: true, window: { earlyDays: 400, earlyFrom: null, earlyTo: null }, losses: [] }) }));
  const other = card(s, { id: `${s.t}::${s.page}-two::existing_edit::ai_answer_gap`, pagePath: `${s.page}-two`, pageUrl: `https://${s.t}.example${s.page}-two`, primaryQuery: `${s.q} at night`, winnersOnFile: undefined, obligation: undefined, impactScore: 10 });
  vi.doMock("@/domains/decision/producers/extra", () => ({ extraQueuePass: async () => ({ run: { cards: [other], complete: true, held: [], needsOwnPage: [], families: ["ai_answer_gap"] }, unitLoad: null }) }));
  const { produceProposalsForTenant: run } = await import("@/domains/decision/produce-proposals");
  env.snap = snapshot(s, titles);
  return run(s.t, { now: NOW, bypassCache: true, produce: true, maxDrafts: 0, persist: true, complete: async () => ({ value: {} }) } as never);
};

beforeEach(() => { store.rows.clear(); });

describe("the reading a settled row owes, through the pass that writes the row", () => {
  it.each(SITES)("$t: the ladder's own answer for this row is the owed reading of its winners", (s) => {
    expect(nextObligation(card(s, { obligation: { kind: "terminal", reason: "no substantive gap named" } })))
      .toEqual({ kind: "evidence", need: { kind: "competitor_page", query: s.q, reasonCode: "no_winner_to_read" } });
  });

  it.each(SITES)("$t: the placeholder line of a research row is backed by no ranked title, so nothing answers the ladder in its place", (s) => {
    expect(shapeBackingOf(snapshot(s, s.lead), s.q, "The exact wording has not been written yet."), "a brief holds no line for the ranked titles to back").toBeNull();
  });

  it.each(SITES)("$t: the pass writes that owed reading onto the row and hands it to the runtime's buying list", async (s) => {
    const settled = card(s, { obligation: { kind: "terminal", reason: "no substantive gap named" } });
    store.rows.set(settled.id, settled);
    const out = await drive(s, s.lead);
    const kept = store.rows.get(settled.id)!;
    expect([kept.obligation, (out.paid.evidenceOwed ?? []).map((n) => [n.kind, n.query, n.reasonCode])],
      "the row on file says which reading it is waiting on, and that reading reaches the one list the runtime's buy loops read")
      .toEqual([{ kind: "evidence", need: { kind: "competitor_page", query: s.q, reasonCode: "no_winner_to_read" } }, [["competitor_page", s.q, "no_winner_to_read"]]]);
  });

  it.each(SITES)("$t: and two passes over the same evidence leave the row saying the same thing", async (s) => {
    const settled = card(s, { obligation: { kind: "terminal", reason: "no substantive gap named" } });
    store.rows.set(settled.id, settled);
    await drive(s, s.lead); const first = store.rows.get(settled.id)!.obligation;
    await drive(s, s.lead); const second = store.rows.get(settled.id)!.obligation;
    expect([first, second], "nothing about this row's evidence moved between the two passes, so its typed next step may not move either").toEqual([second, second]);
  });
});
