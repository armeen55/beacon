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

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { wixQueryAllDataItems, type WixDeps } from "./client";
import {
  getWixCollectionConfig,
  saveWixCollectionConfig,
  getWixUrlMap,
  writeWixUrlMap,
} from "./mappings-store";
import type { WixUrlMapEntry } from "./types";

// Phase 1 (2026-06-16, MAX_SEO_AEO audit P0 #1): the Wix collection config +
// url map moved out of the ephemeral file store into durable, tenant-scoped
// Supabase (src/lib/connectors/wix/mappings-store.ts), with a file fallback.
// Re-exported here so existing callers (push-service, /diagnostics/wix) keep
// importing these from url-map.ts unchanged.
export { getWixCollectionConfig, saveWixCollectionConfig, getWixUrlMap };

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

/** Content-edit action_type → the page ROLE it edits. The unambiguous
 *  single-field SEO edits are auto-targetable: title, H1, and meta
 *  description. `edit_meta` maps to the `description` role — on Wix a
 *  dynamic page's meta description is populated by an SEO Variable bound
 *  to a collection field, so writing that field updates the live meta
 *  (Wix "Working with SEO Settings for Dynamic Pages" / "Using Variables
 *  in SEO Settings", 2026-06). All three are OPT-IN: each does nothing
 *  until the operator maps the concrete field on /diagnostics/wix, so a
 *  collection with no per-item meta field simply leaves `description`
 *  unset and `edit_meta` cards stay paste-ready. Body-append
 *  (add_h2_section/add_faq) stays absent — multi-field, riskier. */
const CONTENT_ACTION_FIELD_ROLE: Readonly<
  Record<string, "title" | "heading" | "description">
> = {
  edit_title: "title",
  change_h1: "heading",
  edit_meta: "description",
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

  // Collections whose Wix query SUCCEEDED this run. Only these are
  // "authoritative" for the durable stale-delete — a collection that
  // transiently failed below is left out, so writeWixUrlMap preserves its
  // existing rows instead of wiping its pages' push-readiness.
  const okCollectionIds: string[] = [];

  for (const mapping of config) {
    const items = await wixQueryAllDataItems(
      { dataCollectionId: mapping.dataCollectionId },
      deps,
    );
    if (!items.ok) {
      errors.push(`${mapping.dataCollectionId}: ${items.reason}${items.detail ? ` (${items.detail})` : ""}`);
      continue;
    }
    okCollectionIds.push(mapping.dataCollectionId);
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
  // Scope the durable stale-delete to ONLY the collections that synced OK,
  // so a partial Wix failure never wipes a skipped collection's url map.
  await writeWixUrlMap(entries, { authoritativeCollectionIds: okCollectionIds });
  // #73: sampled live verification of the DERIVED urls (warn-only).
  const probe = await probeSampleUrls(entries, deps.fetchImpl ?? fetch);
  return { ok: true, collections: config.length, itemsMapped: entries.length, errors, probe };
}

