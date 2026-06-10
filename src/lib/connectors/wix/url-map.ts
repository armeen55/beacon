import "server-only";

/**
 * 2026-06-10 — Wix URL map (§push layer).
 *
 * Beacon's Change Cards target page URLs; the Wix Data API targets
 * (collection, item) pairs. This module bridges them: an operator-
 * triggered sync queries each configured collection, derives every
 * dynamic page's URL from `urlPrefix + slugField`, and persists the
 * url → item map (tenant-scoped store `wix-url-map`). The push service
 * resolves a card's target_url here before any write.
 *
 * The collection mapping config lives in the tenant-scoped store
 * `wix-collection-config` (operator-edited on /diagnostics/wix).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { wixQueryDataItems, type WixDeps } from "./client";
import type { WixCollectionMapping, WixUrlMapEntry } from "./types";

const MAP_STORE = "wix-url-map";
const CONFIG_STORE = "wix-collection-config";

export async function getWixCollectionConfig(): Promise<WixCollectionMapping[]> {
  try {
    return (await readStore<WixCollectionMapping>(CONFIG_STORE)) ?? [];
  } catch {
    return [];
  }
}

export async function saveWixCollectionConfig(
  rows: WixCollectionMapping[],
): Promise<void> {
  await writeStore(CONFIG_STORE, rows);
}

export async function getWixUrlMap(): Promise<WixUrlMapEntry[]> {
  try {
    return (await readStore<WixUrlMapEntry>(MAP_STORE)) ?? [];
  } catch {
    return [];
  }
}

/** Resolve one canonical page URL to its CMS item, or null. */
export async function resolveWixItemForUrl(
  targetUrl: string,
): Promise<WixUrlMapEntry | null> {
  const canonical = canonicalizeCitationUrl(targetUrl);
  if (canonical == null) return null;
  const map = await getWixUrlMap();
  return (
    map.find((e) => e.url === canonical || e.url === `${canonical}/`) ?? null
  );
}

export type SyncWixUrlMapResult = {
  ok: boolean;
  collections: number;
  itemsMapped: number;
  errors: string[];
};

/**
 * Operator-triggered: rebuild the url map from the configured
 * collections. Replace-on-sync (the map is a derived cache).
 */
export async function syncWixUrlMap(
  args: { siteBaseUrl: string },
  deps: WixDeps = {},
): Promise<SyncWixUrlMapResult> {
  const config = await getWixCollectionConfig();
  const entries: WixUrlMapEntry[] = [];
  const errors: string[] = [];
  const now = new Date().toISOString();
  const base = args.siteBaseUrl.replace(/\/+$/, "");

  for (const mapping of config) {
    const items = await wixQueryDataItems(
      { dataCollectionId: mapping.dataCollectionId, limit: 1000 },
      deps,
    );
    if (!items.ok) {
      errors.push(`${mapping.dataCollectionId}: ${items.reason}${items.detail ? ` (${items.detail})` : ""}`);
      continue;
    }
    for (const item of items.value) {
      const slugRaw = item.data[mapping.slugField];
      if (typeof slugRaw !== "string" || slugRaw === "") continue;
      const slug = slugRaw.replace(/^\/+/, "");
      const prefix = mapping.urlPrefix.replace(/\/+$/, "");
      const rawUrl = `${base}${prefix}/${slug}`;
      const canonical = canonicalizeCitationUrl(rawUrl);
      if (canonical == null) continue;
      const labelRaw = mapping.labelField ? item.data[mapping.labelField] : null;
      entries.push({
        url: canonical,
        dataCollectionId: mapping.dataCollectionId,
        dataItemId: item.id,
        slugField: mapping.slugField,
        label: typeof labelRaw === "string" ? labelRaw : null,
        syncedAt: now,
      });
    }
  }

  if (config.length > 0 && entries.length === 0 && errors.length === config.length) {
    return { ok: false, collections: config.length, itemsMapped: 0, errors };
  }
  await writeStore(MAP_STORE, entries);
  return { ok: true, collections: config.length, itemsMapped: entries.length, errors };
}

