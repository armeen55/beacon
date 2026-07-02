import { log } from "@/lib/logger";
import { listTenants } from "@/domains/tenants/store";
import { getConnectorInfo, updateConnectorToken } from "@/lib/connector-store";
import { syncGscSearchAnalyticsForTenant } from "@/lib/connectors/gsc/sync-search-analytics";
import { syncGa4UrlTrafficForTenant } from "@/lib/connectors/ga4/sync-url-traffic";
import { pullGa4AiReferralsForTenant } from "@/lib/connectors/ga4/sync-ai-referrals";
import { syncClarityDailyMetricsForTenant } from "@/lib/connectors/clarity/sync-daily-metrics";
import { syncProfoundNightlyForTenant } from "@/lib/connectors/profound/sync-nightly";
import { precomputeMoveDraftsForTenant } from "@/domains/demand-graph/precompute-drafts";
import { auditTopCompetitorsForTenant } from "@/domains/demand-graph/competitor-page-audit";
import { runRevenueFactsPass } from "@/domains/revenue/compute-unit-economics";
import { checkPipelineInvariants } from "@/domains/ops/pipeline-invariants";
import { gatherPipelineReadings } from "@/domains/ops/pipeline-readings";
import { buildPipelineHealthRow, writePipelineHealth } from "@/domains/ops/pipeline-health-store";
import { loadQuerySpikeRows } from "@/domains/trend-radar/load-query-spikes";
import { computeQuerySpikes, anchorDateOf } from "@/domains/trend-radar/query-spikes";
import { writeQuerySpikeSummary } from "@/domains/trend-radar/spike-store";
import { runMonthlyArchiveRollup } from "@/domains/seasonal/archive-rollup";
import { loadMonthlyArchiveRows } from "@/domains/seasonal/load-monthly-archive";
import { detectSeasonalQueries } from "@/domains/seasonal/seasonality";
import { writeSeasonalSummary } from "@/domains/seasonal/seasonal-store";
import { runLanguageGapPass } from "@/domains/language-gap/run-language-gap-pass";
import { writeLanguageGapSummary } from "@/domains/language-gap/language-gap-store";
import { runAaCalibrationForTenant } from "@/domains/proof-gsc/aa-calibration";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { detectChangepoints } from "@/domains/proof-gsc/changepoint";
import { writeAlgorithmWeatherSummary } from "@/domains/proof-gsc/algorithm-weather-store";
import { computePooledVerdicts } from "@/domains/proof-gsc/pooled-verdict-runner";

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
