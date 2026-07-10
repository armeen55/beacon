import "server-only";

/**
 * ask/providers/registry (W9 slice 1, 2026-07-09) - the fact-provider registry over
 * EXISTING tenant-scoped durable loaders. Wraps every fact-assembly.ts assembler as a
 * thin, behavior-identical provider (same function, same args, no new query logic) so a
 * future multi-provider planner can fan out across classes without a rewrite. Today only
 * ONE class (site_trend) is actually wired through `gatherFacts` end to end (see
 * src/app/(shell)/ask/ask-actions.ts); the rest are wrapped and pinned for parity.
 *
 * `prodLive` on each provider records whether the underlying source is real hosted
 * (Supabase) data in production today (2026-07-09 audit): every one of the 9 loaders
 * fact-assembly.ts already composes reads Supabase directly (gsc_daily_totals,
 * shipped_change_proof, the PLANS table, cron_runs, getRepository()-routed indices) or a
 * store already registered in json-store.ts's SUPABASE_MIRRORED_STORES (pipeline-
 * violations, publish-health, the DataForSEO/keyword caches). None of the 9 is file-only
 * - if that ever changes, flip the flag here rather than leave a false "live" claim.
 *
 * Fail-soft is the whole point of a registry: gatherFacts catches each provider
 * independently, so one provider throwing never blanks another's facts.
 */

import {
  assemblePageFacts,
  assembleSiteTrendFacts,
  assemblePageRankingFacts,
  assembleAiVisibilityFacts,
  assembleCompetitorFacts,
  assembleMeasurementFacts,
  assemblePlanFacts,
  assembleKeywordNextFacts,
  assembleSystemHealthFacts,
  latestGscDailyDate,
} from "../fact-assembly";
import type { RoutedQuestion } from "../router";
import type { AskFact } from "../types";
import type { AskFactProvider } from "./provider-types";

// ── the 9 wrapped providers ──────────────────────────────────────────────────────────

export const pageSpecificProvider: AskFactProvider = {
  id: "page-dossier",
  classes: ["page_specific"],
  // loadPageDossier composes Supabase-backed team reads (GSC/GA4/Clarity/Profound) plus
  // the Supabase-table proof ledger; its one file-routed sub-source (language gaps) is
  // in SUPABASE_MIRRORED_STORES too.
  prodLive: true,
  gather: (tenantId, question) => (question.pagePath ? assemblePageFacts(tenantId, question.pagePath) : Promise.resolve([])),
};

/**
 * The ONE provider wired end to end through the registry in Slice 1 (see ask-actions.ts).
 * Thin adapter over assembleSiteTrendFacts, plus one small additive read
 * (latestGscDailyDate) to stamp freshness + provenance onto every fact it returns - the
 * existing assembler function itself is untouched.
 */
export const siteTrendProvider: AskFactProvider = {
  id: "gsc-daily-totals",
  classes: ["site_trend"],
  // gsc_daily_totals is a direct Supabase table read (gsc-page-queries.ts), no file
  // store involved.
  prodLive: true,
  gather: async (tenantId) => {
    const [facts, freshnessIso] = await Promise.all([
      assembleSiteTrendFacts(tenantId),
      latestGscDailyDate(tenantId),
    ]);
    if (!freshnessIso) return facts;
    return facts.map((f) => ({ ...f, freshnessIso, providerId: "gsc-daily-totals", prodLive: true }));
  },
};

export const pageRankingProvider: AskFactProvider = {
  id: "page-ranking",
  classes: ["page_ranking"],
  // GA4 page values + GSC page signals both read Supabase tables directly.
  prodLive: true,
  gather: (tenantId, question) => assemblePageRankingFacts(tenantId, question.rankingMetric ?? "traffic"),
};

export const aiVisibilityProvider: AskFactProvider = {
  id: "answer-intelligence-index",
  classes: ["ai_visibility"],
  // getAnswerIntelligenceIndex routes through getRepository().forTenant(tenantId).
  prodLive: true,
  // NOTE: assembleAiVisibilityFacts takes no tenantId - it resolves the tenant itself
  // from ambient request context (answer-intelligence/store.ts's currentTenantId()
  // read), same as every other caller of that store today. Flagged as a known gap for
  // explicit tenantId threading (see registry.test.ts); fixing it means changing that
  // store's own contract, out of scope for this slice (do not rewrite existing
  // assemblers).
  gather: () => assembleAiVisibilityFacts(),
};

export const competitorProvider: AskFactProvider = {
  id: "competitor-intel",
  classes: ["competitor"],
  // Same answer-intelligence index as above, plus loadNativeIntel (direct Supabase read).
  prodLive: true,
  gather: () => assembleCompetitorFacts(),
};

export const measurementProvider: AskFactProvider = {
  id: "proof-ledger",
  classes: ["measurement"],
  // loadProofLedgerCached's primary path queries the Supabase shipped_change_proof
  // table directly (file read is only a pre-migration/no-env fallback).
  prodLive: true,
  gather: (tenantId) => assembleMeasurementFacts(tenantId),
};

export const planProvider: AskFactProvider = {
  id: "daily-plan",
  classes: ["plan"],
  // getAcceptedPlan/getLatestPreviewPlan query the Supabase PLANS table directly.
  prodLive: true,
  gather: (tenantId) => assemblePlanFacts(tenantId),
};

export const keywordNextProvider: AskFactProvider = {
  id: "keyword-library",
  classes: ["keyword_next"],
  // Every sub-source is either a direct Supabase read or a store already registered in
  // SUPABASE_MIRRORED_STORES (dataforseo-keywords-cache, dataforseo-labs-cache,
  // keyword-gap-results, trend-query-spikes, seasonal-windows).
  prodLive: true,
  // Same ambient-tenant caveat as aiVisibilityProvider above.
  gather: () => assembleKeywordNextFacts(),
};

export const systemHealthProvider: AskFactProvider = {
  id: "pipeline-health",
  classes: ["system_health"],
  // cron_runs is a dedicated Supabase table (cron-runs-store.ts); pipeline-violations
  // and publish-health are both SUPABASE_MIRRORED_STORES.
  prodLive: true,
  gather: (tenantId) => assembleSystemHealthFacts(tenantId),
};

export const ALL_PROVIDERS: AskFactProvider[] = [
  pageSpecificProvider,
  siteTrendProvider,
  pageRankingProvider,
  aiVisibilityProvider,
  competitorProvider,
  measurementProvider,
  planProvider,
  keywordNextProvider,
  systemHealthProvider,
];

function providersFor(routed: RoutedQuestion, providers: AskFactProvider[]): AskFactProvider[] {
  return providers.filter((p) => p.classes.includes(routed.questionClass));
}

/**
 * Gather facts for one routed question from every provider registered for its class.
 * Each provider's gather() is caught INDEPENDENTLY - a throw from one provider never
 * blanks another's facts, and never bubbles up to the caller. Almost always exactly one
 * provider matches a class today; the fan-out plumbing is here so a future second
 * provider on the same class (Slice 2) is a registration, not a rewrite.
 */
export async function gatherFacts(
  tenantId: string,
  routed: RoutedQuestion,
  providers: AskFactProvider[] = ALL_PROVIDERS,
): Promise<AskFact[]> {
  const matches = providersFor(routed, providers);
  const perProvider = await Promise.all(
    matches.map((p) => p.gather(tenantId, routed).catch(() => [] as AskFact[])),
  );
  return perProvider.flat();
}
