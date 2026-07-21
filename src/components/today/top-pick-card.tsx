import type { RecommendationType } from "@/domains/recommendations/recommendation-types";
import type { RecommendationAction } from "@/domains/recommendations/resolved-types";

/**
 * Today "Top pick" card (Phase v6 Commit 5, 2026-04-23; revised v7
 * stabilization 2026-04-24).
 *
 * Pulls the first queue item from /recommendations and surfaces it on
 * Today. Reads the resolved action + URL so the title never leaks
 * internal generator titles like "Create a Shield: X page".
 */

export type TopPickSummary = {
  stableKey: string;
  /** Legacy candidate type — kept for back-compat but unused for display. */
  type: RecommendationType;
  /** Operator-facing title, already sanitized. */
  title: string;
  reasoning: string;
  tier: "now" | "this_week" | "later";
  /** Resolved final action (post-resolver). Drives the type badge. */
  action: RecommendationAction;
  /** Canonical URL when the resolver attached one; null when create_new_page / watch. */
  resolvedUrl: string | null;
};

