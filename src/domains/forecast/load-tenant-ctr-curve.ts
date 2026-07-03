import "server-only";

import { cache } from "react";

import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { getBusinessConfig } from "@/lib/business-config";
import { log } from "@/lib/logger";
import {
  defaultCtrCurve,
  fitTenantCtrCurve,
  type QueryCtrAggregate,
  type TenantCtrCurve,
} from "./tenant-ctr-curve";

/**
 * load-tenant-ctr-curve (BEACON_500 R9 / P3) - the I/O edge for the tenant's own
 * position-to-clicks curve. Reuses the SAME per-page GSC signal read every other
 * GSC surface uses (the gsc_page_signals_v1 RPC via loadGscPageSignalsForTenant,
 * exact + bounded), flattens each page's top queries into query observations,
 * excludes brand queries via the tenant's configured name, and fits the curve.
 *
 * Fail-soft: any read/config error returns the industry-default curve (honestly
 * tagged "not enough of your own data yet"), never a throw - a broken read must
 * not blank a forecast surface. Request-deduped via react cache, matching the
 * gsc-page-queries.ts pattern.
 */
export const loadTenantCtrCurve = cache(async (tenantId: string): Promise<TenantCtrCurve> => {
  try {
    const signals = await loadGscPageSignalsForTenant(tenantId);
    const rows: QueryCtrAggregate[] = [];
    for (const signal of signals.values()) {
      for (const q of signal.topQueries) {
        rows.push({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position });
      }
    }
    let brandName: string | null = null;
    try {
      brandName = getBusinessConfig(tenantId).name || null;
    } catch {
      brandName = null;
    }
    return fitTenantCtrCurve(rows, { brandName });
  } catch (e) {
    log.warn("[tenant-ctr-curve] fit failed, using the industry default", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return defaultCtrCurve();
  }
});
