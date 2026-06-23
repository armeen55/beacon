import "server-only";

/**
 * GSC Proof ledger — measurement orchestrator (Phase 5, Path B).
 *
 * Glues the GSC window reader (gsc-window.ts) to the pure math (measure.ts):
 *   • recordShippedChange: capture a baseline + create the ledger record.
 *   • measureRecord: read the pre + 7/14/28-day post windows for the treated page
 *     and its controls, compute the observational diff-in-diff, roll up a verdict.
 *
 * Pure math + thresholds live in measure.ts; this only does the GSC reads + wiring.
 * No publish. No paid calls (GSC is already synced). Fail-soft.
 */

import {
  loadPageSurgeonContext,
  assemblePacketForUrl,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import { loadPageSurgeonForUrl } from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { readWindowForPages, readLastFinalizedDate } from "./gsc-window";
import { readGa4WindowForPages, readLatestGa4Date } from "./ga4-window";
import { computeTrafficOutcome, type TrafficOutcome } from "./traffic-outcome";
import {
  addDays,
  computeWindowLift,
  pickProofMetric,
  isSnippetCapturePlay,
  proofCheckDates,
  summarizeVerdict,
  PROOF_WINDOW_DAYS,
  type GscWindowMetrics,
  type ProofWindowResult,
  type ProofWindowDay,
} from "./measure";
import type { ShippedChangeRecord } from "./shipped-change-store";
import type { GscProofVerdict } from "./measure";

const BASELINE_WINDOW_DAYS = 28;
/** Stand-in for a page/window with no Search reading (clicks 0 is valid; the
 *  CTR/position guards in computeWindowLift treat 0 impressions/position as
 *  "no data", so this never fakes a swing). */
const NULL_METRICS: GscWindowMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
const GA4_ZERO = { sessions: 0, engagedSessions: 0, conversions: 0 };

/**
 * Dollar-ROI proof (gap #1): the GA4 traffic + conversion outcome for a shipped
 * change, control-adjusted, ALONGSIDE the GSC search verdict. Picks the largest
 * proof window whose post period has settled GA4 data (GA4 settles in ~1-2 days,
 * far faster than GSC finalization); reports the smallest window as "measuring"
 * when none has settled. Fail-soft → null. Revenue is structurally absent here
 * (the GA4 connector returns none), so the outcome flags hasRevenue:false and
 * the UI shows conversion + traffic proof only, never money.
 */
async function computeGa4TrafficOutcome(
  tenantId: string,
  record: ShippedChangeRecord,
  shipDate: string,
  latestGa4: string | null,
): Promise<TrafficOutcome | null> {
  // Elapsed post window = ship..latestGa4 inclusive (GA4 settles in ~1-2 days),
  // capped at the largest proof window. windowDays = the ACTUAL elapsed days so
  // the pre window pro-rates fairly; ran = a full proof window has elapsed.
  const maxWindow = Math.max(...PROOF_WINDOW_DAYS);
  const minWindow = Math.min(...PROOF_WINDOW_DAYS);
  let elapsed = 0;
  if (latestGa4 != null && latestGa4 >= shipDate) {
    const diffDays = Math.round(
      (Date.parse(latestGa4) - Date.parse(shipDate)) / 86_400_000,
    );
    elapsed = Math.min(maxWindow, Math.max(0, diffDays) + 1); // inclusive of both ends
  }
  const ran = elapsed >= minWindow;
  const day = elapsed; // 0 → "measuring (no GA4 day since ship yet)"

  const pages = [record.page, ...record.controlPages];
  const preStart = addDays(shipDate, -BASELINE_WINDOW_DAYS);
  const [pre, post] = await Promise.all([
    readGa4WindowForPages({ tenantId, pages, start: preStart, end: shipDate }),
    elapsed > 0
      ? readGa4WindowForPages({ tenantId, pages, start: shipDate, end: addDays(shipDate, elapsed) })
      : Promise.resolve(new Map()),
  ]);

  // Only controls with real pre-window traffic anchor the diff-in-diff baseline.
  const controls = record.controlPages
    .filter((cp) => (pre.get(cp)?.sessions ?? 0) > 0)
    .map((cp) => ({ pre: pre.get(cp) ?? GA4_ZERO, post: post.get(cp) ?? GA4_ZERO }));

  return computeTrafficOutcome({
    windowDays: day,
    ran,
    preWindowDays: BASELINE_WINDOW_DAYS,
    treatedPre: pre.get(record.page) ?? GA4_ZERO,
    treatedPost: post.get(record.page) ?? GA4_ZERO,
    controls,
  });
}

function dateOnly(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

/**
 * audit-4: the DEFAULT treatment day must be a PACIFIC calendar date, because
 * every GSC date in the ledger (baseline + post windows, the finalized
 * watermark, the RPC's date filter) is Search-Console Pacific time. Defaulting
 * to `new Date().toISOString()` (UTC) anchored a change recorded in the US
 * evening (17:00–23:59 PT = 00:00–06:59 UTC next day) one calendar day LATE,
 * mis-filing a genuine post-change Pacific day into the baseline window and
 * biasing the diff-in-diff. en-CA renders YYYY-MM-DD; addDays/dateOnly accept
 * a date-only string. Exported so the dedup-clash check in proof/actions.ts
 * uses the SAME default and still collides correctly.
 */
export function defaultPacificShipDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function toPath(u: string): string {
  return u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
}

/**
 * Pull the human context for a shipped change from the cached Page Surgeon
 * context + pack: canonical page, path, the change's before/after text + headline
 * action (from the Change Pack), and the page's top target queries (from GSC).
 * Best-effort — every field degrades to null/[] on a miss. Reuses cached reads.
 */
export async function captureChangeMeta(
  tenantId: string,
  pageUrl: string,
): Promise<{
  canonPage: string;
  path: string;
  before: string | null;
  after: string | null;
  targetQueries: string[];
  headlineAction: string | null;
}> {
  // Start from the canonicalized input; a bare path (e.g. "/cities") won't
  // canonicalize, so resolve it to the real GSC/snapshot key by path-match below.
  let canonPage = canonicalizeCitationUrl(pageUrl) ?? pageUrl;
  const path = toPath(canonPage);

  let targetQueries: string[] = [];
  try {
    const ctx = await loadPageSurgeonContext(tenantId);
    if (!ctx.gscByUrl.has(canonPage) && !ctx.snapshotByCanon.has(canonPage)) {
      const match =
        [...ctx.gscByUrl.keys(), ...ctx.snapshotByCanon.keys()].find(
          (k) => toPath(k) === path,
        ) ?? null;
      // Resolve a path-only input to its canonical URL so GSC window reads hit.
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
 * Recompute the 7/14/28-day outcome for a shipped change from GSC. Reads the
 * pre-window once + each post-window once, for the treated page + all controls.
 * Returns a NEW record with windows/verdict/confidence/measuredAt updated.
 */
export async function measureRecord(
  tenantId: string,
  record: ShippedChangeRecord,
  now: Date = new Date(),
  /** Pre-read finalized-data watermark (loadProofLedger reads it once for the
   *  whole ledger). Pass `undefined` to have measureRecord read it itself. */
  lastFinalizedDate?: string | null,
): Promise<ShippedChangeRecord> {
  const shipDate = dateOnly(record.shippedAt);
  const lastFinal =
    lastFinalizedDate !== undefined ? lastFinalizedDate : await readLastFinalizedDate(tenantId);
  const pages = [record.page, ...record.controlPages];

  // Pre window: [ship − 28d, ship).
  const preStart = addDays(shipDate, -BASELINE_WINDOW_DAYS);
  const pre = await readWindowForPages({ tenantId, pages, start: preStart, end: shipDate });

  const checks = proofCheckDates(record.shippedAt);
  const windows: ProofWindowResult[] = [];
  for (const day of PROOF_WINDOW_DAYS) {
    const checkOn = checks[day as ProofWindowDay];
    // The window [shipDate, checkOn) is only judgeable once its LAST day
    // (checkOn − 1) has finalized GSC data. Gating on the finalized watermark
    // (not wall-clock `today >= checkOn`) prevents reading a short post window
    // — GSC finalizes with a multi-day lag and, crons being off, the watermark
    // can sit well behind today — which would bias the verdict toward "lost".
    const ran = lastFinal != null && lastFinal >= addDays(checkOn, -1);
    const postEnd = addDays(shipDate, day);
    const post = ran
      ? await readWindowForPages({ tenantId, pages, start: shipDate, end: postEnd })
      : null;

    const treatedPreM = pre.get(record.page) ?? NULL_METRICS;
    const treatedPostM = post?.get(record.page) ?? NULL_METRICS;

    // A control is usable when it had Search presence in the pre window AND
    // (once the window has run) still has presence in the post window. A control
    // that vanished post-ship (deindexed / zero post traffic) would otherwise
    // post a huge negative delta, dragging controlDelta down and INFLATING the
    // treated page's adjusted lift (a disappearing comparison page would falsely
    // read as the treated page "winning").
    const controls = record.controlPages
      .filter(
        (cp) =>
          (pre.get(cp)?.impressions ?? 0) > 0 &&
          (!ran || (post?.get(cp)?.impressions ?? 0) > 0),
      )
      .map((cp) => ({
        pre: pre.get(cp) ?? NULL_METRICS,
        post: post?.get(cp) ?? NULL_METRICS,
      }));

    windows.push(
      computeWindowLift({
        day: day as ProofWindowDay,
        checkOn,
        ran,
        treatedPre: treatedPreM,
        treatedPost: treatedPostM,
        controls,
        // The pre window is 28d but each post window is 7/14/28d — tell
        // computeWindowLift so it pro-rates the pre clicks to the post window.
        preWindowDays: BASELINE_WINDOW_DAYS,
      }),
    );
  }

  // Baseline impressions/clicks for the verdict gate come from the pre window
  // (refreshed here so it reflects real GSC, not just the recorded snapshot).
  const treatedPre = pre.get(record.page);
  const { verdict: computedVerdict, confidence } = summarizeVerdict({
    windows,
    baselineImpressions: treatedPre?.impressions ?? record.baseline.impressions,
    baselineClicks: treatedPre?.clicks ?? record.baseline.clicks,
    // The metric that actually measures this change type (CTR for a meta/title
    // test, position for a rank play, else clicks for coverage/new-content).
    metric: pickProofMetric(record.actionType),
    // Answer-block plays can win the snippet (CTR down, rank held) — don't read
    // that as a loss.
    snippetCapturePlay: isSnippetCapturePlay(record.actionType),
  });

  // Operator override: a mis-attributed "won"/"lost" (control contamination,
  // seasonal co-movement) can be PINNED to "inconclusive" so it drops out of
  // the per-action_type outcome prior that steers ranking. Applied AFTER the
  // GSC math (the numbers/windows still compute + display), and re-applied on
  // every measure so neither recompute nor on-load re-measurement clobbers it.
  const verdict: GscProofVerdict =
    record.operatorVerdictOverride === "inconclusive" ? "inconclusive" : computedVerdict;

  // Dollar-ROI proof (gap #1): attach the GA4 traffic/conversion outcome. Fully
  // fail-soft + computed-only (never persisted) — recomputed on every load like
  // the verdict, so it tracks live GA4.
  let trafficOutcome: TrafficOutcome | null = null;
  try {
    const latestGa4 = await readLatestGa4Date(tenantId);
    trafficOutcome = await computeGa4TrafficOutcome(tenantId, record, shipDate, latestGa4);
  } catch {
    trafficOutcome = null;
  }

  return {
    ...record,
    windows,
    verdict,
    confidence,
    trafficOutcome,
    measuredAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/**
 * Capture a baseline + build a ledger record for a manually-shipped change, then
 * measure it (so a backdated ship with closed windows gets a verdict immediately).
 * `controlPages` are canonical URLs. Does NOT persist — the caller stores it.
 */
export async function recordShippedChange(args: {
  tenantId: string;
  page: string; // canonical URL
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  targetQueries: string[];
  controlPages: string[]; // canonical URLs
  shippedAt?: string; // ISO; defaults to now
  notes?: string | null;
  verifiedLive?: boolean;
  liveSourceUrl?: string | null;
  now?: Date;
}): Promise<ShippedChangeRecord> {
  const now = args.now ?? new Date();
  // audit-4: default to the PACIFIC date (GSC's zone), NOT UTC — see
  // defaultPacificShipDate. An explicit operator-provided shippedAt is honored.
  const shippedAt = args.shippedAt ?? defaultPacificShipDate(now);
  const shipDate = dateOnly(shippedAt);

  // Baseline = the 28d pre-ship window on the treated page (display snapshot).
  const preStart = addDays(shipDate, -BASELINE_WINDOW_DAYS);
  const pre = await readWindowForPages({
    tenantId: args.tenantId,
    pages: [args.page],
    start: preStart,
    end: shipDate,
  });
  const base = pre.get(args.page) ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };

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
