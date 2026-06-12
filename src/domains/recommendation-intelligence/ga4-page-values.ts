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

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

export type Ga4PageValue = {
  page: string;
  sessions28d: number;
  engaged28d: number;
  conversions28d: number;
};

const WINDOW_DAYS = 28;
const MAX_ROWS = 25_000;

export async function loadGa4PageValuesForTenant(
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
  let rows: Row[] = [];
  try {
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("ga4_url_traffic")
      .select("url, sessions, engaged_sessions, conversions")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .limit(MAX_ROWS);
    if (error) {
      log.warn("[ga4-page-values] read failed", {
        tenantId,
        error: error.message,
      });
      return out;
    }
    rows = (data ?? []) as unknown as Row[];
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
