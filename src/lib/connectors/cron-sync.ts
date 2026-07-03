import { log } from "@/lib/logger";
import { listTenants } from "@/domains/tenants/store";
import { getConnectorInfo, updateConnectorToken } from "@/lib/connector-store";
import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";
import { syncGscWeeklyDimensionsForTenant } from "@/lib/connectors/gsc/weekly-dimensions-sync";
import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
import { pullGa4AiReferralsForTenant } from "@/lib/connectors/ga4/sync-ai-referrals";
import { syncClarityDailyMetricsForTenant } from "@/lib/connectors/clarity/sync-daily-metrics";
import { syncProfoundNightlyForTenant } from "@/lib/connectors/profound/sync-nightly";
import { precomputeMoveDraftsForTenant } from "@/domains/demand-graph/precompute-drafts";
import { auditTopCompetitorsForTenant } from "@/domains/demand-graph/competitor-page-audit";
import { rebuildQuestionUniverseForTenant } from "@/domains/research/question-universe-loader";
import { rebuildClaimGraphForTenant } from "@/domains/provenance/claim-graph-loader";
import { runRevenueFactsPass } from "@/domains/revenue/compute-unit-economics";
import { checkPipelineInvariants } from "@/domains/ops/pipeline-invariants";
import { gatherPipelineReadings } from "@/domains/ops/pipeline-readings";
import { buildPipelineHealthRow, writePipelineHealth } from "@/domains/ops/pipeline-health-store";
import { loadQuerySpikeRows } from "@/domains/trend-radar/load-query-spikes";
import { computeQuerySpikes, anchorDateOf } from "@/domains/trend-radar/query-spikes";
import { writeQuerySpikeSummary } from "@/domains/trend-radar/spike-store";
import { runMonthlyArchiveRollup } from "@/domains/seasonal/archive-rollup";
import { runFamilyDemandProfiles } from "@/domains/seasonal/run-family-demand-profiles";
import { runGlobalPatternsNightlyAggregation } from "@/domains/global-patterns/nightly-aggregate";
import { loadMonthlyArchiveRows } from "@/domains/seasonal/load-monthly-archive";
import { detectSeasonalQueries } from "@/domains/seasonal/seasonality";
import { writeSeasonalSummary } from "@/domains/seasonal/seasonal-store";
import { continueDeepBackfillIfStarted } from "@/lib/connectors/gsc/deep-backfill";
import { continueColdStartCrawlIfStarted } from "@/domains/scanning/crawl-frontier";
import { computePeakCalendar } from "@/domains/seasonal/seasonality";
import { writePeakCalendar } from "@/domains/seasonal/peak-calendar-store";
import { loadSeasonalQueries } from "@/domains/seasonal/seasonal-store";
import { runHistoricalVolume, HISTORICAL_VOLUME_KEYWORDS_LIMIT } from "@/domains/serp/dataforseo-labs";
import { runLanguageGapPass } from "@/domains/language-gap/run-language-gap-pass";
import { writeLanguageGapSummary } from "@/domains/language-gap/language-gap-store";
import { loadQuarterlyDecayForTenant } from "@/domains/refresh/load-quarterly-decay";
import { rankRefreshCandidates } from "@/domains/refresh/decay-queue";
import { loadRefreshBriefsForTenant } from "@/domains/refresh/refresh-brief-loader";
import { writeRefreshQueueSummary } from "@/domains/refresh/refresh-store";
import { runAaCalibrationForTenant } from "@/domains/proof-gsc/aa-calibration";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { detectChangepoints } from "@/domains/proof-gsc/changepoint";
import { writeAlgorithmWeatherSummary } from "@/domains/proof-gsc/algorithm-weather-store";
import { computePooledVerdicts } from "@/domains/proof-gsc/pooled-verdict-runner";
import { runInvestigationForTenant } from "@/domains/investigation/run-investigation";
import { recordCronRun, type CronRunSourceResult as LedgerSourceResult } from "@/domains/ops/cron-runs-store";
import { checkTokenExpiryForTenants } from "@/domains/ops/token-expiry-notify";
import { homepageUrlForDomain, probeHomepage, recordSiteProbe } from "@/domains/ops/site-uptime-store";
import { recordAppError, errorFieldsFrom } from "@/lib/obs/error-ledger";

/** N39 error spine: record one phase failure to the durable app-errors ledger
 *  (the log.warn lines below vanish when Vercel rotates function logs). NEVER
 *  throws (recordAppError absorbs every failure), so calling it inside each
 *  phase's catch cannot change the fail-soft contract of the sync. */
function reportPhaseError(action: string, tenantId: string | null, e: unknown): Promise<void> {
  return recordAppError({
    route: "cron/sync-connectors",
    tenantId,
    action,
    ...errorFieldsFrom(e),
  });
}

/** The READ sources a nightly refresh pulls. Wix is publish-only and excluded
 *  (it has no inbound data to sync). Mirrors REFRESH_ALL_SOURCES in the
 *  /settings/connectors "Refresh my data" action, but parameterized per
 *  arbitrary tenant (no request context) so the cron can fan out. */
type ReadProvider = "google_gsc" | "google_ga4" | "clarity" | "profound";

const READ_SOURCES: ReadonlyArray<{
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

export type CronSyncResult = {
  ranAt: string;
  tenants: number;
  connectedSources: number;
  ok: number;
  failed: number;
  results: CronSyncSourceResult[];
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
        await reportPhaseError(`sync-${s.provider}`, tenantId, outcome.reason);
        return { tenantId, provider: s.provider, ok: false, detail: err.slice(0, 200) };
      }
      const verdict = syncSucceeded(outcome.value);
      if (!verdict.ok) {
        // Failed sync — do NOT stamp freshness (the card must not claim a pull
        // that didn't happen). Surface the engine's reason for the cron log.
        return { tenantId, provider: s.provider, ok: false, detail: verdict.reason };
      }
      await stampFreshness(s.provider, tenantId);
      return { tenantId, provider: s.provider, ok: true, detail: "synced" };
    }),
  );
}

/** Per-provider auto-refresh staleness threshold (hours) for the on-USE refresh.
 *  FREE sources (GSC, GA4, Clarity — Google/Microsoft APIs, no per-call cost) use
 *  1h so they effectively re-pull on every login session: the operator should
 *  never see stale free data. (Their underlying data only changes ~daily — GSC is
 *  3 days behind — so 1h is "always fresh" without re-pulling on every single
 *  navigation; the 2-min in-process throttle + durable last_synced_at prevent any
 *  hammering.) PAID sources stay daily: Profound runs once a day, so pulling it
 *  every login would burn quota for IDENTICAL numbers. */
const AUTO_REFRESH_STALE_HOURS: Record<ReadProvider, number> = {
  google_gsc: 1,
  google_ga4: 1,
  clarity: 1,
  profound: 12,
};

function isStale(
  lastSyncedAt: string | null | undefined,
  staleHours: number,
  now: Date,
): boolean {
  if (!lastSyncedAt) return true; // never synced → stale
  const ageMs = now.getTime() - Date.parse(lastSyncedAt);
  return !Number.isFinite(ageMs) || ageMs > staleHours * 3_600_000;
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

  const settled = await Promise.allSettled(stale.map(({ source }) => source.run(tenantId)));
  return Promise.all(
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
        return { tenantId, provider: source.provider, ok: false, detail: err.slice(0, 200) };
      }
      const verdict = syncSucceeded(outcome.value);
      if (!verdict.ok) {
        return { tenantId, provider: source.provider, ok: false, detail: verdict.reason };
      }
      await stampFreshness(source.provider, tenantId);
      return { tenantId, provider: source.provider, ok: true, detail: "synced" };
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
  // Soft deadline for the post-sync enrichment (teardown + precompute). The route's
  // maxDuration is 300s; stop enrichment with headroom so a long run is never KILLED
  // mid-write (PHASE 1 syncs always finished first; enrichment is best-effort and
  // idempotent, so a skipped tail just resumes next night).
  const startMs = Date.now();
  const ENRICH_DEADLINE_MS = 240_000;
  const pastDeadline = () => Date.now() - startMs > ENRICH_DEADLINE_MS;
  const tenants = (await listTenants()).filter((t) => t.status === "active");
  const results: CronSyncSourceResult[] = [];
  // PHASE 1 — sync every tenant's data first (the critical path). LLM precompute
  // is deferred to phase 2 so a slow draft can never starve a later tenant's sync
  // if the 300s cron cap is approached.
  for (const t of tenants) {
    try {
      results.push(...(await syncOneTenant(t.id)));
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      log.error("[cron-sync] tenant failed", { tenantId: t.id, error: err.slice(0, 200) });
      await reportPhaseError("tenant-sync", t.id, e);
    }
  }

  // PHASE 1a-gsc-weekly - weekly GSC dimensions pass (BEACON_500 R17b, v1
  // items 136 + 268): ONE searchAppearance + ONE device aggregate per tenant
  // per WEEK (the engine's own cadence check makes ~6 of 7 nightly runs a
  // free no-op). Isolated step by contract: its own try/catch, dormant until
  // GSC is connected (no_usable_gsc_token is a cheap skip), FREE (Google
  // API), never touches the daily final tables.
  for (const t of tenants) {
    try {
      const r = await syncGscWeeklyDimensionsForTenant({ tenantId: t.id });
      if (r.ran) {
        log.info("[cron-sync] gsc weekly dimensions", {
          tenantId: t.id,
          property: r.property,
          weeksPulled: r.weeksPulled,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] gsc weekly dimensions failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("gsc-weekly-dimensions", t.id, e);
    }
  }

  // PHASE 1a-ai - AI-referral attribution (item 6): a SEPARATE GA4 report split
  // by sessionSource so ChatGPT / Perplexity / Gemini / Copilot / Claude visits
  // land in ga4_ai_referral_daily per page per day. Isolated step by contract:
  // its own try/catch, its own report request, dormant until a GA4 key exists
  // (the pull returns no_token/no_property cheaply), so it can never slow or
  // break the traffic sync above. FREE (Google API), idempotent upsert.
  for (const t of tenants) {
    try {
      const r = await pullGa4AiReferralsForTenant({ tenantId: t.id });
      if (r.synced && r.rows_upserted > 0) {
        log.info("[cron-sync] ai referrals", {
          tenantId: t.id,
          rowsUpserted: r.rows_upserted,
          sessions: r.sessions,
          sources: r.sources,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] ai referrals failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("ai-referrals", t.id, e);
    }
  }

  // PHASE 1b - revenue facts (item 3): the operator's rate x tonight's fresh GA4
  // traffic -> honest per-page dollar rows in revenue_facts. Deterministic, FREE
  // (no LLM, no paid API), idempotent upsert, dormant until a revenue model is
  // set in settings. Isolated try/catch per tenant like every other step.
  for (const t of tenants) {
    try {
      const r = await runRevenueFactsPass(t.id);
      if (r.ran && r.rowsUpserted > 0) {
        log.info("[cron-sync] revenue facts", {
          tenantId: t.id,
          rowsUpserted: r.rowsUpserted,
          adNetworkRows: r.adNetworkRows,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] revenue facts failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("revenue-facts", t.id, e);
    }
  }

  // PHASE 1c - trend radar (master plan item 14): week-over-week query spikes
  // from tonight's fresh gsc_daily_rows (this week vs the trailing 4-week
  // baseline), persisted so the Today Demand band + the daily plan builder read
  // them at $0. Deterministic, FREE (bounded Supabase reads, no LLM, no paid
  // API), latest-wins upsert; an empty list is written too so "checked, quiet"
  // stays distinguishable from "never checked". Isolated try/catch per tenant.
  for (const t of tenants) {
    try {
      const rows = await loadQuerySpikeRows(t.id);
      const spikes = computeQuerySpikes(rows);
      await writeQuerySpikeSummary({
        tenant_id: t.id,
        computed_at: new Date().toISOString(),
        anchor_date: anchorDateOf(rows),
        spikes,
      });
      if (spikes.length > 0) {
        log.info("[cron-sync] trend radar found spikes", {
          tenantId: t.id,
          spikes: spikes.length,
          top: spikes[0]?.query,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] trend radar failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("trend-radar", t.id, e);
    }
  }

  // PHASE 1d - permanent seasonal archive (master plan item 21): fold tonight's
  // fresh gsc_daily_rows into the permanent gsc_monthly_archive rollup (bounded,
  // monthly-chunked reads; idempotent upsert on the month), then run the pure
  // seasonality detector over the tenant's full archive and persist any detected
  // peak windows so the Today Demand band + the daily plan builder read them at
  // $0. Deterministic, FREE (bounded Supabase reads, no LLM, no paid API).
  // Backfills all history on a tenant's first run; isolated try/catch per tenant,
  // does not touch PHASE 1c above.
  for (const t of tenants) {
    try {
      // D9 truth-gap fix (2026-07-02): the per-family demand profiles that the
      // seasonal voice and prepare-today-moves READ were never populated by any
      // job - the store stayed empty and the voice stayed silent. Populate them
      // right after the archive rollup they derive from. Fail-soft: a profile
      // failure never blocks the rollup or the rest of the sync.
      try {
        const fam = await runFamilyDemandProfiles(t.id);
        log.info("[cron-sync] family demand profiles", { tenantId: t.id, ...("profilesWritten" in fam ? { profilesWritten: (fam as { profilesWritten?: number }).profilesWritten } : {}) });
      } catch (e) {
        log.warn("[cron-sync] family demand profiles failed (fail-soft)", { tenantId: t.id, error: e instanceof Error ? e.message : String(e) });
        await reportPhaseError("family-demand-profiles", t.id, e);
      }
      const rollup = await runMonthlyArchiveRollup(t.id);
      if (rollup.ran && rollup.monthsRolled.length > 0) {
        log.info("[cron-sync] seasonal archive rollup", {
          tenantId: t.id,
          isBackfill: rollup.isBackfill,
          monthsRolled: rollup.monthsRolled.length,
          rowsWritten: rollup.rowsWritten,
        });
      }
      const archiveRows = await loadMonthlyArchiveRows(t.id);
      const seasonal = detectSeasonalQueries(archiveRows);
      await writeSeasonalSummary({
        tenant_id: t.id,
        computed_at: new Date().toISOString(),
        monthsOfHistory: new Set(archiveRows.map((r) => r.month.slice(0, 7))).size,
        seasonal,
      });
      if (seasonal.length > 0) {
        log.info("[cron-sync] seasonal windows detected", {
          tenantId: t.id,
          seasonal: seasonal.length,
          top: seasonal[0]?.query,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] seasonal archive failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("seasonal-archive", t.id, e);
    }
  }

  // PHASE 1d-2 - GSC deep history backfill continuation (master plan item 63): an
  // operator-triggered deep backfill (/diagnostics/connectors "Load my full Search
  // Console history") reaches up to 16 months back in resumable chunks; this
  // continues exactly one more chunk per night for any tenant with a backfill
  // still in_progress. A no-op for every tenant that never started one (fail-soft,
  // isolated try/catch per tenant, does not touch PHASE 1d above).
  for (const t of tenants) {
    try {
      const chunk = await continueDeepBackfillIfStarted(t.id);
      if (chunk.ran) {
        log.info("[cron-sync] GSC deep backfill chunk", {
          tenantId: t.id,
          chunkStart: chunk.chunkStart,
          chunkEnd: chunk.chunkEnd,
          daysPulled: chunk.daysPulled,
          complete: chunk.complete,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] GSC deep backfill continuation failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("gsc-deep-backfill", t.id, e);
    }
  }

  // PHASE 1d-2b - cold-start crawl continuation (BEACON_500 R12 / T0e): the
  // URL-first signup starts a RESUMABLE crawl queue (crawl-frontier store);
  // this continues exactly one more bounded batch per night (max 15 pages /
  // 45s) for any tenant whose queue is still in_progress, until frontier
  // exhaustion or the 150-page cap. A no-op for every tenant without a live
  // queue. FREE (polite crawl of the tenant's own site, no LLM, no paid API).
  // Includes pending_onboarding tenants on purpose: a signup that stalled
  // before launch still gets its site read overnight (the /diagnostics
  // stalled-signup rescue reads the same state). Isolated fail-soft phase,
  // same resumable-continuation contract as PHASE 1d-2 above.
  try {
    const crawlTenants = (await listTenants()).filter(
      (t) => t.status === "active" || t.status === "pending_onboarding",
    );
    for (const t of crawlTenants) {
      if (pastDeadline()) {
        log.info("[cron-sync] enrichment deadline reached, skipping remaining cold-start crawl batches");
        break;
      }
      try {
        const batch = await continueColdStartCrawlIfStarted(t.id);
        if (batch.ran) {
          log.info("[cron-sync] cold-start crawl batch", {
            tenantId: t.id,
            crawled: batch.crawled,
            failed: batch.failed,
            totalCrawled: batch.totalCrawled,
            remaining: batch.remaining,
            complete: batch.complete,
          });
        }
      } catch (e) {
        log.warn("[cron-sync] cold-start crawl continuation failed", {
          tenantId: t.id,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
        await reportPhaseError("cold-start-crawl", t.id, e);
      }
    }
  } catch (e) {
    log.warn("[cron-sync] cold-start crawl tenant listing failed (phase skipped)", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    await reportPhaseError("cold-start-crawl", null, e);
  }

  // PHASE 1d-3 - proven peak calendar (master plan item 63): cross-check the top
  // detected seasonal cluster heads (at most HISTORICAL_VOLUME_KEYWORDS_LIMIT, 20)
  // against DataForSEO Labs' independent multi-year market volume, upgrading
  // 'repeated' entries to 'proven' when both sources agree, then persist the
  // calendar so the daily plan candidate feed can read it at $0. runHistoricalVolume
  // rides the SAME money gauntlet as every other Labs read (30-day cache, dry-run
  // default, fail-closed shared cap) - a dry-run/capped/error result yields no rows,
  // and computePeakCalendar treats that as "unconfirmed" (archive-only confidence),
  // never an error. The 30-day cache means the SAME stable cluster-head keyword set
  // only spends once per month even though this runs nightly. Isolated try/catch
  // per tenant, does not touch PHASE 1d/1d-2 above.
  for (const t of tenants) {
    try {
      const seasonal = await loadSeasonalQueries(t.id);
      const clusterHeads = seasonal
        .filter((s) => s.confidence === "repeated")
        .slice(0, HISTORICAL_VOLUME_KEYWORDS_LIMIT)
        .map((s) => s.query);
      const historicalVolume = new Map<string, Array<{ year: number; month: number; searchVolume: number }>>();
      if (clusterHeads.length > 0) {
        const labs = await runHistoricalVolume(clusterHeads);
        for (const row of labs.rows) {
          historicalVolume.set(row.keyword.trim().toLowerCase(), row.monthly);
        }
      }
      const calendar = computePeakCalendar(seasonal, historicalVolume);
      await writePeakCalendar({
        tenant_id: t.id,
        computed_at: new Date().toISOString(),
        calendar,
      });
      const proven = calendar.filter((c) => c.confidence === "proven").length;
      if (proven > 0) {
        log.info("[cron-sync] peak calendar proven windows", { tenantId: t.id, proven, total: calendar.length });
      }
    } catch (e) {
      log.warn("[cron-sync] peak calendar failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("peak-calendar", t.id, e);
    }
  }

  // PHASE 1e - Farsi/Finglish language-gap matrix (master plan item 24): classify
  // tonight's cached GSC query demand by script and language, join against each
  // owned page's crawled content language, persist any gaps found so the Today
  // Demand band + the daily plan builder read them at $0. Deterministic, FREE
  // (reads only the already-cached GSC page signals + page_snapshots, no LLM, no
  // paid API), latest-wins upsert; an empty list is written too so "checked,
  // no gap" stays distinguishable from "never checked". Isolated try/catch per
  // tenant, does not touch PHASE 1c/1d above.
  for (const t of tenants) {
    try {
      const pass = await runLanguageGapPass(t.id);
      if (pass.ran) {
        await writeLanguageGapSummary({
          tenant_id: t.id,
          computed_at: new Date().toISOString(),
          queriesClassified: pass.queriesClassified,
          farsiScriptCount: pass.farsiScriptCount,
          finglishCount: pass.finglishCount,
          englishCount: pass.englishCount,
          gaps: pass.gaps,
        });
        if (pass.gaps.length > 0) {
          log.info("[cron-sync] language gaps found", {
            tenantId: t.id,
            gaps: pass.gaps.length,
            top: pass.gaps[0]?.page,
          });
        }
      }
    } catch (e) {
      log.warn("[cron-sync] language gap pass failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("language-gap", t.id, e);
    }
  }

  // PHASE 1f - A/A calibration harness (master plan item 31): measure Beacon's
  // OWN false-positive rate by running the real measurement math on pages
  // Beacon never touched (deterministically-seeded pseudo ship dates, real
  // GSC data, in-memory only - see aa-calibration.ts's safety doc). Persists
  // ONLY the aggregate rate + derived floors; NEVER writes a placebo row to
  // the real proof ledger. Bounded to 40 placebo pages/tenant/night, $0 (GSC
  // reads only, already-synced data). Isolated try/catch per tenant, does not
  // touch PHASE 1c/1d/1e above.
  for (const t of tenants) {
    if (pastDeadline()) {
      log.info("[cron-sync] enrichment deadline reached — skipping remaining A/A calibration");
      break;
    }
    try {
      const cal = await runAaCalibrationForTenant(t.id);
      if (cal.ran && cal.sampleSize > 0) {
        log.info("[cron-sync] A/A calibration", {
          tenantId: t.id,
          sampleSize: cal.sampleSize,
          falsePositiveRate: Number(cal.falsePositiveRate.toFixed(3)),
        });
      }
    } catch (e) {
      log.warn("[cron-sync] A/A calibration failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("aa-calibration", t.id, e);
    }
  }

  // PHASE 1g - algorithm-weather guard (master plan item 32): a CUSUM changepoint
  // pass over tonight's fresh sitewide daily GSC totals (clicks + impressions),
  // detecting Google-core-update-shaped sitewide shocks so the Results page can
  // caveat any verdict whose measurement window overlapped one, and the prior/
  // lesson readers can exclude it from training. Deterministic, FREE (reads only
  // the already-synced gsc_daily_totals, no LLM, no paid API), latest-wins upsert;
  // an empty pair of lists is written too so "checked, nothing shifted" stays
  // distinguishable from "never checked". Isolated try/catch per tenant, does not
  // touch PHASE 1c/1d/1e/1f above.
  for (const t of tenants) {
    if (pastDeadline()) {
      log.info("[cron-sync] enrichment deadline reached — skipping remaining algorithm-weather pass");
      break;
    }
    try {
      const totals = await loadDailyTotalsForTenant(t.id, 90);
      const clicksChangepoints = detectChangepoints(totals.map((d) => ({ date: d.date, value: d.clicks })));
      const impressionsChangepoints = detectChangepoints(totals.map((d) => ({ date: d.date, value: d.impressions })));
      await writeAlgorithmWeatherSummary({
        tenant_id: t.id,
        computed_at: new Date().toISOString(),
        anchor_date: totals.length > 0 ? totals[totals.length - 1]!.date : null,
        clicksChangepoints,
        impressionsChangepoints,
      });
      if (clicksChangepoints.length > 0 || impressionsChangepoints.length > 0) {
        log.info("[cron-sync] algorithm-weather shock detected", {
          tenantId: t.id,
          clicksChangepoints: clicksChangepoints.length,
          impressionsChangepoints: impressionsChangepoints.length,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] algorithm-weather pass failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("algorithm-weather", t.id, e);
    }
  }

  // PHASE 1h - pooled batch verdicts (master plan item 34): the live daily batch ships ONE
  // lever across many sibling pages in one accepted plan, yet each page's own diff-in-diff
  // read is individually underpowered. Group this tenant's ledger by (planId, actionFamily),
  // and for every batch with >= 3 measured pages, stack the per-page adjusted lifts with
  // inverse-variance weights into ONE confident batch-level verdict (pooled-verdict.ts).
  // Deterministic, FREE (reads already-synced GSC daily series + already-persisted plans/
  // ledger, no LLM, no paid API), computed-only (never touches shipped_change_proof).
  // Isolated try/catch per tenant, does not touch PHASE 1c/1d/1e/1f/1g above.
  for (const t of tenants) {
    if (pastDeadline()) {
      log.info("[cron-sync] enrichment deadline reached, skipping remaining pooled-verdict pass");
      break;
    }
    try {
      const result = await computePooledVerdicts(t.id);
      if (result.groupsPooled > 0) {
        log.info("[cron-sync] pooled batch verdicts computed", {
          tenantId: t.id,
          groupsPooled: result.groupsPooled,
          groupsConsidered: result.groupsConsidered,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] pooled-verdict pass failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("pooled-verdicts", t.id, e);
    }
  }

  // PHASE 1i - refresh production line (master plan item 56): rank pages losing clicks
  // QUARTER over quarter (the gsc_decay_v1 RPC with 91-day windows - the gradual fades the
  // 28d trigger never crosses), floor out tiny pages (>= 100 clicks/quarter baseline), build
  // each queued page's evidence brief (searched queries no H2 answers + the queries it is
  // losing + the winner's newer section from the cached competitor teardown), and persist so
  // the Today Demand band + the daily plan builder read the queue at $0. Deterministic, FREE
  // (bounded Supabase reads + cached crawl + cached teardowns, no LLM, no paid API),
  // latest-wins upsert; an empty queue is written too so "checked, nothing fading" stays
  // distinguishable from "never checked". Isolated try/catch per tenant, does not touch
  // PHASE 1c/1d/1e/1f/1g/1h above.
  for (const t of tenants) {
    if (pastDeadline()) {
      log.info("[cron-sync] enrichment deadline reached, skipping remaining refresh-queue pass");
      break;
    }
    try {
      const deltas = await loadQuarterlyDecayForTenant(t.id);
      const ranked = rankRefreshCandidates(deltas, { limit: 8 });
      const queue = await loadRefreshBriefsForTenant(t.id, ranked);
      await writeRefreshQueueSummary({
        tenant_id: t.id,
        computed_at: new Date().toISOString(),
        pagesConsidered: deltas.length,
        queue,
      });
      if (queue.length > 0) {
        log.info("[cron-sync] refresh queue built", {
          tenantId: t.id,
          queued: queue.length,
          top: queue[0]?.page,
          topClicksLostPerMonth: queue[0]?.rank.clicksLostPerMonth,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] refresh queue pass failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("refresh-queue", t.id, e);
    }
  }

  // PHASE 2a — Step 3 competitor teardown (deterministic, FREE: polite HTTP only,
  // no LLM/paid API). Populates `competitor_page_audit` so the cockpit + New Pages
  // board show "what wins" everywhere, not just where the operator visited the
  // diagnostics page. Idempotent (caches ok audits) + fail-soft. Runs BEFORE the
  // precompute so drafts get fresh teardown grounding.
  for (const t of tenants) {
    if (pastDeadline()) {
      log.info("[cron-sync] enrichment deadline reached — skipping remaining teardowns");
      break;
    }
    try {
      const a = await auditTopCompetitorsForTenant({ tenantId: t.id, limit: 15 });
      if (a.audited.length > 0) {
        log.info("[cron-sync] competitor teardown", {
          tenantId: t.id,
          audited: a.audited.length,
          targets: a.targets,
          cached: a.cached,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] teardown failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("competitor-teardown", t.id, e);
    }
  }

  // PHASE 2a-q (BEACON_500 R11 / N30) - demand-ranked question universe. Merges
  // every question-shaped signal already synced above (GSC queries, AI fanouts,
  // the tenant question library, captured People-also-ask rows) into ONE ranked,
  // ownership-and-coverage-checked list per tenant, persisted to the
  // "question-universe" store. $0 (cache/DB reads only). Runs BEFORE the
  // precompute so the FAQ/answer-block drafters seed from tonight's universe.
  // Isolated fail-soft: a failure here never touches the sync result.
  for (const t of tenants) {
    if (pastDeadline()) {
      log.info("[cron-sync] enrichment deadline reached, skipping remaining question-universe builds");
      break;
    }
    try {
      const qu = await rebuildQuestionUniverseForTenant(t.id);
      if (qu.rows > 0) {
        log.info("[cron-sync] question universe", {
          tenantId: t.id,
          rows: qu.rows,
          uncovered: qu.uncovered,
          bySource: qu.stats.bySource,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] question universe failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("question-universe", t.id, e);
    }
  }

  // PHASE 2a-r (BEACON_500 R13 / N3) - claim-level provenance graph. Mines the
  // factual claims (numbers, dates, is-a definitions) out of the stored page
  // bodies + FAQ answers for the highest-traffic pages, attaches dated teardown
  // sources, and persists the capped per-tenant graph to the "claim-graph"
  // store. $0 (stored reads only, no LLM, no paid call). Feeds the daily card's
  // per-claim source lines, the claim-conflict trigger, and
  // /diagnostics/provenance. Isolated fail-soft: rebuildClaimGraphForTenant
  // never throws, and a failure here never touches the sync result.
  for (const t of tenants) {
    if (pastDeadline()) {
      log.info("[cron-sync] enrichment deadline reached, skipping remaining claim-graph builds");
      break;
    }
    try {
      const cg = await rebuildClaimGraphForTenant(t.id);
      if (cg.claims > 0) {
        log.info("[cron-sync] claim graph", {
          tenantId: t.id,
          claims: cg.claims,
          conflicting: cg.conflicting,
          consistent: cg.consistent,
          unverified: cg.unverified,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] claim graph failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("claim-graph", t.id, e);
    }
  }

  // PHASE 2b — §6 move-draft precompute, AFTER all data is fresh. No-op unless
  // BEACON_LLM_PROVIDER=openai; budget-capped + idempotent (only un-drafted Moves
  // → steady-state ~free) + fail-soft (per-tenant try/catch, never affects sync).
  for (const t of tenants) {
    if (pastDeadline()) {
      log.info("[cron-sync] enrichment deadline reached — skipping remaining precompute");
      break;
    }
    try {
      const pc = await precomputeMoveDraftsForTenant(t.id, { maxMoves: 8 });
      if (!pc.skipped && (pc.answerBlocksSaved > 0 || pc.faqSchemasSaved > 0 || pc.newPageOpeningsSaved > 0)) {
        log.info("[cron-sync] precomputed move drafts", {
          tenantId: t.id,
          answerBlocks: pc.answerBlocksSaved,
          faqSchemas: pc.faqSchemasSaved,
          newPageOpenings: pc.newPageOpeningsSaved,
          spendUsd: Number(pc.spendUsd.toFixed(4)),
        });
      }
    } catch (e) {
      log.warn("[cron-sync] precompute failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("move-draft-precompute", t.id, e);
    }
  }
  // PHASE 3 - pipeline volume invariants (master plan item 10). AFTER every sync
  // and enrichment step, assert each stage actually produced rows (GSC/GA4/Profound
  // volume + 48h freshness, daily-plan candidates, demand-graph moves) and persist
  // the result for the Today Ops card. This is the watchdog against the silent-empty
  // failure class (/today once rendered blank for weeks), so it runs even past the
  // enrichment deadline: ~12 tiny reads per tenant, $0, deterministic. Isolated
  // try/catch per tenant - a watchdog failure never affects the sync result.
  for (const t of tenants) {
    try {
      const readings = await gatherPipelineReadings(t.id);
      const violations = checkPipelineInvariants(readings);
      await writePipelineHealth(buildPipelineHealthRow(readings, violations));
      if (violations.length > 0) {
        log.warn("[cron-sync] pipeline invariants violated", {
          tenantId: t.id,
          stages: violations.map((v) => v.stage),
        });
      }
    } catch (e) {
      log.warn("[cron-sync] pipeline invariant check failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("pipeline-invariants", t.id, e);
    }
  }

  // PHASE 4 - overnight forensic investigation (master plan item 53). AFTER the
  // pipeline watchdog, so tonight's data is confirmed fresh, and AFTER PHASE 1g's
  // algorithm-weather pass (item 32), whose stored changepoints this phase reads
  // rather than re-detecting. When a page family's weekly clicks collapsed >= 60
  // percent, or the sitewide changepoint detector found a high-magnitude drop,
  // auto-run an investigation: a bounded, polite live fetch of the affected pages
  // (max 3/investigation) for noindex/status/canonical regressions, a $0 cached-
  // SERP rank check, a $0 push-ledger scan for recent shipped changes, and a $0
  // read of the algorithm-weather store, then file a ranked-cause diagnosis card.
  // Capped at 2 investigations/tenant/night and idempotent per (family, week) -
  // see investigation-store.ts. Isolated try/catch per tenant, never affects the
  // sync result; runs even past the enrichment deadline like PHASE 3, since it is
  // itself bounded and cheap.
  for (const t of tenants) {
    try {
      const run = await runInvestigationForTenant(t.id);
      if (run.investigated > 0) {
        log.info("[cron-sync] forensic investigation filed", {
          tenantId: t.id,
          triggered: run.triggered,
          investigated: run.investigated,
          skippedIdempotent: run.skippedIdempotent,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] forensic investigation failed", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("forensic-investigation", t.id, e);
    }
  }

  // PHASE 4b - site uptime probe (BEACON_500 T0c, 2026-07-03). ONE polite
  // HEAD/GET on each tenant's homepage, recording status + time-to-first-byte
  // into site-uptime-probes so the deadman verdict on Today can say "your site
  // did not answer" when it is down two nights in a row. Isolated fail-soft
  // phase by contract: its own try/catch per tenant, a 15s hard timeout per
  // probe, no LLM, no paid API, and it runs even past the enrichment deadline
  // (like PHASE 3/4) because a down site is exactly what must not be skipped.
  // Honest limit: fetch() exposes no TLS internals, so certificate EXPIRY
  // DATES are not forecast here; an already-broken cert still fails the probe
  // and raises the same banner (see site-uptime-store.ts).
  for (const t of tenants) {
    try {
      const url = homepageUrlForDomain(t.domain);
      if (url == null) continue; // no real domain configured - nothing to probe
      const outcome = await probeHomepage(url);
      await recordSiteProbe({
        tenant_id: t.id,
        url,
        checked_at: new Date().toISOString(),
        ok: outcome.ok,
        status: outcome.status,
        ttfb_ms: outcome.ttfbMs,
        error: outcome.error,
      });
      if (!outcome.ok) {
        log.warn("[cron-sync] site uptime probe failed", {
          tenantId: t.id,
          url,
          status: outcome.status,
          error: outcome.error,
        });
      }
    } catch (e) {
      log.warn("[cron-sync] site uptime probe threw (fail-soft)", {
        tenantId: t.id,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      await reportPhaseError("site-uptime-probe", t.id, e);
    }
  }

  // D9 truth-gap fix (2026-07-02): the anonymous cross-tenant pattern brain
  // (global_patterns, item 66) had a complete write pipeline that NO job ever
  // invoked - the table stayed empty and priors never got their global backoff
  // cells. Run it once per nightly sync, fleet-level, after all tenants synced.
  // Fail-soft: an aggregation failure never touches the sync above.
  try {
    const agg = await runGlobalPatternsNightlyAggregation();
    log.info("[cron-sync] global patterns aggregated", { ...agg });
  } catch (e) {
    log.warn("[cron-sync] global patterns aggregation failed (fail-soft)", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    await reportPhaseError("global-patterns", null, e);
  }

  // PHASE 5 - Google token-expiry forecast + warning email (BEACON_500 item 84,
  // 2026-07-03). AFTER everything else, so a slow/failed check here can never
  // delay or break the actual data sync above. Computes days-until-Testing-
  // mode-refresh-token-death per tenant's Google connections and sends ONE
  // deduped email to the configured operator inbox at T-2 days (see
  // token-expiry-notify.ts for the full safety contract: operator-only, skip-
  // and-log when unconfigured, never a second email inside the same expiry
  // cycle). Isolated try/catch across the whole fleet - a failure here never
  // affects the sync result.
  let tokenExpiryChecked = 0;
  let tokenExpiryWarningsSent = 0;
  try {
    const checks = await checkTokenExpiryForTenants(tenants.map((t) => t.id));
    tokenExpiryChecked = checks.length;
    tokenExpiryWarningsSent = checks.filter((c) => c.action === "sent").length;
    if (tokenExpiryWarningsSent > 0) {
      log.info("[cron-sync] token-expiry warning emails sent", {
        sent: tokenExpiryWarningsSent,
        checked: tokenExpiryChecked,
      });
    }
  } catch (e) {
    log.warn("[cron-sync] token-expiry check failed", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    await reportPhaseError("token-expiry", null, e);
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.length - ok;
  log.info("[cron-sync] complete", {
    tenants: tenants.length,
    connectedSources: results.length,
    ok,
    failed,
  });

  // Cron health ledger (BEACON_500 item 85, 2026-07-03): record this run so the
  // /settings/connectors health panel and item 84's failure-streak trigger have
  // a durable, queryable history instead of log lines that vanish. FAIL-SOFT BY
  // CONTRACT - recordCronRun never throws, but it is still called from inside
  // this try so a synchronous bug in the mapping below can never mask the real
  // sync result computed above.
  try {
    await recordCronRun({
      job: "sync-connectors",
      startedAt: ranAt,
      finishedAt: new Date().toISOString(),
      ok: failed === 0,
      perSource: results.map(
        (r): LedgerSourceResult => ({
          tenantId: r.tenantId,
          provider: r.provider,
          ok: r.ok,
          detail: r.detail,
        }),
      ),
      notes: {
        tenants: tenants.length,
        tokenExpiryChecked,
        tokenExpiryWarningsSent,
      },
    });
  } catch (e) {
    log.warn("[cron-sync] ledger write threw unexpectedly (sync result unaffected)", {
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    await reportPhaseError("cron-ledger", null, e);
  }

  return { ranAt, tenants: tenants.length, connectedSources: results.length, ok, failed, results };
}
