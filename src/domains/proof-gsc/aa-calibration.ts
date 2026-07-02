import "server-only";

/**
 * A/A calibration harness (2026-07-02, master plan item 31) - measures Beacon's
 * OWN false-positive rate by running the real measurement math on pages Beacon
 * never touched, then derives per-traffic-tier floors from what it finds.
 *
 * How it works: pick untreated pages with real GSC traffic, give each one a
 * DETERMINISTICALLY-SEEDED pseudo ship date 2-6 weeks back (same page + same
 * calendar week -> same pseudo date, so reruns are stable and testable), run
 * the SAME diff-in-diff window math the real ledger uses
 * (computeWindowLift/summarizeVerdict from measure.ts) against real GSC data,
 * and see how often a page that was never changed reads "won" or "lost". That
 * fraction IS the pipeline's empirical false-positive rate. The placebo lift
 * distribution per traffic tier then derives a floor that would have kept ~5%
 * of these untouched pages from crying wolf.
 *
 * SAFETY (do not weaken):
 *   - This module NEVER calls recordShippedChange / upsertShippedChange / any
 *     write to shipped_change_proof. Every placebo "record" lives only in a
 *     local array for the duration of one run; only the AGGREGATE result
 *     (aa-calibration-store.ts) is persisted.
 *   - Placebo pages are excluded from anything currently in the ledger (as a
 *     treated page OR as anyone's control page), so a real experiment is never
 *     double-counted as a placebo.
 *   - Date.now/Math.random are NEVER used for the pseudo ship date - it is a
 *     pure hash of (tenantId, page, weekKey), so two runs in the same
 *     calendar week produce byte-identical placebo assignments.
 *   - Threshold derivation is STRICTER-ONLY (never below the shipped default)
 *     until at least MIN_SAMPLES_TO_TRUST cumulative placebo samples exist -
 *     see deriveFloorsForTier's doc comment.
 */

import {
  loadPageSurgeonContext,
  type PageSurgeonContext,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import { loadShippedChanges } from "./shipped-change-store";
import { readWindowForPages, readLastFinalizedDate } from "./gsc-window";
import {
  addDays,
  computeWindowLift,
  summarizeVerdict,
  proofCheckDates,
  PROOF_WINDOW_DAYS,
  PROOF_BASELINE_WINDOW_DAYS,
  trafficTierOf,
  TRAFFIC_TIERS,
  DEFAULT_MIN_LIFT_CLICKS,
  DEFAULT_MIN_LIFT_CTR,
  type GscWindowMetrics,
  type ProofWindowResult,
  type ProofWindowDay,
  type TrafficTier,
} from "./measure";
import { readAaCalibration, writeAaCalibration, type AaTierResult } from "./aa-calibration-store";

const NULL_METRICS: GscWindowMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

/** Bounded nightly cost: at most this many placebo pages per tenant per run. */
export const MAX_PLACEBO_PAGES_PER_RUN = 40;
/** How many untreated same-site pages anchor each placebo page's diff-in-diff
 *  (mirrors auto-record-on-ship's control count). */
const PLACEBO_CONTROLS_PER_PAGE = 3;
/** A placebo page needs at least this many controls for an honest comparison -
 *  same floor the real recorder enforces. */
const MIN_PLACEBO_CONTROLS = 2;
/** Below this baseline-impressions floor a page can't support ANY verdict
 *  (matches measure.ts's MIN_BASELINE_IMPRESSIONS) - skip it as a placebo
 *  candidate entirely rather than counting a guaranteed "insufficient_data". */
const MIN_PLACEBO_BASELINE_IMPRESSIONS = 200;
/** Pseudo ship dates land 2-6 weeks back (14-42 days), the range item 31
 *  specifies - old enough that the 7/14-day windows reliably close against
 *  real finalized GSC data, recent enough that the traffic mix is current. */
const MIN_PSEUDO_WEEKS_BACK = 2;
const MAX_PSEUDO_WEEKS_BACK = 6;
/** Target false-positive rate the derived floors aim to hit. */
export const TARGET_FALSE_POSITIVE_RATE = 0.05;
/** Threshold derivation can only get STRICTER than the shipped default until
 *  this many cumulative placebo samples exist for the tenant (see
 *  deriveFloorsForTier). Below this, a single noisy run could derive a floor
 *  from too few points to trust; the safe fallback is the untouched default. */
export const MIN_SAMPLES_TO_DERIVE = 100;

// ── Deterministic seeding (no Date.now/Math.random) ──────────────────────

/** FNV-1a string hash -> unsigned 32-bit int. Deterministic, no external dep. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The calibration "week" a run belongs to (YYYY-Www, ISO-ish but simple: just
 *  a 7-day bucket index from the Unix epoch) - stable within a week, rotates
 *  slowly so the placebo sample isn't frozen on the same pages forever. */
export function weekKeyOf(now: Date): string {
  const days = Math.floor(now.getTime() / 86_400_000);
  const week = Math.floor(days / 7);
  return `w${week}`;
}

/**
 * A deterministic pseudo ship date for one page, 2-6 weeks back from `now`.
 * Pure hash of (tenantId, page, weekKey) - same inputs always produce the
 * same date, so the SAME page can be re-run in the SAME calibration week with
 * a byte-identical placebo assignment (the determinism the spec requires).
 */
export function seededPseudoShipDate(tenantId: string, page: string, now: Date): string {
  const week = weekKeyOf(now);
  const seed = fnv1a(`${tenantId}::${page}::${week}`);
  const spanDays = (MAX_PSEUDO_WEEKS_BACK - MIN_PSEUDO_WEEKS_BACK) * 7; // 28
  const offsetDays = MIN_PSEUDO_WEEKS_BACK * 7 + (seed % (spanDays + 1)); // 14..42
  const today = now.toISOString().slice(0, 10);
  return addDays(today, -offsetDays);
}

// ── Placebo page + control selection (pure) ──────────────────────────────

export type PlaceboCandidate = {
  page: string;
  baselineImpressions: number;
};

function normPath(u: string): string {
  try {
    return (new URL(u).pathname || "/").replace(/\/+$/, "") || "/";
  } catch {
    return (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  }
}

/**
 * Every path that currently appears in the real proof ledger, either as the
 * treated page OR as anyone's control page - a placebo run must avoid ALL of
 * these so it never double-counts a real (or already-anchoring) experiment as
 * an untreated page. Pure.
 */
export function ledgerExclusionPaths(ledger: ReadonlyArray<{ path: string; controlPages: string[] }>): Set<string> {
  const out = new Set<string>();
  for (const r of ledger) {
    out.add(normPath(r.path));
    for (const cp of r.controlPages) out.add(normPath(cp));
  }
  return out;
}

/**
 * Pick up to `limit` untreated, adequate-traffic pages as this run's placebo
 * sample: excludes anything in `exclude` (the ledger's treated + control
 * paths), requires baseline impressions >= MIN_PLACEBO_BASELINE_IMPRESSIONS,
 * and orders deterministically (by impressions desc, tie-broken by URL) so
 * the same candidate pool always yields the same slice. Pure - no I/O, no
 * randomness.
 */
export function pickPlaceboPages(
  candidates: ReadonlyArray<PlaceboCandidate>,
  exclude: ReadonlySet<string>,
  limit: number = MAX_PLACEBO_PAGES_PER_RUN,
): PlaceboCandidate[] {
  return candidates
    .filter((c) => c.baselineImpressions >= MIN_PLACEBO_BASELINE_IMPRESSIONS)
    .filter((c) => !exclude.has(normPath(c.page)))
    .slice()
    .sort((a, b) => b.baselineImpressions - a.baselineImpressions || a.page.localeCompare(b.page))
    .slice(0, Math.max(0, limit));
}

/**
 * Comparison pages for ONE placebo page: the next-highest-traffic untreated
 * candidates (excluding the placebo page itself and the ledger exclusion
 * set), same selection shape as auto-record-on-ship's real control picker.
 * Pure.
 */
export function pickPlaceboControls(
  placeboPage: string,
  candidates: ReadonlyArray<PlaceboCandidate>,
  exclude: ReadonlySet<string>,
  count: number = PLACEBO_CONTROLS_PER_PAGE,
): string[] {
  const placeboPath = normPath(placeboPage);
  return candidates
    .filter((c) => normPath(c.page) !== placeboPath && !exclude.has(normPath(c.page)))
    .slice()
    .sort((a, b) => b.baselineImpressions - a.baselineImpressions || a.page.localeCompare(b.page))
    .slice(0, count)
    .map((c) => c.page);
}

// ── Threshold derivation (pure) ───────────────────────────────────────────

/** 95th percentile of a set of non-negative magnitudes (linear interpolation
 *  between the two nearest ranks). Pure. Empty input -> 0. */
export function percentile95(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = 0.95 * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

/**
 * Derive a stricter-only floor for one metric in one tier from its placebo
 * absolute-lift distribution. SAFETY RULE (do not remove): tuning can only
 * ever make the floor STRICTER (higher) than the shipped default, and ONLY
 * once `cumulativeSampleSize` reaches MIN_SAMPLES_TO_DERIVE - below that, too
 * few placebo points exist to trust a percentile, so this returns the
 * untouched default. This means a bad or lucky short run can never LOOSEN a
 * floor and let more false positives through than the hand-picked default
 * already allows.
 */
export function deriveFloorForTier(args: {
  absLifts: ReadonlyArray<number>;
  defaultFloor: number;
  cumulativeSampleSize: number;
}): number {
  if (args.cumulativeSampleSize < MIN_SAMPLES_TO_DERIVE) return args.defaultFloor;
  const p95 = percentile95(args.absLifts);
  return Math.max(args.defaultFloor, p95);
}

// ── The full pass ──────────────────────────────────────────────────────────

type PlaceboVerdictClass = "flagged" | "quiet"; // flagged = won or lost (a false positive on an untouched page)

type PlaceboMeasurement = {
  page: string;
  tier: TrafficTier;
  verdictClass: PlaceboVerdictClass;
  /** Absolute lift on whichever metric the basis window judged (clicks or
   *  CTR - placebo pages are always judged on the default "clicks" metric
   *  the untyped-change case uses, since a placebo page has no real action
   *  type to pick a metric from). */
  absClicksLift: number;
  absCtrLift: number;
};

export type AaCalibrationResult = {
  ran: boolean;
  sampleSize: number;
  falsePositiveRate: number;
  byTrafficTier: AaTierResult[];
  cumulativeSampleSize: number;
};

const EMPTY_RESULT: AaCalibrationResult = {
  ran: false,
  sampleSize: 0,
  falsePositiveRate: 0,
  byTrafficTier: [],
  cumulativeSampleSize: 0,
};

/**
 * Measure ONE placebo page: pseudo-ship it, read the pre/post GSC windows the
 * same way measureRecord does, compute the diff-in-diff, and classify the
 * verdict using the SHIPPED DEFAULT floors (never the calibrated ones - this
 * pass measures how the default floors perform, so it must not grade itself
 * against its own output). In-memory only; never touches the ledger.
 */
async function measurePlaceboPage(args: {
  tenantId: string;
  page: string;
  controls: string[];
  now: Date;
  lastFinal: string | null;
}): Promise<PlaceboMeasurement | null> {
  const pseudoShipDate = seededPseudoShipDate(args.tenantId, args.page, args.now);
  const pages = [args.page, ...args.controls];

  const preStart = addDays(pseudoShipDate, -PROOF_BASELINE_WINDOW_DAYS);
  const pre = await readWindowForPages({ tenantId: args.tenantId, pages, start: preStart, end: pseudoShipDate });

  const treatedPre = pre.get(args.page) ?? NULL_METRICS;
  if (treatedPre.impressions < MIN_PLACEBO_BASELINE_IMPRESSIONS) return null;

  const checks = proofCheckDates(pseudoShipDate);
  const windows: ProofWindowResult[] = [];
  for (const day of PROOF_WINDOW_DAYS) {
    const checkOn = checks[day as ProofWindowDay];
    const ran = args.lastFinal != null && args.lastFinal >= addDays(checkOn, -1);
    const postEnd = addDays(pseudoShipDate, day);
    const post = ran
      ? await readWindowForPages({ tenantId: args.tenantId, pages, start: pseudoShipDate, end: postEnd })
      : null;
    const treatedPostM = post?.get(args.page) ?? NULL_METRICS;
    const usableControls = args.controls
      .filter((cp) => (pre.get(cp)?.impressions ?? 0) > 0 && (!ran || (post?.get(cp)?.impressions ?? 0) > 0))
      .map((cp) => ({ pre: pre.get(cp) ?? NULL_METRICS, post: post?.get(cp) ?? NULL_METRICS }));

    windows.push(
      computeWindowLift({
        day: day as ProofWindowDay,
        checkOn,
        ran,
        treatedPre,
        treatedPost: treatedPostM,
        controls: usableControls,
        preWindowDays: PROOF_BASELINE_WINDOW_DAYS,
      }),
    );
  }
  if (!windows.some((w) => w.ran)) return null; // nothing closed yet for this pseudo date

  // Classify on BOTH clicks and CTR against the SHIPPED DEFAULT floors (not
  // whatever calibration may already exist) - this run measures the default
  // floors' real-world false-positive rate so it can propose a correction,
  // never the calibrated floors' own performance.
  const clicksVerdict = summarizeVerdict({
    windows,
    baselineImpressions: treatedPre.impressions,
    baselineClicks: treatedPre.clicks,
    metric: "clicks",
  });
  const ctrVerdict = summarizeVerdict({
    windows,
    baselineImpressions: treatedPre.impressions,
    baselineClicks: treatedPre.clicks,
    metric: "ctr",
  });
  const flagged =
    clicksVerdict.verdict === "won" || clicksVerdict.verdict === "lost" ||
    ctrVerdict.verdict === "won" || ctrVerdict.verdict === "lost";

  return {
    page: args.page,
    tier: trafficTierOf(treatedPre.impressions),
    verdictClass: flagged ? "flagged" : "quiet",
    absClicksLift: Math.abs(clicksVerdict.lift),
    absCtrLift: Math.abs(ctrVerdict.lift),
  };
}

/**
 * Run the full A/A calibration pass for one tenant: pick placebo pages, measure
 * each against real GSC using the real measurement math, aggregate a
 * false-positive rate + derived floors per traffic tier, and persist ONLY the
 * aggregate. Fail-soft -> { ran: false, ... } on any read failure; never
 * throws into the cron loop.
 *
 * Injectable I/O for tests (loadContext/loadLedger/readWindow/readLastFinal
 * default to the real modules).
 */
export async function runAaCalibrationForTenant(
  tenantId: string,
  now: Date = new Date(),
  deps: {
    loadContext?: (tenantId: string) => Promise<PageSurgeonContext>;
    loadLedger?: () => Promise<Array<{ path: string; controlPages: string[] }>>;
    readLastFinal?: (tenantId: string) => Promise<string | null>;
  } = {},
): Promise<AaCalibrationResult> {
  if (!tenantId) return EMPTY_RESULT;
  const loadContext = deps.loadContext ?? loadPageSurgeonContext;
  const loadLedger = deps.loadLedger ?? loadShippedChanges;
  const readLastFinal = deps.readLastFinal ?? readLastFinalizedDate;

  let ctx: PageSurgeonContext;
  let ledger: Array<{ path: string; controlPages: string[] }>;
  let lastFinal: string | null;
  try {
    [ctx, ledger, lastFinal] = await Promise.all([
      loadContext(tenantId),
      loadLedger().catch(() => []),
      readLastFinal(tenantId).catch(() => null),
    ]);
  } catch {
    return EMPTY_RESULT;
  }

  const candidates: PlaceboCandidate[] = [];
  for (const [url, sig] of ctx.gscByUrl) {
    if (!ctx.snapshotByCanon.has(url)) continue;
    candidates.push({ page: url, baselineImpressions: sig.impressions90d });
  }
  if (candidates.length === 0) return { ...EMPTY_RESULT, ran: true };

  const exclude = ledgerExclusionPaths(ledger);
  const placeboPages = pickPlaceboPages(candidates, exclude);
  if (placeboPages.length === 0) return { ...EMPTY_RESULT, ran: true };

  const measurements: PlaceboMeasurement[] = [];
  for (const cand of placeboPages) {
    const controls = pickPlaceboControls(cand.page, candidates, exclude);
    if (controls.length < MIN_PLACEBO_CONTROLS) continue;
    try {
      const m = await measurePlaceboPage({ tenantId, page: cand.page, controls, now, lastFinal });
      if (m) measurements.push(m);
    } catch {
      /* one bad page never aborts the run */
    }
  }
  if (measurements.length === 0) return { ...EMPTY_RESULT, ran: true };

  // Prior cumulative sample size (before this run) feeds the stricter-only
  // "don't derive from too few points" gate.
  const prior = await readAaCalibration(tenantId, now).catch(() => null);
  const priorCumulative = prior?.cumulativeSampleSize ?? 0;
  const cumulativeSampleSize = priorCumulative + measurements.length;

  const byTrafficTier: AaTierResult[] = TRAFFIC_TIERS.map((tier) => {
    const tierRows = measurements.filter((m) => m.tier === tier);
    const sampleSize = tierRows.length;
    const flaggedCount = tierRows.filter((m) => m.verdictClass === "flagged").length;
    const falsePositiveRate = sampleSize > 0 ? flaggedCount / sampleSize : 0;
    const derivedMinLiftClicks = deriveFloorForTier({
      absLifts: tierRows.map((m) => m.absClicksLift),
      defaultFloor: DEFAULT_MIN_LIFT_CLICKS,
      cumulativeSampleSize,
    });
    const derivedMinLiftCtr = deriveFloorForTier({
      absLifts: tierRows.map((m) => m.absCtrLift),
      defaultFloor: DEFAULT_MIN_LIFT_CTR,
      cumulativeSampleSize,
    });
    return { tier, sampleSize, falsePositiveRate, derivedMinLiftClicks, derivedMinLiftCtr };
  });

  const flaggedTotal = measurements.filter((m) => m.verdictClass === "flagged").length;
  const result: AaCalibrationResult = {
    ran: true,
    sampleSize: measurements.length,
    falsePositiveRate: flaggedTotal / measurements.length,
    byTrafficTier,
    cumulativeSampleSize,
  };

  await writeAaCalibration({
    tenant_id: tenantId,
    computed_at: now.toISOString(),
    sampleSize: result.sampleSize,
    falsePositiveRate: result.falsePositiveRate,
    byTrafficTier: result.byTrafficTier,
    cumulativeSampleSize: result.cumulativeSampleSize,
  });

  return result;
}
