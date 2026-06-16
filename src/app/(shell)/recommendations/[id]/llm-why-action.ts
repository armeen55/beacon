"use server";

/**
 * Act 2 "Why this matters" — LLM sharpening server action (Slice B,
 * 2026-06-16).
 *
 * The detail page's `WhyThisMattersAct` calls this AFTER mount to (maybe)
 * sharpen the deterministic baseline. It is:
 *   • TENANT-SCOPED — resolves the rec for the CURRENT tenant only, via
 *     the SAME loader + resolver the detail page uses. A rec id from
 *     another tenant resolves to a miss and returns null.
 *   • READ-ONLY — nothing here is published. The returned text feeds Act 2
 *     display only; it never touches the draft, validators, or push path.
 *   • FAIL-CLOSED — any problem (flag off, miss, budget, network, sanitize
 *     rejection, thrown error) returns null and the client keeps the
 *     deterministic sentences. NEVER throws to the client.
 *
 * The `WhyThisMattersInput` is assembled with the SHARED `buildWhyInput`
 * helper — the exact same assembly the detail client uses for the
 * deterministic baseline — so the LLM grounds in identical input.
 */

import { currentTenantId } from "@/lib/tenant-context";
import { getRepository } from "@/lib/persistence/repositories";
import { loadPersistedRecommendationQueueForPage } from "@/domains/recommendations/load-queue";
import { buildRecommendationActionRows } from "@/domains/recommendations/recommendation-action-rows";
import { resolveRecommendationDetail } from "@/domains/recommendations/resolve-recommendation-detail";
import { decodeRecommendationRouteId } from "@/components/recommendations/v2/recommendation-route-id";
import { buildWhyInput } from "@/domains/recommendations/why-this-matters-narrative";
import { composeLlmWhyThisMatters } from "@/domains/recommendations/llm-why-narrative";

export async function requestLlmWhyNarrativeAction(
  recId: string,
): Promise<{ sentences: string[] } | null> {
  try {
    // Fast flag check — when off (default), do zero work. The narrative
    // module also gates on this, but short-circuiting here skips the
    // tenant load + resolve entirely.
    if (process.env.BEACON_LLM_WHY !== "1") return null;

    const tenantId = await currentTenantId();

    // The client passes `row.id` (the already-decoded detail id). Decode
    // defensively in case a route-encoded id ever arrives; fall back to
    // the raw value when decode returns null.
    const decodedId = decodeRecommendationRouteId(recId) ?? recId;

    const persisted = await loadPersistedRecommendationQueueForPage({
      tenantId,
    });

    const promptTextById: Record<string, string> = {};
    for (const p of persisted.trackedPrompts) {
      promptTextById[p.id] = p.text;
    }

    // Active tracked competitor names for the render-time `why`-display
    // guard inside buildWhyInput. Soft-fail to [] (UUID + internal-token
    // detection still runs) so a read error never strands the action.
    let competitorNames: string[] = [];
    try {
      const entities = await getRepository()
        .forTenant(tenantId)
        .getTrackedEntities();
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

    const input = buildWhyInput(resolution.row, promptTextById, competitorNames);
    const result = await composeLlmWhyThisMatters(input);
    if (result == null || result.sentences.length === 0) return null;
    return { sentences: result.sentences };
  } catch {
    // Never surface a thrown error to the client — keep the baseline.
    return null;
  }
}
