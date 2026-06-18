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
import {
  buildWhyInput,
  composeWhyThisMatters,
} from "@/domains/recommendations/why-this-matters-narrative";
import { deriveRowTopicFit } from "@/domains/recommendations/topic-fit-from-evidence";
import { composeExpertStrategy } from "@/domains/recommendations/llm-expert-strategist";
import {
  buildDeterministicStrategistResult,
  type StrategistActionResult,
} from "./strategist-result";

// Re-export the shared type so existing importers (StrategistAct, tests) keep
// importing it from the action module. The TYPE + the deterministic builder
// live in strategist-result.ts because this is a "use server" file — only
// async server actions may be exported from here.
export type { StrategistActionResult } from "./strategist-result";

export async function requestExpertStrategistAction(
  recId: string,
): Promise<StrategistActionResult | null> {
  try {
    // ON BY DEFAULT (2026-06-16) — no feature flag to manage. Emergency
    // kill-switch only: BEACON_LLM_STRATEGIST="0" disables without a redeploy.
    if (process.env.BEACON_LLM_STRATEGIST === "0") return null;

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

    let brandName: string | undefined;
    try {
      const cfg = await getBusinessConfigForCurrentTenant();
      brandName = cfg.name?.trim() || undefined;
    } catch {
      brandName = undefined;
    }
    const allRows = buildRecommendationActionRows({
      queue: persisted.queue,
      promptTextById,
      brandName,
    });
    const resolution = resolveRecommendationDetail(allRows, decodedId);
    if (resolution.kind === "miss") return null;
    const row = resolution.row;

    const why = buildWhyInput(row, promptTextById, competitorNames);
    const whyNarrative = composeWhyThisMatters(why).join(" ").trim();

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
    // Trust audit C (2026-06-16): the LLM path is a PROGRESSIVE ENHANCEMENT on
    // top of the deterministic read — never a gate on whether the panel shows.
    // When the LLM is unavailable (no key / budget / sanitize-reject / timeout
    // → composeExpertStrategy returns null), fall back to the VISIBLE
    // deterministic panel so the operator always sees Beacon's reasoning + the
    // evidence receipt, not the bare brief.
    if (synthesis == null) {
      return buildDeterministicStrategistResult(row, whyNarrative);
    }

    const qa = row.detail.qaVerdict ?? null;
    return {
      source: "llm",
      strategist: synthesis.strategist,
      enforcedConfidence: synthesis.enforcedConfidence,
      enforcedApprove: synthesis.enforcedApprove,
      gateNotes: synthesis.gateNotes,
      criticReview: synthesis.criticReview ?? null,
      evidenceSupports: qa?.evidenceSupports ?? [],
      evidenceMissing: qa?.evidenceMissing ?? [],
    };
  } catch {
    return null;
  }
}
