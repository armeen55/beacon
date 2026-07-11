import "server-only";

/**
 * pooled-verdict-runner (2026-07-02, master plan item 34) - the I/O glue: load the ledger + this
 * tenant's daily-experiment plans, group into same-plan same-lever batches
 * (pooled-verdict-groups.ts), derive each qualifying page's percent lift + variance from its own
 * pre-ship daily click series, run the pure pool (pooled-verdict.ts), and persist one row per
 * qualifying batch (pooled-verdict-store.ts). Isolated, fail-soft, idempotent (a re-run just
 * overwrites the same (tenant, plan, lever) row with a fresh computation) - mirrors
 * aa-calibration.ts / algorithm-weather's runner posture exactly.
 *
 * COMPUTED-ONLY (mission hard rule): this NEVER writes to shipped_change_proof or mutates a
 * per-page record - only its own pooled-verdicts store.
 *
 * Follow-up (explicitly out of scope this cycle, noted per the mission brief): the learning/prior
 * readers (outcome-prior.ts, proof-history-voice.ts) MAY eventually consume these pooled verdicts
 * to weight a lever's prior by its most powerful evidence instead of per-page noise. That wiring
 * is NOT done here - this runner + store only compute and persist; loadLatestPooledVerdict /
 * loadPooledVerdicts (pooled-verdict-store.ts) are the read surface for that future wiring.
 */

import { loadShippedChanges, type ShippedChangeRecord } from "./shipped-change-store";
import { listPlans } from "@/domains/experiments/daily-experiment-plan-store";
import { groupLedgerRowsByPlanAndLever, type PlanLinkedLedgerRow } from "./pooled-verdict-groups";
import { poolBatchLifts, estimateDailyLiftVariance, type PerPageLift } from "./pooled-verdict";
import { upsertPooledVerdict, type PooledVerdictRow } from "./pooled-verdict-store";
import { loadDailyClicksByPathsForTenant } from "./daily-series";
import { PROOF_BASELINE_WINDOW_DAYS, type ProofWindowResult } from "./measure";
import { log } from "@/lib/logger";

/** How many plans back to consider - matches the lookback the calibration writer already uses
 *  (listPlans(tenantId, 60) in run-measurement.ts) so a batch shipped up to ~2 months back is
 *  still poolable. */
const PLAN_LOOKBACK = 60;

/** The longest-run window for a ledger row - the SAME "most-settled signal" basis
 *  summarizeVerdict (measure.ts) picks, so the pooled input matches what the per-page verdict
 *  itself is judged on. */
function basisWindowOf(record: ShippedChangeRecord): ProofWindowResult | null {
  const ran = (record.windows ?? []).filter((w) => w.ran).sort((a, b) => b.day - a.day);
  return ran[0] ?? null;
}

/** Percent lift for one page's basis window: the clicks adjusted lift as a percent of the page's
 *  own pre-ship baseline, pro-rated to the basis window length (the SAME pro-rating convention
 *  summarizeVerdict's clicksFloorBaseline uses, so "9 percent" here means the same thing a
 *  per-page "+9 clicks vs a baseline this size" would mean). A baseline of 0 has no percent to
 *  report - the row is honestly skipped rather than divide-by-zero'd into a fabricated number. */
function percentLiftOf(record: ShippedChangeRecord, basis: ProofWindowResult): number | null {
  const baselineClicks = record.baseline?.clicks ?? 0;
  const scaledBaseline = baselineClicks * (basis.day / PROOF_BASELINE_WINDOW_DAYS);
  if (scaledBaseline <= 0) return null;
  return (basis.adjustedLift / scaledBaseline) * 100;
}

/** Build one page's pooling input from its ledger row + its pre-ship daily click series (already
 *  loaded in bulk by the caller). Null when the page has no measured basis window or no percent
 *  lift can be honestly derived. */
function perPageLiftFor(
  row: PlanLinkedLedgerRow,
  dailySeries: Map<string, { date: string; clicks: number }[]>,
): PerPageLift | null {
  const basis = basisWindowOf(row.record);
  if (!basis) return null;
  const pct = percentLiftOf(row.record, basis);
  if (pct == null) return null;

  const shipDate = row.record.shippedAt.slice(0, 10);
  const series = dailySeries.get(row.record.path) ?? [];
  const preShipClicks = series.filter((d) => d.date < shipDate).map((d) => d.clicks);
  const variance = estimateDailyLiftVariance(preShipClicks, basis.day);

  return { page: row.record.path, adjustedLiftPct: pct, variance };
}

export type ComputePooledVerdictsResult = {
  groupsConsidered: number;
  groupsPooled: number;
  groupsSkipped: number;
};

/**
 * Compute + persist pooled verdicts for every qualifying (plan, lever) batch for a tenant. Fail-
 * soft: any failure returns a zeroed result rather than throwing (this is an isolated tail step,
 * same posture as the algorithm-weather / A-A calibration passes it sits alongside).
 */
export async function computePooledVerdicts(tenantId: string, now: Date = new Date()): Promise<ComputePooledVerdictsResult> {
  const empty: ComputePooledVerdictsResult = { groupsConsidered: 0, groupsPooled: 0, groupsSkipped: 0 };
  try {
    const [records, plans] = await Promise.all([
      loadShippedChanges(),
      listPlans(tenantId, PLAN_LOOKBACK),
    ]);
    const groups = groupLedgerRowsByPlanAndLever(records, plans);
    if (groups.length === 0) return empty;

    // One bounded daily-clicks read across every measured page in every qualifying group (dedup
    // paths first) - mirrors /results's own sparkline read (loadDailyClicksByPathsForTenant is
    // capped at 16 paths per call internally), batched here to stay within that cap per call.
    const allPaths = [...new Set(groups.flatMap((g) => g.measuredRows.map((r) => r.record.path)))];
    const dailySeries = new Map<string, { date: string; clicks: number }[]>();
    for (let i = 0; i < allPaths.length; i += 16) {
      const chunk = allPaths.slice(i, i + 16);
      const chunkSeries = await loadDailyClicksByPathsForTenant(tenantId, chunk, 90).catch(
        () => new Map<string, { date: string; clicks: number }[]>(),
      );
      for (const [path, series] of chunkSeries) dailySeries.set(path, series);
    }

    let pooled = 0;
    let skipped = 0;
    for (const group of groups) {
      try {
        const perPage = group.measuredRows
          .map((row) => perPageLiftFor(row, dailySeries))
          .filter((p): p is PerPageLift => p != null);
        if (perPage.length < 3) {
          skipped += 1;
          continue;
        }
        const result = poolBatchLifts(perPage);
        if (result.sentence == null) {
          skipped += 1;
          continue;
        }
        const row: PooledVerdictRow = {
          tenant_id: tenantId,
          plan_id: group.planId,
          plan_date: group.planDate,
          action_family: group.actionFamily,
          computed_at: now.toISOString(),
          n: result.n,
          pooled_lift_pct: result.pooledLiftPct,
          standard_error: result.standardError,
          z_score: result.zScore,
          permutation_p: result.permutationP,
          verdict: result.verdict,
          // The pooled sign-flip inference has NOT passed any self-test, so every row it writes is
          // uncalibrated. Stamp null so isCalibratedPooledVerdict (verdict-calibration.ts) keeps it
          // quarantined fail-closed until a certified pooled classifier registers its version.
          calibrationVersion: null,
          sentence: result.sentence,
          pages: perPage.map((p) => p.page),
        };
        await upsertPooledVerdict(row);
        pooled += 1;
      } catch (e) {
        skipped += 1;
        log.warn("[pooled-verdict] group failed (non-blocking)", {
          tenantId,
          planId: group.planId,
          actionFamily: group.actionFamily,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { groupsConsidered: groups.length, groupsPooled: pooled, groupsSkipped: skipped };
  } catch (e) {
    log.warn("[pooled-verdict] pass failed (non-blocking)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return empty;
  }
}
