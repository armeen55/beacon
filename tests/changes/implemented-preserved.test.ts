/** A CHANGE THE OPERATOR ALREADY MADE IS NEVER REOPENED BY A RULE WRITTEN AFTER IT (2026-09-05). Two rows on the live account are exactly
 *  this shape: answer blocks applied on 2026-08-12 whose stored wording still carries "NUMBER as of YEAR (SOURCE)", which today's completeness
 *  read refuses. The words are a template and the reading may not vote on them, and the row is still work the operator did: it is counted as
 *  implemented, it is kept out of every lane a customer can act on, and no later pass may write a draft over it. Driven through the REAL
 *  loader and the REAL completeness read, on two synthetic accounts, from stored rows only. */
import { describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));
vi.mock("@/domains/decision/proposal-store", async (orig) => ({ ...(await orig<Record<string, unknown>>()), loadChangeProposals: async () => store.rows }));
vi.mock("@/domains/account", async (orig) => ({ ...(await orig<Record<string, unknown>>()),
  getTenant: async () => ({ id: "t", domain: "example.test" }), loadBusinessProfile: async () => null }));

import { loadProposalQueue } from "@/domains/decision/load-proposals";
import { deliverableGaps } from "@/domains/decision/completeness";
import type { ChangeProposal } from "@/domains/decision";

const BASIS = "basis_now::d8";
/** THE STORED WORDING OF THE TWO LIVE ROWS: a template nobody filled in, which is exactly what today's read refuses. */
const TEMPLATE = "The population is NUMBER as of YEAR (SOURCE).";
const SITES = [
  { t: "acct-tide", path: "/tide-pools", label: "Tide Pools", q: "tide pool depth" },
  { t: "acct-bordado", path: "/bordado", label: "Bordado a mano", q: "puntadas de bordado" },
];
const row = (s: (typeof SITES)[number], over: Partial<ChangeProposal> = {}): ChangeProposal => ({
  id: `${s.t}::${s.path}::existing_edit::answer_block`, tenantId: s.t, kind: "existing_edit", pagePath: s.path,
  pageUrl: `https://${s.t}.example${s.path}`, pageLabel: s.label, primaryQuery: s.q, opportunityType: "Answer the exact search",
  changeFamily: "answer_block", status: "implemented_pending_verification", researchOnly: false, basis: BASIS,
  recommendedChange: { kind: "existing_edit", field: "answer_block", before: "An older answer.", after: TEMPLATE },
  whyItMatters: "This page answers the search badly.", estimatedEffortMinutes: 4, riskLevel: "low", confidence: "medium",
  limitations: [], evidence: { query: s.q, hints: [], evidenceRefCount: 2 }, impactScore: 30, upsidePerMonth: null,
  publish: "manual", createdAt: "2026-08-12T00:00:00.000Z", ...over,
} as unknown as ChangeProposal);

describe("a row the operator already marked done is counted, never queued and never redrafted", () => {
  for (const s of SITES) {
    it(`${s.t}: an implemented row whose stored wording fails today's read stays out of every lane the customer can act on`, async () => {
      const done = row(s);
      expect(deliverableGaps(done).length, "today's completeness read really does refuse this wording, which is the whole premise").toBeGreaterThan(0);
      store.rows = new Map([[done.id, done]]);
      const q = await loadProposalQueue(s.t, { currentBasis: BASIS });
      expect([q.ready.length, q.toDo.length, q.research.length, q.ranked.length, q.implementedPendingVerification],
        "no lane holds it, nothing ranks it back into the queue, and it is counted as the implementation it is").toEqual([0, 0, 0, 0, 1]);
      expect(q.demotedStaleBasis, "and it is not reported as work set aside for a stale bar either: it is finished work, not withheld work").toBe(0);
    });

    it(`${s.t}: the same row still open would be shown, so the lane is decided by the operator's press and not by the wording`, async () => {
      const open = row(s, { status: "needs_review" });
      store.rows = new Map([[open.id, open]]);
      const q = await loadProposalQueue(s.t, { currentBasis: BASIS });
      expect([q.ready.length, q.toDo.length + q.research.length, q.implementedPendingVerification],
        "the identical wording on an OPEN row is visible and held for review, so nothing here is hiding a row for failing a read").toEqual([0, 1, 0]);
    });
  }
});
