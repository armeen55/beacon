import "server-only";

/**
 * measure-pass (CORE 100K) - the GSC before/after comparison engine. Reads the
 * treated page + its comparison pages over the pre-ship window and each 7/14/28
 * post window via the existing GSC connector reads (gsc-window), computes the
 * observational diff in diff, and stamps the record's windows + a stored verdict
 * from the kernel. Replaces the retired run-measurement/measure stack.
 *
 * Observational, never causal: adjustedLift = (treatedPost - treatedPre) -
 * mean(controlPost - controlPre). No permutation nulls, FDR, calibration
 * self-tests, or forecast machinery.
 */

import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  loadPageSurgeonContext,
  assemblePacketForUrl,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import { loadPageSurgeonForUrl } from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import { readWindowForPages, readLastFinalizedDate } from "./gsc-window";
import {
  BASELINE_WINDOW_DAYS,
  PROOF_WINDOW_DAYS,
  type GscWindowMetrics,
  type ProofMetric,
  type ProofWindowDay,
  type ProofWindowResult,
} from "./types";
import type { ShippedChangeRecord } from "./shipped-change-store";
import { addDays, evaluateWindows, metricFor, readLedger } from "./kernel";

const NULL_METRICS: GscWindowMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

/** GSC's reporting zone is Pacific; default a ship date to that day. */
export function defaultPacificShipDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function dateOnly(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

function toPath(u: string): string {
  return u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const mean = (xs: number[]): number => (xs.length > 0 ? xs.reduce((s, d) => s + d, 0) / xs.length : 0);
const ctrDelta = (m0: GscWindowMetrics, m1: GscWindowMetrics): number =>
  m0.impressions > 0 && m1.impressions > 0 ? m1.ctr - m0.ctr : 0;
const posImprove = (m0: GscWindowMetrics, m1: GscWindowMetrics): number =>
  m0.position > 0 && m1.position > 0 ? m0.position - m1.position : 0;

/** Snippet plays move CTR, rank plays move position, else clicks. */
export function pickProofMetric(actionType: string): ProofMetric {
  return metricFor(actionType);
}

/**
 * One window's observational diff in diff from already-read treated + control
 * window metrics. Pure. Pre clicks are pro-rated to the post window length so a
 * 28-day pre sum is never subtracted from a 7-day post sum.
 */
export function computeWindowLift(args: {
  day: ProofWindowDay;
  checkOn: string;
  ran: boolean;
  treatedPre: GscWindowMetrics;
  treatedPost: GscWindowMetrics;
  controls: ReadonlyArray<{ pre: GscWindowMetrics; post: GscWindowMetrics }>;
  preWindowDays?: number;
}): ProofWindowResult {
  const { treatedPre, treatedPost, controls } = args;
  if (!args.ran) {
    return {
      day: args.day, checkOn: args.checkOn, ran: false,
      treatedDelta: 0, controlDelta: 0, adjustedLift: 0,
      treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0,
      treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0,
      controlsUsed: 0, treatedPostImpressions: 0,
      treatedImpressionsDelta: 0, controlImpressionsDelta: 0, adjustedImpressionsLift: 0,
    };
  }
  const preDays = args.preWindowDays ?? args.day;
  const scale = preDays > 0 ? args.day / preDays : 1;
  const scaledPre = (m: GscWindowMetrics) => m.clicks * scale;
  const treatedDelta = treatedPost.clicks - scaledPre(treatedPre);
  const treatedCtr = ctrDelta(treatedPre, treatedPost);
  const treatedPos = posImprove(treatedPre, treatedPost);
  const treatedImpr = treatedPost.impressions - treatedPre.impressions * scale;
  const controlDelta = mean(controls.map((c) => c.post.clicks - scaledPre(c.pre)));
  const controlCtr = mean(controls.map((c) => ctrDelta(c.pre, c.post)));
  const controlPos = mean(controls.map((c) => posImprove(c.pre, c.post)));
  const controlImpr = mean(controls.map((c) => c.post.impressions - c.pre.impressions * scale));
  return {
    day: args.day, checkOn: args.checkOn, ran: true,
    treatedDelta, controlDelta: round2(controlDelta), adjustedLift: round2(treatedDelta - controlDelta),
    treatedCtrDelta: round4(treatedCtr), controlCtrDelta: round4(controlCtr), adjustedCtrLift: round4(treatedCtr - controlCtr),
    treatedPosDelta: round2(treatedPos), controlPosDelta: round2(controlPos), adjustedPosLift: round2(treatedPos - controlPos),
    controlsUsed: controls.length, treatedPostImpressions: treatedPost.impressions,
    treatedImpressionsDelta: round2(treatedImpr), controlImpressionsDelta: round2(controlImpr),
    adjustedImpressionsLift: round2(treatedImpr - controlImpr),
  };
}

/** Map the kernel's live directional read to the stored verdict vocabulary. */
function storedVerdictFor(record: ShippedChangeRecord, now: Date, lastFinal: string | null): {
  verdict: ShippedChangeRecord["verdict"];
  confidence: ShippedChangeRecord["confidence"];
} {
  const read = readLedger([record], now, lastFinal)[0];
  const confidence = read.confidence;
  switch (read.verdict) {
    case "directional_improvement":
    case "stronger_improvement":
      return { verdict: "won", confidence };
    case "directional_decline":
      return { verdict: "lost", confidence };
    case "no_clear_movement":
      return { verdict: "inconclusive", confidence };
    case "insufficient_evidence":
      return { verdict: "insufficient_data", confidence };
    default:
      return { verdict: "measuring", confidence };
  }
}

/**
 * Recompute the 7/14/28-day outcome for a shipped change from GSC. Reads the pre
 * window once and each post window once, for the treated page + all controls.
 * Returns a NEW record with windows/verdict/confidence/measuredAt updated. A
 * control that is itself an active treatment can be excluded from the diff.
 */
export async function measureRecord(
  tenantId: string,
  record: ShippedChangeRecord,
  now: Date = new Date(),
  lastFinalizedDate?: string | null,
  excludeControlPaths: Set<string> = new Set(),
): Promise<ShippedChangeRecord> {
  const shipDate = dateOnly(record.shippedAt);
  const lastFinal = lastFinalizedDate !== undefined ? lastFinalizedDate : await readLastFinalizedDate(tenantId);
  const controlPages = record.controlPages.filter((c) => !excludeControlPaths.has(toPath(c)));
  const pages = [record.page, ...controlPages];

  const preStart = addDays(shipDate, -BASELINE_WINDOW_DAYS);
  const pre = await readWindowForPages({ tenantId, pages, start: preStart, end: shipDate });

  const windowStates = evaluateWindows(record.shippedAt, now, lastFinal);
  const windows: ProofWindowResult[] = [];
  for (const day of PROOF_WINDOW_DAYS) {
    const state = windowStates.find((w) => w.day === day)!;
    const checkOn = addDays(shipDate, day);
    const ran = state.state === "closed";
    const post = ran ? await readWindowForPages({ tenantId, pages, start: shipDate, end: addDays(shipDate, day) }) : null;
    const treatedPre = pre.get(record.page) ?? NULL_METRICS;
    const treatedPost = post?.get(record.page) ?? NULL_METRICS;
    const controls = controlPages
      .map((c) => ({ pre: pre.get(c) ?? NULL_METRICS, post: post?.get(c) ?? NULL_METRICS }))
      .filter((c) => c.pre.impressions > 0 && (!ran || c.post.impressions > 0));
    windows.push(
      computeWindowLift({ day, checkOn, ran, treatedPre, treatedPost, controls, preWindowDays: BASELINE_WINDOW_DAYS }),
    );
  }

  const measured: ShippedChangeRecord = {
    ...record,
    windows,
    measuredAt: windows.some((w) => w.ran) ? now.toISOString() : record.measuredAt,
    updatedAt: now.toISOString(),
  };
  const { verdict, confidence } = storedVerdictFor(measured, now, lastFinal);
  // Operator "exclude from learning" pins the stored verdict to inconclusive.
  measured.verdict = record.operatorVerdictOverride === "inconclusive" ? "inconclusive" : verdict;
  measured.confidence = confidence;
  return measured;
}

/**
 * Pull the human context for a shipped change from the cached Page Surgeon
 * context + pack: canonical page, path, before/after text + headline action, and
 * the page's top target queries. Best-effort; every field degrades to null/[].
 */
export async function captureChangeMeta(
  tenantId: string,
  pageUrl: string,
): Promise<{ canonPage: string; path: string; before: string | null; after: string | null; targetQueries: string[]; headlineAction: string | null }> {
  let canonPage = canonicalizeCitationUrl(pageUrl) ?? pageUrl;
  const path = toPath(canonPage);
  let targetQueries: string[] = [];
  try {
    const ctx = await loadPageSurgeonContext(tenantId);
    if (!ctx.gscByUrl.has(canonPage) && !ctx.snapshotByCanon.has(canonPage)) {
      const match = [...ctx.gscByUrl.keys(), ...ctx.snapshotByCanon.keys()].find((k) => toPath(k) === path) ?? null;
      if (match) canonPage = match;
    }
    const packet = assemblePacketForUrl(ctx, canonPage);
    targetQueries = (packet.gsc?.topQueries ?? []).slice(0, 5).map((q) => q.query);
  } catch {
    /* best-effort */
  }
  let before: string | null = null;
  let after: string | null = null;
  let headlineAction: string | null = null;
  try {
    const ps = await loadPageSurgeonForUrl(tenantId, pageUrl, { history: false });
    if (ps.status === "pack") {
      headlineAction = ps.pack.headlineAction;
      before = ps.pack.bundle.primary?.before ?? null;
      after = ps.pack.bundle.primary?.after ?? null;
    }
  } catch {
    /* best-effort */
  }
  return { canonPage, path, before, after, targetQueries, headlineAction };
}

/**
 * Capture a 28-day baseline + create the ledger record for a manually-shipped
 * change, then measure it immediately. Preserves the (path, ship-date) id.
 */
export async function recordShippedChange(args: {
  tenantId: string;
  page: string;
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  targetQueries: string[];
  controlPages: string[];
  shippedAt?: string;
  notes?: string | null;
  verifiedLive?: boolean;
  liveSourceUrl?: string | null;
  now?: Date;
}): Promise<ShippedChangeRecord> {
  const now = args.now ?? new Date();
  const shippedAt = args.shippedAt ?? defaultPacificShipDate(now);
  const shipDate = dateOnly(shippedAt);
  const preStart = addDays(shipDate, -BASELINE_WINDOW_DAYS);
  const pre = await readWindowForPages({ tenantId: args.tenantId, pages: [args.page], start: preStart, end: shipDate });
  const base = pre.get(args.page) ?? NULL_METRICS;
  const draft: ShippedChangeRecord = {
    id: `${args.path}::${shipDate}`,
    page: args.page,
    path: args.path,
    actionType: args.actionType,
    before: args.before,
    after: args.after,
    shippedAt,
    baseline: { ...base, windowDays: BASELINE_WINDOW_DAYS },
    targetQueries: args.targetQueries,
    controlPages: args.controlPages,
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: args.notes ?? null,
    verifiedLive: args.verifiedLive ?? false,
    liveSourceUrl: args.liveSourceUrl ?? null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return measureRecord(args.tenantId, draft, now);
}
