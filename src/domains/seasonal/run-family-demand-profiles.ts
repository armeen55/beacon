/**
 * seasonal/run-family-demand-profiles (BEACON_500 item 69) - orchestrates one
 * tenant's family demand profile pass: load the permanent monthly archive +
 * the recent daily page rows, build the per-family weekly+annual profiles,
 * persist them. Mirrors the nightly seasonality pass's own orchestration
 * (seasonality.ts + seasonal-store.ts) exactly, just one level up (family
 * instead of query).
 *
 * Fail-soft: any loader error yields an empty profile set for that source,
 * never a thrown error into a cron or a page render.
 */

import "server-only";

import { loadMonthlyArchiveRows } from "./load-monthly-archive";
import { loadFamilyDailyRows } from "./load-family-daily-rows";
import { buildFamilyDemandProfiles, type FamilyDemandProfile } from "./family-demand-profile";
import { writeFamilyDemandProfiles } from "./family-demand-profile-store";

export type FamilyProfileRunResult = {
  ran: boolean;
  familiesDetected: number;
  profiles: FamilyDemandProfile[];
};

/**
 * Build and persist this tenant's family demand profiles. $0 (both sources
 * are already-synced rows, no paid calls). Idempotent - re-running replaces
 * the tenant's row with a fresh compute over current data.
 */
export async function runFamilyDemandProfiles(tenantId: string, now: Date = new Date()): Promise<FamilyProfileRunResult> {
  if (!tenantId) return { ran: false, familiesDetected: 0, profiles: [] };

  const [monthlyRows, dailyRows] = await Promise.all([
    loadMonthlyArchiveRows(tenantId),
    loadFamilyDailyRows(tenantId),
  ]);

  const profiles = buildFamilyDemandProfiles({ monthlyRows, dailyRows });

  await writeFamilyDemandProfiles({
    tenant_id: tenantId,
    computed_at: now.toISOString(),
    profiles,
  });

  return { ran: true, familiesDetected: profiles.length, profiles };
}
