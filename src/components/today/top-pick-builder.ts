/**
 * Pure builder that converts a prioritized + resolved rec into a
 * TopPickSummary. Delegates all title generation to the shared
 * buildResolvedRecommendationTitle() so Today Top Pick, /recommendations
 * rows, and Accept → changelog all produce identical title copy for the
 * same resolved rec.
 *
 * Phase 1 (2026-04-24): title logic moved into
 * src/domains/recommendations/build-title.ts. This module is now a thin
 * adapter that shapes the output for the TopPickSummary contract.
 */

import { buildResolvedRecommendationTitle } from "@/domains/recommendations/build-title";
import { NEEDS_NEW_PAGE } from "@/domains/recommendations/resolved-types";
import type { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import type { TopPickSummary } from "./top-pick-card";

type PrioritizedQueueItem = ReturnType<
  typeof prioritizeRecommendations
>["queue"][number];

export function buildTopPickSummary(
  top: PrioritizedQueueItem,
): TopPickSummary {
  const resolution = top.resolution;
  const action = resolution?.action ?? "create_new_page";
  const resolvedUrl =
    resolution &&
    resolution.targetUrl &&
    resolution.targetUrl !== NEEDS_NEW_PAGE
      ? resolution.targetUrl
      : null;

  const title = buildResolvedRecommendationTitle({
    clusterLabel: top.clusterLabel,
    promptTextFallback: null,
    resolution,
  });

  return {
    stableKey: top.stableKey,
    type: top.type,
    title,
    reasoning: resolution?.reasoning ?? top.reasoning,
    tier: top.tier,
    action,
    resolvedUrl,
  };
}
