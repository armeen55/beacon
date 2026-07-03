import "server-only";

import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { loadResultsLedgerSurface } from "../results/results-ledger-data";
import { buildReportModel, type ReportModel } from "./report-model";

/**
 * reports-data (P23, 2026-07-03) - the read-only entry point for the internal
 * /reports pack (the export-a-win card + the trailing-month report page).
 *
 * IT COMPOSES ALREADY-COMPUTED DATA. It reads the EXACT same snapshot the
 * /results page and /results/export route read (loadResultsLedgerSurface -
 * results-ledger-data.ts's SWR cache), so every count and every clicks figure
 * on /reports agrees with /results by construction: same rows, same measure
 * pass, same `computedAt`. No new store, no new measure, no LLM.
 *
 * The pure shaping lives in report-model.ts (unit-tested); this layer only does
 * the tenant-scoped read and hands the rows + snapshot time to it.
 */

/** Request-memoized report model for the current tenant, built from the shared
 *  /results snapshot. Every /reports surface reads THIS so one request serves
 *  one snapshot and the numbers never drift within a page. */
export const loadReportModel = cache(async (): Promise<ReportModel> => {
  await currentTenantId(); // ambient-tenant read keeps this in lockstep with /results routing
  const surface = await loadResultsLedgerSurface().catch(() => null);
  return buildReportModel({
    ledger: surface?.ledger ?? [],
    computedAt: surface?.computedAt ?? new Date().toISOString(),
    now: new Date(),
  });
});
