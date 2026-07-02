import "server-only";

/**
 * aa-calibration-store (2026-07-02, master plan item 31) - persistence for the
 * nightly A/A (placebo) calibration pass: Beacon's own measured false-positive
 * rate, and the per-traffic-tier floors derived from it.
 *
 * Follows the language-gap-matrix / trend-query-spikes sibling pattern exactly:
 * a GLOBAL json-store (rows carry tenant_id because the nightly cron fans out
 * across tenants with no ambient request context), Supabase-mirrored so the
 * write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 *
 * SAFETY: this store holds ONLY the aggregate calibration result (sample size,
 * false-positive rate, derived floors). It never holds a placebo "shipped
 * change" row, and nothing here is read by loadProofLedger / the real proof
 * ledger - see aa-calibration.ts for the in-memory-only placebo run.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { TrafficTier, VerdictFloors } from "./measure";

const STORE = "aa-calibration";

/** A calibration pass older than this is not trusted for floor derivation
 *  (the site's traffic mix drifts) - readFloorsFor falls back to defaults. */
export const AA_CALIBRATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type AaTierResult = {
  tier: TrafficTier;
  /** How many placebo pages landed in this tier this run. */
  sampleSize: number;
  /** Fraction (0-1) of this tier's placebo pages that read won or lost. */
  falsePositiveRate: number;
  /** Derived floors for this tier (stricter-only clamp vs the shipped default). */
  derivedMinLiftClicks: number;
  derivedMinLiftCtr: number;
};

export type AaCalibrationRow = {
  tenant_id: string;
  computed_at: string;
  /** Total placebo pages measured this run, across all tiers. */
  sampleSize: number;
  /** Overall fraction (0-1) that read won or lost (the headline number). */
  falsePositiveRate: number;
  byTrafficTier: AaTierResult[];
  /** Cumulative placebo samples ever measured for this tenant (this run's
   *  sampleSize plus every prior run's) - the derivation's "stricter only
   *  until >=100 samples" safety rule reads this, not the single-run count. */
  cumulativeSampleSize: number;
};

/** Persist the latest calibration pass for a tenant (latest wins; other
 *  tenants untouched). Fail-soft: throws only on a genuine write failure the
 *  caller should see (mirrors writeLanguageGapSummary's posture). */
export async function writeAaCalibration(row: AaCalibrationRow): Promise<void> {
  const rows = await readStore<AaCalibrationRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest calibration pass for the tenant, or null when absent / older than
 *  AA_CALIBRATION_MAX_AGE_MS. Fail-soft -> null. */
export async function readAaCalibration(
  tenantId: string,
  now: Date = new Date(),
): Promise<AaCalibrationRow | null> {
  try {
    const rows = await readStore<AaCalibrationRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= AA_CALIBRATION_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/**
 * The floors measure.ts should use for a given tenant + traffic tier, read
 * from the latest fresh calibration pass. Fail-soft: any read failure or a
 * missing/stale/tier-less calibration returns `{}` (summarizeVerdict then
 * falls back to its own DEFAULT_MIN_LIFT_* constants) - so this function can
 * NEVER make measure.ts throw or behave differently when there is no
 * calibration data, which is the behavior the identical-when-empty test pins.
 */
export async function readFloorsFor(
  tenantId: string,
  tier: TrafficTier,
  now: Date = new Date(),
): Promise<VerdictFloors> {
  try {
    const row = await readAaCalibration(tenantId, now);
    if (!row) return {};
    const t = row.byTrafficTier.find((x) => x.tier === tier);
    if (!t) return {};
    return { minLiftClicks: t.derivedMinLiftClicks, minLiftCtr: t.derivedMinLiftCtr };
  } catch {
    return {};
  }
}
