import "server-only";

/**
 * hypothesis-log (2026-07-02, DREAM SITE V1 item D7) - durable, additive-only store that captures
 * every forecast opportunity-math.ts renders to the operator, so the settle-time calibration
 * ledger (forecast-calibration-store.ts, written at the day-28 measure) can be joined back to the
 * EXACT hypothesis that was on screen when the number was shown. This is the render-time half of
 * "every forecast becomes a learnable hypothesis": forecast-calibration-store.ts already grades a
 * pick's forecast once it settles; this store proves the forecast was actually shown BEFORE that,
 * with the same shape opportunity-math.ts produced, not reconstructed after the fact.
 *
 * Follows the forecast-calibration-store.ts sibling pattern exactly: a GLOBAL json-store (rows
 * carry tenant_id, because a future nightly digest render would have no ambient request context)
 * that is Supabase-mirrored so the write survives Vercel's read-only filesystem. Registered in
 * store-classification.ts (GLOBAL_STORES) + json-store.ts (SUPABASE_MIRRORED_STORES).
 *
 * NEVER touches measurement history - this is a NEW, separate, append-only ledger. A capture call
 * is idempotent per hypothesisId (opportunity-math.ts derives the id from tenant+page+lever+day, so
 * re-rendering the SAME opportunity on the SAME day logs once, not once per page view).
 *
 * Write-only today (repository diet 2026-07-21): the in-app read API was deleted with no consumer;
 * the durable rows remain joinable by a future calibration reader.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { OpportunityForecast } from "./opportunity-math";

const STORE = "opportunity-hypotheses";

export type HypothesisRecord = {
  hypothesisId: string;
  tenantId: string;
  page: string;
  lever: string;
  lowPerMonth: number | null;
  highPerMonth: number | null;
  days: number;
  basis: string;
  /** ISO timestamp the forecast was first rendered/captured. */
  at: string;
};

function toRecord(tenantId: string, page: string, lever: string, forecast: OpportunityForecast, at: string): HypothesisRecord {
  return {
    hypothesisId: forecast.hypothesisId,
    tenantId,
    page,
    lever,
    lowPerMonth: forecast.lowPerMonth,
    highPerMonth: forecast.highPerMonth,
    days: forecast.days,
    basis: forecast.basis,
    at,
  };
}

async function readAll(): Promise<HypothesisRecord[]> {
  try {
    return (await readStore<HypothesisRecord>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

/**
 * Record one rendered forecast as a falsifiable hypothesis. Additive-only: a repeat capture of the
 * SAME hypothesisId (the same tenant+page+lever+day) is a no-op (returns false) - re-rendering a
 * page many times in one day logs the hypothesis once. Fail-soft on write (best-effort; logging a
 * hypothesis must never block or fail the render that produced it).
 */
export async function captureHypothesis(
  tenantId: string,
  page: string,
  lever: string,
  forecast: OpportunityForecast,
  at: string = new Date().toISOString(),
): Promise<boolean> {
  try {
    const rows = await readAll();
    if (rows.some((r) => r.tenantId === tenantId && r.hypothesisId === forecast.hypothesisId)) return false;
    await writeStore(STORE, [...rows, toRecord(tenantId, page, lever, forecast, at)]);
    return true;
  } catch {
    return false;
  }
}
