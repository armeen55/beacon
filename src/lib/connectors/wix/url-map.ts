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

/** Content-edit action_type → the page ROLE it edits. Only the
 *  unambiguous single-field edits are auto-targetable in v1; body-append
 *  (add_h2_section/add_faq) and CMS meta are intentionally absent —
 *  riskier, and Wix CMS items rarely carry a per-item meta field. */
const CONTENT_ACTION_FIELD_ROLE: Readonly<
  Record<string, "title" | "heading">
> = {
  edit_title: "title",
  change_h1: "heading",
};

/**
 * Derive a live-pushable `field:<cmsField>` element key for a content
 * edit (Wix content-push slice, 2026-06-13) from the operator's
 * per-collection `contentFieldRoles` config. THIS is what lets Accept
 * push a title/heading edit LIVE to a Wix CONTENT page (the push service
 * calls this when a card carries no `field:`/`create:` target).
 *
 * Returns null — so the card stays PASTE-READY (today's behavior) — when:
 *   • the action isn't an auto-targetable content edit, OR
 *   • the URL isn't a mapped Wix CMS item (run the url-map sync), OR
 *   • the matched collection has no role configured on /diagnostics/wix.
 *
 * Per-tenant + operator-derived (NO hardcoding): the field name comes
 * only from the operator's own collection config, empty by default, so a
 * tenant opts into live content pushes by filling it in. Slug-ish fields
 * are still refused downstream in push-service (no URL changes ever).
 * Tenant scope is ambient (same as resolveWixItemForUrl /
 * getWixCollectionConfig — both read the tenant-scoped store).
 */
export async function deriveWixContentFieldKey(
  targetUrl: string,
  actionType: string,
): Promise<string | null> {
  const role = CONTENT_ACTION_FIELD_ROLE[actionType];
  if (role == null) return null;
  const entry = await resolveWixItemForUrl(targetUrl);
  if (entry == null) return null;
  const config = await getWixCollectionConfig();
  const mapping = config.find(
    (m) => m.dataCollectionId === entry.dataCollectionId,
  );
  const field = mapping?.contentFieldRoles?.[role]?.trim();
  if (!field) return null;
  return `field:${field}`;
}

export type SyncWixUrlMapResult = {
  ok: boolean;
  collections: number;
  itemsMapped: number;
  errors: string[];
  /**
   * Night-shift #73 (2026-06-11) — sampled live-URL verification: up
   * to PROBE_SAMPLES_PER_COLLECTION derived URLs per collection are
   * probed after the sync. A failing sample means the prefix/slug
   * mapping is probably wrong for that collection (pushes would target
   * pages that don't exist). Warn-only: entries stay usable; the
   * operator surface + nightly log show the warning.
   */
  probe: { checked: number; ok: number; failures: string[] };
};

const PROBE_SAMPLES_PER_COLLECTION = 3;

async function probeSampleUrls(
  entries: ReadonlyArray<WixUrlMapEntry>,
  fetchImpl: typeof fetch,
): Promise<{ checked: number; ok: number; failures: string[] }> {
  // Deterministic sample: first / middle / last entry per collection.
  const byCollection = new Map<string, WixUrlMapEntry[]>();
  for (const e of entries) {
    const arr = byCollection.get(e.dataCollectionId) ?? [];
    arr.push(e);
    byCollection.set(e.dataCollectionId, arr);
  }
  const samples: WixUrlMapEntry[] = [];
  for (const arr of byCollection.values()) {
    const picks = new Set([0, Math.floor(arr.length / 2), arr.length - 1]);
    let n = 0;
    for (const i of picks) {
      if (arr[i] && n < PROBE_SAMPLES_PER_COLLECTION) {
        samples.push(arr[i]!);
        n++;
      }
    }
  }
  let okCount = 0;
  const failures: string[] = [];
  for (const sample of samples) {
    try {
      const res = await fetchImpl(sample.url, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "BeaconUrlMapProbe/1.0" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) okCount++;
      else failures.push(`${sample.url} → HTTP ${res.status} (${sample.dataCollectionId})`);
    } catch (err) {
      failures.push(
        `${sample.url} → ${err instanceof Error ? err.message : String(err)} (${sample.dataCollectionId})`,
      );
    }
  }
  return { checked: samples.length, ok: okCount, failures };
}

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
    return {
      ok: false,
      collections: config.length,
      itemsMapped: 0,
      errors,
      probe: { checked: 0, ok: 0, failures: [] },
    };
  }
  await writeStore(MAP_STORE, entries);
  // #73: sampled live verification of the DERIVED urls (warn-only).
  const probe = await probeSampleUrls(entries, deps.fetchImpl ?? fetch);
  return { ok: true, collections: config.length, itemsMapped: entries.length, errors, probe };
}

