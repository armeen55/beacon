/**
 * shadow-portfolio-capture (2026-07-02, master plan item 65) - PURE selection of tonight's
 * "shadow portfolio": the top rejected-but-eligible candidates, ranked exactly the way the
 * planner itself ranks a candidate (daily-experiment-planner.ts scoreCandidate), that did NOT
 * make it into the selected batch.
 *
 * "Eligible" here means the candidate already passed every content-quality and eligibility
 * gate build-today-preview.ts applies (recommendation-quality review, the specialist-team
 * veto) - the SAME pool the planner scores before it applies its diversification caps. A
 * candidate loses a spot in `selected` purely on capacity (page-family cap, action-family
 * cap, high-traffic cap, effort budget, or simply ranking below the cutoff), never on
 * quality - so its untreated GSC drift is a genuine counterfactual for "what would have
 * happened to a page just as good as the ones we shipped."
 *
 * PURE. No I/O. The caller (build-today-preview.ts) has both `teamReviewed` (the full eligible
 * pool) and `plan.selected` (the chosen subset) in scope already; this only does the ranking +
 * exclusion + shaping into the store's row type.
 */

import { scoreCandidate, pageFamilyOf, type DailyCandidate } from "./daily-experiment-planner";
import { normalizePath } from "./daily-plan-types";
import { forecastRange } from "./pick-expectations";
import type { ShadowCandidate } from "./shadow-portfolio-store";

export const MAX_SHADOW_CANDIDATES = 5;

/** Build tonight's shadow cohort: score every eligible candidate the same way the planner
 *  would, drop anything that made it into the selected batch, and keep the top N by score.
 *  Deterministic given the same inputs (stable sort by score, then by url for ties). */
export function buildShadowCandidates(
  eligible: ReadonlyArray<DailyCandidate>,
  selectedUrls: ReadonlySet<string>,
  correctionFactor: number = 1,
  max: number = MAX_SHADOW_CANDIDATES,
): ShadowCandidate[] {
  const rejected = eligible.filter((c) => !selectedUrls.has(c.url));
  const scored = rejected
    .map((c) => ({ c, score: scoreCandidate(c) }))
    .sort((a, b) => b.score - a.score || a.c.url.localeCompare(b.c.url))
    .slice(0, Math.max(0, max));

  return scored.map(({ c, score }) => {
    const range = forecastRange(c.ctrOpportunityClicks, correctionFactor);
    return {
      page: c.url,
      pagePath: normalizePath(c.url),
      lever: c.actionFamily,
      pageFamily: c.pageFamily ?? pageFamilyOf(c.url),
      targetQuery: c.targetQuery,
      score,
      ...(range ? { forecastLow: range.low, forecastHigh: range.high } : {}),
    };
  });
}
