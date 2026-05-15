/**
 * Section 6 C4a (2026-05-15) — Today hero primary-recommendation share,
 * snapshot-derived.
 *
 * Pure helper + injected-dependency loader for computing the
 * per-platform "primary recommendation" percentage that the Today hero
 * footer renders (`{Platform} N% primary`). Source: the
 * `primary_recommendation_count` + `total_possible` columns on
 * `daily_metric_snapshots` rows where `scope_type = "platform"` and
 * `source_type = "derived"`. C2 populates these on every native-poll
 * snapshot run; C3 backfilled history.
 *
 * Semantic = "most recent day with data" (mirrors the legacy
 * `enrichmentV2.sparklines[].primaryRate` traversal-backward-pick-first-
 * non-null path; see
 * `src/app/(shell)/today-v2-visibility-group-client.tsx:176-177` for
 * the legacy client closure). Equivalence harness
 * `tests/domains/today/today-primary-share-equivalence.test.ts` proves
 * 0pp drift vs that legacy path.
 *
 * Section 6 C4 contract (per H1–H8 Decision Lock + J1):
 *   • Numerator    primary_recommendation_count (skip null/undefined).
 *   • Denominator  total_possible (skip null OR ≤ 0).
 *   • Filter       scope_type='platform' AND source_type='derived'.
 *     `source_type='benchmark'` rows (pre-Section-6 Profound imports)
 *     are excluded — they predate the heuristic and have null
 *     primary counts; treating them as zero would silently drag the
 *     percentage down.
 *   • Latest       order by `date` desc; first row meeting the
 *     filters above wins. Earlier rows are ignored.
 *   • Missing      no usable row → return null (J1 lock: no fallback
 *     to the legacy sparkline path).
 *   • Rounding     Math.round((numerator / denominator) × 100). Single
 *     final round to integer percent; matches the legacy helper's
 *     `Math.round(r * 100)` after the sparkline's 2-decimal storage.
 *
 * NO direct Supabase client construction. Tests + production callers
 * inject the repository surface via `computeTodayPrimaryShare`'s
 * `repo` parameter so the helper stays a pure unit + the async
 * wrapper stays single-purpose.
 */

import type { DailyMetricSnapshot } from "./types";

/**
 * Two platforms the Today hero pills cover today. The Section 6 H1 +
 * D6 lock keeps `google_ai_overviews` out of customer UI (GAIO is not
 * polled). Adding a third platform here would require a new pill +
 * surface review and is out of scope for C4.
 */
export type TodayHeroPlatform = "ChatGPT" | "Perplexity";

export type TodayPrimaryShare = {
  chatgptPrimaryPct: number | null;
  perplexityPrimaryPct: number | null;
};

/**
 * Snapshot-row repository surface this loader consumes. Tests inject a
 * minimal in-memory implementation; production callers wire a
 * `getRepository().forTenant(tenantId)` instance.
 */
export type TodayPrimaryShareRepo = {
  /**
   * Tenant-scoped read of `daily_metric_snapshots` for the tenant the
   * repo wraps. The caller is responsible for the `.forTenant()`
   * binding — this helper never accepts a tenant_id directly to
   * eliminate the cross-tenant footgun.
   */
  getDailyMetricSnapshots(options?: {
    /** Optional ISO date floor (inclusive) — caller may scope the read window. */
    since?: string;
  }): Promise<DailyMetricSnapshot[]>;
};

export type ComputeTodayPrimaryShareOptions = {
  /**
   * Inclusive lower-bound date (YYYY-MM-DD UTC) to constrain the
   * snapshot read window. Optional; caller may pass undefined to read
   * the full tenant history. Recommended in production: a 14-day
   * trailing window mirroring the legacy sparkline window so the
   * "latest non-null day" lookup is bounded.
   */
  since?: string;
};

/**
 * Pure helper. Given a snapshot row set + a platform label, returns
 * the latest-non-null primary-recommendation percentage for that
 * platform, or null if no usable row exists.
 *
 * `snapshots` may include rows for other tenants only if the caller
 * has not yet filtered; the helper never reads tenant_id directly and
 * leaves tenant isolation as the caller's contract (the
 * `TodayPrimaryShareRepo` wrapper enforces it via `forTenant()`).
 */
export function computeSnapshotPlatformPrimaryPct(
  snapshots: ReadonlyArray<DailyMetricSnapshot>,
  platform: TodayHeroPlatform,
): number | null {
  let bestDate: string | null = null;
  let bestRow: DailyMetricSnapshot | null = null;

  for (const row of snapshots) {
    if (row.scope_type !== "platform") continue;
    if (row.source_type !== "derived") continue;
    if (row.platform !== platform) continue;

    const count = row.primary_recommendation_count;
    const total = row.total_possible;
    if (count === null || count === undefined) continue;
    if (total === null || total === undefined) continue;
    if (total <= 0) continue;

    if (bestDate === null || row.date > bestDate) {
      bestDate = row.date;
      bestRow = row;
    }
  }

  if (bestRow === null) return null;
  // Both count + total are guaranteed non-null + total > 0 by the
  // filter above; the `!` reassures the type narrower.
  const count = bestRow.primary_recommendation_count!;
  const total = bestRow.total_possible!;
  return Math.round((count / total) * 100);
}

/**
 * Async wrapper that consumes the injected tenant-scoped repository,
 * reads platform-scope snapshot rows for the configured window, and
 * derives the two hero percentages.
 *
 * Tenant isolation contract: the caller passes a `repo` already bound
 * to `.forTenant(tenantId)`. This wrapper never sees the bare
 * repository surface, never reads `tenantId` from request context,
 * and never calls `getRepository()` directly — so a future drive-by
 * edit can't accidentally bypass tenant scope.
 */
export async function computeTodayPrimaryShare(args: {
  repo: TodayPrimaryShareRepo;
  options?: ComputeTodayPrimaryShareOptions;
}): Promise<TodayPrimaryShare> {
  const snapshots = await args.repo.getDailyMetricSnapshots({
    since: args.options?.since,
  });
  return {
    chatgptPrimaryPct: computeSnapshotPlatformPrimaryPct(snapshots, "ChatGPT"),
    perplexityPrimaryPct: computeSnapshotPlatformPrimaryPct(
      snapshots,
      "Perplexity",
    ),
  };
}
