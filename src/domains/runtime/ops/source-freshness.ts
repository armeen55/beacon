/**
 * source-freshness (Wave 3A, 2026-07-10) - THE one place a data source's freshness is
 * judged, against a per-source DATA-age SLA. Kills the three coexisting thresholds that
 * let "5 sources healthy" render while the AI-answers data was two weeks old:
 *   - connector-store STALE_DAYS = 14 (sync age, connection liveness)
 *   - data-sources-strip FRESH_WINDOW_MS = 24h (sync age)
 *   - today/golden-path FRESH_WITHIN_DAYS = 2 (data age)
 *
 * The clock that decides health is DATA-THROUGH age (how recent the source's newest data
 * is), NOT sync age (when we last pulled): a source can sync hourly yet report data from
 * two weeks ago. GA4 is "removed" (the cross-page session sum is a false total, Wave 1 P1)
 * so it is excluded from the tally entirely. Wix is publish-only, so it is optional and
 * never blocks health. PURE, no I/O.
 */

import {
  CONNECTOR_REGISTRY,
  type ConnectorSla,
  type SourceKey,
} from "@/lib/connectors/registry";

// SourceKey + the per-source SLA now live on the canonical connector registry;
// re-exported here so the many `import { SourceKey } from
// "@/domains/runtime/ops/source-freshness"` callers keep working unchanged.
export type { SourceKey };
export type SourceFreshnessState = "healthy" | "stale" | "no_data" | "removed";

/** Alias of the registry's SLA shape, kept for callers importing SourceSla here. */
export type SourceSla = ConnectorSla;

/**
 * THE per-source data-age SLA table, derived from the ONE connector registry so a
 * connector's SLA lives in exactly one record. connector-store + data-sources-strip
 * read it so three magic numbers can never drift apart again.
 *   gsc      3d  (Google reports ~3 days behind; older than that is a real gap)
 *   clarity  7d  (limited pull budget; a week is the honest freshness bar)
 *   ga4      removed (false-total; never counted)
 *   wix      optional, no data SLA (publish-only, pulls nothing)
 */
export const SOURCE_SLA: Record<SourceKey, SourceSla> = Object.fromEntries(
  CONNECTOR_REGISTRY.map((c) => [c.sourceKey, c.sla]),
) as Record<SourceKey, SourceSla>;

/**
 * Connection-liveness (SYNC-age) staleness threshold, DISTINCT from the per-source
 * DATA-age SLA above. connector-store uses this for its soft-disconnect middle state
 * ("showing cached data, reconnect to refresh") - a coarse "is this connection still
 * alive" signal, never a data-freshness verdict. Kept here so every freshness constant
 * lives in one module.
 */
export const CONNECTION_LIVENESS_STALE_DAYS = 14;

/**
 * Connector-store provider keys for the on-USE auto-refresh. Vendor-prefixed
 * (google_gsc, google_ga4) because they name connector-store rows, DISTINCT from
 * SourceKey above which the data-age SLA table uses. Kept here so every freshness
 * constant lives in one module (the on-use module re-exports this as ReadProvider).
 */
export type AutoRefreshProvider = "google_gsc" | "google_ga4" | "clarity";

/**
 * Per-provider auto-refresh staleness threshold (hours) for the on-USE refresh.
 * FREE sources (GSC, GA4, Clarity - Google/Microsoft APIs, no per-call cost) use
 * 1h so they effectively re-pull on every login session: the operator should never
 * see stale free data. (Their underlying data only changes ~daily - GSC is 3 days
 * behind - so 1h is "always fresh" without re-pulling on every single navigation;
 * the 2-min in-process throttle + durable last_synced_at prevent any hammering.)
 * This is a SYNC-age threshold (when we last pulled), NOT the DATA-age SLA above
 * (how recent the data is). Both live here so the freshness constants never drift.
 */
export const AUTO_REFRESH_STALE_HOURS: Record<AutoRefreshProvider, number> = {
  google_gsc: 1,
  google_ga4: 1,
  clarity: 1,
};

/** SYNC-age staleness check for the on-use auto-refresh: true when a source was
 *  never synced, or its last sync is older than `staleHours`. */
export function isStale(
  lastSyncedAt: string | null | undefined,
  staleHours: number,
  now: Date,
): boolean {
  if (!lastSyncedAt) return true; // never synced → stale
  const ageMs = now.getTime() - Date.parse(lastSyncedAt);
  return !Number.isFinite(ageMs) || ageMs > staleHours * 3_600_000;
}

export type SourceFreshness = {
  source: SourceKey;
  /** The source's newest data date (YYYY-MM-DD), or null when it has none. The real
   *  recency clock, NOT when we last synced. */
  dataThroughDate: string | null;
  /** Whole days since the last successful sync (pull), or null when never synced. */
  syncAgeDays: number | null;
  /** Max acceptable data age for this source (null = no SLA). */
  slaMaxDataAgeDays: number | null;
  /** Whether this source must be fresh for overall health. */
  required: boolean;
  state: SourceFreshnessState;
};

export type SourceFreshnessInput = {
  source: SourceKey;
  /** The source's newest data date. The real recency clock. */
  dataThroughDate?: string | null;
  /** Whole days since the last successful sync (display only). */
  syncAgeDays?: number | null;
};

const YMD = /^\d{4}-\d{2}-\d{2}/;

/** Whole days (floored, never negative) between a YYYY-MM-DD date and now. */
function dataAgeDays(dataThroughDate: string, now: Date): number {
  const t = Date.parse(
    dataThroughDate.length === 10 ? `${dataThroughDate}T00:00:00Z` : dataThroughDate,
  );
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.floor(Math.max(0, now.getTime() - t) / 86_400_000);
}

/** Classify ONE source against its SLA. GA4 is always "removed"; a source with no data
 *  is "no_data"; a source with data is healthy iff its data age is within its SLA. */
export function classifySourceFreshness(
  input: SourceFreshnessInput,
  now: Date = new Date(),
): SourceFreshness {
  const sla = SOURCE_SLA[input.source];
  const dataThroughDate =
    input.dataThroughDate && YMD.test(input.dataThroughDate)
      ? input.dataThroughDate.slice(0, 10)
      : null;
  const base: Omit<SourceFreshness, "state"> = {
    source: input.source,
    dataThroughDate,
    syncAgeDays: input.syncAgeDays ?? null,
    slaMaxDataAgeDays: sla.slaMaxDataAgeDays,
    required: sla.required,
  };
  if (sla.removed) return { ...base, state: "removed" };
  if (dataThroughDate == null) return { ...base, state: "no_data" };
  // A source with no data SLA (wix) is healthy whenever it has any data at all.
  if (sla.slaMaxDataAgeDays == null) return { ...base, state: "healthy" };
  const age = dataAgeDays(dataThroughDate, now);
  return { ...base, state: age <= sla.slaMaxDataAgeDays ? "healthy" : "stale" };
}

export type OverallFreshness = {
  /** Healthy ONLY when there is at least one required source and EVERY required source is
   *  inside its own SLA (state "healthy"). A removed (GA4) or optional (Wix) source can
   *  never make this true or false. */
  healthy: boolean;
  /** The oldest data-through among REQUIRED sources that have data (YYYY-MM-DD), or null.
   *  The one date the health line names - never a bare connected count. */
  worstThrough: string | null;
  /** Required sources currently out of SLA (stale) or with no data. */
  stale: SourceFreshness[];
};

export function overallFreshness(sources: ReadonlyArray<SourceFreshness>): OverallFreshness {
  const required = sources.filter((s) => s.required && SOURCE_SLA[s.source].removed === false);
  const notHealthy = required.filter((s) => s.state !== "healthy");
  let worstThrough: string | null = null;
  for (const s of required) {
    if (s.dataThroughDate != null && (worstThrough == null || s.dataThroughDate < worstThrough)) {
      worstThrough = s.dataThroughDate;
    }
  }
  return {
    healthy: required.length > 0 && notHealthy.length === 0,
    worstThrough,
    stale: notHealthy,
  };
}

/**
 * The one health line: names the worst required source's data-through, never a bare
 * connected count. `throughLabel` is the already-formatted month/day of overall.worstThrough
 * (monthDayLabel, UTC) so this module stays free of the JSX date helper. Beacon voice, no dashes.
 */
export function sourceFreshnessLine(
  overall: OverallFreshness,
  throughLabel: string | null,
): string {
  if (overall.healthy) {
    return throughLabel
      ? `Your key sources are current. The oldest data runs through ${throughLabel}.`
      : "Your key sources are current.";
  }
  const n = overall.stale.length;
  const gap = `${n} key source${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`;
  return throughLabel ? `${gap}. The oldest data runs through ${throughLabel}.` : `${gap}.`;
}
