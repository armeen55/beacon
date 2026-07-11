import "server-only";

/**
 * activity-data (R14a, 2026-07-03) - the server loader for /activity. READ-ONLY +
 * fail-soft + deadline-bounded: every source is an EXISTING store (no new writes),
 * each read races its own deadline so one wedged read can never hold the page, and
 * any source that misses its deadline simply contributes nothing this visit.
 */

import { currentTenantId } from "@/lib/tenant-context";
import { valueWithDeadline } from "@/lib/load-with-deadline";
import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { getAutopilotState } from "@/domains/autopilot/autopilot-store";
import { listPlans } from "@/domains/experiments/daily-experiment-plan-store";
import { listKnownJobs, listRecentCronRuns, type CronRunRow } from "@/domains/ops/cron-runs-store";
import { listAppErrorsForTenant, type AppErrorRow } from "@/lib/obs/error-ledger";
import { getConnectorInfo, type ConnectorProvider } from "@/lib/connector-store";
import { readRecentSpendRows, type SpendActivityRow } from "@/lib/cost/budget-ledger-supabase";
import {
  composeActivityStream,
  type ActivityEvent,
  type ActivityInputs,
  type ConnectionInput,
} from "@/domains/activity/activity-stream";

const SOURCE_DEADLINE_MS = 5_000;
/** Bound the cron read: at most this many distinct jobs x runs each. */
const MAX_CRON_JOBS = 12;
const MAX_RUNS_PER_JOB = 20;
/** Plan events worth listing (the store returns newest-created first). */
const MAX_PLANS = 20;

/** The connectors whose token stamps become connection events, with their plain names. */
const CONNECTION_LABELS: ReadonlyArray<readonly [ConnectorProvider, string]> = [
  ["google_gsc", "Google Search Console"],
  ["google_ga4", "Google Analytics"],
  ["wix", "Wix"],
  ["clarity", "Microsoft Clarity"],
  ["profound", "AI answer tracking"],
];

async function loadCronRunsBounded(): Promise<CronRunRow[]> {
  const jobs = (await listKnownJobs()).slice(0, MAX_CRON_JOBS);
  const perJob = await Promise.all(
    jobs.map((job) => listRecentCronRuns(job, MAX_RUNS_PER_JOB).catch(() => [] as CronRunRow[])),
  );
  // Only completed runs become activity events. An unfinished "started" receipt
  // would otherwise render as a misleading failed event (ok defaults false,
  // duration 0) before the run has even finished.
  return perJob.flat().filter((r) => (r.phase ?? "finished") === "finished");
}

async function loadConnectionEvents(tenantId: string): Promise<ConnectionInput[]> {
  const infos = await Promise.all(
    CONNECTION_LABELS.map(async ([provider, label]) => {
      try {
        const info = await getConnectorInfo(provider, tenantId);
        return {
          label,
          // A "you connected X" row only while the connection is actually live -
          // a long-disconnected provider's old stamp would read as a lie.
          connectedAt: info.status === "connected" ? info.connected_at : null,
          authFailedAt: info.auth_failed_at ?? null,
        } satisfies ConnectionInput;
      } catch {
        return { label, connectedAt: null, authFailedAt: null } satisfies ConnectionInput;
      }
    }),
  );
  return infos;
}

/** R14b - how far back the spend join reads (the same 30-day frame /settings/spend uses). */
const SPEND_SINCE_DAYS = 30;

/** The composed stream, newest first. Fail-soft per source; never throws. */
export async function loadActivityEvents(now: Date = new Date()): Promise<ActivityEvent[]> {
  const tenantId = await currentTenantId();
  const [shipped, receipts, plans, cronRuns, errorRows, connections, spendRows] = await Promise.all([
    valueWithDeadline(loadShippedChanges().catch(() => []), [], SOURCE_DEADLINE_MS),
    valueWithDeadline(
      getAutopilotState()
        .then((s) => s.receipts)
        .catch(() => []),
      [],
      SOURCE_DEADLINE_MS,
    ),
    valueWithDeadline(listPlans(tenantId, MAX_PLANS).catch(() => []), [], SOURCE_DEADLINE_MS),
    valueWithDeadline(loadCronRunsBounded().catch(() => []), [], SOURCE_DEADLINE_MS),
    valueWithDeadline(
      listAppErrorsForTenant(tenantId).catch(() => [] as AppErrorRow[]),
      [] as AppErrorRow[],
      SOURCE_DEADLINE_MS,
    ),
    valueWithDeadline(loadConnectionEvents(tenantId).catch(() => []), [], SOURCE_DEADLINE_MS),
    valueWithDeadline(
      readRecentSpendRows(tenantId, SPEND_SINCE_DAYS).catch(() => [] as SpendActivityRow[]),
      [] as SpendActivityRow[],
      SOURCE_DEADLINE_MS,
    ),
  ]);

  const inputs: ActivityInputs = {
    shipped: shipped.map((r) => ({
      id: r.id,
      path: r.path,
      actionType: r.actionType,
      shippedAt: r.shippedAt,
      verifiedLive: r.verifiedLive,
    })),
    autopilotReceipts: receipts.map((r) => ({
      url: r.url,
      shippedAt: r.shippedAt,
      result: r.result,
      kind: r.kind,
    })),
    plans: plans.map((p) => ({
      date: p.date,
      selectedCount: p.selected.length,
      estimatedMinutes: p.estimatedMinutes,
      acceptedAt: p.acceptedAt ?? null,
      abandonedAt: p.abandonedAt ?? null,
    })),
    cronRuns: cronRuns.map((r) => ({
      job: r.job,
      started_at: r.started_at,
      finished_at: r.finished_at,
      duration_ms: r.duration_ms,
      ok: r.ok,
    })),
    errorRows,
    connections,
    // R14b spend-to-outcome: the llm_budget_ledger day rows join the stream as
    // plain "I spent $X doing Y" receipts. Read-only, same 30-day frame as
    // /settings/spend, fail-soft like every other source above.
    spend: spendRows.map((s) => ({
      dateUtc: s.dateUtc,
      platform: s.platform,
      spentUsd: s.spentUsd,
      promptCount: s.promptCount,
      updatedAt: s.updatedAt,
    })),
  };
  return composeActivityStream(inputs, now);
}
