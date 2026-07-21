import "server-only";

import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import {
  getBusinessConfig,
  hydrateBusinessConfigFromSupabase,
} from "@/lib/business-config";
import { isUsableRevenueModel } from "@/domains/revenue/compute-unit-economics";
import type { ChangeRevenueModel } from "@/domains/proof-gsc/change-dollar-value";
import { buildShockWindows } from "@/domains/proof-gsc/algorithm-weather";
import { loadDetectedChangepoints } from "@/domains/proof-gsc/algorithm-weather-store";
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
  const tenantId = await currentTenantId(); // ambient-tenant read keeps this in lockstep with /results routing
  const now = new Date();
  const surface = await loadResultsLedgerSurface().catch(() => null);
  const revenueModel = await resolveTenantRevenueModel(tenantId);
  // Same shock windows /results builds (loadDetectedChangepoints is react-cached, so
  // this shares the read), so /reports dollars route through THE ONE DOLLAR RULE and
  // can never claim earnings for a win Today and Results exclude. Fail-soft to [].
  const changepoints = await loadDetectedChangepoints(tenantId, now).catch(() => []);
  const shockWindows = buildShockWindows({ dailySeries: [], priorChangepoints: changepoints });
  return buildReportModel({
    ledger: surface?.ledger ?? [],
    computedAt: surface?.computedAt ?? now.toISOString(),
    now,
    revenueModel,
    shockWindows,
  });
});

/**
 * RANK-2: resolve the operator's own unit-economics rate (business-config item 3)
 * into the ChangeRevenueModel the money model names the dollar basis with. Same
 * lookup as the nightly revenue pass + run-measurement's resolver (freshest
 * Supabase-hydrated config, in-memory fallback). Returns null - so the win cards
 * show the honest connect-prompt - whenever no usable positive rate is set.
 * Fail-soft: any config read error degrades to null (no dollars), never throws.
 */
async function resolveTenantRevenueModel(
  tenantId: string,
): Promise<ChangeRevenueModel | null> {
  try {
    const cfg = (await hydrateBusinessConfigFromSupabase(tenantId)) ?? getBusinessConfig(tenantId);
    const model = cfg.revenueModel;
    if (!isUsableRevenueModel(model)) return null;
    if (model.kind === "rpm") return { kind: "rpm", rpmUsd: model.rpmUsd! };
    return { kind: "per_lead", dollarsPerLead: model.dollarsPerLead! };
  } catch {
    return null;
  }
}
