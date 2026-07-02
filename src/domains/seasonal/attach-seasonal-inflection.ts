/**
 * seasonal/attach-seasonal-inflection (BEACON_500 item 69) - the one call site
 * a proof read path needs: given a tenant's shipped-change ledger rows, load
 * that tenant's family demand profiles ONCE and compute each row's
 * seasonal-inflection flag, keyed by ledger row id. Mirrors the
 * detectMeasurementOverlaps / buildShockWindows precedent in
 * measurement-maturity.ts / algorithm-weather.ts - a small read-time join, no
 * mutation, no persistence.
 *
 * HARD RULE: computed-only. Nothing here writes to any store; the returned
 * map is fed straight into buildMeasurementPresentation's `seasonalInflection`
 * / `seasonalInflectionCaveat` inputs (measurement-maturity.ts), the same
 * additive posture as shockWindows/weakComparison.
 */

import "server-only";

import { measurementWindowOf } from "@/domains/proof-gsc/measurement-maturity";
import { loadFamilyDemandProfiles } from "./family-demand-profile-store";
import { computeSeasonalInflection, type SeasonalInflectionFlag } from "./seasonal-inflection";

/** First path segment groups a family - mirrors pageFamilyOf in
 *  daily-experiment-planner.ts exactly (duplicated here rather than imported
 *  to keep this leaf module dependency-free of the experiments domain; both
 *  copies are pinned by tests so drift would be caught). */
function pageFamilyOfPath(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[0]! : (segs[0] ?? "root");
}

export type SeasonalInflectionLedgerRow = {
  id: string;
  path: string;
  shippedAt: string;
  windows: ReadonlyArray<{ day: number; ran: boolean }>;
};

/**
 * Load this tenant's family demand profiles once and compute the seasonal-
 * inflection flag for every ledger row whose measurement window is known.
 * Fail-soft -> empty map (a loader hiccup means no caveats fire, never a
 * crash on the Results page).
 */
export async function attachSeasonalInflectionForLedger(
  tenantId: string,
  rows: readonly SeasonalInflectionLedgerRow[],
): Promise<Map<string, SeasonalInflectionFlag>> {
  const out = new Map<string, SeasonalInflectionFlag>();
  if (!tenantId || rows.length === 0) return out;

  const profiles = await loadFamilyDemandProfiles(tenantId).catch(() => []);
  if (profiles.length === 0) return out;
  const byFamily = new Map(profiles.map((p) => [p.pageFamily, p] as const));

  for (const row of rows) {
    const window = measurementWindowOf(row.shippedAt, row.windows);
    if (!window) continue;
    const family = pageFamilyOfPath(row.path);
    const profile = byFamily.get(family);
    if (!profile) continue;
    const flag = computeSeasonalInflection({
      pageFamily: family,
      windowStart: window.start,
      windowEnd: window.end,
      profile,
    });
    if (flag.measuredAcrossSeasonalInflection) out.set(row.id, flag);
  }

  return out;
}
