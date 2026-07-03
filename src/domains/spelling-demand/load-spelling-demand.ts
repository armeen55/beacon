/**
 * load-spelling-demand (P20, v1 129, 2026-07-03) - server assembly.
 *
 * Assembles the pure inputs the spelling-demand engine + Move predicate need,
 * from the tenant's declared spelling groups (config) and the ALREADY-LOADED
 * GSC page signals ($0 - no new query, no API). This module does the I/O
 * (reading the tenant config); the engine stays pure.
 *
 * With no configured spelling groups it returns empty items immediately, so the
 * loader adds nothing and every surface is byte-identical to before P20.
 *
 * GENERIC + language-agnostic. No em or en dashes anywhere.
 */

import "server-only";

import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

import { consolidateSpellingDemand, normalizeSpelling } from "./consolidate";
import {
  buildSpellingDemandMoveItems,
  type SpellingDemandMoveItem,
} from "./build-move-items";
import type { SpellingDemandTerm, SpellingVariantGroup } from "./types";

/**
 * Read the tenant's declared spelling groups. Empty array when none configured
 * or on any registry hiccup (the engine no-ops on an empty array anyway).
 */
export async function loadSpellingVariantGroupsForTenant(
  tenantId: string,
): Promise<SpellingVariantGroup[]> {
  try {
    const { getTenant } = await import("@/domains/tenants/store");
    const tenant = await getTenant(tenantId);
    const groups = tenant?.spelling_variants;
    return Array.isArray(groups) ? groups : [];
  } catch {
    return [];
  }
}

/**
 * Flatten GSC page signals into per-term demand (impressions) across the whole
 * site, plus a coverage map: normalized spelling -> owned page URLs already
 * showing demand for it. Demand for a term is summed over every page+query that
 * matches it; coverage lists the pages where it appears.
 */
function assembleDemandFromGsc(gscSignals: ReadonlyMap<string, GscPageSignal>): {
  demand: SpellingDemandTerm[];
  ownedCoverageBySpelling: Map<string, Set<string>>;
} {
  const demandByNorm = new Map<string, { display: string; demand: number }>();
  const coverage = new Map<string, Set<string>>();
  for (const sig of gscSignals.values()) {
    for (const q of sig.topQueries) {
      if (!q.query) continue;
      const norm = normalizeSpelling(q.query);
      if (norm.length === 0) continue;
      const impressions = typeof q.impressions === "number" ? q.impressions : 0;
      const existing = demandByNorm.get(norm);
      if (existing) existing.demand += impressions;
      else demandByNorm.set(norm, { display: q.query.trim(), demand: impressions });
      if (impressions > 0) {
        let urls = coverage.get(norm);
        if (!urls) {
          urls = new Set<string>();
          coverage.set(norm, urls);
        }
        urls.add(sig.page);
      }
    }
  }
  const demand: SpellingDemandTerm[] = [];
  for (const { display, demand: d } of demandByNorm.values()) {
    demand.push({ term: display, demand: d });
  }
  return { demand, ownedCoverageBySpelling: coverage };
}

export type LoadSpellingDemandMoveItemsInput = {
  tenantId: string;
  gscSignals: ReadonlyMap<string, GscPageSignal>;
  /** Optional demand floor override (tests / tuning). */
  minCombinedDemand?: number;
};

/**
 * The one call the trigger loader makes: config -> consolidation -> Move items.
 * Empty when the tenant configured no groups (no-op) or no group clears the bar.
 */
export async function loadSpellingDemandMoveItems(
  input: LoadSpellingDemandMoveItemsInput,
): Promise<SpellingDemandMoveItem[]> {
  const groups = await loadSpellingVariantGroupsForTenant(input.tenantId);
  if (groups.length === 0) return [];

  const { demand, ownedCoverageBySpelling } = assembleDemandFromGsc(input.gscSignals);
  const consolidated = consolidateSpellingDemand({ groups, demand });
  if (consolidated.groups.length === 0) return [];

  return buildSpellingDemandMoveItems({
    groups: consolidated.groups,
    ownedCoverageBySpelling,
    minCombinedDemand: input.minCombinedDemand,
  });
}
