/**
 * Phase 0 — Site-level citation timeline + movement detector.
 *
 * Aggregates one-number-per-day owned citation counts for the tenant's
 * domain. Uses `source_category === "owned"` as ground truth (overrides the
 * `is_owned` flag, which is broken on some days — see data-quality.ts).
 *
 * The movement detector emits one `SiteMovementEvent` per consecutive-day
 * delta that exceeds configurable thresholds. Days flagged by the
 * data-quality gate are treated as missing: the detector pairs the
 * most-recent good day with the next good day, producing a single delta
 * across the outage rather than a fake cliff at the boundary.
 *
 * Pure functions — no I/O. Callers (CLI scripts, tests, future production
 * jobs) load citation shards + data-quality flags and pass them in.
 */

import type {
  SiteMovementEvent,
  DataQualityFlag,
} from "@/domains/events/types";
import type { RawCitation } from "@/domains/truth/data-quality";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One day in the site-level timeline. */
export type SiteCitationDay = {
  /** YYYY-MM-DD. */
  date: string;
  /** Owned citations (source_category === "owned") for the tenant's domain. */
  count: number;
  /** True when the data-quality gate flagged this date. */
  is_data_bad: boolean;
};

export type SiteCitationTimeline = {
  tenant_id: string;
  domain: string;
  /** ISO 8601 timestamp of when this was built. */
  built_at: string;
  /** Sorted ascending by `date`. Dense: every day between first and last is present. */
  days: SiteCitationDay[];
};

export type MovementThresholds = {
  /** Absolute delta in citations/day that triggers a movement event. */
  deltaAbsMin: number;
  /** Relative delta (fraction) that triggers a movement event. */
  deltaPctMin: number;
  /** Minimum prev-day count for the pct rule to apply. Avoids false
   *  positives from tiny baselines (2→4 is 100% but uninteresting). */
  minPrevForPctRule: number;
};

export const DEFAULT_MOVEMENT_THRESHOLDS: MovementThresholds = {
  deltaAbsMin: 20,
  deltaPctMin: 0.3,
  minPrevForPctRule: 5,
};

export type BuildTimelineInput = {
  tenant_id: string;
  domain: string;
  /** YYYY-MM-DD → citation records for that day. */
  citationsByDate: Record<string, RawCitation[]>;
  /** Output of `detectDataQualityFlags` — used to mark days as `is_data_bad`. */
  dataQualityFlags: DataQualityFlag[];
};

// ---------------------------------------------------------------------------
// Timeline builder
// ---------------------------------------------------------------------------

/**
 * Count owned citations per day via `source_category === "owned"` (the
 * override). Produces a dense ascending series covering every day between
 * the first and last shard date (missing days get count=0).
 */
export function buildSiteCitationTimeline(
  input: BuildTimelineInput,
): SiteCitationTimeline {
  const badDates = new Set(input.dataQualityFlags.map((f) => f.date));
  const byDate: Record<string, number> = {};

  for (const [date, records] of Object.entries(input.citationsByDate)) {
    let count = 0;
    for (const r of records) {
      if (r.domain === input.domain && r.source_category === "owned") {
        count += 1;
      }
    }
    byDate[date] = count;
  }

  const sortedDates = Object.keys(byDate).sort();
  if (sortedDates.length === 0) {
    return {
      tenant_id: input.tenant_id,
      domain: input.domain,
      built_at: new Date().toISOString(),
      days: [],
    };
  }

  // Build a dense series across the full range.
  const first = sortedDates[0];
  const last = sortedDates[sortedDates.length - 1];
  const days: SiteCitationDay[] = [];
  for (let d = first; d <= last; d = addDay(d)) {
    days.push({
      date: d,
      count: byDate[d] ?? 0,
      is_data_bad: badDates.has(d),
    });
  }

  return {
    tenant_id: input.tenant_id,
    domain: input.domain,
    built_at: new Date().toISOString(),
    days,
  };
}

// ---------------------------------------------------------------------------
// Movement detector
// ---------------------------------------------------------------------------

/**
 * Emit one SiteMovementEvent per consecutive-good-day pair whose delta
 * crosses a threshold. Walks the timeline forward, skipping `is_data_bad`
 * days — so a 6-day outage between two healthy days produces ONE delta
 * across the gap, not a spurious cliff on the first and last bad day.
 *
 * Thresholds (default):
 *   - abs(delta) >= 20, OR
 *   - prev >= 5 AND abs(delta_pct) >= 0.30
 *
 * The detector emits both up-moves and down-moves — we want to explain
 * drops too.
 */
export function detectSiteMovements(
  timeline: SiteCitationTimeline,
  thresholds: Partial<MovementThresholds> = {},
): SiteMovementEvent[] {
  const cfg = { ...DEFAULT_MOVEMENT_THRESHOLDS, ...thresholds };
  const events: SiteMovementEvent[] = [];

  let prev: SiteCitationDay | null = null;
  for (const day of timeline.days) {
    if (day.is_data_bad) continue;
    if (!prev) {
      prev = day;
      continue;
    }

    const delta_abs = day.count - prev.count;
    const denom = Math.max(prev.count, 1);
    const delta_pct = delta_abs / denom;

    const hitAbs = Math.abs(delta_abs) >= cfg.deltaAbsMin;
    const hitPct =
      prev.count >= cfg.minPrevForPctRule &&
      Math.abs(delta_pct) >= cfg.deltaPctMin;

    if (hitAbs || hitPct) {
      events.push({
        id: `mov-${day.date.replaceAll("-", "")}`,
        date: day.date,
        prev_count: prev.count,
        count: day.count,
        delta_abs,
        delta_pct,
        trigger:
          hitAbs && hitPct ? "both" : hitAbs ? "delta_abs_over_threshold" : "delta_pct_over_threshold",
        tenant_id: timeline.tenant_id,
      });
    }

    prev = day;
  }

  return events;
}

/**
 * Convenience: rank movement events by absolute magnitude of delta_abs,
 * descending. Used by the validation report.
 */
export function rankMovementsByMagnitude(
  events: SiteMovementEvent[],
): SiteMovementEvent[] {
  return [...events].sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs));
}

// ---------------------------------------------------------------------------
// Date helpers (YYYY-MM-DD arithmetic)
// ---------------------------------------------------------------------------

function addDay(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
