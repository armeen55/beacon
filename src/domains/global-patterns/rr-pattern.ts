/**
 * rr-pattern (BEACON_500 item 66, 2026-07-02), the cross-tenant pattern brain
 * REBUILT on the GSC proof ledger (ShippedChangeRecord), replacing the dormant
 * CX4 citation-delta design in `contracts.ts` (which stays untouched, it still
 * types the unreachable `guided-execution` module and its pinned test file;
 * this module is the live, GSC-ledger-fed successor).
 *
 * PRIVACY MODEL (locked, same as contracts.ts + cross-tenant-brain/):
 *   cross-tenant sharing is ANONYMOUS PATTERNS ONLY. No tenant name, domain,
 *   query text, or page URL ever leaves a tenant's cell, only closed-vocabulary
 *   dimension VALUES (site category, move type, intent bucket, position band)
 *   and aggregate counts/rates. A benchmark line may only surface a cell when
 *   `distinctTenants >= MIN_DISTINCT_TENANTS_TO_SURFACE` (3).
 *
 * PatternKey = {siteCategory, canonicalMoveType, intentBucket, positionBand}
 * over MATURE ShippedChangeRecord outcomes, the SAME maturity/weather/
 * parallel-trends eligibility gate `loadExperimentOutcomes` already applies
 * (this module reuses that loader; it does not re-derive maturity).
 *
 * PURE compute lives here (key derivation + aggregation math). I/O (reading
 * every tenant's ledger, writing the `global_patterns` table) lives in
 * `nightly-aggregate.ts`. `experiment-prior.ts`'s `resolvePrior` reads the
 * aggregated table as an opt-in backoff, see that file's `GlobalCell` lookup.
 */

import type { TenantSegment } from "@/domains/tenants/types";
import { canonicalMoveType, pageTypeFromUrl } from "@/domains/learning/experiment-prior";
import { classifyQueryIntent, type QueryIntent } from "@/domains/demand-graph/query-intent";

// ---------------------------------------------------------------------------
// Dimension 1: siteCategory, coarse, from the tenant's own segment. No new
// per-tenant config field is added (none exists today beyond `segment`); this
// IS the tenant's existing coarse category, already closed-vocabulary and
// already governs cross-tenant separation elsewhere (cross-tenant-brain).
// ---------------------------------------------------------------------------

export type SiteCategory = TenantSegment;

export function siteCategoryFromSegment(segment: TenantSegment | null | undefined): SiteCategory {
  return segment ?? "unknown";
}

// ---------------------------------------------------------------------------
// Dimension 2: canonicalMoveType, reuse the SAME collapse used by the
// per-tenant learning prior, so a tenant cell and a global cell of the same
// name are the same bucket by construction (no drift between the two priors).
// ---------------------------------------------------------------------------

export { canonicalMoveType };

// ---------------------------------------------------------------------------
// Dimension 3: intentBucket, from the query-intent classifier when a target
// query is known; else a coarse informational default (the honest fallback:
// most ShippedChangeRecord rows carry a real targetQueries[0], but a record
// with none should not be dropped from the brain, just bucketed generically).
// ---------------------------------------------------------------------------

export type IntentBucket = QueryIntent;

export function intentBucketFromQuery(query: string | null | undefined): IntentBucket {
  const q = (query ?? "").trim();
  if (q.length === 0) return "informational";
  return classifyQueryIntent(q).intent;
}

// ---------------------------------------------------------------------------
// Dimension 4: positionBand, coarse GSC pre-ship position bucket. No shared
// helper existed in the codebase (striking-distance logic inlines its own
// 4-15 band); this is the canonical one for the pattern brain.
// ---------------------------------------------------------------------------

export type PositionBand = "1-3" | "4-10" | "11-20" | "21+" | "unranked";

export function positionBand(position: number | null | undefined): PositionBand {
  if (position == null || !Number.isFinite(position) || position <= 0) return "unranked";
  if (position <= 3) return "1-3";
  if (position <= 10) return "4-10";
  if (position <= 20) return "11-20";
  return "21+";
}

// ---------------------------------------------------------------------------
// The generalized pattern key + cell
// ---------------------------------------------------------------------------

export type RrPatternKey = {
  siteCategory: SiteCategory;
  canonicalMoveType: string;
  intentBucket: IntentBucket;
  positionBand: PositionBand;
};

/** Stable, deterministic id for a cell. Same shape as contracts.ts's
 *  patternKeyHash, plain delimited string, no hashing needed (values are
 *  already closed-vocabulary and delimiter-safe). */
export function rrPatternKeyId(key: RrPatternKey): string {
  return `${key.siteCategory}::${key.canonicalMoveType}::${key.intentBucket}::${key.positionBand}`;
}

/** Re-usable helper: derive the full key from what a ShippedChangeRecord (or
 *  an equivalent lightweight projection) plus its tenant's segment carry. */
export function deriveRrPatternKey(input: {
  segment: TenantSegment | null | undefined;
  actionType: string | null | undefined;
  targetQuery: string | null | undefined;
  prePosition: number | null | undefined;
}): RrPatternKey {
  return {
    siteCategory: siteCategoryFromSegment(input.segment),
    canonicalMoveType: canonicalMoveType(input.actionType),
    intentBucket: intentBucketFromQuery(input.targetQuery),
    positionBand: positionBand(input.prePosition),
  };
}

/** Re-exported for callers that want a page-type dimension too (kept for
 *  parity with experiment-prior's dims, not part of the locked cell key). */
export { pageTypeFromUrl };

// ---------------------------------------------------------------------------
// Aggregation math (pure)
// ---------------------------------------------------------------------------

/** Minimum DISTINCT tenants for a cell to ever surface a benchmark line.
 *  Mirrors contracts.ts's confidence-gate floor (3) for the new pipeline. */
export const MIN_DISTINCT_TENANTS_TO_SURFACE = 3;

/** One MATURE, decided (won/lost) outcome feeding a cell, reduced to what the
 *  aggregation needs. `clicksLift` is the 28-day diff-in-diff adjustedLift
 *  (clicks/month proxy); null when a won/lost record has no numeric lift
 *  (should not normally happen for a mature result, but stay honest). */
export type RrCellObservation = {
  tenantId: string;
  key: RrPatternKey;
  won: boolean;
  clicksLift: number | null;
};

export type RrPatternCell = {
  key: RrPatternKey;
  id: string;
  n: number;
  distinctTenants: number;
  winRate: number;
  /** 25th / 75th percentile of clicksLift across observations that carried a
   *  numeric lift (nulls excluded from the percentile, counted in n/winRate). */
  liftP25: number | null;
  liftP75: number | null;
  updatedAt: string;
};

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * Aggregate observations into per-cell stats. PURE, deterministic, no I/O.
 * Groups by `rrPatternKeyId(key)`. Rows are anonymous by construction: the
 * returned `RrPatternCell` carries no tenantId, no page, no query text -
 * only the closed-vocabulary key + counts/rates. `distinctTenants` is
 * counted internally during aggregation and returned as a NUMBER only
 * (never as a list of ids), which is what makes this safe to persist to a
 * cross-tenant table.
 */
export function aggregateRrPatternCells(
  observations: readonly RrCellObservation[],
  now: Date = new Date(),
): RrPatternCell[] {
  const groups = new Map<
    string,
    { key: RrPatternKey; tenants: Set<string>; wins: number; total: number; lifts: number[] }
  >();

  for (const o of observations) {
    const id = rrPatternKeyId(o.key);
    let g = groups.get(id);
    if (!g) {
      g = { key: o.key, tenants: new Set(), wins: 0, total: 0, lifts: [] };
      groups.set(id, g);
    }
    g.tenants.add(o.tenantId);
    g.total += 1;
    if (o.won) g.wins += 1;
    if (o.clicksLift != null && Number.isFinite(o.clicksLift)) g.lifts.push(o.clicksLift);
  }

  const nowIso = now.toISOString();
  const cells: RrPatternCell[] = [];
  for (const [id, g] of groups) {
    const sortedLifts = [...g.lifts].sort((a, b) => a - b);
    cells.push({
      key: g.key,
      id,
      n: g.total,
      distinctTenants: g.tenants.size,
      winRate: g.total > 0 ? Math.round((g.wins / g.total) * 1000) / 1000 : 0,
      liftP25: sortedLifts.length > 0 ? Math.round(percentile(sortedLifts, 0.25) * 10) / 10 : null,
      liftP75: sortedLifts.length > 0 ? Math.round(percentile(sortedLifts, 0.75) * 10) / 10 : null,
      updatedAt: nowIso,
    });
  }

  // Deterministic order: id ascending.
  cells.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return cells;
}

/** True when a cell is eligible to surface ANY benchmark line to an operator. */
export function cellMeetsSurfaceFloor(cell: Pick<RrPatternCell, "distinctTenants">): boolean {
  return cell.distinctTenants >= MIN_DISTINCT_TENANTS_TO_SURFACE;
}
