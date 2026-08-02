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
 * so it is excluded from the tally entirely. PURE, no I/O.
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

/**
 * THE per-source data-age SLA table, derived from the ONE connector registry so a
 * connector's SLA lives in exactly one record. connector-store + data-sources-strip
 * read it so three magic numbers can never drift apart again.
 *   gsc      3d  (Google reports ~3 days behind; older than that is a real gap)
 *   clarity  7d  (limited pull budget; a week is the honest freshness bar)
 *   ga4      removed (false-total; never counted)
 */
export const SOURCE_SLA: Record<SourceKey, ConnectorSla> = Object.fromEntries(
  CONNECTOR_REGISTRY.map((c) => [c.sourceKey, c.sla]),
) as Record<SourceKey, ConnectorSla>;

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
