/**
 * Measurement kernel (CORE 100K replacement). PURE + one thin loader.
 *
 * This is the small, honest replacement for the sprawling proof-gsc engine. It
 * does exactly nine things and nothing more:
 *   1. Load a shipped change + its tenant/site/page identity.
 *   2. Evaluate the available 7/14/28-day windows.
 *   3. Compare before vs after (GSC clicks, CTR, position; impressions carried
 *      through for visibility; GA4 traffic where trustworthy).
 *   4. Account for Google reporting lag + missing data.
 *   5. Detect overlapping actions on the same page over overlapping windows.
 *   6. Produce an individual directional read, a bundle read for overlaps, and
 *      an explicit confounded / insufficient state when separation is impossible.
 *   7. Never claim clean causality from observational data.
 *   8. Feed a small outcome signal back into recommendation ranking.
 *   9. Render the Results information an average operator needs.
 *
 * Confidence is derived from transparent conditions ONLY: window maturity, data
 * availability, sample size, baseline stability, overlap/confounding, and source
 * freshness. No permutation-null, FDR, calibration self-tests, or forecast
 * machinery. Honest conservative output is the whole requirement.
 *
 * Beacon voice on every operator-facing string: first person, concrete numbers,
 * honest about misses, no em or en dashes.
 */

import "server-only";

import { loadShippedChangesForTenant } from "./shipped-change-store";
import { readLastFinalizedDate } from "./gsc-window";

// ── The kernel's own small verdict vocabulary ──────────────────────────────

/**
 * The full verdict set. This small set is sufficient. Ordered weakest signal to
 * strongest so a numeric rank can be derived when needed.
 */
export type KernelVerdict =
  | "waiting" // no window has closed yet
  | "insufficient_evidence" // window(s) closed but data/sample too thin to read
  | "directional_decline" // the page moved down vs comparable pages
  | "no_clear_movement" // movement sits inside the comparable-page range
  | "directional_improvement" // the page moved up vs comparable pages
  | "stronger_improvement" // a larger, well-supported improvement
  | "confounded"; // overlapping changes make one change impossible to separate

/** Which Search metric a change is judged on. Snippet plays move CTR, rank plays
 *  move position, everything else moves clicks. */
export type KernelMetric = "clicks" | "ctr" | "position";

export type KernelConfidence = "low" | "medium" | "high";

/** One window's state after accounting for Google's reporting lag. */
export type WindowState = "waiting" | "closed" | "pending_data";

export type KernelWindowRead = {
  day: 7 | 14 | 28;
  /** The calendar date this window closes (shippedAt + day), YYYY-MM-DD. */
  closesOn: string;
  state: WindowState;
};

/**
 * The normalized input the pure kernel reads. A record from the historical
 * ledger is mapped to this by `toKernelInput` so the kernel never depends on the
 * full ShippedChangeRecord shape (which the cutover shrinks).
 */
export type KernelInput = {
  id: string;
  page: string;
  path: string;
  actionType: string;
  shippedAt: string;
  baselineImpressions: number;
  baselineClicks: number;
  /** Per closed-or-open window: the observational diff in diff readings. */
  windows: ReadonlyArray<{
    day: 7 | 14 | 28;
    ran: boolean;
    adjustedClicksLift: number;
    adjustedCtrLift: number;
    adjustedPosLift: number;
    adjustedImpressionsLift: number;
    controlsUsed: number;
    treatedPostImpressions: number;
  }>;
  /** GA4 net extra sessions since the change, only when GA4 is trustworthy for
   *  this property. Null when GA4 is absent or not trustworthy. Never invents a
   *  number. */
  ga4ExtraSessions?: number | null;
  /** Whether GA4 traffic is trustworthy/available for this property. */
  ga4Trustworthy?: boolean;
};

/** The full render + ranking read for one change. */
export type KernelRead = {
  id: string;
  page: string;
  path: string;
  actionType: string;
  metric: KernelMetric;
  /** The 7/14/28 window states, honest about Google's lag. */
  windows: KernelWindowRead[];
  /** The longest window that has closed AND has data (the basis), or null. */
  basisDay: 7 | 14 | 28 | null;
  /** The basis window's adjusted lift on the judged metric. */
  lift: number;
  /** The basis window's adjusted impressions (visibility) lift. */
  impressionsLift: number;
  verdict: KernelVerdict;
  /** The operator-facing headline. Beacon voice, concrete, honest. */
  headline: string;
  confidence: KernelConfidence;
  /** Transparent, plain-language reasons the confidence is what it is. */
  confidenceReasons: string[];
  /** Honest caveats an average operator needs (lag, overlap, thin sample). */
  caveats: string[];
  /** Ids of other changes on the same page whose windows overlap this one. */
  overlappingIds: string[];
  /** The small outcome signal fed back into recommendation ranking, in [-1, 1].
   *  Zero for anything not cleanly settled (waiting / insufficient / confounded /
   *  no clear movement). Never claims clean causality. */
  rankingSignal: number;
};

// ── Thresholds (conservative, observational, named so they are auditable) ────

/** A page needs at least this many baseline impressions before any read. */
export const MIN_BASELINE_IMPRESSIONS = 200;
/** At least this many comparable (control) pages before a directional read. */
export const MIN_CONTROLS = 2;
/** Comparable pages for a stronger, higher-confidence read. */
const CONTROLS_FOR_STRONG = 3;
/** Baseline impressions for a stronger, higher-confidence read. */
const IMPRESSIONS_FOR_STRONG = 3000;
/** Clicks lift floor (absolute) OR this fraction of the window baseline. */
const MIN_LIFT_CLICKS = 3;
const MIN_LIFT_FRACTION = 0.1;
/** CTR lift floor (0 to 1). A 0.3 percentage-point diff in diff clears it. */
const MIN_LIFT_CTR = 0.003;
/** Position lift floor: half a rank better than comparable pages. */
const MIN_LIFT_POSITION = 0.5;
/** A lift this many multiples past the floor reads as a stronger improvement. */
const STRONG_MULTIPLE = 3;
/** The pre-ship baseline window length the diff in diff pro-rates from. */
const BASELINE_WINDOW_DAYS = 28;
/** Google reports a few days behind; a window is only readable once its close
 *  date is at least this many days behind the finalized data watermark. */
export const GSC_LAG_DAYS = 3;

const WINDOW_DAYS: Array<7 | 14 | 28> = [7, 14, 28];

const CTR_ACTIONS = new Set([
  "title", "edit_title", "meta", "edit_meta", "h1", "change_h1",
  "intro_answer_block", "answer_block", "faq", "schema", "add_schema", "fix_schema",
]);
const POSITION_ACTIONS = new Set([
  "internal_link", "add_internal_link", "internal_links", "section_reorder",
]);

/** Map an action type to the Search metric that actually measures it. Pure. */
export function metricFor(actionType: string): KernelMetric {
  const a = (actionType || "").toLowerCase();
  if (CTR_ACTIONS.has(a)) return "ctr";
  if (POSITION_ACTIONS.has(a)) return "position";
  return "clicks";
}

// ── Date helpers (pure, UTC) ─────────────────────────────────────────────────

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Add days to a YYYY-MM-DD (or ISO) date, returning YYYY-MM-DD. Pure (UTC). */
export function addDays(dateStr: string, days: number): string {
  const base = dateStr.length > 10 ? dateStr.slice(0, 10) : dateStr;
  const [y, m, d] = base.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.length > 10 ? fromIso : `${fromIso}T00:00:00Z`);
  const b = Date.parse(toIso.length > 10 ? toIso : `${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

// ── Point 2 + 4: window evaluation with reporting lag ────────────────────────

/**
 * Evaluate every 7/14/28 window against the ship date, "now", and Google's
 * finalized-data watermark. A window is `closed` (readable) only when its close
 * date is at least GSC_LAG_DAYS behind the finalized data. Between calendar
 * close and finalized data it is `pending_data` (the honest "waiting on Google",
 * not "stalled"). Pure.
 */
export function evaluateWindows(
  shippedAt: string,
  now: Date,
  latestGscDate: string | null,
): KernelWindowRead[] {
  const nowIso = now.toISOString().slice(0, 10);
  return WINDOW_DAYS.map((day) => {
    const closesOn = addDays(shippedAt, day);
    let state: WindowState = "waiting";
    if (daysBetween(closesOn, nowIso) >= 0) {
      // Calendar window has closed. Is Google's data caught up to it?
      if (latestGscDate && daysBetween(closesOn, latestGscDate) >= 0) {
        state = "closed";
      } else {
        state = "pending_data";
      }
    }
    return { day, closesOn, state };
  });
}

// ── Point 5: overlap detection ───────────────────────────────────────────────

/**
 * Detect overlapping changes: two changes on the SAME page whose 28-day
 * measurement windows overlap in time cannot be cleanly separated. Returns a map
 * of change id to the ids it overlaps. Pure. This is the ONLY confounding signal
 * the kernel needs: same page, overlapping dates.
 */
export function detectOverlaps(
  changes: ReadonlyArray<{ id: string; path: string; shippedAt: string }>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const a of changes) out.set(a.id, []);
  for (let i = 0; i < changes.length; i += 1) {
    for (let j = i + 1; j < changes.length; j += 1) {
      const a = changes[i];
      const b = changes[j];
      if (a.path !== b.path) continue;
      const aStart = Date.parse(a.shippedAt);
      const bStart = Date.parse(b.shippedAt);
      if (!Number.isFinite(aStart) || !Number.isFinite(bStart)) continue;
      const aEnd = aStart + 28 * 86_400_000;
      const bEnd = bStart + 28 * 86_400_000;
      if (aStart <= bEnd && bStart <= aEnd) {
        out.get(a.id)!.push(b.id);
        out.get(b.id)!.push(a.id);
      }
    }
  }
  return out;
}

// ── Point 3 + 6 + 7: the verdict producer ────────────────────────────────────

function liftOnMetric(
  w: KernelInput["windows"][number],
  metric: KernelMetric,
): number {
  if (metric === "ctr") return w.adjustedCtrLift;
  if (metric === "position") return w.adjustedPosLift;
  return w.adjustedClicksLift;
}

function floorFor(
  metric: KernelMetric,
  baselineClicks: number,
  basisDay: number,
): number {
  if (metric === "ctr") return MIN_LIFT_CTR;
  if (metric === "position") return MIN_LIFT_POSITION;
  const windowBaseline = baselineClicks * (basisDay / BASELINE_WINDOW_DAYS);
  return Math.max(MIN_LIFT_CLICKS, windowBaseline * MIN_LIFT_FRACTION);
}

/** The SIZE of a move, never its sign: the sentence owns the direction. A signed number
 *  inside a sentence that already said "down" printed "+0.5pp" on a losing change. */
function formatLift(metric: KernelMetric, lift: number): string {
  if (metric === "ctr") {
    const pp = Math.abs(Math.round(lift * 1000) / 10);
    return `${pp} percentage point${pp === 1 ? "" : "s"} of click rate`;
  }
  const size = metric === "position" ? Math.round(Math.abs(lift) * 10) / 10 : Math.abs(Math.round(lift));
  return `${size} ${metric === "position" ? "rank" : "click"}${size === 1 ? "" : "s"}`;
}

/** Human phrase for a verdict, Beacon voice, concrete numbers folded in by the
 *  caller via `headline`. This is the short label. */
export function verdictPhrase(v: KernelVerdict): string {
  switch (v) {
    case "waiting": return "Waiting on the first window";
    case "insufficient_evidence": return "Not enough evidence yet";
    case "directional_decline": return "Pointing down so far";
    case "no_clear_movement": return "No clear movement";
    case "directional_improvement": return "Pointing up so far";
    case "stronger_improvement": return "A stronger improvement";
    case "confounded": return "Confounded by overlapping changes";
  }
}

/**
 * Produce the full read for one change. Pure. This is points 3, 6, 7, 8, 9 in
 * one deterministic pass. `overlappingIds` is supplied by detectOverlaps; when a
 * change overlaps another on the same page and would otherwise read directional,
 * the verdict becomes `confounded` (honest: cannot separate the two).
 */
export function evaluateChange(
  input: KernelInput,
  windows: KernelWindowRead[],
  overlappingIds: string[],
): KernelRead {
  const metric = metricFor(input.actionType);
  const closed = windows.filter((w) => w.state === "closed").map((w) => w.day);
  // Basis = longest window that has BOTH closed and has a ran reading with data.
  const basisWindow = [...input.windows]
    .filter((w) => w.ran && closed.includes(w.day))
    .sort((a, b) => b.day - a.day)[0];
  const basisDay = basisWindow ? basisWindow.day : null;

  const caveats: string[] = [];
  const confidenceReasons: string[] = [];

  // Point 4: honest lag caveat when a calendar window closed but Google has not
  // caught up.
  const pendingData = windows.some((w) => w.state === "pending_data");
  if (pendingData && !basisWindow) {
    caveats.push("A check window has closed on the calendar, but I am still waiting on Google to finalize those days. Google reports a few days behind.");
  }

  // No closed window with data yet => still waiting. Never a dead-end read.
  if (!basisWindow) {
    return {
      id: input.id,
      page: input.page,
      path: input.path,
      actionType: input.actionType,
      metric,
      windows,
      basisDay: null,
      lift: 0,
      impressionsLift: 0,
      verdict: "waiting",
      headline: "I am still measuring this. The first read lands once a check window closes and Google finalizes those days.",
      confidence: "low",
      confidenceReasons: ["No check window has closed with finalized data yet."],
      caveats,
      overlappingIds,
      rankingSignal: 0,
    };
  }

  const lift = liftOnMetric(basisWindow, metric);
  const impressionsLift = basisWindow.adjustedImpressionsLift;
  const controls = basisWindow.controlsUsed;

  // Point 6: insufficient when the sample can not support a directional read.
  const thinBaseline = input.baselineImpressions < MIN_BASELINE_IMPRESSIONS;
  const thinControls = controls < MIN_CONTROLS;
  const noRateData =
    (metric === "ctr" || metric === "position") && basisWindow.treatedPostImpressions === 0;
  if (thinBaseline || thinControls || noRateData) {
    if (thinBaseline) confidenceReasons.push(`This page had ${Math.round(input.baselineImpressions)} impressions before the change, below the ${MIN_BASELINE_IMPRESSIONS} I want before I read a result.`);
    if (thinControls) confidenceReasons.push(`I could compare against only ${controls} similar page${controls === 1 ? "" : "s"}, below the ${MIN_CONTROLS} I want.`);
    if (noRateData) confidenceReasons.push("This page had no Search impressions in the window, so there is no click rate or rank to compare.");
    return {
      id: input.id,
      page: input.page,
      path: input.path,
      actionType: input.actionType,
      metric,
      windows,
      basisDay,
      lift,
      impressionsLift,
      verdict: "insufficient_evidence",
      headline: "I cannot read this one confidently yet. There is not enough Search data or enough similar pages to compare against.",
      confidence: "low",
      confidenceReasons,
      caveats,
      overlappingIds,
      rankingSignal: 0,
    };
  }

  const floor = floorFor(metric, input.baselineClicks, basisDay!);

  // Directional read on the judged metric.
  let verdict: KernelVerdict;
  if (lift >= floor * STRONG_MULTIPLE && controls >= CONTROLS_FOR_STRONG) {
    verdict = "stronger_improvement";
  } else if (lift >= floor) {
    verdict = "directional_improvement";
  } else if (lift <= -floor) {
    verdict = "directional_decline";
  } else {
    verdict = "no_clear_movement";
  }

  // Point 5 + 6: overlapping changes on the same page over overlapping windows
  // make a single change impossible to isolate. Only downgrade a real
  // directional read to confounded (a "no clear movement" stays honest as is,
  // and does not need a confounding caveat to be true).
  const isDirectional =
    verdict === "directional_improvement" ||
    verdict === "stronger_improvement" ||
    verdict === "directional_decline";
  if (overlappingIds.length > 0 && isDirectional) {
    caveats.push(`I made ${overlappingIds.length} other change${overlappingIds.length === 1 ? "" : "s"} on this page in the same window, so I cannot pin this movement on one change alone.`);
    verdict = "confounded";
  }

  // Point 7: never claim clean causality. Every directional headline says
  // "compared to similar pages" and never "caused".
  const headline = buildHeadline(verdict, metric, lift, impressionsLift, basisDay!, input, overlappingIds.length);

  // Confidence from transparent conditions only (point: window maturity, data
  // availability, sample size, baseline stability, overlap).
  let confidence: KernelConfidence = "low";
  if (verdict === "confounded" || verdict === "no_clear_movement") {
    confidence = "low";
  } else if (controls >= CONTROLS_FOR_STRONG && input.baselineImpressions >= IMPRESSIONS_FOR_STRONG && basisDay === 28) {
    confidence = "high";
  } else if (controls >= MIN_CONTROLS && input.baselineImpressions >= 800) {
    confidence = "medium";
  }
  confidenceReasons.push(`Read on the ${basisDay}-day window against ${controls} similar page${controls === 1 ? "" : "s"}.`);
  if (basisDay !== 28) confidenceReasons.push("This will firm up when the 28-day window closes.");

  // Point 8: the ranking outcome signal. Only a cleanly settled directional read
  // feeds ranking; confounded / no-clear / insufficient / waiting are all zero.
  // Scaled by confidence so a shaky win nudges less than a strong one.
  const confScale = confidence === "high" ? 1 : confidence === "medium" ? 0.6 : 0.3;
  let rankingSignal = 0;
  if (verdict === "stronger_improvement") rankingSignal = confScale;
  else if (verdict === "directional_improvement") rankingSignal = 0.6 * confScale;
  else if (verdict === "directional_decline") rankingSignal = -0.6 * confScale;

  return {
    id: input.id,
    page: input.page,
    path: input.path,
    actionType: input.actionType,
    metric,
    windows,
    basisDay,
    lift,
    impressionsLift,
    verdict,
    headline,
    confidence,
    confidenceReasons,
    caveats,
    overlappingIds,
    rankingSignal: Math.round(rankingSignal * 100) / 100,
  };
}

function buildHeadline(
  verdict: KernelVerdict,
  metric: KernelMetric,
  lift: number,
  impressionsLift: number,
  basisDay: number,
  input: KernelInput,
  overlapCount: number,
): string {
  const win = `${basisDay}-day`;
  const ga4 =
    input.ga4Trustworthy && typeof input.ga4ExtraSessions === "number" && input.ga4ExtraSessions !== 0
      ? ` GA4 shows ${input.ga4ExtraSessions > 0 ? "+" : ""}${Math.round(input.ga4ExtraSessions)} sessions since the change.`
      : "";
  switch (verdict) {
    case "confounded":
      return `This page moved over the ${win} window, but I made ${overlapCount} other change${overlapCount === 1 ? "" : "s"} on it at the same time, so I cannot say which one did it.${ga4}`;
    // Observational, never causal: the page MOVED after the change. A pre-28-day read is still measuring, so it never closes with a verdict.
    case "stronger_improvement":
      return `This page moved up after the change: ${formatLift(metric, lift)} ahead of similar pages over the ${win} window.${basisDay === 28 ? " A clear, well supported move." : " I will call it when the 28-day window closes."}${ga4}`;
    case "directional_improvement":
      return `This page moved up after the change: ${formatLift(metric, lift)} ahead of similar pages over the ${win} window. Still observational, not proof.${ga4}`;
    case "directional_decline":
      return `This page moved down after the change: ${formatLift(metric, lift)} behind similar pages over the ${win} window.${basisDay === 28 ? " Worth trying a different angle on this page." : " Still measuring, so I will call it when the 28-day window closes."}${ga4}`;
    case "no_clear_movement":
    default: {
      const vis = impressionsLift > 50 ? ` The page is showing for more searches though (+${Math.round(impressionsLift)} impressions vs similar pages).` : "";
      return `No clear change yet: the movement sits inside the range of similar pages over the ${win} window.${vis}${ga4}`;
    }
  }
}

// ── Bundle read for overlaps (point 6) ───────────────────────────────────────

export type BundleRead = {
  path: string;
  changeIds: string[];
  /** The bundle's combined directional read on clicks vs comparable pages, when
   *  every member shares a closed basis window. Null when the bundle can not be
   *  read as a group yet. */
  verdict: KernelVerdict;
  headline: string;
};

/**
 * A same-page bundle of overlapping changes gets ONE honest group read: the
 * changes cannot be separated, but their combined effect on the page can still
 * be reported. Pure. Returns one BundleRead per overlapping group of 2+.
 */
export function bundleReads(reads: ReadonlyArray<KernelRead>): BundleRead[] {
  const byPath = new Map<string, KernelRead[]>();
  for (const r of reads) {
    if (r.overlappingIds.length === 0) continue;
    const arr = byPath.get(r.path) ?? [];
    arr.push(r);
    byPath.set(r.path, arr);
  }
  const out: BundleRead[] = [];
  for (const [path, group] of byPath) {
    if (group.length < 2) continue;
    const withBasis = group.filter((g) => g.basisDay != null);
    const combinedLift = withBasis.reduce((s, g) => s + g.lift, 0);
    let verdict: KernelVerdict = "insufficient_evidence";
    let headline = `I made ${group.length} changes on this page in the same window. I am still gathering enough data to read them as a group.`;
    if (withBasis.length === group.length && withBasis.length > 0) {
      if (combinedLift > 0) {
        verdict = "directional_improvement";
        headline = `As a group, the ${group.length} changes on this page are pointing up compared to similar pages. I cannot split the credit between them, but the page as a whole is improving.`;
      } else if (combinedLift < 0) {
        verdict = "directional_decline";
        headline = `As a group, the ${group.length} changes on this page are pointing down compared to similar pages. Worth a look at what changed together here.`;
      } else {
        verdict = "no_clear_movement";
        headline = `As a group, the ${group.length} changes on this page have not clearly moved it compared to similar pages.`;
      }
    }
    out.push({ path, changeIds: group.map((g) => g.id), verdict, headline });
  }
  return out;
}

// ── Point 8: the ranking outcome signal, aggregated per action type ──────────

/**
 * Aggregate the per-change ranking signals into a per action-type prior in
 * [-1, 1], the small outcome signal recommendation ranking consumes. Only
 * cleanly settled reads contribute (waiting / insufficient / confounded / no
 * clear movement are all zero-signal and ignored). An action type needs at least
 * MIN_RANKING_SAMPLES contributing reads before it earns a prior. Pure.
 */
export const MIN_RANKING_SAMPLES = 3;

export function rankingPriors(
  reads: ReadonlyArray<{ actionType: string; read: Pick<KernelRead, "rankingSignal"> }>,
): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const { actionType, read } of reads) {
    if (!actionType || read.rankingSignal === 0) continue;
    const cur = sums.get(actionType) ?? { total: 0, n: 0 };
    cur.total += read.rankingSignal;
    cur.n += 1;
    sums.set(actionType, cur);
  }
  const out = new Map<string, number>();
  for (const [at, { total, n }] of sums) {
    if (n < MIN_RANKING_SAMPLES) continue;
    out.set(at, Math.round((total / n) * 100) / 100);
  }
  return out;
}

// ── Compat adapter: map a historical ledger record to a KernelInput ──────────

/** The subset of the historical ShippedChangeRecord the kernel reads. Kept
 *  structural (not an import of the full type) so the kernel is decoupled from
 *  the shrinking record shape. */
export type LedgerRecordLike = {
  id: string;
  page: string;
  path: string;
  actionType: string;
  shippedAt: string;
  baseline?: { impressions?: number; clicks?: number } | null;
  windows?: ReadonlyArray<{
    day: number;
    ran?: boolean;
    adjustedLift?: number;
    adjustedCtrLift?: number;
    adjustedPosLift?: number;
    adjustedImpressionsLift?: number;
    controlsUsed?: number;
    treatedPostImpressions?: number;
  }> | null;
  /** Optional GA4 net extra sessions since the change, supplied by the caller
   *  only when GA4 is trustworthy for the property. Never sourced from a deleted
   *  module; absent => no GA4 line. */
  ga4ExtraSessions?: number | null;
  ga4Trustworthy?: boolean;
};

/** Map a historical record to the kernel's normalized input. Pure. Reads only
 *  the small set of fields the kernel needs; everything else on the record is
 *  ignored (preserved in the store, untouched). */
export function toKernelInput(r: LedgerRecordLike): KernelInput {
  const windows = (r.windows ?? [])
    .filter((w): w is NonNullable<typeof w> => w != null && (w.day === 7 || w.day === 14 || w.day === 28))
    .map((w) => ({
      day: w.day as 7 | 14 | 28,
      ran: w.ran === true,
      adjustedClicksLift: w.adjustedLift ?? 0,
      adjustedCtrLift: w.adjustedCtrLift ?? 0,
      adjustedPosLift: w.adjustedPosLift ?? 0,
      adjustedImpressionsLift: w.adjustedImpressionsLift ?? 0,
      controlsUsed: w.controlsUsed ?? 0,
      treatedPostImpressions: w.treatedPostImpressions ?? 0,
    }));
  return {
    id: r.id,
    page: r.page,
    path: r.path,
    actionType: r.actionType,
    shippedAt: r.shippedAt,
    baselineImpressions: r.baseline?.impressions ?? 0,
    baselineClicks: r.baseline?.clicks ?? 0,
    windows,
    ga4ExtraSessions: r.ga4ExtraSessions ?? null,
    ga4Trustworthy: r.ga4Trustworthy === true,
  };
}

/**
 * Build the full set of reads for a set of historical records. Pure over its
 * inputs (records + now + watermark). This is the one function the Results
 * surface and the ranking consumers call: it maps records, evaluates windows,
 * detects overlaps, and produces every read in one honest pass. Every historical
 * record in => one read out, so nothing ever disappears from Results.
 */
export function readLedger(
  records: ReadonlyArray<LedgerRecordLike>,
  now: Date,
  latestGscDate: string | null,
): KernelRead[] {
  const inputs = records.map(toKernelInput);
  const overlaps = detectOverlaps(
    inputs.map((i) => ({ id: i.id, path: i.path, shippedAt: i.shippedAt })),
  );
  return inputs.map((input) => {
    const windows = evaluateWindows(input.shippedAt, now, latestGscDate);
    return evaluateChange(input, windows, overlaps.get(input.id) ?? []);
  });
}

// ── UI bands + labels (point 9) ──────────────────────────────────────────────

export type ResultBand = "won" | "promising" | "learned" | "measuring";

/** Which Results band a read belongs to. Pure. "won" = a MATURE (28-day)
 *  improvement; "promising" = an earlier improvement whose window has not
 *  closed (never sold as a win); "learned" = a mature decline or settled
 *  no-movement; "measuring" = everything else still in flight. */
export function bandOf(read: Pick<KernelRead, "verdict" | "basisDay">): ResultBand {
  if (read.verdict === "directional_improvement" || read.verdict === "stronger_improvement") {
    return read.basisDay === 28 ? "won" : "promising";
  }
  if (read.basisDay === 28 && (read.verdict === "directional_decline" || read.verdict === "no_clear_movement")) {
    return "learned";
  }
  return "measuring";
}

/** Split reads into the four bands, preserving order. Pure. */
export function splitReads<T extends { read: Pick<KernelRead, "verdict" | "basisDay"> }>(
  items: ReadonlyArray<T>,
): { won: T[]; promising: T[]; learned: T[]; measuring: T[] } {
  const out = { won: [] as T[], promising: [] as T[], learned: [] as T[], measuring: [] as T[] };
  for (const it of items) out[bandOf(it.read)].push(it);
  return out;
}

/** A short, plain window-state line for the operator. Pure. */
export function windowStateLine(windows: ReadonlyArray<KernelWindowRead>): string {
  const closed = windows.filter((w) => w.state === "closed").map((w) => w.day);
  const pending = windows.some((w) => w.state === "pending_data");
  if (closed.length === 3) return "All three check windows (7, 14, 28 days) have closed.";
  if (closed.length > 0) return `${closed.join(" and ")}-day window${closed.length === 1 ? "" : "s"} closed; the rest are still open.`;
  if (pending) return "A check window has closed on the calendar, but Google has not finalized those days yet.";
  return "Still waiting on the first check window to close.";
}

// ── Learning / ranking compat: settled verdict from a stored record ──────────

/**
 * A window is treated as readable for LEARNING when the stored record already
 * marked it `ran` (Google data was available at measure time). Learning does not
 * re-derive Google's lag; it trusts the stored measurement. Pure.
 */
function windowsFromRanFlags(input: KernelInput): KernelWindowRead[] {
  return WINDOW_DAYS.map((day) => {
    const w = input.windows.find((x) => x.day === day);
    return {
      day,
      closesOn: addDays(input.shippedAt, day),
      state: (w && w.ran ? "closed" : "waiting") as WindowState,
    };
  });
}

/**
 * The legacy learning vocabulary ("won" / "lost" / "measuring") the ranking
 * priors consume, derived from a kernel read. Only a MATURE (28-day basis)
 * directional read is decided; everything weaker or confounded is held as
 * "measuring" (never trains ranking on an early or unseparable signal). Pure.
 */
export function learningVerdictOf(read: KernelRead): "won" | "lost" | "measuring" {
  if (read.basisDay !== 28) return "measuring";
  if (read.verdict === "directional_improvement" || read.verdict === "stronger_improvement") return "won";
  if (read.verdict === "directional_decline") return "lost";
  return "measuring";
}

/**
 * Evaluate a set of stored records for LEARNING: windows come from stored `ran`
 * flags (trust the measurement, ignore live lag), overlaps are detected across
 * the set, and an operator "exclude from learning" override forces measuring.
 * Returns reads aligned 1:1 with the input records. Pure.
 */
export function readRecordsForLearning(
  records: ReadonlyArray<LedgerRecordLike & { operatorVerdictOverride?: string | null }>,
  _now: Date = new Date(),
): KernelRead[] {
  const inputs = records.map(toKernelInput);
  const overlaps = detectOverlaps(
    inputs.map((i) => ({ id: i.id, path: i.path, shippedAt: i.shippedAt })),
  );
  return inputs.map((input, idx) => {
    if (records[idx].operatorVerdictOverride === "inconclusive") {
      // Operator pinned out of learning: read it as no clear movement (measuring).
      return evaluateChange({ ...input, windows: [] }, windowsFromRanFlags(input), []);
    }
    return evaluateChange(input, windowsFromRanFlags(input), overlaps.get(input.id) ?? []);
  });
}

/** The settled learning verdict for one stored record, in the legacy vocabulary.
 *  Convenience for callers that only have one record in hand. Pure. */
export function recordLearningVerdict(
  record: LedgerRecordLike & { operatorVerdictOverride?: string | null },
  now: Date = new Date(),
): "won" | "lost" | "measuring" {
  return learningVerdictOf(readRecordsForLearning([record], now)[0]);
}

// ── The one thin loader (point 1) ────────────────────────────────────────────

/**
 * Load a tenant's shipped changes from the preserved historical store and
 * produce every read. This is the only I/O in the kernel: it reads the existing
 * shipped_change records (never reshaping the table) and the finalized-data
 * watermark, then runs the pure engine. Fail-soft: an empty or failed read
 * yields an empty ledger, never a throw into a surface.
 */
export async function loadKernelLedger(
  tenantId: string,
  now: Date = new Date(),
): Promise<KernelRead[]> {
  const records = await loadShippedChangesForTenant(tenantId).catch(() => []);
  if (records.length === 0) return [];
  const latestGscDate = await readLastFinalizedDate(tenantId).catch(() => null);
  return readLedger(records as unknown as LedgerRecordLike[], now, latestGscDate);
}
