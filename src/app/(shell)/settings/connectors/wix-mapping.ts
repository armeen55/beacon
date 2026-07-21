import "server-only";

/**
 * Wix page mapping (relocated 2026-07-20 from the retired /diagnostics/wix
 * surface). The guided collection-mapper that used to live on a diagnostics
 * page is gone; the ONE thing an operator needs to unblock Wix publishing is
 * this: turn "0 mapped pages" into a real page map. This module is that
 * minimal end-to-end move, callable from the Wix card's Discover collections
 * button:
 *
 *   1. Read-only discover the connected site's collections + fields
 *      (wixListDataCollections — no writes to Wix, ever).
 *   2. Auto-map every CONTENT collection not already mapped, using the pure
 *      suggestion heuristics (suggestCollectionMapping). Operator-saved rows
 *      are preserved untouched — we only ADD suggestions, never clobber. System
 *      collections (orders / members / form submissions) are skipped so we never
 *      map transactional data as if it were a page.
 *   3. Build the durable url map from the (now merged) config
 *      (syncWixUrlMap) — THIS is what produces the real mapped-page count and
 *      what the push service resolves a card's target URL through before any
 *      write.
 *
 * Honest by construction: a Wix read failure (no key / disconnected / API
 * error) or a sync failure returns a discriminated reason the card renders as
 * plain first-person copy; a run that maps zero pages returns ok with
 * mappedPages: 0 (found collections, nothing publishable yet) rather than
 * faking success.
 */

import type { WixDeps } from "@/lib/connectors/wix/client";
import { wixListDataCollections } from "@/lib/connectors/wix/client";
import {
  getWixCollectionConfig,
  saveWixCollectionConfig,
  syncWixUrlMap,
} from "@/lib/connectors/wix/url-map";
import {
  isSystemWixCollection,
  suggestCollectionMapping,
} from "@/lib/connectors/wix/suggest-mapping";
import type { WixCollectionMapping } from "@/lib/connectors/wix/types";

export type DiscoverWixResult =
  | {
      ok: true;
      /** Content (page-like) collections discovered on the site. */
      collectionsFound: number;
      /** Collections in the durable config after this run (saved + newly added). */
      collectionsMapped: number;
      /** Content collections this run auto-mapped for the first time. */
      newlyMapped: number;
      /** Pages in the url map after the sync — the real mapped-page count. */
      mappedPages: number;
      /** Sampled live-URL probe failures (a derived-URL mapping may be off). */
      probeWarnings: number;
    }
  | {
      ok: false;
      reason: "no_key" | "disconnected" | "api_error" | "sync_failed";
      detail?: string;
    };

/**
 * Discover the connected site's collections, auto-map the not-yet-mapped
 * content ones, then rebuild the url map. `siteBaseUrl` is the tenant's own
 * site origin (e.g. https://www.example.com); `deps` forwards the tenant/token
 * seam to the Wix client (tests inject a fake list + sync).
 */
export async function discoverAndMapWixCollections(
  args: { siteBaseUrl: string },
  deps: WixDeps = {},
): Promise<DiscoverWixResult> {
  const listed = await wixListDataCollections(deps);
  if (!listed.ok) {
    const reason =
      listed.reason === "no_key" || listed.reason === "disconnected"
        ? listed.reason
        : "api_error";
    return { ok: false, reason, detail: listed.detail };
  }

  // Content collections only. System collections (orders / members / form
  // submissions) are never auto-mapped as pages.
  const content = listed.value.filter((c) => !isSystemWixCollection(c.id));

  const existing = await getWixCollectionConfig().catch(() => []);
  const existingIds = new Set(existing.map((m) => m.dataCollectionId));

  // Merge, never clobber: keep every operator-saved row; ADD a suggested
  // mapping for each content collection not already mapped.
  const additions: WixCollectionMapping[] = content
    .filter((c) => !existingIds.has(c.id))
    .map((c) => suggestCollectionMapping(c));
  const merged = [...existing, ...additions];

  if (additions.length > 0) {
    await saveWixCollectionConfig(merged);
  }

  // Build the url map from the merged config → the real mapped-page count.
  const sync = await syncWixUrlMap(args, deps);
  if (!sync.ok) {
    return {
      ok: false,
      reason: "sync_failed",
      detail: sync.errors.length > 0 ? sync.errors.join("; ") : undefined,
    };
  }

  return {
    ok: true,
    collectionsFound: content.length,
    collectionsMapped: merged.length,
    newlyMapped: additions.length,
    mappedPages: sync.itemsMapped,
    probeWarnings: sync.probe.failures.length,
  };
}
