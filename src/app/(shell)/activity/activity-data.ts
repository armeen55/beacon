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
import { CONNECTOR_REGISTRY } from "@/lib/connectors/registry";
import { readRecentSpendRows, type SpendActivityRow } from "@/lib/cost/budget-ledger-supabase";
import {
  listRecentRefreshRuns,
  type RefreshRunRow,
  type RefreshSource,
} from "@/domains/ops/refresh-runs-store";
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

/** The connectors whose token stamps become connection events, with their plain
 *  names. The four live connectors read their activity label from the ONE
 *  connector registry; profound stays as a legacy entry so historical profound
 *  connection events still render (it is a stored-row provider, not a live
 *  registry connector). */
const CONNECTION_LABELS: ReadonlyArray<readonly [ConnectorProvider, string]> = [
  ...CONNECTOR_REGISTRY.map((c) => [c.id, c.activityLabel] as const),
  ["profound", "AI answer tracking"] as const,
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

/**
 * Certified-fix 2026-07-20 (defect 2): the daily refresh_runs pulls (Search
 * Console / Analytics / Clarity / AI answer tracking) were never surfaced on
 * /activity, so the freshest visible rows were repeated sub-cent "Draft
 * quality check" spend lines - the LEAST interesting thing Beacon does,
 * standing in for the most. Each source's actual data pull now joins the
 * stream as its own honest receipt.
 */

/** Plain, customer-known source names - never the raw refresh_runs source key. */
const REFRESH_SOURCE_LABEL: Record<RefreshSource, string> = {
  gsc: "Search Console",
  ga4: "Analytics",
  clarity: "Clarity",
  profound: "AI answer tracking",
};

/** How far back a refresh pull is worth showing; older pulls are superseded
 *  by fresher ones and just add noise. */
const REFRESH_LOOKBACK_DAYS = 7;
/** Headroom over REFRESH_LOOKBACK_DAYS x 4 sources so a busy retry day still
 *  fits before the date filter below trims it. */
const MAX_REFRESH_ROWS_FETCHED = 200;

function shortDateLabel(dateUtc: string): string {
  const ms = Date.parse(`${dateUtc}T00:00:00Z`);
  if (!Number.isFinite(ms)) return dateUtc;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** One plain first-person sentence per refresh outcome. Exported for tests. */
export function refreshRunSentence(row: RefreshRunRow): string {
  const label = REFRESH_SOURCE_LABEL[row.source];
  const dataThrough = row.latest_data_date ? shortDateLabel(row.latest_data_date) : null;
  if (row.result === "failed") {
    return `The ${label} pull did not work. I keep retrying.`;
  }
  if (row.result === "partial") {
    return `The ${label} pull ran but found no new data${dataThrough ? ` since ${dataThrough}` : ""}.`;
  }
  if (row.rows_persisted != null && row.rows_persisted > 0) {
    const rows = row.rows_persisted.toLocaleString("en-US");
    return `I pulled fresh ${label} data: ${rows} row${row.rows_persisted === 1 ? "" : "s"}${dataThrough ? ` through ${dataThrough}` : ""}.`;
  }
  return `I checked ${label}. Nothing new${dataThrough ? ` since ${dataThrough}` : ""}.`;
}

function refreshRunTitle(row: RefreshRunRow): string {
  const label = REFRESH_SOURCE_LABEL[row.source];
  if (row.result === "failed") return `${label} pull failed`;
  if (row.result === "ok" && row.rows_persisted != null && row.rows_persisted > 0) {
    return `${label} data refreshed`;
  }
  return `${label} checked`;
}

function refreshRunToEvent(row: RefreshRunRow): ActivityEvent {
  return {
    at: row.finished_at,
    // Reuses the existing "cron" kind: like a cron_runs row, this is honest
    // background-job receipt copy, not a new taxonomy the list needs to know
    // about (ActivityKind stays owned by activity-stream.ts).
    kind: "cron",
    title: refreshRunTitle(row),
    sentence: refreshRunSentence(row),
    href: "/settings/connectors",
    linkLabel: "Connections",
  };
}

/** Bounded, fail-soft read of the last REFRESH_LOOKBACK_DAYS of data pulls,
 *  collapsed to one entry per (source, day) so a source that retries several
 *  times in one day can't spam the feed the same way the spend rows used to. */
async function loadRefreshActivity(tenantId: string, now: Date): Promise<ActivityEvent[]> {
  const rows = await listRecentRefreshRuns(tenantId, { limit: MAX_REFRESH_ROWS_FETCHED });
  const cutoffMs = now.getTime() - REFRESH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const latestPerSourceDay = new Map<string, RefreshRunRow>();
  for (const row of rows) {
    if (!validAtDate(row.finished_at)) continue;
    const finishedMs = Date.parse(row.finished_at);
    if (finishedMs < cutoffMs) continue;
    const key = `${row.source}::${row.finished_at.slice(0, 10)}`;
    const existing = latestPerSourceDay.get(key);
    if (!existing || finishedMs > Date.parse(existing.finished_at)) {
      latestPerSourceDay.set(key, row);
    }
  }
  return Array.from(latestPerSourceDay.values()).map(refreshRunToEvent);
}

function validAtDate(at: string | null | undefined): at is string {
  return typeof at === "string" && Number.isFinite(Date.parse(at));
}

/** The composed stream plus whether any underlying read failed this visit. A
 *  failed read must never masquerade as a genuinely empty stream (that would
 *  render "Nothing logged yet." while the truth is we could not look). */
export type ActivityFeed = {
  events: ActivityEvent[];
  anyReadFailed: boolean;
};

/** The composed stream, newest first. Fail-soft per source; never throws.
 *  Kept for callers (the CSV export) that only need the rows. */
export async function loadActivityEvents(now: Date = new Date()): Promise<ActivityEvent[]> {
  return (await loadActivityFeed(now)).events;
}

/** The composed stream plus a read-health flag, newest first. Fail-soft per
 *  source; never throws. Any source that throws flips `anyReadFailed` so the
 *  page can tell "nothing happened" apart from "I could not load your activity".
 */
export async function loadActivityFeed(now: Date = new Date()): Promise<ActivityFeed> {
  const tenantId = await currentTenantId();
  let anyReadFailed = false;
  const onFail = <T>(fallback: T) => (err: unknown): T => {
    anyReadFailed = true;
    void err;
    return fallback;
  };
  const [shipped, receipts, plans, cronRuns, errorRows, connections, spendRows, refreshEvents] =
    await Promise.all([
      valueWithDeadline(loadShippedChanges().catch(onFail([])), [], SOURCE_DEADLINE_MS),
      valueWithDeadline(
        getAutopilotState()
          .then((s) => s.receipts)
          .catch(onFail([])),
        [],
        SOURCE_DEADLINE_MS,
      ),
      valueWithDeadline(listPlans(tenantId, MAX_PLANS).catch(onFail([])), [], SOURCE_DEADLINE_MS),
      valueWithDeadline(loadCronRunsBounded().catch(onFail([])), [], SOURCE_DEADLINE_MS),
      valueWithDeadline(
        listAppErrorsForTenant(tenantId).catch(onFail([] as AppErrorRow[])),
        [] as AppErrorRow[],
        SOURCE_DEADLINE_MS,
      ),
      valueWithDeadline(loadConnectionEvents(tenantId).catch(onFail([])), [], SOURCE_DEADLINE_MS),
      valueWithDeadline(
        readRecentSpendRows(tenantId, SPEND_SINCE_DAYS).catch(onFail([] as SpendActivityRow[])),
        [] as SpendActivityRow[],
        SOURCE_DEADLINE_MS,
      ),
      valueWithDeadline(
        loadRefreshActivity(tenantId, now).catch(onFail([] as ActivityEvent[])),
        [] as ActivityEvent[],
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
  // Defect 2 fix: refreshEvents are already-built ActivityEvent rows (not part
  // of composeActivityStream's own ActivityInputs), so they join AFTER
  // composition and get re-sorted newest-first alongside it - the same rule
  // composeActivityStream itself sorts by.
  const events = [...composeActivityStream(inputs, now), ...refreshEvents].sort((a, b) =>
    a.at < b.at ? 1 : a.at > b.at ? -1 : 0,
  );
  return { events, anyReadFailed };
}
