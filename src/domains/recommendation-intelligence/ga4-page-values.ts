/**
 * Fusion slice (2026-06-12) — per-page GA4 value signals. Aggregates
 * the tenant's synced `ga4_url_traffic` rows over the trailing 28-day
 * window into one value object per page — the PIE "Importance" axis
 * from the fusion-math research (page business value weights the
 * priority of work on that page).
 *
 * Fail-soft: missing table / no rows / stale connector (no recent
 * rows) → empty Map → every page weighs neutral (1.0). The weight
 * activates automatically once GA4 syncs fresh rows.
 */

import "server-only";

import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

// Request-memoized: the cockpit now reads GA4 page value from several sections
// (hero post-pass + the money-leak scan) on one render — cache() dedupes the
// full-tenant read to a single query per request. Degrades to a no-op outside a
// React request scope (cron/scripts call it uncached, exactly as before).
export const loadGa4PageValuesForTenant = cache(loadGa4PageValuesForTenantUncached);

export type Ga4PageValue = {
  page: string;
  sessions28d: number;
  engaged28d: number;
  conversions28d: number;
};

const WINDOW_DAYS = 28;
// audit-wave #5 (2026-06-23): 25k url×day rows truncated high-traffic tenants
// (~890 pages × 28d) and dropped the most-recent days, understating the
// business-value weight. Raised to match the sibling per-URL reader
// (gsc-page-signals MAX_ROWS = 80k ≈ 2850 pages × 28d). Follow-up: a server-side
// GROUP BY RPC (one row per page) would remove the cap entirely.
const MAX_ROWS = 80_000;

async function loadGa4PageValuesForTenantUncached(
  tenantId: string,
  now: Date = new Date(),
): Promise<Map<string, Ga4PageValue>> {
  const out = new Map<string, Ga4PageValue>();
  type Row = {
    url: string;
    sessions: number;
    engaged_sessions: number;
    conversions: number;
  };
  const rows: Row[] = [];
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sb = getSupabaseAdmin();
    // audit wave-2 #5 (2026-06-14): PostgREST caps a response at ~1000 rows
    // regardless of .limit(), so the old `.limit(25000)` read silently
    // truncated to an arbitrary 1000 url×day rows — then the per-page SUM
    // below understated sessions/conversions, skewing the GA4 priority
    // weight (a high-value page could weigh neutral because its rows fell
    // past the cut). Page through in 1000-row chunks, stably ordered.
    const PAGE = 1000;
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await sb
        .from("ga4_url_traffic")
        .select("url, sessions, engaged_sessions, conversions")
        .eq("tenant_id", tenantId)
        .gte("date", since)
        .order("date")
        .order("url")
        .range(from, from + PAGE - 1);
      if (error) {
        log.warn("[ga4-page-values] read failed", {
          tenantId,
          error: error.message,
        });
        break;
      }
      const batch = (data ?? []) as unknown as Row[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
  } catch {
    return out;
  }
  for (const r of rows) {
    const page = canonicalizeCitationUrl(r.url) ?? r.url;
    const cur = out.get(page) ?? {
      page,
      sessions28d: 0,
      engaged28d: 0,
      conversions28d: 0,
    };
    cur.sessions28d += r.sessions ?? 0;
    cur.engaged28d += r.engaged_sessions ?? 0;
    cur.conversions28d += r.conversions ?? 0;
    out.set(page, cur);
  }
  return out;
}

/**
 * Bounded page-value multiplier (1.0–1.5), log-damped per the fusion
 * research (PIE Importance + the log-damping convention so one
 * converting page doesn't monopolize the queue):
 *
 *   weight = min(1.5, 1 + 0.25 · log10(1 + conversions + 0.1·engaged))
 *
 * Conversions dominate (they are the business value); engaged
 * sessions contribute at a 10:1 discount. Neutral (1.0) when the
 * page has no GA4 value data.
 */
export function ga4ValueWeight(v: Ga4PageValue | undefined): number {
  if (v == null) return 1.0;
  const mass = v.conversions28d + 0.1 * v.engaged28d;
  if (mass <= 0) return 1.0;
  return Math.min(1.5, 1 + 0.25 * Math.log10(1 + mass));
}
