/**
 * decision/rank-proposals (decision truth replacement, 2026-07-27): the ONE
 * ranking function. It orders proposals by RECOVERABLE OPPORTUNITY, so the
 * operator sees the change that wins back the most clicks first.
 *
 * Ordering rule (most-valuable first):
 *   1. Actionability tier: a `proposed` (validated-safe) proposal always
 *      outranks a `needs_review`, which outranks a `rejected`. A rejected draft
 *      is never actionable, so it sinks regardless of its raw upside.
 *   2. Recoverable clicks (carried on `impactScore`), the clicks the diagnosis
 *      proved a fix could win back, measured on exact query rows against the
 *      click curve. Gross impressions and gross clicks never rank anything: a
 *      small page with a real gap outranks a huge page with none.
 *   3. Lower effort wins the tie (a 1-minute title beats a 60-minute page).
 *   4. Higher confidence wins the next tie.
 *
 * PURE, no I/O. Deterministic + stable (equal keys keep input order).
 */

import type { ChangeProposal, ProposalStatus, ProposalConfidence } from "./contracts";

const STATUS_TIER: Record<ProposalStatus, number> = {
  proposed: 3,
  applied: 3, // an applied proposal is still a real, safe move; ranks with proposed
  needs_review: 2,
  rejected: 0,
};

const CONFIDENCE_RANK: Record<ProposalConfidence, number> = { high: 3, medium: 2, low: 1 };

/** The clicks this proposal's diagnosis proved are recoverable (0 when it carries no
 *  proven figure, never a fabricated one). The old-generation sink lived here; it is
 *  gone because an off-basis row is now withheld from the queue outright and can
 *  never reach a ranking. */
function recoverableClicks(p: ChangeProposal): number {
  return p.impactScore != null && Number.isFinite(p.impactScore) ? Math.max(0, p.impactScore) : 0;
}

/** The scalar value used for ranking a single proposal (higher = better).
 *  Exposed so a caller can log/inspect exactly why the order came out as it
 *  did. Keeps the actionability tier dominant (a rejected draft can never
 *  outrank a proposed one on recoverable clicks alone). */
export function proposalValueScore(p: ChangeProposal): number {
  return (STATUS_TIER[p.status] ?? 0) * 1e9 + recoverableClicks(p);
}

/** Rank proposals by value, most-valuable first. Stable + deterministic. */
export function rankProposals(proposals: readonly ChangeProposal[]): ChangeProposal[] {
  return proposals
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const at = STATUS_TIER[a.p.status] ?? 0;
      const bt = STATUS_TIER[b.p.status] ?? 0;
      if (at !== bt) return bt - at;

      const ar = recoverableClicks(a.p);
      const br = recoverableClicks(b.p);
      if (ar !== br) return br - ar;

      if (a.p.estimatedEffortMinutes !== b.p.estimatedEffortMinutes) {
        return a.p.estimatedEffortMinutes - b.p.estimatedEffortMinutes;
      }

      const ac = CONFIDENCE_RANK[a.p.confidence] ?? 0;
      const bc = CONFIDENCE_RANK[b.p.confidence] ?? 0;
      if (ac !== bc) return bc - ac;

      return a.i - b.i; // stable
    })
    .map((x) => x.p);
}
