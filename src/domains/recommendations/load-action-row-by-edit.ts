import "server-only";

/**
 * 2026-06-16 — resolve ONE action row by its source edit id, server-side.
 *
 * The armed one-click publish action (`acceptAndPublishRecommendation`) needs
 * the rec's deterministic QA verdict at PUBLISH time, as defense-in-depth: the
 * card already gates which CTA it shows, but the server must independently
 * confirm the rec is approved + paste-ready before routing a click to a LIVE
 * write (a stale page could otherwise post a since-downgraded rec).
 *
 * It rebuilds the rows exactly as the detail page does
 * (loadPersistedRecommendationQueueForPage → buildRecommendationActionRows) and
 * returns the row whose source edit matches. `promptTextById` is intentionally
 * empty — it only prettifies TITLES and never changes the QA verdict's
 * `approve` / `pushReadiness` (the only fields the publish gate reads), so this
 * stays a cheap, single-purpose resolver.
 */

import { loadPersistedRecommendationQueueForPage } from "./load-queue";
import {
  buildRecommendationActionRows,
  type RecommendationActionRow,
} from "./recommendation-action-rows";

export async function loadActionRowByEditId(
  tenantId: string,
  editId: string,
): Promise<RecommendationActionRow | null> {
  const persisted = await loadPersistedRecommendationQueueForPage({ tenantId });

  let knownCities: string[] | undefined;
  let knownServices: string[] | undefined;
  let brandName: string | undefined;
  try {
    const { getBusinessConfigForCurrentTenant } = await import(
      "@/lib/business-config"
    );
    const cfg = await getBusinessConfigForCurrentTenant();
    knownCities = cfg.locations;
    knownServices = cfg.services;
    brandName = cfg.name?.trim() || undefined;
  } catch {
    knownCities = undefined;
    knownServices = undefined;
    brandName = undefined;
  }

  const rows = buildRecommendationActionRows({
    queue: persisted.queue,
    promptTextById: {},
    knownCities,
    knownServices,
    brandName,
  });

  return (
    rows.find(
      (r) =>
        r.sourceEditId === editId || r.detail?.debug?.editId === editId,
    ) ?? null
  );
}
