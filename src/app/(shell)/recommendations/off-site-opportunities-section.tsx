/**
 * Recommendations "Off-site opportunities" section — Section 7 C7e
 * (2026-05-22).
 *
 * A read-only section at the BOTTOM of /recommendations, visually +
 * structurally SEPARATE from the website-edit recommendation queue.
 * Off-site rows are permanently blocked from the queue (locked
 * `recommendation-intelligence-offsite-contract` → `diagnostic_only`);
 * this section never promotes anything into the queue and exposes no
 * Accept / Defer / Dismiss affordance.
 *
 * Reuses the C7d `OffSiteAuthorityTile` for the actual presentation
 * (zero rendering duplication). This section adds only:
 *   • a tenant-correct snapshot load (MT-2) + pure candidate derivation,
 *     soft-failing to a hidden section on error;
 *   • a renderability gate (mirrors the tile) so the "Off-site
 *     opportunities" label never wraps an empty card;
 *   • the manual-follow-up context label that frames the off-site card
 *     as distinct from the website-edit queue above it.
 *
 * Safety pinned by:
 *   • tests/architecture/off-site-recommendations-section-safe-copy.test.ts
 *   • tests/architecture/off-site-recommendations-section-no-queue.test.ts
 * The reused tile's own copy is pinned by the C7d
 * `off-site-customer-tile-safe-copy` invariant.
 */

import "server-only";

import { OffSiteAuthorityTile } from "@/components/today/off-site-authority-tile";
import { loadOffSitePresenceSnapshot } from "@/domains/off-site-authority/load-snapshot";
import {
  computeOffSiteRecommendationCandidates,
  type OffSiteCandidateAction,
} from "@/domains/off-site-authority/recommendation-rules";
import type { ActionType } from "@/domains/recommendations/action-types";

/**
 * Renderability mirror of the C7d tile's allowlist. Tiny (3 entries) so
 * it's inlined rather than extracted — the section only needs it to
 * decide whether the tile will render anything before drawing the
 * labeled wrapper. The reused tile is the single source of truth for
 * what actually renders.
 */
const ALLOWED_REVIEW_ACTIONS: ReadonlySet<ActionType> = new Set<ActionType>([
  "claim_gbp",
  "claim_or_optimize_yelp",
  "optimize_gbp_profile",
]);

const COPY = {
  context:
    "Off-site opportunities — manual follow-up, separate from your website edits.",
} as const;

export async function OffSiteOpportunitiesSection() {
  let snapshot = null;
  let candidates: readonly OffSiteCandidateAction[] = [];
  try {
    snapshot = await loadOffSitePresenceSnapshot();
    candidates = computeOffSiteRecommendationCandidates(snapshot).candidates;
  } catch (error) {
    console.warn("[section7-c7e-off-site] snapshot load failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  // Renderability gate — mirror the tile so an empty card never gets a
  // labeled wrapper. is_local_service gate + at least one connected
  // channel OR one non-policy-risk review opportunity.
  if (snapshot == null || !snapshot.is_local_service) return null;
  const hasConnected = snapshot.channels.some((c) => c.claimed === true);
  const hasReviewOpportunities = candidates.some(
    (c) => ALLOWED_REVIEW_ACTIONS.has(c.actionType) && c.policy_risk === false,
  );
  if (!hasConnected && !hasReviewOpportunities) return null;

  return (
    <section
      data-recommendations-off-site="true"
      className="mt-8 border-t border-border/40 pt-6"
      aria-label="Off-site opportunities"
    >
      <p className="text-xs font-medium text-muted-foreground">
        {COPY.context}
      </p>
      <div className="mt-3">
        <OffSiteAuthorityTile snapshot={snapshot} candidates={candidates} />
      </div>
    </section>
  );
}
