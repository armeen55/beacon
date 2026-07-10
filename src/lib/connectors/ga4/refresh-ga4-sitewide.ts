import "server-only";

/**
 * GA4 sitewide + reconciliation ride-along for the ON-DEMAND refresh paths
 * (2026-07-10, Wave 2A).
 *
 * The nightly cron runs the TRUE sitewide GA4 series (ga4_daily_totals) and its
 * monthly reconciliation as their own dedicated phases. But the operator's manual
 * "Update data" click (refreshAllConnectedDataNow) and the on-USE auto refresh
 * (autoRefreshStaleConnectorsForTenant) only pull the per-PAGE GA4 traffic table,
 * so without this the north-star visits number would never light up between nightly
 * runs. This helper closes that gap: after a GA4 refresh on those paths, pull the
 * sitewide sessions and reconcile them, so the card can go live the moment the
 * operator refreshes - no cron dependence.
 *
 * FAIL-SOFT + DORMANT-UNTIL-KEY: both steps return a cheap no_token/no_property
 * result when GA4 is not connected (a $0 no-op), and this wrapper never throws, so
 * a sitewide/reconcile hiccup can never turn a good visitors pull into a failure -
 * exactly the isolation contract the nightly phases carry.
 */

import { log } from "@/lib/logger";
import { syncGa4SitewideSessionsForTenant } from "./sync-sitewide-sessions";
import { reconcileGa4MonthlySeries } from "@/domains/north-star/reconcile-ga4-monthly-series";

export async function refreshGa4SitewideAndReconcile(tenantId: string): Promise<void> {
  try {
    await syncGa4SitewideSessionsForTenant({ tenantId });
    await reconcileGa4MonthlySeries(tenantId);
  } catch (e) {
    log.warn("[ga4-sitewide-refresh] ride-along failed (visitors pull unaffected)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
