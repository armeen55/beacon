import "server-only";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { generatePageCandidates, type PageCandidate } from "./entity-attribute-factory";

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
