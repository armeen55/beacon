import "server-only";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { getBusinessConfig } from "@/lib/business-config";
import { generatePageCandidates, type PageCandidate } from "./entity-attribute-factory";
import { generateCityServiceCandidates, type CityServiceCandidate } from "./city-service-factory";

/**
 * load-page-candidates (2026-06-25, Sprint 6) — feed the programmatic page factory
 * from the tenant's real demand graph (owned page URLs + demand-cluster labels +
 * topics). Read-only, $0, fail-soft. Output is needs-demand-validation candidates
 * (no fabricated demand) — they must pass the DataForSEO create-page verdict before
 * becoming real Moves.
 */
export async function loadPageCandidates(tenantId: string, opts: { max?: number } = {}): Promise<PageCandidate[]> {
  try {
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    const ownedUrls = graph.pageNodes.filter((p) => p.isOwned).map((p) => p.url);
    const demandLabels = graph.moves.map((m) => m.label);
    const tenantTopics = [...new Set([...demandLabels, ...ownedUrls])];
    return generatePageCandidates({
      ownedUrls,
      demandLabels,
      tenantTopics,
      maxCandidates: opts.max ?? 24,
    });
  } catch {
    return [];
  }
}

/**
 * City × service candidates (plan P12, local-service half). Driven entirely by the
 * tenant's CONFIG (locations × services) — fail-closed to [] for content tenants
 * with no service areas (so it self-hides for Iranopedia + populates for a connected
 * local-service tenant like Ritz). Read-only, $0.
 */
export async function loadCityServiceCandidates(tenantId: string, opts: { max?: number } = {}): Promise<CityServiceCandidate[]> {
  try {
    const config = getBusinessConfig(tenantId);
    const cities = config.locations ?? [];
    const services = config.services ?? [];
    if (cities.length === 0 || services.length === 0) return []; // not a local-service tenant
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    const ownedUrls = graph.pageNodes.filter((p) => p.isOwned).map((p) => p.url);
    return generateCityServiceCandidates({
      cities,
      services,
      ownedUrls,
      titleQualifier: config.industry || undefined,
      maxCandidates: opts.max ?? 30,
    });
  } catch {
    return [];
  }
}
