"use server";

/**
 * Expert-rec-engine PHASE I (2026-06-16) — LLM expert-strategist server action.
 *
 * The detail page's `StrategistAct` calls this AFTER mount to (maybe) layer a
 * senior-strategist reasoning panel on top of the deterministic brief. Mirrors
 * `requestLlmWhyNarrativeAction` exactly:
 *   • TENANT-SCOPED — resolves the rec for the CURRENT tenant via the same
 *     loader + resolver the detail page uses; a foreign rec id → miss → null.
 *   • READ-ONLY — the reasoning is displayed as ANALYSIS, never published.
 *   • FAIL-CLOSED — flag off / miss / budget / network / parse / sanitize /
 *     thrown error → null; the client renders nothing extra and the
 *     deterministic brief stands. NEVER throws to the client.
 *
 * The evidence packet is the SHARED `buildWhyInput` (identical to Act 2). The
 * page-topic intent-fit is derived from the row's own evidence with the
 * tenant's brand/locale terms (config, not baked); the DETERMINISTIC gate in
 * `composeExpertStrategy` — not the LLM — sets the confidence/approve verdict.
 */

import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { loadPersistedRecommendationQueueForPage } from "@/domains/recommendations/load-queue";
import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";
import { decodeRecommendationRouteId } from "@/components/recommendations/v2/recommendation-route-id";
import { buildWhyInput } from "@/domains/recommendations/why-this-matters-narrative";
import { deriveRowTopicFit } from "@/domains/recommendations/topic-fit-from-evidence";
import {
  composeExpertStrategy,
  type ExpertSynthesis,
} from "@/domains/recommendations/llm-expert-strategist";

export type StrategistActionResult = {
  strategist: ExpertSynthesis["strategist"];
  enforcedConfidence: ExpertSynthesis["enforcedConfidence"];
  enforcedApprove: boolean;
  gateNotes: string[];
  /** The adversarial QA critic review (the "Adversarial QA" panel), or null. */
  criticReview: ExpertSynthesis["criticReview"];
};

export async function requestExpertStrategistAction(
  recId: string,
): Promise<StrategistActionResult | null> {
  try {
    // Fast flag check — when off (default), do zero work.
    if (process.env.BEACON_LLM_STRATEGIST !== "1") return null;

    const tenantId = await currentTenantId();
    const decodedId = decodeRecommendationRouteId(recId) ?? recId;

    const persisted = await loadPersistedRecommendationQueueForPage({ tenantId });

    const promptTextById: Record<string, string> = {};
    for (const p of persisted.trackedPrompts) {
      promptTextById[p.id] = p.text;
    }

    let competitorNames: string[] = [];
    try {
      const entities = await getRepository().forTenant(tenantId).getTrackedEntities();
      competitorNames = entities
        .filter((e) => e.entity_type === "competitor" && e.is_active === true)
        .map((e) => e.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0);
    } catch {
      competitorNames = [];
    }

    const allRows = buildRecommendationActionRows({
      queue: persisted.queue,
      promptTextById,
    });
    const resolution = resolveRecommendationDetail(allRows, decodedId);
    if (resolution.kind === "miss") return null;
    const row = resolution.row;

    const why = buildWhyInput(row, promptTextById, competitorNames);

    // Tenant brand/locale terms for intent classification (config, not baked).
    let brandTerms: string[] | undefined;
    let localeTerms: string[] | undefined;
    try {
      const cfg = await getBusinessConfigForCurrentTenant();
      brandTerms = cfg.name ? [cfg.name] : undefined;
      localeTerms = cfg.locations && cfg.locations.length > 0 ? cfg.locations : undefined;
    } catch {
      brandTerms = undefined;
      localeTerms = undefined;
    }

    const topicFit = deriveRowTopicFit(row, why.affectedPromptTexts, {
      brandTerms,
      localeTerms,
    });

    const synthesis = await composeExpertStrategy({ why, topicFit });
    if (synthesis == null) return null;

    return {
      strategist: synthesis.strategist,
      enforcedConfidence: synthesis.enforcedConfidence,
      enforcedApprove: synthesis.enforcedApprove,
      gateNotes: synthesis.gateNotes,
      criticReview: synthesis.criticReview ?? null,
    };
  } catch {
    return null;
  }
}
