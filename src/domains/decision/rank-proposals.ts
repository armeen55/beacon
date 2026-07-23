/**
 * decision/rank-proposals (CORE 100K decision kernel, 2026-07-22) — the ONE
 * ranking function. It orders proposals by honest VALUE, so the operator sees
 * the highest-leverage safe move first.
 *
 * Ordering rule (most-valuable first):
 *   1. Actionability tier — a `proposed` (validated-safe) proposal always
 *      outranks a `needs_review`, which outranks a `rejected`. A rejected draft
 *      is never actionable, so it sinks regardless of its raw upside.
 *   2. Honest monthly upside (upsidePerMonth) — the sized opportunity midpoint.
 *      A null (unsized — not enough history) sorts BELOW any real figure; we
 *      never fabricate a number to climb the list.
 *   3. Impact score — the demand/score-derived rank input.
 *   4. Lower effort wins the tie (a 1-minute title beats a 60-minute page).
 *   5. Higher confidence wins the next tie.
 *
 * PURE — no I/O. Deterministic + stable (equal keys keep input order).
 */

import type { ChangeProposal, ProposalStatus, ProposalConfidence } from "./contracts";

const STATUS_TIER: Record<ProposalStatus, number> = {
  proposed: 3,
  applied: 3, // an applied proposal is still a real, safe move; ranks with proposed
  needs_review: 2,
  rejected: 0,
};

const CONFIDENCE_RANK: Record<ProposalConfidence, number> = { high: 3, medium: 2, low: 1 };

/** The scalar value used for ranking a single proposal (higher = better).
 *  Exposed so a caller can log/inspect exactly why the order came out as it
 *  did. Combines the actionability tier and the honest upside into one number,
 *  keeping the tier dominant (a rejected draft can never outrank a proposed one
 *  on upside alone). */
export function proposalValueScore(p: ChangeProposal): number {
  const tier = STATUS_TIER[p.status] ?? 0;
  const upside = p.upsidePerMonth != null && Number.isFinite(p.upsidePerMonth) ? Math.max(0, p.upsidePerMonth) : -1;
  const impact = p.impactScore != null && Number.isFinite(p.impactScore) ? Math.max(0, p.impactScore) : 0;
  // Tier dominates (x1e9); upside next; impact as a small tiebreak.
  return tier * 1e9 + (upside >= 0 ? upside : 0) * 1e3 + impact;
}

/** Rank proposals by value, most-valuable first. Stable + deterministic. */
export function rankProposals(proposals: readonly ChangeProposal[]): ChangeProposal[] {
  return proposals
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const at = STATUS_TIER[a.p.status] ?? 0;
      const bt = STATUS_TIER[b.p.status] ?? 0;
      if (at !== bt) return bt - at;

      const au = a.p.upsidePerMonth;
      const bu = b.p.upsidePerMonth;
      const aHas = au != null && Number.isFinite(au);
      const bHas = bu != null && Number.isFinite(bu);
      if (aHas && bHas && au !== bu) return (bu as number) - (au as number);
      if (aHas !== bHas) return aHas ? -1 : 1; // a real figure beats an unsized one

      const ai = a.p.impactScore ?? 0;
      const bi = b.p.impactScore ?? 0;
      if (ai !== bi) return bi - ai;

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
