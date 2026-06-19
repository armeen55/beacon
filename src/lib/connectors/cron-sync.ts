import { log } from "@/lib/logger";
import { listTenants } from "@/domains/tenants/store";
import { getConnectorInfo, updateConnectorToken } from "@/lib/connector-store";
import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";
import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
import { syncSemrushOrganicKeywordsForTenant } from "@/lib/connectors/semrush/sync-organic-keywords";
import { syncClarityDailyMetricsForTenant } from "@/lib/connectors/clarity/sync-daily-metrics";
import { syncProfoundNightlyForTenant } from "@/lib/connectors/profound/sync-nightly";

/** The READ sources a nightly refresh pulls. Wix is publish-only and excluded
 *  (it has no inbound data to sync). Mirrors REFRESH_ALL_SOURCES in the
 *  /settings/connectors "Refresh my data" action, but parameterized per
 *  arbitrary tenant (no request context) so the cron can fan out. */
type ReadProvider = "google_gsc" | "google_ga4" | "semrush" | "clarity" | "profound";

const READ_SOURCES: ReadonlyArray<{
  provider: ReadProvider;
  run: (tenantId: string) => Promise<unknown>;
}> = [
  { provider: "google_gsc", run: (t) => syncGscSearchAnalyticsForTenant({ tenantId: t }) },
  { provider: "google_ga4", run: (t) => syncGa4UrlTrafficForTenant({ tenantId: t }) },
  { provider: "semrush", run: (t) => syncSemrushOrganicKeywordsForTenant({ tenantId: t }) },
  { provider: "clarity", run: (t) => syncClarityDailyMetricsForTenant({ tenantId: t }) },
  { provider: "profound", run: (t) => syncProfoundNightlyForTenant({ tenantId: t }) },
];

export type CronSyncSourceResult = {
  tenantId: string;
  provider: ReadProvider;
  ok: boolean;
  detail: string;
};

export type CronSyncResult = {
  ranAt: string;
  tenants: number;
  connectedSources: number;
  ok: number;
  failed: number;
  results: CronSyncSourceResult[];
};

/** A sync engine that returns `{ ok: false }` ran but didn't pull — don't stamp
 *  freshness for it. (Throwing is handled separately as a hard failure.) */
function resultLooksFailed(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok?: unknown }).ok === false
  );
}

/** Stamp last_synced_at so the connector card's freshness label stays honest.
 *  Best-effort — a freshness-write failure must never flip a successful sync to
 *  a failure. The per-provider switch narrows the union for updateConnectorToken's
 *  overloads (same shape as writeLastSyncedAt in the settings action). */
async function stampFreshness(provider: ReadProvider, tenantId: string): Promise<void> {
  const patch = { last_synced_at: new Date().toISOString() };
  try {
    switch (provider) {
      case "google_gsc":
        await updateConnectorToken("google_gsc", patch, tenantId);
        break;
      case "google_ga4":
        await updateConnectorToken("google_ga4", patch, tenantId);
        break;
      case "semrush":
        await updateConnectorToken("semrush", patch, tenantId);
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

async function syncOneTenant(tenantId: string): Promise<CronSyncSourceResult[]> {
  // Only exercise CONNECTED sources. A status-read failure counts as
  // not-connected (fail-soft) so a flaky read never spams errors.
  const connectedFlags = await Promise.all(
    READ_SOURCES.map(async (s) => {
      try {
        return (await getConnectorInfo(s.provider, tenantId)).status === "connected";
      } catch {
        return false;
      }
    }),
  );
  const connected = READ_SOURCES.filter((_, i) => connectedFlags[i]);
  if (connected.length === 0) return [];

  const settled = await Promise.allSettled(connected.map((s) => s.run(tenantId)));

  return Promise.all(
    connected.map(async (s, i): Promise<CronSyncSourceResult> => {
      const outcome = settled[i]!;
      if (outcome.status === "rejected") {
        const err =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        log.warn("[cron-sync] source threw", {
          tenantId,
          provider: s.provider,
          error: err.slice(0, 200),
        });
        return { tenantId, provider: s.provider, ok: false, detail: err.slice(0, 200) };
      }
      if (resultLooksFailed(outcome.value)) {
        return { tenantId, provider: s.provider, ok: false, detail: "sync reported not-ok" };
      }
      await stampFreshness(s.provider, tenantId);
      return { tenantId, provider: s.provider, ok: true, detail: "synced" };
    }),
  );
}

/**
 * Nightly DATA-ONLY refresh across every ACTIVE tenant.
 *
 * Pulls each CONNECTED read source (GSC, GA4, SEMrush, Clarity, Profound) so:
 *   1. Google OAuth tokens refresh INSIDE their 7-day window and never
 *      hard-expire — the cause of "my connection went stale after a few days".
 *   2. Dashboards stay fresh without the operator clicking "Refresh my data".
 *
 * Touches NO LLM / OpenAI — pure HTTP→Supabase, so this cron is free to run.
 * The paid generation/drafting path is intentionally NOT here. Fail-soft per
 * tenant AND per source; never throws.
 */
export async function syncAllConnectedForActiveTenants(): Promise<CronSyncResult> {
  const ranAt = new Date().toISOString();
  const tenants = (await listTenants()).filter((t) => t.status === "active");
  const results: CronSyncSourceResult[] = [];
  for (const t of tenants) {
    try {
      results.push(...(await syncOneTenant(t.id)));
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log.error("[cron-sync] tenant failed", { tenantId: t.id, error: err.slice(0, 200) });
    }
  }
  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  log.info("[cron-sync] complete", {
    tenants: tenants.length,
    connectedSources: results.length,
    ok,
    failed,
  });
  return { ranAt, tenants: tenants.length, connectedSources: results.length, ok, failed, results };
}
