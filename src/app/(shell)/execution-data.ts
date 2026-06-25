import { currentTenantId } from "@/lib/tenant-context";
import { loadTodayMovesHeroData, type TodayMove } from "./today-moves-data";
import { loadDemandOpportunities } from "@/domains/demand/load-demand-opportunities";
import { buildImplementationPlan, type ImplementationPlan, type MoveForPlan } from "@/domains/execution/implementation-plan";

/**
 * execution-data (2026-06-25, Sprint 5) — the cockpit loader for the Operator
 * Execution Layer. Composes the EXISTING prepared Today Moves (Sprint 2 deterministic
 * drafts, react.cache-reused from the hero — no extra pipeline run) + the demand
 * product opportunities (Sprint 4) into safe, structured implementation plans
 * (Sprint 5 pure engine). Read-only, fail-soft, $0 (no paid calls). No CMS write,
 * no publish.
 */

export type ImplementationPlansResult = {
  plans: ImplementationPlan[];
  readyCount: number;
  blockedCount: number;
};

function moveToPlanInput(m: TodayMove, tenantId: string): MoveForPlan {
  const answerBlock = m.savedAnswerBlock ?? m.preparedDraftText ?? m.answerBrief ?? null;
  const evidence = [
    m.demand != null ? `${m.demand.toLocaleString()} demand (${m.demandBasis ?? "signal"})` : null,
    m.rankWhy || null,
  ].filter((x): x is string => !!x);
  return {
    moveId: m.id,
    tenantId,
    actionType: m.action,
    targetUrl: m.targetUrl,
    targetTitle: m.pageLabel,
    query: m.query,
    confidence: m.confidence,
    demand: m.demand,
    draftTitle: m.draftTitle,
    draftMeta: m.draftMeta,
    answerBlock,
    faqs: m.faqs,
    faqJsonLd: m.savedFaqJsonLd,
    schema: m.schema,
    outline: m.outline,
    evidence,
    proofMetrics: m.proof ? [m.proof] : undefined,
  };
}

const STATUS_RANK: Record<string, number> = {
  ready_to_apply: 0,
  needs_content_review: 1,
  legal_or_licensing_risk: 2,
  missing_inventory: 3,
  needs_location_review: 4,
  missing_page_mapping: 5,
  insufficient_evidence: 6,
  applied: 7,
  measuring: 8,
};

export async function loadImplementationPlans(opts: { limit?: number } = {}): Promise<ImplementationPlansResult> {
  const limit = opts.limit ?? 10;
  let tenantId = "";
  const plans: ImplementationPlan[] = [];
  const generatedAt = new Date().toISOString();

  try {
    tenantId = await currentTenantId();
  } catch {
    return { plans: [], readyCount: 0, blockedCount: 0 };
  }

  // (a) Prepared Today Moves → plans (reuses the hero's react.cache; no extra run).
  try {
    const hero = await loadTodayMovesHeroData({});
    for (const m of hero.moves.slice(0, limit)) {
      plans.push({ ...buildImplementationPlan(moveToPlanInput(m, tenantId)), generatedAt });
    }
  } catch {
    /* fail-soft — execution layer still works off whatever loaded */
  }

  // (b) Demand product opportunities → concept-only product/collection plans.
  try {
    const demand = await loadDemandOpportunities(tenantId, { limit });
    for (const p of demand.products.slice(0, 6)) {
      plans.push({
        ...buildImplementationPlan({
          moveId: p.id,
          tenantId,
          actionType: p.recommendedAction,
          targetUrl: p.matchedPageUrl,
          query: p.keyword,
          demand: p.estDemand,
          confidence: p.confidence,
          conceptOnly: p.conceptOnly,
          licensingRisk: p.licensingRisk,
          inventoryVerified: !p.conceptOnly,
          evidence: p.evidence,
          proofMetrics: p.proofMetrics,
        }),
        generatedAt,
      });
    }
  } catch {
    /* fail-soft */
  }

  plans.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
  const readyCount = plans.filter((p) => p.status === "ready_to_apply").length;
  const blockedCount = plans.filter(
    (p) => p.status !== "ready_to_apply" && p.status !== "applied" && p.status !== "measuring",
  ).length;
  return { plans: plans.slice(0, limit + 6), readyCount, blockedCount };
}
