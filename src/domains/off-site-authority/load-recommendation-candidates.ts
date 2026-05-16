/**
 * Section 7 C7c (2026-05-16) — Off-Site recommendation preview loader.
 *
 * Thin server wrapper: load the C7a snapshot, run the C7c pure
 * decision tree, return BOTH so the operator diagnostic page can
 * render the existing channel table + data-sources footer
 * (snapshot-driven) alongside the new candidate-actions section
 * (recommendations-driven).
 *
 * Locked posture:
 *   • Imports only from the C7a snapshot loader + C7c pure rules
 *     + `server-only` + type-only `./types`.
 *   • No `getRepository`. No `unstable_cache`. No HTTP / fetch / axios.
 *     No connector imports. No LLM provider import.
 *   • No persistence — the C7a loader is read-only, and C7c writes
 *     zero `recommended_edits` rows. Architecture invariant
 *     `off-site-recommendation-rules-no-persistence.test.ts` pins
 *     this across the three C7c production files.
 */

import "server-only";

import { loadOffSitePresenceSnapshot } from "./load-snapshot";
import {
  computeOffSiteRecommendationCandidates,
  type OffSiteRecommendationCandidates,
} from "./recommendation-rules";
import type { OffSitePresenceSnapshot } from "./types";

export type LoadOffSiteRecommendationCandidatesOptions = {
  /** Override the "now" instant for tests. Passed through to the
   *  C7a snapshot loader. */
  now?: Date | string;
};

/**
 * Combined preview shape consumed by the operator diagnostic page.
 * Carries the full `OffSitePresenceSnapshot` so the existing
 * `ChannelTable` + `DataSourcesFooter` + `PlaceholderBanner`
 * components keep their typed inputs unchanged.
 */
export type OffSiteRecommendationPreview = {
  snapshot: OffSitePresenceSnapshot;
  recommendationCandidates: OffSiteRecommendationCandidates;
};

export async function loadOffSiteRecommendationPreview(
  options: LoadOffSiteRecommendationCandidatesOptions = {},
): Promise<OffSiteRecommendationPreview> {
  const snapshot = await loadOffSitePresenceSnapshot(options);
  const recommendationCandidates =
    computeOffSiteRecommendationCandidates(snapshot);
  return { snapshot, recommendationCandidates };
}
