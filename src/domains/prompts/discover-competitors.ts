/**
 * CX2.7 — Competitor auto-discovery.
 *
 * After the first successful audit run, analyzes all observations to
 * identify the tenant's top competitors by citation frequency. Stores
 * the top 5 on the tenant record as `discovered_competitors`.
 *
 * Discovery method: across all observations, count how often each
 * non-owned, non-generic domain appears as a citation or entity. The
 * top 5 by frequency become the tenant's competitors. These are used
 * by the comparative prompt strata and by the CX3 rank chart.
 */

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { updateTenant } from "@/domains/tenants/store";
import { getLogger } from "@/lib/obs/logger";

// ---------------------------------------------------------------------------
// Generic / directory domains to exclude
// ---------------------------------------------------------------------------

const GENERIC_DOMAINS = new Set([
  "wikipedia.org",
  "yelp.com",
  "google.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "bbb.org",
  "houzz.com",
  "angi.com",
  "homeadvisor.com",
  "thumbtack.com",
  "nextdoor.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "pinterest.com",
  "buildzoom.com",
  "porch.com",
  "angieslist.com",
  "manta.com",
  "yellowpages.com",
  "mapquest.com",
  "superpages.com",
  "foursquare.com",
]);

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function normalizeDomain(url: string): string {
  return url
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/.*$/, "")
    .toLowerCase()
    .trim();
}

/**
 * Discover the top N competitor domains from a set of observations.
 *
 * Returns domains sorted by frequency, excluding the tenant's own
 * domain and generic/directory domains.
 */
export function discoverCompetitorDomains(opts: {
  observations: PromptAnswerObservation[];
  tenantDomain: string;
  topN?: number;
}): string[] {
  const { observations, tenantDomain, topN = 5 } = opts;
  const ownDomain = normalizeDomain(tenantDomain);

  const domainCounts = new Map<string, number>();

  for (const obs of observations) {
    // Count from citation domains
    for (const domain of obs.citation_domains) {
      const normalized = normalizeDomain(domain);
      if (normalized === ownDomain) continue;
      if (GENERIC_DOMAINS.has(normalized)) continue;
      if (normalized.length <= 3) continue;
      domainCounts.set(
        normalized,
        (domainCounts.get(normalized) ?? 0) + 1,
      );
    }

    // Count from mentions metadata (if entities were stored there)
    for (const mention of obs.mentions) {
      // Mentions are brand names, not domains — skip for domain-based discovery
      // Future: resolve brand names to domains via a lookup
    }
  }

  // Sort by frequency, take top N
  return [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([domain]) => domain);
}

/**
 * Run competitor discovery for a tenant and persist to the tenant record.
 * Idempotent: overwrites any previously discovered competitors.
 */
export async function discoverAndPersistCompetitors(opts: {
  tenantId: string;
  observations: PromptAnswerObservation[];
  tenantDomain: string;
}): Promise<string[]> {
  const log = getLogger({
    module: "prompts/discover-competitors",
    tenantId: opts.tenantId,
  });

  const competitors = discoverCompetitorDomains({
    observations: opts.observations,
    tenantDomain: opts.tenantDomain,
  });

  if (competitors.length > 0) {
    await updateTenant(opts.tenantId, {
      discovered_competitors: competitors,
    });
    log.info(
      { competitors, count: competitors.length },
      "Competitors discovered and saved",
    );
  } else {
    log.info("No competitors discovered from observations");
  }

  return competitors;
}
