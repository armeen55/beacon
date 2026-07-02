import "server-only";

/**
 * nightly-aggregate (BEACON_500 item 66, 2026-07-02), the I/O half of the
 * rebuilt cross-tenant pattern brain. Runs nightly (or on demand via the
 * probe script): reads EVERY tenant's shipped_change_proof ledger directly
 * (tenant-explicit, same posture as auto-measure.ts, safe to fan out from a
 * cron, no ambient-tenant coupling), applies the IDENTICAL maturity/weather/
 * parallel-trends eligibility gate the per-tenant learning prior uses
 * (`gateRecordsToOutcomes`), buckets the decided (won/lost) outcomes into
 * {siteCategory, canonicalMoveType, intentBucket, positionBand} cells, and
 * upserts the aggregated `global_patterns` table.
 *
 * PRIVACY: only the closed-vocabulary key + counts/rates ever get written.
 * No tenant id, page, domain, or query text is persisted, see rr-pattern.ts
 * and the migration's header for the full argument. `distinctTenants` is
 * counted from a Set that is discarded after aggregation; only its size
 * survives to the row.
 *
 * SEEDING HONESTY (item 66 #4): with 1 real tenant today, every cell's
 * distinctTenants is 1, which is BELOW MIN_DISTINCT_TENANTS_TO_SURFACE (3).
 * The brain stays silent, rows are written (so the pipeline is provably
 * live and ready to warm up the moment tenant #2 and #3 ship MATURE
 * changes), but nothing surfaces to an operator. This module does not
 * decide what surfaces; `experiment-prior.ts`'s `resolvePrior` does, and it
 * re-checks the floor independently at read time.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { listTenants } from "@/domains/tenants/store";
import type { TenantSegment } from "@/domains/tenants/types";
import { rowToRecord } from "@/domains/proof-gsc/shipped-change-store";
import { gateRecordsToOutcomes } from "@/domains/learning/load-experiment-outcomes";
import type { GlobalCell, PriorDimension } from "@/domains/learning/experiment-prior";
import { canonicalMoveType } from "@/domains/learning/experiment-prior";
import {
  aggregateRrPatternCells,
  deriveRrPatternKey,
  rrPatternKeyId,
  siteCategoryFromSegment,
  type RrCellObservation,
  type RrPatternCell,
} from "./rr-pattern";
import { log } from "@/lib/logger";

const SHIPPED_TABLE = "shipped_change_proof";
const GLOBAL_TABLE = "global_patterns";

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204")) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    (/relation .* does not exist/i.test(e.message) || /schema cache/i.test(e.message))
  );
}

/**
 * Load + gate ONE tenant's shipped-change ledger into RrCellObservation[].
 * Tenant-explicit (no ambient currentTenantId()) so this is safe to call in
 * a loop across every tenant from a single process. Fail-soft: a read error
 * or missing table yields [] for that tenant rather than aborting the pass.
 */
export async function loadTenantMatureObservations(
  tenantId: string,
  segment: TenantSegment | null | undefined,
): Promise<RrCellObservation[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return []; // no Supabase env → nothing to aggregate for this tenant
  }
  const { data, error } = await admin.from(SHIPPED_TABLE).select("*").eq("tenant_id", tenantId);
  if (error != null) {
    if (!isUndefinedTableError(error)) {
      log.warn("[global-patterns/nightly-aggregate] read failed", { tenantId, error: error.message });
    }
    return [];
  }
  const records = (data as Parameters<typeof rowToRecord>[0][]).map(rowToRecord);
  if (records.length === 0) return [];

  // gateRecordsToOutcomes maps `records` 1:1, preserving order (see its
  // implementation); index alignment below is safe without a lookup map.
  const outcomes = await gateRecordsToOutcomes(tenantId, records);

  const observations: RrCellObservation[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i];
    // decided-only (won/lost): MATURE gate already neutralized every
    // non-mature/weather-overlapping/weak-control record to "measuring",
    // and operator-pinned "inconclusive" overrides are excluded exactly
    // like the per-tenant prior excludes them.
    const isWon = outcome.verdict === "won";
    const isLost = outcome.verdict === "lost";
    if (!isWon && !isLost) continue;
    if (outcome.operatorVerdictOverride === "inconclusive") continue;

    const record = records[i];
    if (!record) continue;
    const basisWindow = (record.windows ?? [])
      .filter((w) => w.ran && w.day === 28)
      .sort((a, b) => b.day - a.day)[0];

    observations.push({
      tenantId,
      key: deriveRrPatternKey({
        segment,
        actionType: record.actionType,
        targetQuery: record.targetQueries?.[0] ?? null,
        prePosition: record.baseline?.position ?? null,
      }),
      won: isWon,
      clicksLift: basisWindow ? basisWindow.adjustedLift : null,
    });
  }
  return observations;
}

/**
 * Full nightly pass: enumerate every tenant, gate + bucket each one's mature
 * outcomes, aggregate into cells, and upsert `global_patterns`. Returns the
 * computed cells (so the probe/cron caller can report a summary) even when
 * the table write itself is skipped (pre-migration environment).
 */
export async function runGlobalPatternsNightlyAggregation(): Promise<{
  cells: RrPatternCell[];
  tenantsScanned: number;
  observationsAggregated: number;
  written: boolean;
}> {
  const tenants = await listTenants();
  const allObservations: RrCellObservation[] = [];

  for (const tenant of tenants) {
    const obs = await loadTenantMatureObservations(tenant.id, tenant.segment);
    allObservations.push(...obs);
  }

  const cells = aggregateRrPatternCells(allObservations);
  const written = await writeGlobalPatternCells(cells);

  return {
    cells,
    tenantsScanned: tenants.length,
    observationsAggregated: allObservations.length,
    written,
  };
}

type GlobalPatternRow = {
  id: string;
  site_category: string;
  canonical_move_type: string;
  intent_bucket: string;
  position_band: string;
  n: number;
  distinct_tenants: number;
  win_rate: number;
  lift_p25: number | null;
  lift_p75: number | null;
  updated_at: string;
};

function cellToRow(cell: RrPatternCell): GlobalPatternRow {
  return {
    id: cell.id,
    site_category: cell.key.siteCategory,
    canonical_move_type: cell.key.canonicalMoveType,
    intent_bucket: cell.key.intentBucket,
    position_band: cell.key.positionBand,
    n: cell.n,
    distinct_tenants: cell.distinctTenants,
    win_rate: cell.winRate,
    lift_p25: cell.liftP25,
    lift_p75: cell.liftP75,
    updated_at: cell.updatedAt,
  };
}

/**
 * Upsert every cell into `global_patterns`. Fail-soft + pre-migration-safe:
 * a missing table logs a warning and returns false (the app already
 * degrades correctly; resolvePrior's global backoff simply finds nothing
 * until this is applied). Returns true only when every cell wrote cleanly.
 */
export async function writeGlobalPatternCells(cells: RrPatternCell[]): Promise<boolean> {
  if (cells.length === 0) return true; // nothing to write is not a failure
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return false; // no Supabase env, probe/dry-run environments stay inert
  }
  const rows = cells.map(cellToRow);
  const { error } = await admin.from(GLOBAL_TABLE).upsert(rows, { onConflict: "id" });
  if (error != null) {
    if (isUndefinedTableError(error)) {
      log.warn("[global-patterns/nightly-aggregate] global_patterns table not found, apply the pending migration");
      return false;
    }
    log.warn("[global-patterns/nightly-aggregate] write failed", { error: error.message });
    return false;
  }
  return true;
}

function rowToCell(row: GlobalPatternRow): RrPatternCell {
  return {
    key: {
      siteCategory: row.site_category as RrPatternCell["key"]["siteCategory"],
      canonicalMoveType: row.canonical_move_type,
      intentBucket: row.intent_bucket as RrPatternCell["key"]["intentBucket"],
      positionBand: row.position_band as RrPatternCell["key"]["positionBand"],
    },
    id: row.id,
    n: row.n,
    distinctTenants: row.distinct_tenants,
    winRate: row.win_rate,
    liftP25: row.lift_p25,
    liftP75: row.lift_p75,
    updatedAt: row.updated_at,
  };
}

/**
 * Read every `global_patterns` row into memory. Fail-soft → [] (no Supabase
 * env, missing table, or read error all degrade to "no global signal",
 * matching the pre-item-66 posture until the migration + first nightly run
 * have both landed).
 */
export async function readAllGlobalPatternCells(): Promise<RrPatternCell[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return [];
  }
  const { data, error } = await admin.from(GLOBAL_TABLE).select("*");
  if (error != null) {
    if (!isUndefinedTableError(error)) {
      log.warn("[global-patterns/nightly-aggregate] read failed", { error: error.message });
    }
    return [];
  }
  return (data as GlobalPatternRow[]).map(rowToCell);
}

/**
 * Build the `globalLookup` callback `resolvePrior` / `applyExperimentPriorToMoves`
 * accept, bridging the two dimension vocabularies:
 *   - the tenant-level prior is keyed by {actionType, pageType, queryCluster}
 *   - the global cell is keyed by {siteCategory, canonicalMoveType, intentBucket,
 *     positionBand}
 *
 * The only dimension both share is the move type (`actionType` <-> `canonicalMoveType`
 * via the SAME `canonicalMoveType()` collapse both pipelines use). Looking up by
 * (dimension, value) from `resolvePrior`'s ladder therefore only ever resolves for
 * `dimension === "actionType"`; `pageType`/`queryCluster` have no global analogue and
 * intentionally return undefined (no false-precision cross-dimension guess). Within
 * `actionType`, every intent/position-band cell for the tenant's OWN site category is
 * folded into one summary cell (n-weighted win rate, min/max of the lift bands) so a
 * thin per-band sample doesn't understate the cross-tenant sample size.
 *
 * Pure once `cells` is loaded (no I/O inside the returned closure), matching
 * `resolvePrior`'s "globalLookup is a plain synchronous map read" contract.
 */
export function buildGlobalCellLookup(
  cells: readonly RrPatternCell[],
  siteCategory: ReturnType<typeof siteCategoryFromSegment>,
): (dimension: PriorDimension, value: string) => GlobalCell | undefined {
  const byActionType = new Map<string, RrPatternCell[]>();
  for (const cell of cells) {
    if (cell.key.siteCategory !== siteCategory) continue;
    const arr = byActionType.get(cell.key.canonicalMoveType) ?? [];
    arr.push(cell);
    byActionType.set(cell.key.canonicalMoveType, arr);
  }

  return (dimension, value) => {
    if (dimension !== "actionType") return undefined;
    const matches = byActionType.get(canonicalMoveType(value));
    if (!matches || matches.length === 0) return undefined;

    const totalN = matches.reduce((a, c) => a + c.n, 0);
    if (totalN === 0) return undefined;
    const weightedWins = matches.reduce((a, c) => a + c.winRate * c.n, 0);
    const distinctTenants = Math.max(...matches.map((c) => c.distinctTenants));
    const lows = matches.map((c) => c.liftP25).filter((v): v is number => v != null);
    const highs = matches.map((c) => c.liftP75).filter((v): v is number => v != null);

    return {
      n: totalN,
      distinctTenants,
      winRate: Math.round((weightedWins / totalN) * 1000) / 1000,
      liftLow: lows.length > 0 ? Math.round(Math.min(...lows)) : null,
      liftHigh: highs.length > 0 ? Math.round(Math.max(...highs)) : null,
    };
  };
}

// Re-exported so a caller only needs this module + experiment-prior for the
// full global-backoff wiring (avoids importing rr-pattern directly just to
// build the lookup's siteCategory argument).
export { rrPatternKeyId, siteCategoryFromSegment };
