/**
 * GA4 nightly URL-traffic sync (2026-06-13 midnight shift) — closes the
 * END-STATE gap where GA4 had a live CONSUMER but no nightly producer.
 *
 * The page-value weight in the priority score
 * (`ga4-page-values.loadGa4PageValuesForTenant` → `promotion-writer`)
 * reads `ga4_url_traffic`, and the outcome-attribution surfaces read it
 * too — but the ONLY writer was the operator-triggered diagnostics
 * button (`/diagnostics/outcome-attribution` refresh action). So a
 * freshly-connected GA4 key contributed NOTHING to ranking until an
 * operator manually clicked refresh. This wrapper makes GA4 sync
 * nightly like the other connectors (GSC / SEMrush / Clarity / Profound):
 * the moment a GA4 key + property land, traffic flows into the ranking
 * weight with zero further action.
 *
 * Thin, deterministic, fail-soft, DORMANT-UNTIL-KEY by contract:
 *   • no GA4 token            → { synced: false, reason: "no_token" }
 *   • token but no property   → { synced: false, reason: "no_property" }
 *   • Data API / persist fail → { synced: false, reason } (the cron logs
 *                                one line and continues — never dies here)
 *
 * Reuses the EXACT same helpers the operator refresh action uses
 * (`getGoogleConnectorToken("ga4")` → `token.ga4_property_id` →
 * `getRecommendedEdits()` → `computeRefreshDateRange()` →
 * `persistGa4UrlTraffic()`), minus the operator-mode gate — the nightly
 * job is the trusted runner context, same as the GSC sync step. The
 * date range is bounded by `computeRefreshDateRange` (90-day default,
 * expanded back only to the earliest shipped edit's live_at, hard-floored
 * at the lookback cap) so the GA4 quota is never abused. Writes UPSERT
 * idempotently inside `persistGa4UrlTraffic`, so re-running a night is safe.
 */

import "server-only";

import { getGoogleConnectorToken } from "@/lib/connector-store";
import { getRepository } from "@/lib/persistence/repositories";

import {
  computeRefreshDateRange,
  persistGa4UrlTraffic,
} from "./persist-url-traffic";

export type Ga4SyncResult =
  | { synced: false; reason: string }
  | {
      synced: true;
      property: string;
      rows_fetched: number;
      rows_upserted: number;
    };

export async function syncGa4UrlTrafficForTenant(args: {
  tenantId: string;
  now?: Date;
}): Promise<Ga4SyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) {
    return { synced: false, reason: "no_token" };
  }
  const propertyId = token.ga4_property_id;
  if (propertyId == null || propertyId === "") {
    return { synced: false, reason: "no_property" };
  }

  // Bound the pull to the same window the operator refresh uses: 90-day
  // default, expanded back only to the earliest shipped edit's live_at.
  const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  const { startDate, endDate } = computeRefreshDateRange(edits, now);

  const result = await persistGa4UrlTraffic({
    tenantId,
    propertyId,
    startDate,
    endDate,
  });
  if (!result.ok) {
    return { synced: false, reason: result.reason };
  }
  return {
    synced: true,
    property: propertyId,
    rows_fetched: result.rows_fetched,
    rows_upserted: result.rows_upserted,
  };
}
