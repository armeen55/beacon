/**
 * algorithm-weather-store (2026-07-02, master plan item 32) - persistence for
 * the nightly CUSUM changepoint pass over a tenant's sitewide daily Search
 * Console totals, so the Results page + the prior/lesson readers see detected
 * sitewide shocks without recomputing them (and so they survive a lambda
 * recycle on Vercel).
 *
 * Follows the trend-radar/spike-store.ts sibling pattern exactly: a GLOBAL
 * json-store (rows carry tenant_id because the nightly cron fans out across
 * tenants with no ambient request context) that is Supabase-mirrored so the
 * write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { Changepoint } from "./changepoint";

const STORE = "algorithm-weather-shocks";

/** A detection older than this is not trusted as "current weather" - a shock
 *  from 3 months ago should not silently keep quarantining today's verdicts
 *  forever; the nightly pass re-detects and re-persists every night anyway. */
const SHOCKS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type AlgorithmWeatherRow = {
  tenant_id: string;
  computed_at: string;
  /** The newest finalized GSC day the detection pass ran over, or null when
   *  the pass had no usable data. */
  anchor_date: string | null;
  clicksChangepoints: Changepoint[];
  impressionsChangepoints: Changepoint[];
};

/** Persist the latest changepoint pass for a tenant (latest wins). An EMPTY
 *  pair of lists is written too: "checked, nothing shifted" is a different
 *  truth from "never checked". */
export async function writeAlgorithmWeatherSummary(row: AlgorithmWeatherRow): Promise<void> {
  const rows = await readStore<AlgorithmWeatherRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest changepoint pass for the tenant, or null when absent / stale.
 *  Fail-soft -> null. */
export async function readAlgorithmWeatherSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<AlgorithmWeatherRow | null> {
  try {
    const rows = await readStore<AlgorithmWeatherRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= SHOCKS_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for surfaces: this tenant's detected changepoints (clicks +
 *  impressions merged), or [] when no fresh pass exists. */
export async function loadDetectedChangepoints(tenantId: string, now: Date = new Date()): Promise<Changepoint[]> {
  const row = await readAlgorithmWeatherSummary(tenantId, now);
  if (!row) return [];
  const seen = new Set<string>();
  const out: Changepoint[] = [];
  for (const c of [...row.clicksChangepoints, ...row.impressionsChangepoints]) {
    const key = `${c.date}:${c.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
