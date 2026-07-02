import "server-only";

/**
 * forecast-calibration-store (2026-07-02, master plan items 27/28) - durable, additive-only store
 * for calibration records: one row per pick, written ONCE at its 28-day measure, comparing the
 * numeric forecast persisted on the plan pick (pick-expectations.ts) against the realized monthly
 * click lift the measurement already computed. These records are NEW writes only - they NEVER
 * touch measurement history (ShippedChangeRecord / the GSC proof ledger stay untouched); this is a
 * separate, append-only ledger the aggregator (forecast-calibration.ts) reads.
 *
 * Follows the pipeline-health-store / ai-engine-gap-summary sibling pattern: a GLOBAL json-store
 * (rows carry tenant_id, because the measure pass can run with no ambient request context) that is
 * Supabase-mirrored so the write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts (SUPABASE_MIRRORED_STORES).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "forecast-calibration";

export type CalibrationOutcome = "inside" | "above" | "below";

export type CalibrationRecord = {
  /** The plan pick's experimentId (PlannedExperimentRecord.id), also the natural idempotency key
   *  alongside tenantId - a pick is measured at day 28 exactly once. */
  pickId: string;
  tenantId: string;
  /** The shipped-change ledger row this pick settled into (ShippedChangeRecord.id). */
  proofId: string;
  page: string;
  lever: string;
  forecastLow: number;
  forecastHigh: number;
  /** Realized monthly click lift at the 28-day window (the same adjustedLift the GSC ledger
   *  already computed, scaled to a per-month figure so it is comparable to the forecast range). */
  actual: number;
  outcome: CalibrationOutcome;
  /** ISO timestamp the calibration record was written (the day-28 measure time, not the ship date). */
  at: string;
};

function outcomeFor(actual: number, low: number, high: number): CalibrationOutcome {
  if (actual < low) return "below";
  if (actual > high) return "above";
  return "inside";
}

/** PURE: fold a settled pick's forecast + realized lift into a calibration record. */
export function buildCalibrationRecord(input: {
  pickId: string;
  tenantId: string;
  proofId: string;
  page: string;
  lever: string;
  forecastLow: number;
  forecastHigh: number;
  actual: number;
  at: string;
}): CalibrationRecord {
  return {
    pickId: input.pickId,
    tenantId: input.tenantId,
    proofId: input.proofId,
    page: input.page,
    lever: input.lever,
    forecastLow: input.forecastLow,
    forecastHigh: input.forecastHigh,
    actual: input.actual,
    outcome: outcomeFor(input.actual, input.forecastLow, input.forecastHigh),
    at: input.at,
  };
}

async function readAll(): Promise<CalibrationRecord[]> {
  try {
    return (await readStore<CalibrationRecord>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

/** All calibration records for a tenant. Fail-soft -> []. */
export async function loadCalibrationRecords(tenantId: string): Promise<CalibrationRecord[]> {
  const rows = await readAll();
  return rows.filter((r) => r.tenantId === tenantId);
}

/** True when a pick already has a calibration record (idempotency guard for the day-28 writer). */
export async function hasCalibrationRecord(tenantId: string, pickId: string): Promise<boolean> {
  const rows = await readAll();
  return rows.some((r) => r.tenantId === tenantId && r.pickId === pickId);
}

/**
 * Append one calibration record, once per pickId. Additive-only: never overwrites or removes an
 * existing record for the same pick (calibration history, once written, is never mutated). No-op
 * (returns false) when a record for this pick already exists. Fail-soft on write (best-effort;
 * a calibration write must never block or fail the measure pass it rides on).
 */
export async function appendCalibrationRecord(record: CalibrationRecord): Promise<boolean> {
  try {
    const rows = await readAll();
    if (rows.some((r) => r.tenantId === record.tenantId && r.pickId === record.pickId)) return false;
    await writeStore(STORE, [...rows, record]);
    return true;
  } catch {
    return false;
  }
}
