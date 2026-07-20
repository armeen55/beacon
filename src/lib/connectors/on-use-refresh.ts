import { log } from "@/lib/logger";
import { getConnectorInfo, updateConnectorToken } from "@/lib/connector-store";
import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";
import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
import { syncClarityDailyMetricsForTenant } from "@/lib/connectors/clarity/sync-daily-metrics";
import { syncProfoundNightlyForTenant } from "@/lib/connectors/profound/sync-nightly";
import { refreshGa4SitewideAndReconcile } from "@/lib/connectors/ga4/refresh-ga4-sitewide";
import { recordSourceRefresh } from "@/domains/ops/record-source-refresh";
import type { RefreshSource, RefreshTrigger } from "@/domains/ops/refresh-runs-store";
import {
  AUTO_REFRESH_STALE_HOURS,
  isStale,
  type AutoRefreshProvider,
} from "@/domains/ops/source-freshness";

/**
 * on-use-refresh — the ON-USE half of the connector sync, split out of cron-sync.ts
 * so the hot on-visit path (on-visit-refresh.ts) imports only this lean module and
 * never the 1500-line nightly orchestrator. Contains the per-visit auto-refresh
 * (autoRefreshStaleConnectorsForTenant) plus the helpers the nightly orchestrator
 * ALSO uses (READ_SOURCES, syncSucceeded, recordLedger, stampFreshness). cron-sync.ts
 * imports those shared helpers FROM here; nothing here imports cron-sync.ts.
 */

/** The connector-store provider keys the on-use + nightly refresh pull. Alias of
 *  AutoRefreshProvider (defined beside the freshness constants in source-freshness). */
export type ReadProvider = AutoRefreshProvider;

/** The READ sources a refresh pulls. Wix is publish-only and excluded (it has no
 *  inbound data to sync). Mirrors REFRESH_ALL_SOURCES in the /settings/connectors
 *  "Refresh my data" action, but parameterized per arbitrary tenant (no request
 *  context) so the cron can fan out. */
export const READ_SOURCES: ReadonlyArray<{
  provider: ReadProvider;
  run: (tenantId: string) => Promise<unknown>;
}> = [
  { provider: "google_gsc", run: (t) => syncGscSearchAnalyticsForTenant({ tenantId: t }) },
  { provider: "google_ga4", run: (t) => syncGa4UrlTrafficForTenant({ tenantId: t }) },
  { provider: "clarity", run: (t) => syncClarityDailyMetricsForTenant({ tenantId: t }) },
  { provider: "profound", run: (t) => syncProfoundNightlyForTenant({ tenantId: t }) },
];

export type CronSyncSourceResult = {
  tenantId: string;
  provider: ReadProvider;
  ok: boolean;
  detail: string;
};

/**
 * POSITIVE success gate (audit-3 #5, 2026-06-22).
 *
 * Every read-sync engine returns the discriminated union
 * `{ synced: false, reason } | { synced: true, ... }` — NONE returns an `ok`
 * field. The prior `resultLooksFailed` checked `value.ok === false`, which is
 * ALWAYS false (no such key), so a `{ synced: false }` failure slipped through:
 * we stamped `last_synced_at` fresh and reported `ok: true` for a sync that
 * never pulled — the connector card then lied about freshness.
 *
 * Gate POSITIVELY on `synced === true`: only a confirmed success stamps
 * freshness. Anything else (synced:false, or an unexpected shape we can't
 * confirm) is treated as not-fresh. Throwing is handled separately upstream.
 */
export function syncSucceeded(value: unknown): { ok: true } | { ok: false; reason: string } {
  if (
    typeof value === "object" &&
    value !== null &&
    "synced" in value &&
    (value as { synced?: unknown }).synced === true
  ) {
    return { ok: true };
  }
  const reason =
    typeof value === "object" &&
    value !== null &&
    "reason" in value &&
    typeof (value as { reason?: unknown }).reason === "string"
      ? (value as { reason: string }).reason
      : "sync reported not-synced";
  return { ok: false, reason };
}

/** Connector-store provider -> refresh-ledger source name (drops the vendor
 *  prefix: google_gsc -> gsc, google_ga4 -> ga4). */
function ledgerSource(provider: ReadProvider): RefreshSource {
  switch (provider) {
    case "google_gsc":
      return "gsc";
    case "google_ga4":
      return "ga4";
    case "clarity":
      return "clarity";
    case "profound":
      return "profound";
  }
}

/** Record one source's outcome into the refresh ledger (cron + on-use paths
 *  both call this). Fail-soft: recordSourceRefresh never throws, and this catch
 *  is belt-and-suspenders so a ledger write can never affect the sync. `value`
 *  is the engine's return object (or a synthetic {synced:false,reason} for a
 *  thrown/failed source) so the ledger classifies it honestly. */
export async function recordLedger(
  tenantId: string,
  provider: ReadProvider,
  trigger: RefreshTrigger,
  startedAt: string,
  value: unknown,
): Promise<void> {
  try {
    await recordSourceRefresh({
      tenantId,
      source: ledgerSource(provider),
      trigger,
      startedAt,
      value,
    });
  } catch (e) {
    log.warn("[cron-sync] refresh-ledger write threw (sync unaffected)", {
      tenantId,
      provider,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }
}

/** Stamp last_synced_at so the connector card's freshness label stays honest.
 *  Best-effort — a freshness-write failure must never flip a successful sync to
 *  a failure. The per-provider switch narrows the union for updateConnectorToken's
 *  overloads (same shape as writeLastSyncedAt in the settings action). */
export async function stampFreshness(provider: ReadProvider, tenantId: string): Promise<void> {
  const patch = { last_synced_at: new Date().toISOString() };
  try {
    switch (provider) {
      case "google_gsc":
        // A good pull also clears any bounded needs-attention marker (BUG 2) in
        // the SAME write, so the banner heals immediately on success.
        await updateConnectorToken(
          "google_gsc",
          { ...patch, needs_attention_at: null, needs_attention_since: null, needs_attention_kind: null },
          tenantId,
        );
        break;
      case "google_ga4":
        await updateConnectorToken(
          "google_ga4",
          { ...patch, needs_attention_at: null, needs_attention_since: null, needs_attention_kind: null },
          tenantId,
        );
        break;
      case "clarity":
        await updateConnectorToken("clarity", patch, tenantId);
        break;
      case "profound":
        await updateConnectorToken("profound", patch, tenantId);
        break;
    }
  } catch (e) {
    log.warn("[cron-sync] freshness stamp failed (sync still succeeded)", {
      tenantId,
      provider,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * On-USE auto-refresh for ONE tenant (the "no more Pull-my-data button" path).
 * Refreshes each CONNECTED read source whose last_synced_at is older than its
 * per-provider staleness threshold — nothing else. Throttled BY last_synced_at
 * (durable), so calling it on every app visit can't hammer egress/quota: a
 * just-synced source is skipped until it ages out. Meant to be scheduled via
 * next/after so it runs AFTER the response and never delays the page. Fail-soft
 * per source; never throws.
 */
export async function autoRefreshStaleConnectorsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<CronSyncSourceResult[]> {
  const infos = await Promise.all(
    READ_SOURCES.map(async (s) => {
      try {
        return { source: s, info: await getConnectorInfo(s.provider, tenantId) };
      } catch {
        return { source: s, info: null };
      }
    }),
  );
  const stale = infos.filter(
    ({ source, info }) =>
      info?.status === "connected" &&
      isStale(info.last_synced_at, AUTO_REFRESH_STALE_HOURS[source.provider], now),
  );
  if (stale.length === 0) return [];

  const startedAt = new Date().toISOString();
  const settled = await Promise.allSettled(stale.map(({ source }) => source.run(tenantId)));
  const results = await Promise.all(
    stale.map(async ({ source }, i): Promise<CronSyncSourceResult> => {
      const outcome = settled[i]!;
      if (outcome.status === "rejected") {
        const err =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        log.warn("[auto-refresh] source threw", {
          tenantId,
          provider: source.provider,
          error: err.slice(0, 200),
        });
        await recordLedger(tenantId, source.provider, "on-use", startedAt, {
          synced: false,
          reason: err.slice(0, 200),
        });
        return { tenantId, provider: source.provider, ok: false, detail: err.slice(0, 200) };
      }
      const verdict = syncSucceeded(outcome.value);
      await recordLedger(tenantId, source.provider, "on-use", startedAt, outcome.value);
      if (!verdict.ok) {
        return { tenantId, provider: source.provider, ok: false, detail: verdict.reason };
      }
      await stampFreshness(source.provider, tenantId);
      return { tenantId, provider: source.provider, ok: true, detail: "synced" };
    }),
  );

  // Wave 2A: the READ_SOURCES GA4 entry pulls only the per-PAGE traffic table. When
  // GA4 refreshed here, also pull the TRUE sitewide series + reconcile it so the
  // north-star visits card can light up on this on-use refresh, not only after the
  // nightly cron's dedicated sitewide phases. Fail-soft, dormant-until-key.
  if (stale.some(({ source }) => source.provider === "google_ga4")) {
    await refreshGa4SitewideAndReconcile(tenantId);
  }
  return results;
}
