/**
 * load-service-area-gaps (RANK-5, 2026-07-06) - the loader-side I/O wrapper for
 * the service-area page factory.
 *
 * The trigger predicate must be PURE (predicate-purity invariant), so this
 * module does the reads and hands the predicate a pre-assembled, config-driven
 * gap list. It reuses two SHIPPED substrates:
 *   • business config (locations x services x industry) - the market definition.
 *   • the demand graph's owned page URLs - for dedup (never propose a page that
 *     already exists).
 *
 * Empty-safe + fail-soft: a tenant with NO locations/services config returns []
 * immediately (a content tenant like an encyclopedia is a byte-identical no-op),
 * and any read failure returns [] rather than breaking the recommendation
 * pipeline. Read-only, $0 - no paid API call and no live crawl happen here.
 */

import "server-only";

import { getBusinessConfig } from "@/lib/business-config";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import {
  detectServiceAreaGaps,
  type ServiceAreaGap,
} from "./service-area-gaps";

/**
 * Load config-driven service-area gaps for a tenant. Returns the highest-value
 * missing city x service pages, or [] for a non-local-service tenant. Fail-soft.
 */
export async function loadServiceAreaGapsForTenant(
  tenantId: string,
  opts: { max?: number } = {},
): Promise<ServiceAreaGap[]> {
  try {
    const config = getBusinessConfig(tenantId);
    const cities = config.locations ?? [];
    const services = config.services ?? [];
    // Not a local-service tenant (no service areas configured) -> no-op.
    if (cities.length === 0 || services.length === 0) return [];

    // Owned URLs for dedup - fail-soft to none (a fresh tenant with no graph
    // still gets its config-declared gaps, just without owned-page dedup).
    let ownedUrls: string[] = [];
    try {
      const { graph } = await loadDemandGraphForTenantCached(tenantId);
      ownedUrls = graph.pageNodes.filter((p) => p.isOwned).map((p) => p.url);
    } catch {
      ownedUrls = [];
    }

    return detectServiceAreaGaps({
      cities,
      services,
      ownedUrls,
      titleQualifier: config.industry || undefined,
      maxGaps: opts.max ?? 12,
    });
  } catch {
    return [];
  }
}
