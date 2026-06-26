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
 * nightly like the other connectors (GSC / Clarity / Profound):
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

import { log } from "@/lib/logger";
import { getGoogleConnectorToken, updateConnectorToken } from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { getRepository } from "@/lib/persistence/repositories";

import {
  computeRefreshDateRange,
  persistGa4UrlTraffic,
  type Ga4RevenuePersistStatus,
} from "./persist-url-traffic";

export type Ga4SyncResult =
  | { synced: false; reason: string }
  | {
      synced: true;
      property: string;
      rows_fetched: number;
      rows_upserted: number;
      /** audit-3 #7: true when GA4 runReport returned a PARTIAL result
       *  (GA4_MAX_PAGES ceiling or a later page failed). The data is stored
       *  but incomplete — surfaced so the cron summary doesn't read as a clean
       *  full pull. */
      truncated?: boolean;
      /** 2026-06-26: revenue enrichment outcome. Traffic syncing succeeds
       *  regardless; this reports whether revenue was also captured (synced),
       *  was unavailable, or failed — so the cron summary is honest. */
      revenue?: Ga4RevenuePersistStatus;
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
    // Reconnect signal (2026-06-15): ONLY a `token_expired` outcome proves the
    // GA4 grant is dead → stamp the token so getConnectorHealth surfaces
    // "Reconnect Google". Other failures (quota_exceeded, admin_unavailable,
    // persist_failed, invalid_args, …) are NOT auth failures and must not
    // fabricate a reconnect prompt. Fail-soft — the stamp never alters this
    // return value or throws.
    if (result.reason === "token_expired") {
      await stampGa4AuthFailure(tenantId, now);
    }
    return { synced: false, reason: result.reason };
  }
  // Auth proved good (data fetched + persisted) → clear any prior marker so
  // the strip drops back to a plain "connected" ✓. Fail-soft.
  await clearGa4AuthFailure(tenantId);
  // audit-3 #7: a truncated pull stored a PARTIAL day. Log loudly so a silently
  // incomplete GA4 day is visible in the nightly log (mirrors the GSC path),
  // and thread the flag up so the cron result is honest.
  if (result.truncated) {
    log.warn("[ga4-sync] GA4 report truncated; stored a PARTIAL result", {
      tenantId,
      property: propertyId,
      rows_fetched: result.rows_fetched,
    });
  }
  // Revenue is best-effort: traffic synced regardless. Log when revenue could
  // NOT be captured so the operator sees WHY page-value falls back to
  // conversions (e.g. revenue_unavailable = property has no ecommerce).
  if (result.revenue && !result.revenue.synced) {
    log.warn("[ga4-sync] traffic synced but revenue NOT captured; using conversion fallback", {
      tenantId,
      property: propertyId,
      reason: result.revenue.reason,
    });
  }
  return {
    synced: true,
    property: propertyId,
    rows_fetched: result.rows_fetched,
    rows_upserted: result.rows_upserted,
    ...(result.truncated ? { truncated: true } : {}),
    ...(result.revenue ? { revenue: result.revenue } : {}),
  };
}

/**
 * Reconnect signal (2026-06-15) — persist the auth-failure marker onto the
 * google_ga4 token row so getConnectorHealth can surface "Reconnect Google"
 * from a render. FAIL-SOFT by contract: a token-write error here must NEVER
 * change the sync's return value or throw. Tenant-scoped (RAILS: isolation
 * sacred).
 */
async function stampGa4AuthFailure(tenantId: string, now: Date): Promise<void> {
  try {
    const token = await getGoogleConnectorToken("ga4", tenantId);
    if (token == null) return; // never connected → never fabricate a prompt
    // DEFINITIVE (2026-06-22, mirrors GSC): "revoked" is set ONLY when the
    // refresh token is genuinely dead. The on-use auto-refresh fires this sync
    // concurrently, so probe with a LIVE refresh: success → grant alive → CLEAR;
    // invalid_grant → dead → STAMP; any other error → transient → leave as-is.
    if (token.refresh_token) {
      try {
        await refreshGoogleAccessToken(token.refresh_token);
        await updateConnectorToken("google_ga4", { auth_failed_at: null }, tenantId);
        return;
      } catch (e) {
        if (!(e instanceof Error && /invalid_grant/i.test(e.message))) {
          return; // transient — do NOT alarm
        }
      }
    }
    await updateConnectorToken(
      "google_ga4",
      { auth_failed_at: now.toISOString() },
      tenantId,
    );
  } catch {
    /* fail-soft — never alter the sync outcome */
  }
}

async function clearGa4AuthFailure(tenantId: string): Promise<void> {
  try {
    await updateConnectorToken("google_ga4", { auth_failed_at: null }, tenantId);
  } catch {
    /* fail-soft — never alter the sync outcome */
  }
}
