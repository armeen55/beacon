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
import { teammateOf } from "@/domains/team/identity";
import type { RoutedQuestion } from "../router";
import type { AskFact } from "../types";
import type { AskPlan } from "../planner";
import type { AskFactProvider } from "./provider-types";

// ── the 9 wrapped providers ──────────────────────────────────────────────────────────

export const pageSpecificProvider: AskFactProvider = {
  id: "page-dossier",
  label: teammateOf("gsc").name,
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
  label: teammateOf("gsc").name,
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
  label: teammateOf("gsc").name,
  classes: ["page_ranking"],
  // GA4 page values + GSC page signals both read Supabase tables directly.
  prodLive: true,
  gather: (tenantId, question) => assemblePageRankingFacts(tenantId, question.rankingMetric ?? "traffic"),
};

export const aiVisibilityProvider: AskFactProvider = {
  id: "answer-intelligence-index",
  label: teammateOf("profound").name,
  classes: ["ai_visibility"],
  // getAnswerIntelligenceIndexForTenant routes through getRepository().forTenant(tenantId).
  prodLive: true,
  gather: (tenantId) => assembleAiVisibilityFacts(tenantId),
};

export const competitorProvider: AskFactProvider = {
  id: "competitor-intel",
  label: teammateOf("dataforseo").name,
  classes: ["competitor"],
  // Same answer-intelligence index as above, plus loadNativeIntelForTenant (direct Supabase read).
  prodLive: true,
  gather: (tenantId) => assembleCompetitorFacts(tenantId),
};

export const measurementProvider: AskFactProvider = {
  id: "proof-ledger",
  label: teammateOf("proof").name,
  classes: ["measurement"],
  // loadProofLedgerCached's primary path queries the Supabase shipped_change_proof
  // table directly (file read is only a pre-migration/no-env fallback).
  prodLive: true,
  gather: (tenantId) => assembleMeasurementFacts(tenantId),
};

export const planProvider: AskFactProvider = {
  id: "daily-plan",
  label: teammateOf("llm").name,
  classes: ["plan"],
  // getAcceptedPlan/getLatestPreviewPlan query the Supabase PLANS table directly.
  prodLive: true,
  gather: (tenantId) => assemblePlanFacts(tenantId),
};

export const keywordNextProvider: AskFactProvider = {
  id: "keyword-library",
  label: teammateOf("dataforseo").name,
  classes: ["keyword_next"],
  // Every sub-source is either a direct Supabase read or a store already registered in
  // SUPABASE_MIRRORED_STORES (dataforseo-keywords-cache, dataforseo-labs-cache,
  // keyword-gap-results, trend-query-spikes, seasonal-windows).
  prodLive: true,
  gather: (tenantId) => assembleKeywordNextFacts(tenantId),
};

export const systemHealthProvider: AskFactProvider = {
  id: "pipeline-health",
  label: teammateOf("llm").name,
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

// ── W9 slice 2 (2026-07-10): multi-provider gather over an ALREADY-SELECTED plan ──────

const MAX_TOTAL_PLAN_FACTS = 12;
const MAX_FACTS_PER_PROVIDER = 6;

/**
 * Run every provider the planner (planner.ts) already selected for this question, in
 * parallel, fail-soft PER provider exactly like gatherFacts - one provider throwing (or a
 * secondary cue that turned out to have no data) never blanks another's facts. After each
 * provider returns, its facts are stamped with provenance CENTRALLY: providerId and
 * prodLive are filled in ONLY when the provider itself did not already set them (the ??),
 * so a provider that stamps its own richer provenance - e.g. siteTrendProvider adding
 * freshnessIso - is never overwritten. source/href/freshnessIso pass straight through.
 * Facts are then merged and hard-capped so a multi-specialist answer stays bounded.
 */
export async function gatherPlan(tenantId: string, plan: AskPlan): Promise<AskFact[]> {
  const perProvider = await Promise.all(
    plan.selections.map(async (sel) => {
      const raw = await sel.provider.gather(tenantId, plan.routed).catch(() => [] as AskFact[]);
      return raw.map((f) => ({
        ...f,
        providerId: f.providerId ?? sel.provider.id,
        prodLive: f.prodLive ?? sel.provider.prodLive,
      }));
    }),
  );
  return mergeAndCapFacts(perProvider);
}

/**
 * Merge per-provider fact lists into one bounded list. Pure. Each provider is capped first
 * (default 6) so no single specialist can crowd the answer, then the groups are round-robin
 * interleaved in SELECTION ORDER (primary group first, so the routed class always leads),
 * then the whole thing is hard-capped (default 12). An exact-duplicate value (trim +
 * lowercase) is dropped, keeping the FIRST occurrence so the primary provider wins a tie.
 */
export function mergeAndCapFacts(
  perProvider: AskFact[][],
  opts: { maxTotal?: number; maxPerProvider?: number } = {},
): AskFact[] {
  const maxTotal = opts.maxTotal ?? MAX_TOTAL_PLAN_FACTS;
  const maxPerProvider = opts.maxPerProvider ?? MAX_FACTS_PER_PROVIDER;
  const groups = perProvider.map((g) => g.slice(0, maxPerProvider));
  const longest = groups.reduce((m, g) => Math.max(m, g.length), 0);
  const seen = new Set<string>();
  const out: AskFact[] = [];
  for (let i = 0; i < longest && out.length < maxTotal; i++) {
    for (const g of groups) {
      if (out.length >= maxTotal) break;
      const f = g[i];
      if (!f) continue;
      const norm = f.value.trim().toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push(f);
    }
  }
  return out;
}

/**
 * Resolve a provider id to its HUMAN specialist label (never the slug). Used by the composer
 * to name a selected provider that returned zero facts (providersUnavailable) honestly. An
 * unknown id degrades to a neutral "my team" rather than leaking the raw id.
 */
export function askProviderLabel(id: string): string {
  return ALL_PROVIDERS.find((p) => p.id === id)?.label ?? "my team";
}
