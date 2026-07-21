import "server-only";

import { log } from "@/lib/logger";
import { getTenant, updateTenant } from "@/domains/tenants/store";
import { refreshTenantProfile } from "@/domains/onboarding/refresh-tenant-profile";
import { syncGscWeeklyDimensionsForTenant } from "@/lib/connectors/gsc/weekly-dimensions-sync";
import { pullGa4AiReferralsForTenant } from "@/lib/connectors/ga4/sync-ai-referrals";
import { runRevenueFactsPass } from "@/domains/revenue/compute-unit-economics";
import { loadQuerySpikeRows } from "@/domains/trend-radar/load-query-spikes";
import { computeQuerySpikes, anchorDateOf } from "@/domains/trend-radar/query-spikes";
import { writeQuerySpikeSummary } from "@/domains/trend-radar/spike-store";
import { runMonthlyArchiveRollup } from "@/domains/seasonal/archive-rollup";
import { runFamilyDemandProfiles } from "@/domains/seasonal/run-family-demand-profiles";
import { loadMonthlyArchiveRows } from "@/domains/seasonal/load-monthly-archive";
import { detectSeasonalQueries, computePeakCalendar } from "@/domains/seasonal/seasonality";
import { writeSeasonalSummary, loadSeasonalQueries } from "@/domains/seasonal/seasonal-store";
import { writePeakCalendar } from "@/domains/seasonal/peak-calendar-store";
import { loadQuarterlyDecayForTenant } from "@/domains/refresh/load-quarterly-decay";
import { rankRefreshCandidates } from "@/domains/refresh/decay-queue";
import { loadRefreshBriefsForTenant } from "@/domains/refresh/refresh-brief-loader";
import { writeRefreshQueueSummary } from "@/domains/refresh/refresh-store";
import { loadDailyTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { detectChangepoints } from "@/domains/proof-gsc/changepoint";
import { writeAlgorithmWeatherSummary } from "@/domains/proof-gsc/algorithm-weather-store";
import { buildShockWindows } from "@/domains/proof-gsc/algorithm-weather";
import { buildExternalEventLedger, type OutageSignal } from "@/domains/events/external-event-ledger";
import { writeExternalEventLedger } from "@/domains/events/external-event-store";
import { loadProofLedger } from "@/domains/proof-gsc/load-ledger";
import { loadDeadmanVerdict } from "@/domains/ops/deadman-view";
import { runAaCalibrationForTenant } from "@/domains/proof-gsc/aa-calibration";
import { demoteResolvedForTenant } from "@/domains/recommendations/recrawl-demotion-runner";
import { sweepQueueForTenant } from "@/domains/recommendations/queue-sweeper";
import { evaluateAuthEscalationForTenant } from "@/domains/ops/auth-escalation";
import { homepageUrlForDomain, probeHomepage, recordSiteProbe } from "@/domains/ops/site-uptime-store";
import { checkPipelineInvariants } from "@/domains/ops/pipeline-invariants";
import { gatherPipelineReadings } from "@/domains/ops/pipeline-readings";
import { buildPipelineHealthRow, writePipelineHealth } from "@/domains/ops/pipeline-health-store";
import { runInvestigationForTenant } from "@/domains/investigation/run-investigation";

/**
 * on-visit-enrichment — the $0, deterministic, per-tenant enrichment producers
 * that used to run as nightly phases of cron-sync.ts. Beacon has no scheduler,
 * so this pass moved to the ON-USE cycle (runOwnedCycle in on-visit-refresh.ts):
 * it runs once per day per tenant, AFTER the connector auto-refresh has pulled
 * tonight's fresh GSC/GA4 data, so the LIVE surfaces that read these stores
 * (Today's Demand band + Ops + Investigation, Changes, Results) stop showing
 * frozen data.
 *
 * CONTRACT (mirrors the nightly phases it replaces):
 *   - Every step is FREE: bounded Supabase / cached reads + pure compute + a
 *     latest-wins upsert, or a Google API pull that is a cheap no-op until the
 *     connector is present. NO LLM, NO paid API (the paid DataForSEO peak-volume
 *     UPGRADE that cron ran is intentionally dropped here; the peak calendar is
 *     computed archive-only at $0).
 *   - Every step is isolated + fail-soft: its own try/catch, a failure never
 *     touches the sync or the other steps.
 *   - The whole pass is deadline-bounded so a slow step can never strand the
 *     post-response lambda; a skipped tail just resumes on the next day's pass.
 *
 * The paid drafting / research producers are NOT here — those live in the
 * autonomous research pass (runAutonomousResearchForTenant), which also already
 * runs competitor teardown, question-universe, claim-graph, internal-pagerank
 * and topic-mentions. This module is only the deterministic data spine.
 */

/** Default budget for the whole enrichment pass. The steps are individually
 *  cheap; this is the safety net so a wedged read can never eat the lambda. */
export const ENRICHMENT_DEADLINE_MS = 90_000;

export type EnrichmentOptions = {
  now?: () => Date;
  deadlineMs?: number;
};

export type EnrichmentResult = {
  ran: string[];
  failed: string[];
  skippedPastDeadline: string[];
};

export async function runOnVisitEnrichment(
  tenantId: string,
  options: EnrichmentOptions = {},
): Promise<EnrichmentResult> {
  const nowFn = options.now ?? (() => new Date());
  const deadlineMs = options.deadlineMs ?? ENRICHMENT_DEADLINE_MS;
  const startMs = Date.now();
  const pastDeadline = () => Date.now() - startMs > deadlineMs;

  const result: EnrichmentResult = { ran: [], failed: [], skippedPastDeadline: [] };

  /** Run one isolated, fail-soft enrichment step. `deadlineSensitive` steps are
   *  skipped once the pass is past its budget (the watchdog + investigation run
   *  regardless, like the nightly phases that ran past the enrichment deadline). */
  const step = async (
    name: string,
    run: () => Promise<void>,
    deadlineSensitive = true,
  ): Promise<void> => {
    if (deadlineSensitive && pastDeadline()) {
      result.skippedPastDeadline.push(name);
      return;
    }
    try {
      await run();
      result.ran.push(name);
    } catch (e) {
      result.failed.push(name);
      log.warn(`[enrichment] ${name} failed (fail-soft)`, {
        tenantId,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
  };

  const now = nowFn();
  const tenant = await getTenant(tenantId).catch(() => null);

  // Weekly GSC dimensions (searchAppearance + device). The engine's own cadence
  // check makes ~6 of 7 passes a free no-op; a cheap skip until GSC is connected.
  await step("gsc-weekly-dimensions", async () => {
    await syncGscWeeklyDimensionsForTenant({ tenantId });
  });

  // AI-referral attribution: a GA4 report split by sessionSource so ChatGPT /
  // Perplexity / Gemini / Copilot / Claude visits land per page per day. Cheap
  // no-op until a GA4 key exists.
  await step("ai-referrals", async () => {
    await pullGa4AiReferralsForTenant({ tenantId });
  });

  // Revenue facts: the operator's rate x fresh GA4 traffic -> per-page dollar rows.
  await step("revenue-facts", async () => {
    await runRevenueFactsPass(tenantId);
  });

  // Trend radar: week-over-week query spikes from tonight's fresh gsc_daily_rows.
  await step("trend-radar", async () => {
    const rows = await loadQuerySpikeRows(tenantId);
    const spikes = computeQuerySpikes(rows);
    await writeQuerySpikeSummary({
      tenant_id: tenantId,
      computed_at: new Date().toISOString(),
      anchor_date: anchorDateOf(rows),
      spikes,
    });
  });

  // Seasonal: per-family demand profiles + the permanent monthly archive rollup +
  // the pure seasonality detector over the tenant's full archive.
  await step("seasonal-archive", async () => {
    try {
      await runFamilyDemandProfiles(tenantId, now);
    } catch (e) {
      log.warn("[enrichment] family demand profiles failed (fail-soft)", {
        tenantId,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
    }
    await runMonthlyArchiveRollup(tenantId);
    const archiveRows = await loadMonthlyArchiveRows(tenantId);
    const seasonal = detectSeasonalQueries(archiveRows);
    await writeSeasonalSummary({
      tenant_id: tenantId,
      computed_at: new Date().toISOString(),
      monthsOfHistory: new Set(archiveRows.map((r) => r.month.slice(0, 7))).size,
      seasonal,
    });
  });

  // Peak calendar, ARCHIVE-ONLY ($0): the same detected seasonal windows, with no
  // paid DataForSEO market-volume upgrade (cron's runHistoricalVolume is dropped).
  // computePeakCalendar treats an empty volume map as "unconfirmed" (archive-only
  // confidence), never an error, so this stays a pure compute-over-synced-data pass.
  await step("peak-calendar", async () => {
    const seasonal = await loadSeasonalQueries(tenantId);
    const calendar = computePeakCalendar(seasonal, new Map());
    await writePeakCalendar({
      tenant_id: tenantId,
      computed_at: new Date().toISOString(),
      calendar,
    });
  });

  // Refresh production line: rank pages losing clicks quarter over quarter, build
  // each queued page's evidence brief, persist the queue (Today Demand band +
  // daily plan builder read it at $0).
  await step("refresh-queue", async () => {
    const deltas = await loadQuarterlyDecayForTenant(tenantId);
    const ranked = rankRefreshCandidates(deltas, { limit: 8 });
    const queue = await loadRefreshBriefsForTenant(tenantId, ranked);
    await writeRefreshQueueSummary({
      tenant_id: tenantId,
      computed_at: new Date().toISOString(),
      pagesConsidered: deltas.length,
      queue,
    });
  });

  // Algorithm-weather guard: a CUSUM changepoint pass over tonight's sitewide daily
  // GSC totals so Results can caveat any verdict whose window overlapped a shock.
  await step("algorithm-weather", async () => {
    const totals = await loadDailyTotalsForTenant(tenantId, 90);
    const clicksChangepoints = detectChangepoints(totals.map((d) => ({ date: d.date, value: d.clicks })));
    const impressionsChangepoints = detectChangepoints(totals.map((d) => ({ date: d.date, value: d.impressions })));
    await writeAlgorithmWeatherSummary({
      tenant_id: tenantId,
      computed_at: new Date().toISOString(),
      anchor_date: totals.length > 0 ? totals[totals.length - 1]!.date : null,
      clicksChangepoints,
      impressionsChangepoints,
    });
  });

  // External-event ledger: one honest-context ledger (Google updates + detected
  // sitewide shocks + connector outages + own-site change clusters). Reuses the
  // shocks recomputed from the same series; reads deadman + proof ledger at $0.
  await step("external-event-ledger", async () => {
    const totals = await loadDailyTotalsForTenant(tenantId, 90);
    const dailySeries = totals.map((d) => ({ date: d.date, value: d.clicks }));
    const shockWindows = buildShockWindows({ dailySeries });
    const deadman = await loadDeadmanVerdict(tenantId).catch(() => null);
    const nowIso = new Date().toISOString();
    const outageSignals: OutageSignal[] = (deadman?.jobs ?? [])
      .filter((j) => j.pace === "stalled")
      .map((j) => ({ label: j.sentence ?? j.label, lastRunAt: j.lastRunAt, observedAt: nowIso, severe: true }));
    const proofLedger = await loadProofLedger(tenantId).catch(() => []);
    const shippedChanges = proofLedger.map((r) => ({ path: r.path, shippedAt: r.shippedAt }));
    const events = buildExternalEventLedger({ shockWindows, outageSignals, shippedChanges, dailySeries });
    await writeExternalEventLedger({
      tenant_id: tenantId,
      computed_at: nowIso,
      anchor_date: totals.length > 0 ? totals[totals.length - 1]!.date : null,
      events,
    });
  });

  // A/A calibration: Beacon's own false-positive rate on pages it never touched.
  await step("aa-calibration", async () => {
    await runAaCalibrationForTenant(tenantId);
  });

  // Recommendation queue hygiene: retire machine-created rows that are stale,
  // overflow the bounded queue, or whose latest crawl proves the change is live.
  await step("queue-hygiene", async () => {
    await demoteResolvedForTenant(tenantId);
    await sweepQueueForTenant(tenantId);
  });

  // Auth-failure escalation: when a source has failed N nights spanning >= M days,
  // stamp the needs-attention marker so /settings/connectors prompts a reconnect.
  await step("auth-escalation", async () => {
    await evaluateAuthEscalationForTenant(tenantId);
  });

  // Site uptime probe: one polite HEAD/GET on the homepage so the deadman verdict
  // can say "your site did not answer" when it is down. Runs past the deadline.
  await step(
    "site-uptime",
    async () => {
      const url = tenant ? homepageUrlForDomain(tenant.domain) : null;
      if (url == null) return;
      const outcome = await probeHomepage(url);
      await recordSiteProbe({
        tenant_id: tenantId,
        url,
        checked_at: new Date().toISOString(),
        ok: outcome.ok,
        status: outcome.status,
        ttfb_ms: outcome.ttfbMs,
        error: outcome.error,
      });
    },
    false,
  );

  // Profile self-heal: re-derive business type + services + service areas from the
  // now-current substrates and fill only genuinely-empty config holes.
  await step("profile-self-heal", async () => {
    if (!tenant) return;
    const r = await refreshTenantProfile({ tenantId, currentSegment: tenant.segment });
    if (r.segmentChanged && r.segment) {
      await updateTenant(tenantId, { segment: r.segment });
    }
  });

  // Pipeline invariants watchdog: assert each stage produced rows + 48h freshness
  // and persist the result for the Today Ops card. Runs past the deadline (this is
  // the guard against the silent-empty failure class).
  await step(
    "pipeline-invariants",
    async () => {
      const readings = await gatherPipelineReadings(tenantId);
      const violations = checkPipelineInvariants(readings);
      await writePipelineHealth(buildPipelineHealthRow(readings, violations));
    },
    false,
  );

  // Forensic investigation: when a page family's clicks collapsed or the sitewide
  // changepoint detector found a high-magnitude drop, run a bounded, polite live
  // fetch (max 3 pages) + $0 cached-SERP / ledger / weather reads and file a
  // ranked-cause diagnosis. Bounded + idempotent, so it runs past the deadline.
  await step(
    "forensic-investigation",
    async () => {
      await runInvestigationForTenant(tenantId, now);
    },
    false,
  );

  return result;
}
