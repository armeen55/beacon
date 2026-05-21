/**
 * 2026-05-19 — Slice 4.5.B.α₀ — minimal queue-rules gate.
 * EVOLVED in Slice 4.5.F (2026-05-21) — off-site shared queue
 * carve-out (always diagnostic_only).
 *
 * MINIMAL 4-of-10 rules per master plan §4.5.12. Full 10-rule
 * layer ships in Slice 4.5.D before the customer-queue flip. α₀
 * surfaces results only on the operator diagnostic page.
 *
 * Rules applied in order:
 *   1. SPECIFIC — `target_url` is non-null, non-empty, non-
 *      sentinel; EXCEPT for off-site action types (Section 7's
 *      vocabulary) which have no owned-page URL by design.
 *   2. EVIDENCE-BACKED — `evidence.length >= 1`.
 *   3. OFF-SITE ROUTE — off-site action rows ALWAYS route to
 *      `diagnostic_only` in 4.5.F (never to `candidates`), even
 *      at high confidence and zero safety flags. Defense-in-depth
 *      with α₀a.1 `eligibilityForTrigger` → "blocked" + α₀a.3a
 *      Gate 1 → `blocked_tier`. Off-site customer-queue promotion
 *      stays permanently blocked.
 *   4. CONFIDENCE — `low` routes to `diagnostic_only`.
 *   5. SAFETY-FLAG-EMPTY — flagged rows route to `diagnostic_only`.
 *
 * Slice 4.5.D adds: customer-vocab scan, accepted-ancestor
 * suppression, dismissed cooldown, signal-stale, prerequisite-
 * blocked, max-per-page + max-per-family caps.
 *
 * Off-site action types are detected via the registry's
 * `signalType === "off_page_seo"` field — derived from
 * `ACTION_TYPE_REGISTRY`, NOT a parallel allowlist. This avoids
 * touching `promotion-eligibility.ts` (operator-locked F-block
 * constraint, 2026-05-21).
 */

import { ACTION_TYPE_REGISTRY } from "@/domains/recommendations/action-types";
import type { ActionType } from "@/domains/recommendations/action-types";

import type { RecommendationCandidateRow } from "./candidate-row";

export type ApplyQueueRulesResult = {
  candidates: RecommendationCandidateRow[];
  diagnostic_only: RecommendationCandidateRow[];
};

const FORBIDDEN_TARGET_URLS = new Set<string>(["", "needs_new_page"]);

/** Pure registry lookup. Off-site action types carry
 *  `signalType: "off_page_seo"` per the existing registry
 *  convention (Section 7 vocabulary, 7 entries). */
function isOffSiteAction(actionType: ActionType): boolean {
  return ACTION_TYPE_REGISTRY[actionType].signalType === "off_page_seo";
}

export function applyQueueRules(
  rows: ReadonlyArray<RecommendationCandidateRow>,
): ApplyQueueRulesResult {
  const candidates: RecommendationCandidateRow[] = [];
  const diagnostic_only: RecommendationCandidateRow[] = [];
  for (const row of rows) {
    const offSite = isOffSiteAction(row.action_type);
    // Rule 1: SPECIFIC — off-site rows are exempt from target_url
    // non-null requirement (they target a channel, not a URL).
    if (!offSite) {
      if (row.target_url == null || FORBIDDEN_TARGET_URLS.has(row.target_url)) {
        continue;
      }
    }
    // Rule 2: EVIDENCE-BACKED.
    if (row.evidence.length === 0) continue;
    // Rule 3: OFF-SITE ROUTE — always diagnostic_only in 4.5.F.
    if (offSite) {
      diagnostic_only.push(row);
      continue;
    }
    // Rule 4: CONFIDENCE.
    if (row.confidence === "low") {
      diagnostic_only.push(row);
      continue;
    }
    // Rule 5: SAFETY-FLAG-EMPTY.
    if (row.safety_flags.length > 0) {
      diagnostic_only.push(row);
      continue;
    }
    candidates.push(row);
  }
  return { candidates, diagnostic_only };
}
