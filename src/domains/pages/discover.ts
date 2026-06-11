/**
 * Page discovery: mine PageEntity records from existing citation and changelog data.
 * No crawling required — purely data-driven.
 */

import type { CitationObservation } from "@/domains/citation-observations/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type {
  PageEntity,
  DiscoverySource,
} from "./types";
import {
  normalizePageUrl,
  classifyPageType,
  classifyOwnership,
  extractCityFromPath,
  extractCityFromText,
  isOpaqueUrl,
} from "./classify";
import { getBusinessConfig } from "@/lib/business-config";

type DiscoveredPage = {
  url: string;
  domain: string;
  path: string;
  sources: Set<DiscoverySource>;
  titles: string[];
  cities: Set<string>;
  topics: Set<string>;
  changelog_ids: string[];
  source_categories: string[];
  entity_ids: Set<string>;
  first_seen: string;
  last_seen: string;
};

/**
 * Discover all pages from citations, changelog entries, and tracked entities.
 * Returns deduplicated PageEntity records keyed by normalized URL.
 */
export function discoverPages(opts: {
  citations: CitationObservation[];
  changes: ChangelogEntry[];
  entities: TrackedEntity[];
  ownedDomain: string;
  tenantId: string;
}): PageEntity[] {
  const { citations, changes, entities, ownedDomain, tenantId } = opts;
  if (!tenantId) {
    throw new Error(
      `[discoverPages] tenantId required; pass currentTenantId() / BEACON_TENANT_ID from the calling orchestrator or script.`,
    );
  }
  const ownedDomains = new Set<string>();

  for (const e of entities) {
    if (e.is_owned && e.domain) {
      ownedDomains.add(e.domain.toLowerCase().replace(/^www\./, ""));
    }
  }
  ownedDomains.add(ownedDomain.toLowerCase().replace(/^www\./, ""));

  // Night-shift #147 (2026-06-11): the tenant's OWN city vocabulary
  // (lowercased) drives city extraction — not the global Bay-Area list.
  // A content tenant with no locations → [] → no false city tags.
  const tenantCities = (getBusinessConfig(tenantId).locations ?? []).map((c) =>
    c.toLowerCase().trim(),
  );

  const pageMap = new Map<string, DiscoveredPage>();

  function getOrCreate(url: string, domain: string, path: string): DiscoveredPage {
    let page = pageMap.get(url);
    if (!page) {
      page = {
        url, domain, path,
        sources: new Set(),
        titles: [],
        cities: new Set(),
        topics: new Set(),
        changelog_ids: [],
        source_categories: [],
        entity_ids: new Set(),
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      };
      pageMap.set(url, page);
    }
    return page;
  }

  for (const c of citations) {
    if (!c.url && !c.domain) continue;
    const raw = c.url ?? `https://${c.domain}/`;
    const parsed = normalizePageUrl(raw);
    if (!parsed) continue;

    const page = getOrCreate(parsed.url, parsed.domain, parsed.path);
    page.sources.add("citation");
    if (c.title) page.titles.push(c.title);
    if (c.source_category) page.source_categories.push(c.source_category);
    if (c.tracked_entity_id) page.entity_ids.add(c.tracked_entity_id);

    if (c.observed_at < page.first_seen) page.first_seen = c.observed_at;
    if (c.observed_at > page.last_seen) page.last_seen = c.observed_at;
  }

  for (const ch of changes) {
    if (!ch.url || isOpaqueUrl(ch.url)) continue;
    const parsed = normalizePageUrl(ch.url, ownedDomain);
    if (!parsed) continue;

    const page = getOrCreate(parsed.url, parsed.domain, parsed.path);
    page.sources.add("changelog");
    page.changelog_ids.push(ch.id);
    if (ch.city_targeted) page.cities.add(ch.city_targeted.toLowerCase().trim());
    if (ch.topic_targeted) page.topics.add(ch.topic_targeted);

    if (ch.timestamp < page.first_seen) page.first_seen = ch.timestamp;
    if (ch.timestamp > page.last_seen) page.last_seen = ch.timestamp;
  }

  for (const e of entities) {
    if (!e.url) continue;
    const parsed = normalizePageUrl(e.url);
    if (!parsed) continue;

    const page = getOrCreate(parsed.url, parsed.domain, parsed.path);
    page.sources.add("entity_url");
    page.entity_ids.add(e.id);

    if (e.created_at < page.first_seen) page.first_seen = e.created_at;
  }

  const results: PageEntity[] = [];
  let idx = 0;

  for (const [, p] of pageMap) {
    idx++;
    const pageType = classifyPageType(p.path, p.domain);
    const primaryCategory = mostCommon(p.source_categories) as
      | CitationObservation["source_category"]
      | undefined;
    const ownership = classifyOwnership(p.domain, ownedDomains, primaryCategory);

    const pathCity = extractCityFromPath(p.path, tenantCities);
    const textCity = p.cities.size > 0
      ? [...p.cities][0]
      : p.titles.length > 0
        ? extractCityFromText(p.titles[0], tenantCities)
        : null;
    const city = pathCity ?? textCity ?? null;

    const entityId = p.entity_ids.size > 0 ? [...p.entity_ids][0] : null;

    results.push({
      id: `pg-${idx}`,
      url: p.url,
      canonical_url: p.url,
      domain: p.domain,
      path: p.path,
      page_type: pageType,
      city,
      service: null,
      topics: [...p.topics],
      ownership_tier: ownership,
      tracked_entity_id: entityId,
      is_owned: ownership === "owned",
      first_seen_at: p.first_seen,
      last_observed_at: p.last_seen,
      discovery_sources: [...p.sources],
      title_last_seen: p.titles.length > 0 ? p.titles[p.titles.length - 1] : null,
      changelog_ids: p.changelog_ids,
      metadata: {},
      tenant_id: tenantId,
    });
  }

  return results;
}

function mostCommon(arr: string[]): string | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const s of arr) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best = arr[0];
  let bestCount = 0;
  for (const [k, v] of counts) {
    if (v > bestCount) { best = k; bestCount = v; }
  }
  return best;
}
