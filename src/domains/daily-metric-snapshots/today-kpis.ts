import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";

/**
 * Today's headline KPIs read from `daily_metric_snapshots` (source_type=derived,
 * scope_type=platform). Flips Today's top-of-dashboard tiles off the raw
 * Profound-era `results` table and onto the current native-poll aggregate rows.
 *
 * Fallback policy (strict):
 *   1. Prefer today's date (UTC) if both platform rows exist.
 *   2. Fall back to yesterday's date if today has no derived platform rows yet
 *      (pre-cron window — cron fires at 10:00 UTC, UI can be opened before).
 *   3. NEVER fall through to `source_type='benchmark'`. That would reintroduce
 *      the silent Profound-cliff problem Commit 2 surfaced. Caller handles null.
 *
 * Context: on 2026-04-23 (pre-pivot cutoff) the Profound `results` table
 * stopped getting new rows. Today's KPI tiles silently render data through
 * Apr 21 unless flipped to derived. Commit 5 ships the flip.
 */

export type TodayDerivedKpis = {
  /** ISO date the rendered KPIs represent (today or yesterday). */
  date: string;
  /** True iff we fell back to yesterday because today had no derived rows yet. */
  isFallback: boolean;
  /** Sum of `citation_count` across all platform rows for the date. */
  totalCitations: number;
  /** Sum of `mention_count` across all platform rows for the date. */
  totalMentions: number;
  /** Number of platform rows aggregated (should be 2: Perplexity + ChatGPT). */
  platformRowCount: number;
};

type PlatformRow = {
  platform: string;
  mention_count: number;
  citation_count: number;
  visibility_score: number | string | null;
  share_of_voice: number | string | null;
};

/**
 * Fetch platform-scope derived snapshot rows for one ISO date, scoped to
 * one tenant.
 *
 * audit wave-2 #1 (2026-06-14) — CRITICAL cross-tenant fix. This reads via
 * the service-role admin client, which BYPASSES RLS, so the tenant filter
 * MUST be applied in the query. Without it the headline /today KPIs
 * ("Times AI recommended you" / "How often AI mentions you") summed
 * `citation_count`/`mention_count` across EVERY tenant's derived platform
 * rows for the date — one customer saw other customers' numbers folded
 * into their core dashboard tile. `tenantId` is REQUIRED (no cross-tenant
 * default) so the isolation contract is enforced by the type system.
 */
async function fetchPlatformRowsForDate(
  dateISO: string,
  tenantId: string,
): Promise<PlatformRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("daily_metric_snapshots")
    .select("platform, mention_count, citation_count, visibility_score, share_of_voice")
    .eq("tenant_id", tenantId)
    .eq("date", dateISO)
    .eq("source_type", "derived")
    .eq("scope_type", "platform");
  if (error) {
    throw new Error(`today-kpis fetch ${dateISO}: ${error.message}`);
  }
  return (data ?? []) as PlatformRow[];
}

/**
 * Pure aggregation — totals across the platform rows for a single date.
 * Separated for unit-test coverage.
 */
export function aggregateDerivedPlatformRows(
  dateISO: string,
  isFallback: boolean,
  rows: PlatformRow[],
): TodayDerivedKpis {
  let totalCitations = 0;
  let totalMentions = 0;
  for (const r of rows) {
    totalCitations += r.citation_count ?? 0;
    totalMentions += r.mention_count ?? 0;
  }
  return {
    date: dateISO,
    isFallback,
    totalCitations,
    totalMentions,
    platformRowCount: rows.length,
  };
}

/**
 * Main entry. Tries today's UTC date first, falls back to yesterday if no
 * rows. Returns null only when neither date has derived platform rows.
 *
 * Default clock is `Date.now()`; overridable for tests.
 */
export async function fetchTodayDerivedKpis(
  options: { tenantId: string; now?: Date },
): Promise<TodayDerivedKpis | null> {
  const { tenantId } = options;
  const now = options.now ?? new Date();
  const todayISO = now.toISOString().slice(0, 10);
  const yesterdayISO = new Date(now.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);

  const todayRows = await fetchPlatformRowsForDate(todayISO, tenantId);
  if (todayRows.length > 0) {
    return aggregateDerivedPlatformRows(todayISO, false, todayRows);
  }

  const yesterdayRows = await fetchPlatformRowsForDate(yesterdayISO, tenantId);
  if (yesterdayRows.length > 0) {
    return aggregateDerivedPlatformRows(yesterdayISO, true, yesterdayRows);
  }

  return null;
}
