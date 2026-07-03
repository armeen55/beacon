/**
 * activity-stream (R14a, P1 trust receipts, 2026-07-03) - the PURE composer behind
 * /activity: ONE reverse-chronological stream answering "what has Beacon done while
 * I was away", composed from EXISTING stores only (no new writes anywhere):
 *
 *   - shipped changes (proof ledger rows) with WHO shipped them (autopilot vs you),
 *   - plan accept / abandon events (the daily-experiment plan store's own stamps),
 *   - cron receipts (plain job names from cron-schedule-map, never a raw key),
 *   - repeated failures ONLY above the existing spike floor (error-spike.ts's rule),
 *   - connection events (a connector's own connected_at / auth_failed_at stamps).
 *
 * Every row: when, what, one plain sentence, a deep link. Pure over adapted inputs
 * so it unit-tests from fixtures; the server loader (activity-data.ts) does the
 * deadline-bounded reads.
 */

import { findScheduleForJob } from "@/domains/ops/cron-schedule-map";
import { buildErrorSpikeLine } from "@/domains/ops/error-spike";
import type { AppErrorRow } from "@/lib/obs/error-ledger";

export type ActivityKind = "shipped" | "plan" | "cron" | "errors" | "connection" | "spend";

export type ActivityEvent = {
  /** ISO timestamp (sort key, newest first). */
  at: string;
  kind: ActivityKind;
  /** Short plain what ("Change live on /persian-cats", "Nightly data sync"). */
  title: string;
  /** One plain first-person sentence. */
  sentence: string;
  /** Where to see the full story. */
  href: string;
  /** Label for the deep link ("See the result"). */
  linkLabel: string;
};

// ── adapted input shapes (structural, so tests fixture them in five lines) ──

export type ShippedInput = {
  id: string;
  path: string;
  actionType: string;
  shippedAt: string;
  verifiedLive: boolean;
};

export type AutopilotReceiptInput = {
  url: string;
  shippedAt: string;
  result: "pushed" | "failed";
  kind?: "ship" | "revert";
};

export type PlanInput = {
  date: string;
  selectedCount: number;
  estimatedMinutes: number;
  acceptedAt?: string | null;
  abandonedAt?: string | null;
};

export type CronRunInput = {
  job: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  ok: boolean;
};

export type ConnectionInput = {
  /** Plain provider name ("Google Search Console"), never a raw key. */
  label: string;
  connectedAt?: string | null;
  authFailedAt?: string | null;
};

/** R14b - one llm_budget_ledger day row (tenant, day, platform grain). */
export type SpendInput = {
  /** YYYY-MM-DD ledger day. */
  dateUtc: string;
  /** Raw platform key ("dataforseo-serp"); mapped to plain words here, never rendered raw. */
  platform: string;
  spentUsd: number;
  promptCount: number;
  /** Row's own update stamp when present (better sort position than the bare day). */
  updatedAt?: string | null;
};

export type ActivityInputs = {
  shipped: ShippedInput[];
  autopilotReceipts: AutopilotReceiptInput[];
  plans: PlanInput[];
  cronRuns: CronRunInput[];
  errorRows: AppErrorRow[];
  connections: ConnectionInput[];
  /** R14b - optional so existing fixtures keep compiling; absent = no spend rows. */
  spend?: SpendInput[];
};

/** Mirrors /results' PLAIN_ACTION so the same change never wears two names. */
const PLAIN_ACTION: Record<string, string> = {
  edit_meta: "description change",
  edit_title: "title change",
  add_answer_block: "direct answer",
  add_internal_link: "internal link",
  add_schema: "structured data",
};
export function plainActionLabel(actionType: string): string {
  return PLAIN_ACTION[actionType] ?? actionType.replace(/_/g, " ");
}

function stripToPath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return (url.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/[?#].*$/, "") || "/";
  }
}

function validAt(at: string | null | undefined): at is string {
  return typeof at === "string" && Number.isFinite(Date.parse(at));
}

/** "job-key" -> "Job key" for a cron job the schedule map does not know. */
function humanizeJob(job: string): string {
  const words = job.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ── R14b spend rows: plain purpose words per ledger platform, never a raw key ──

const SPEND_PURPOSE: Record<string, { title: string; doing: string; unit: string }> = {
  "dataforseo-serp": {
    title: "Live Google results check",
    doing: "checking live Google results",
    unit: "keyword",
  },
  openai: { title: "AI drafting", doing: "drafting and checking copy with AI", unit: "draft" },
  "adjudicator-openai": {
    title: "Draft quality check",
    doing: "double-checking draft quality",
    unit: "check",
  },
  perplexity: { title: "AI answer check", doing: "checking AI answers", unit: "question" },
};
const SPEND_FALLBACK = { title: "Outside data check", doing: "on outside data checks", unit: "check" };

/** "$0.03", or "under a cent" below a displayable cent - never a lying $0.00. */
export function spendAmountLabel(usd: number): string {
  return usd < 0.005 ? "under a cent" : `$${usd.toFixed(2)}`;
}

/** The one plain spend sentence: what it cost and what it bought. Exported for tests. */
export function spendSentence(row: SpendInput): string {
  const purpose = SPEND_PURPOSE[row.platform] ?? SPEND_FALLBACK;
  const amount = spendAmountLabel(row.spentUsd);
  const bought =
    row.promptCount > 0 && purpose !== SPEND_FALLBACK
      ? ` for ${row.promptCount} ${purpose.unit}${row.promptCount === 1 ? "" : "s"}`
      : "";
  return `I spent ${amount} ${purpose.doing}${bought}. Every paid call is logged before it runs.`;
}

/** PURE: compose + sort the unified stream, newest first. */
export function composeActivityStream(inputs: ActivityInputs, now: Date): ActivityEvent[] {
  const events: ActivityEvent[] = [];

  // WHO shipped it: a PUSHED autopilot receipt (ship or its corrective revert) on the
  // same path + same day means Beacon put it live itself; everything else was the
  // operator's own hands. Failed receipts never claim credit.
  const autopilotShipped = new Set(
    inputs.autopilotReceipts
      .filter((r) => r.result === "pushed" && validAt(r.shippedAt))
      .map((r) => `${stripToPath(r.url)}::${r.shippedAt.slice(0, 10)}`),
  );

  for (const rec of inputs.shipped) {
    if (!validAt(rec.shippedAt)) continue;
    const byAutopilot = autopilotShipped.has(`${rec.path}::${rec.shippedAt.slice(0, 10)}`);
    const label = plainActionLabel(rec.actionType);
    events.push({
      at: rec.shippedAt,
      kind: "shipped",
      title: `Change live on ${rec.path}`,
      sentence: byAutopilot
        ? `I shipped a ${label} on ${rec.path} myself and I am measuring it against similar pages.`
        : `You shipped a ${label} on ${rec.path}${rec.verifiedLive ? ", confirmed live" : ""}, and I am measuring it against similar pages.`,
      href: `/results#proof-${rec.id}`,
      linkLabel: "See the result",
    });
  }

  for (const plan of inputs.plans) {
    if (validAt(plan.acceptedAt)) {
      events.push({
        at: plan.acceptedAt,
        kind: "plan",
        title: "You approved the day's plan",
        sentence: `You approved ${plan.selectedCount} change${plan.selectedCount === 1 ? "" : "s"} for ${plan.date}, about ${plan.estimatedMinutes} minutes of work.`,
        href: "/#daily-experiments",
        linkLabel: "Open Today",
      });
    }
    if (validAt(plan.abandonedAt)) {
      events.push({
        at: plan.abandonedAt,
        kind: "plan",
        title: "You cleared a suggested plan",
        sentence: `You cleared the ${plan.selectedCount}-change plan I suggested for ${plan.date} before approving it.`,
        href: "/#daily-experiments",
        linkLabel: "Open Today",
      });
    }
  }

  for (const run of inputs.cronRuns) {
    const at = validAt(run.finished_at) ? run.finished_at : run.started_at;
    if (!validAt(at)) continue;
    const label = findScheduleForJob(run.job)?.label ?? humanizeJob(run.job);
    const seconds = Math.max(1, Math.round((run.duration_ms ?? 0) / 1000));
    events.push({
      at,
      kind: "cron",
      title: label,
      sentence: run.ok
        ? `This ran on schedule and took ${seconds} second${seconds === 1 ? "" : "s"}.`
        : `This run failed. I keep the full receipt on the source health page.`,
      href: "/settings/health",
      linkLabel: "Source health",
    });
  }

  // Repeated failures join ONLY above the existing spike floor (error-spike.ts:
  // 10+ in 24h) - a handful of transient failures is weather, not a fire, and
  // this stream must never cry wolf where Today stays quiet.
  const spikeLine = buildErrorSpikeLine(inputs.errorRows, now);
  if (spikeLine != null) {
    const newest = inputs.errorRows
      .map((r) => r.at)
      .filter(validAt)
      .sort()
      .at(-1);
    if (newest) {
      events.push({
        at: newest,
        kind: "errors",
        title: "Repeated failures",
        sentence: spikeLine,
        href: "/diagnostics/errors",
        linkLabel: "See details",
      });
    }
  }

  // R14b spend-to-outcome: each ledger day-row joins the stream as one plain
  // "I spent $X doing Y" receipt next to what it bought. Zero-dollar rows never
  // render (a $0.00 row is bookkeeping, not an action worth a stream entry).
  for (const s of inputs.spend ?? []) {
    if (!(s.spentUsd > 0)) continue;
    const at = validAt(s.updatedAt)
      ? s.updatedAt
      : /^\d{4}-\d{2}-\d{2}$/.test(s.dateUtc)
        ? `${s.dateUtc}T12:00:00.000Z`
        : null;
    if (!at) continue;
    const purpose = SPEND_PURPOSE[s.platform] ?? SPEND_FALLBACK;
    events.push({
      at,
      kind: "spend",
      title: purpose.title,
      sentence: spendSentence(s),
      href: "/settings/spend",
      linkLabel: "See all spend",
    });
  }

  for (const conn of inputs.connections) {
    if (validAt(conn.connectedAt)) {
      events.push({
        at: conn.connectedAt,
        kind: "connection",
        title: `${conn.label} connected`,
        sentence: `You connected ${conn.label}. Its data feeds every recommendation I make.`,
        href: "/settings/connectors",
        linkLabel: "Connections",
      });
    }
    if (validAt(conn.authFailedAt)) {
      events.push({
        at: conn.authFailedAt,
        kind: "connection",
        title: `${conn.label} needs a reconnect`,
        sentence: `${conn.label} lost its authorization. Reconnect it so I keep getting fresh data.`,
        href: "/settings/connectors",
        linkLabel: "Reconnect",
      });
    }
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// ── paging (the page shows 50 per screen) ──

export const ACTIVITY_PAGE_SIZE = 50;

export type ActivityPage = {
  rows: ActivityEvent[];
  page: number;
  pageCount: number;
  total: number;
};

export function pageActivityEvents(
  events: ReadonlyArray<ActivityEvent>,
  page: number,
  pageSize: number = ACTIVITY_PAGE_SIZE,
): ActivityPage {
  const total = events.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return {
    rows: events.slice((clamped - 1) * pageSize, clamped * pageSize),
    page: clamped,
    pageCount,
    total,
  };
}
