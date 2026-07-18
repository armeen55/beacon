/**
 * Entity Extraction — builds a lightweight entity index from Beacon's existing data.
 *
 * Sources:
 * - Site config (brand name, domain)
 * - Page snapshots (location_terms, service_terms, titles)
 * - Prompt-answer-observation mentions (brand/competitor names from AI answers)
 * - Answer text entity extraction (bold entities from Profound answer corpus)
 *
 * This is a FOUNDATION — no full knowledge graph, no cross-platform identity
 * stitching, no complex entity resolution.
 */

import "server-only";

import type { PageSnapshot } from "@/domains/pages/types";
import type {
  BeaconEntity,
  BeaconEntityType,
  EntityIndex,
  EntitySource,
} from "./types";
import { getSiteConfig } from "@/lib/site-config";
import { readStore } from "@/lib/persistence/json-store";
import { currentTenantId } from "@/lib/tenant-context";

function canonicalize(name: string): string {
  return name.trim().toLowerCase().replace(/['']/g, "'").replace(/\s+/g, " ");
}

export function isOwnedBrandMention(
  mention: string,
  ownedAliases: ReadonlyArray<string>,
): boolean {
  const canonical = canonicalize(mention);
  return ownedAliases.some((alias) => canonicalize(alias) === canonical);
}

function entityId(type: BeaconEntityType, canonical: string): string {
  return `${type}:${canonical}`;
}

/**
 * Extract entities from all available Beacon data sources.
 */
export async function extractEntities(
  snapshots: PageSnapshot[],
): Promise<EntityIndex> {
  const config = getSiteConfig(await currentTenantId());
  const entityMap = new Map<string, BeaconEntity>();
  const now = new Date().toISOString();

  function upsert(
    name: string,
    type: BeaconEntityType,
    source: EntitySource,
    isOwned: boolean,
    freq: number = 1,
  ): void {
    const canonical = canonicalize(name);
    if (canonical.length < 2) return;
    const id = entityId(type, canonical);

    const existing = entityMap.get(id);
    if (existing) {
      existing.frequency += freq;
      if (!existing.sources.includes(source)) existing.sources.push(source);
      if (isOwned) existing.is_owned = true;
    } else {
      entityMap.set(id, {
        id,
        name,
        entity_type: type,
        canonical_name: canonical,
        is_owned: isOwned,
        frequency: freq,
        sources: [source],
        first_seen: now,
        metadata: {},
      });
    }
  }

  // Source 1: Site config → owned brand
  upsert(config.entityDisplayName, "brand", "site_config", true, 1);
  if (config.ownedBrandShort !== "You") {
    upsert(config.ownedBrandShort, "brand", "site_config", true, 1);
  }

  // Source 2: Page snapshots → locations + services
  const ownedLocations = new Set<string>();
  const ownedServices = new Set<string>();

  for (const snap of snapshots) {
    for (const loc of snap.location_terms) {
      upsert(loc, "location", "page_snapshot", true);
      ownedLocations.add(canonicalize(loc));
    }
    for (const svc of snap.service_terms) {
      upsert(svc, "service", "page_snapshot", true);
      ownedServices.add(canonicalize(svc));
    }
  }

  // Source 3: PAO mentions → brand entities from AI answers
  const paoStore = await readStore<{
    id: string;
    mentions: string[];
    tracked_brand_mentioned: boolean | null;
    tracked_brand_cited: boolean | null;
  }>("prompt-answer-observations");

  const mentionCounts = new Map<string, number>();
  for (const pao of paoStore) {
    for (const mention of pao.mentions ?? []) {
      const key = canonicalize(mention);
      mentionCounts.set(key, (mentionCounts.get(key) ?? 0) + 1);
    }
  }

  const ownedAliases = [config.entityDisplayName, config.ownedBrandShort].filter(
    (alias) => alias.trim() && alias !== "You",
  );

  for (const [canonical, count] of mentionCounts) {
    if (count < 2) continue;
    const isOwned = isOwnedBrandMention(canonical, ownedAliases);

    const displayName = [...mentionCounts.keys()]
      .find((k) => canonicalize(k) === canonical) ?? canonical;

    upsert(displayName, "brand", "answer_mention", isOwned, count);
  }

  const entities = [...entityMap.values()].sort(
    (a, b) => b.frequency - a.frequency,
  );

  return {
    computed_at: now,
    entities,
    owned_brand: config.entityDisplayName,
    owned_locations: [...ownedLocations].sort(),
    owned_services: [...ownedServices].sort(),
  };
}

/**
 * Get only owned entities from the index.
 */
export function getOwnedEntities(index: EntityIndex): BeaconEntity[] {
  return index.entities.filter((e) => e.is_owned);
}

/**
 * Get competitor/external brand entities.
 */
export function getExternalBrands(index: EntityIndex, limit = 30): BeaconEntity[] {
  return index.entities
    .filter((e) => !e.is_owned && e.entity_type === "brand")
    .slice(0, limit);
}

/**
 * Summary for display.
 */
export function summarizeEntities(index: EntityIndex): {
  total: number;
  owned: number;
  external_brands: number;
  locations: number;
  services: number;
  top_external: string[];
} {
  let owned = 0;
  let externalBrands = 0;
  let locations = 0;
  let services = 0;
  const topExternal: string[] = [];

  for (const e of index.entities) {
    if (e.is_owned) owned++;
    if (e.entity_type === "brand" && !e.is_owned) {
      externalBrands++;
      if (topExternal.length < 5) topExternal.push(e.name);
    }
    if (e.entity_type === "location") locations++;
    if (e.entity_type === "service") services++;
  }

  return {
    total: index.entities.length,
    owned,
    external_brands: externalBrands,
    locations,
    services,
    top_external: topExternal,
  };
}
