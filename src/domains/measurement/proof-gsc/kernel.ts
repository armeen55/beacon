/**
 * Measurement kernel (CORE 100K replacement). PURE + one thin loader.
 *
 * This is the small, honest replacement for the sprawling proof-gsc engine. It does
 * exactly nine things and nothing more: (1) load a shipped change and its page identity;
 * (2) evaluate the checkpoints, counted from the stamp; (3) compare before vs after (GSC
 * clicks, CTR, position, impressions for visibility, GA4 where trustworthy); (4) account
 * for Google's reporting lag and missing data; (5) detect overlapping changes on one page;
 * (6) produce a directional read, a bundle read for overlaps, and an explicit confounded
 * or insufficient state when separation is impossible; (7) never claim clean causality;
 * (8) feed a small outcome signal back into ranking; (9) render what an operator needs.
 *
 * Confidence is derived from transparent conditions ONLY: window maturity, data
 * availability, sample size, baseline stability, overlap/confounding, and source
 * freshness. No permutation-null, FDR, calibration self-tests, or forecast machinery.
 *
 * Beacon voice on every operator-facing string: first person, concrete numbers,
 * honest about misses, no em or en dashes.
 */

import "server-only";

import { reportingDay } from "@/lib/reporting-day";
import { loadShippedChangesForTenant } from "./shipped-change-store";
import { readLastFinalizedDate } from "./gsc-window";
import { buildHeadline, learningShape, monthDay, overlapClosures } from "./read-honesty";

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

type KernelConfidence = "low" | "medium" | "high";

/** One window's state after accounting for Google's reporting lag. */
type WindowState = "waiting" | "closed" | "pending_data";

/** The checkpoints. 7/14/28 always; 56 ONLY when the 28-day read did not settle or the
 *  change was a dangerous one (Product Truth omits it otherwise). */
type CheckpointDay = 7 | 14 | 28 | 56;

export type KernelWindowRead = {
  day: CheckpointDay;
  /** The calendar date this window closes (the stamp + day), YYYY-MM-DD. */
  closesOn: string;
  state: WindowState;
  /** Set when a LATER change on this page closed the clean window before this checkpoint: the
   *  days behind it belong to both changes, so this read is not this change's alone. Results
   *  paints these chips amber and names the overlap (results-presentation.ts), so a shared window
   *  can never be sold as a clean win. */
  confounded?: "overlapping_change";
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
  /** THE STAMP: when the operator marked the change done. Every checkpoint counts from
   *  here; a pre-Shipment row has none and counts from its ship date exactly as before. */
  implementedAt?: string | null;
  baselineImpressions: number;
  baselineClicks: number;
  /** Per closed-or-open window: the observational diff in diff readings. */
  windows: ReadonlyArray<{
    day: CheckpointDay;
    ran: boolean;
    /** The day this reading actually closed on, as stored when it ran; absent falls back to the
     *  recomputed close date. */
    checkOn?: string | null;
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
  /** The bundle components the operator applied, for the learning shape below. */
  componentKinds?: readonly string[];
  /** What the proposal said was wrong with the page, where the row holds it. */
  diagnosisCause?: string | null;
  /** How many receipt items the draft carried, where the row holds it. */
  evidenceItemCount?: number | null;
};

/** The full render + ranking read for one change. */
export type KernelRead = {
  id: string;
  page: string;
  path: string;
  actionType: string;
  metric: KernelMetric;
  /** The checkpoint states, honest about Google's lag. */
  windows: KernelWindowRead[];
  /** The longest CLEAN window that has closed AND has data (the basis), or null. */
  basisDay: CheckpointDay | null;
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
  /** The day a LATER change on this page closed this one's clean window, or null. */
  cleanUntil: string | null;
  /** What this read carries forward for later account-scoped learning. Shape only:
   *  nothing here is aggregated, scored, or compared across accounts. */
  learning: {
    actionFamily: string;
    diagnosisCause: string | null;
    evidenceCompleteness: number | null;
    outcomeDirection: "up" | "down" | "flat" | "unclear";
  };
  /** The small outcome signal fed back into recommendation ranking, in [-1, 1].
   *  Zero for anything not cleanly settled (waiting / insufficient / confounded /
   *  no clear movement). Never claims clean causality. */
  rankingSignal: number;
};

// ── Thresholds (conservative, observational, named so they are auditable) ────

/** A page needs at least this many baseline impressions before any read. */
const MIN_BASELINE_IMPRESSIONS = 200;
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
/** The conditional fourth checkpoint. It exists on a read ONLY when the record carries a
 *  day-56 measurement, and measure-lifecycle is the one place that decides it is owed. */
const FOLLOW_UP_DAY = 56;

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
 * Evaluate every checkpoint against the stamp, "now", and Google's finalized-data
 * watermark. A window is `closed` (readable) only when its close date is at least
 * GSC_LAG_DAYS behind the finalized data. Between calendar close and finalized data it is
 * `pending_data` (the honest "waiting on Google", not "stalled"). The day-56 checkpoint is
 * only evaluated when the caller says this change earned one. Pure.
 */
export function evaluateWindows(
  shippedAt: string,
  now: Date,
  latestGscDate: string | null,
  includeFollowUp = false,
): KernelWindowRead[] {
  const nowIso = reportingDay(now);
  const days: CheckpointDay[] = includeFollowUp ? [...WINDOW_DAYS, FOLLOW_UP_DAY] : [...WINDOW_DAYS];
  return days.map((day) => {
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

/**
 * A STORED READING THAT RAN IS SETTLED. The schedule above recomputes every checkpoint from the
 * CURRENT anchor, so a reading taken under an older clock (a stamp landing after the ship date
 * moves the anchor forward) would recompute onto a close date still in the future, read as
 * "waiting", and demote a change the operator was already told about back to measuring. A window
 * whose stored reading ran keeps ITS OWN close date and stays closed; the live schedule governs
 * only the windows that have not run. Pure.
 */
function settleRanWindows(input: KernelInput, live: ReadonlyArray<KernelWindowRead>): KernelWindowRead[] {
  return live.map((w) => {
    const ran = input.windows.find((s) => s.day === w.day && s.ran === true);
    return ran ? { ...w, closesOn: ran.checkOn?.slice(0, 10) ?? w.closesOn, state: "closed" as WindowState } : { ...w };
  });
}

/** The stamp every checkpoint counts from: when the operator marked the change done,
 *  falling back to the ship date on a row written before there was a stamp. Pure. */
function anchorOf(input: Pick<KernelInput, "implementedAt" | "shippedAt">): string {
  const stamp = input.implementedAt ?? input.shippedAt;
  return stamp.length > 10 ? stamp.slice(0, 10) : stamp;
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

/** The directional read on ONE window: one set of thresholds, so a 28-day read and the 56-day
 *  read that replaces it can never be graded on different rules. Pure. */
const directionalVerdict = (lift: number, floor: number, controls: number): KernelVerdict =>
  (lift >= floor * STRONG_MULTIPLE && controls >= CONTROLS_FOR_STRONG ? "stronger_improvement"
    : lift >= floor ? "directional_improvement" : lift <= -floor ? "directional_decline" : "no_clear_movement");

/**
 * THE 28 TO 56 FLIP, SAID OUT LOUD. When the follow-up read lands in a different band from the
 * 28-day read the operator was already shown, the headline names BOTH and says which one governs;
 * silence would replace a win with a shrug and never admit the change. Empty with no 56-day basis,
 * no 28-day reading behind it, or when the two agree. Pure.
 */
function flipSentence(input: KernelInput, metric: KernelMetric, basisDay: CheckpointDay | null, verdict: KernelVerdict): string {
  const w28 = input.windows.find((w) => w.day === 28 && w.ran);
  if (basisDay !== FOLLOW_UP_DAY || verdict === "confounded" || !w28) return "";
  const word = (v: KernelVerdict): string => (v === "directional_decline" ? "a loss"
    : v === "no_clear_movement" ? "no clear change" : "a win");
  const was = word(directionalVerdict(liftOnMetric(w28, metric), floorFor(metric, input.baselineClicks, 28), w28.controlsUsed));
  return was === word(verdict) ? ""
    : ` The 28 day read looked like ${was}; the full 56 day read shows ${word(verdict)}, and the longer window wins.`;
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
 * Produce the full read for one change. Pure. This is points 3, 6, 7, 8, 9 in one
 * deterministic pass. `overlappingIds` is supplied by detectOverlaps. `cleanUntil` is the
 * day a LATER change landed on the same page and CLOSED this one's clean window:
 * checkpoints that closed on or before that day are this change's alone and stay valid,
 * every checkpoint behind it is confounded by the overlap and says so. When no clean
 * checkpoint is left, a directional read becomes `confounded` (honest: I cannot separate
 * the two, and I never split page movement between components).
 */
export function evaluateChange(
  input: KernelInput,
  windows: KernelWindowRead[],
  overlappingIds: string[],
  cleanUntil: string | null = null,
): KernelRead {
  const metric = metricFor(input.actionType);
  const settled = settleRanWindows(input, windows);
  const marked: KernelWindowRead[] = cleanUntil == null ? settled
    : settled.map((w) => (w.closesOn > cleanUntil ? { ...w, confounded: "overlapping_change" as const } : w));
  const closed = marked.filter((w) => w.state === "closed");
  const cleanDays = new Set(closed.filter((w) => w.confounded == null).map((w) => w.day));
  // Basis = longest CLEAN window that has both closed and a ran reading with data. With no
  // clean one left, the longest confounded window is still read, and named as confounded.
  const readable = [...input.windows]
    .filter((w) => w.ran && closed.some((c) => c.day === w.day))
    .sort((a, b) => b.day - a.day);
  const basisWindow = readable.find((w) => cleanDays.has(w.day)) ?? readable[0];
  const basisDay = basisWindow ? basisWindow.day : null;
  const basisConfounded = basisWindow != null && !cleanDays.has(basisWindow.day);

  const caveats: string[] = [];
  const confidenceReasons: string[] = [];
  const shape = (direction: "up" | "down" | "flat" | "unclear") => learningShape({
    componentKinds: input.componentKinds ?? [],
    actionType: input.actionType,
    diagnosisCause: input.diagnosisCause ?? null,
    evidenceItemCount: input.evidenceItemCount ?? null,
    direction,
  });

  // Point 4: honest lag caveat when a calendar window closed but Google has not
  // caught up.
  const pendingData = marked.some((w) => w.state === "pending_data");
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
      windows: marked,
      basisDay: null,
      lift: 0,
      impressionsLift: 0,
      verdict: "waiting",
      headline: "I am still measuring this. The first read lands once a check window closes and Google finalizes those days.",
      confidence: "low",
      confidenceReasons: ["No check window has closed with finalized data yet."],
      caveats,
      overlappingIds,
      cleanUntil,
      learning: shape("unclear"),
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
      windows: marked,
      basisDay,
      lift,
      impressionsLift,
      verdict: "insufficient_evidence",
      headline: "I cannot read this one confidently yet. There is not enough Search data or enough similar pages to compare against.",
      confidence: "low",
      confidenceReasons,
      caveats,
      overlappingIds,
      cleanUntil,
      learning: shape("unclear"),
      rankingSignal: 0,
    };
  }

  const floor = floorFor(metric, input.baselineClicks, basisDay!);

  // Directional read on the judged metric.
  let verdict: KernelVerdict = directionalVerdict(lift, floor, controls);

  // Point 5 + 6: overlapping changes on the same page over overlapping windows make a
  // single change impossible to isolate. Only downgrade a real directional read (a "no
  // clear movement" stays honest as is). A read whose basis window closed BEFORE the page
  // was changed again keeps its verdict and carries the honest cut-off line instead.
  const isDirectional =
    verdict === "directional_improvement" ||
    verdict === "stronger_improvement" ||
    verdict === "directional_decline";
  if (isDirectional && basisConfounded) {
    caveats.push(`I changed this page again on ${monthDay(cleanUntil!)}, so everything after that day belongs to both changes and I stopped reading this one there.`);
    verdict = "confounded";
  } else if (isDirectional && cleanUntil == null && overlappingIds.length > 0) {
    caveats.push(`I made ${overlappingIds.length} other change${overlappingIds.length === 1 ? "" : "s"} on this page in the same window, so I cannot pin this movement on one change alone.`);
    verdict = "confounded";
  } else if (cleanUntil != null && marked.some((w) => w.confounded != null)) {
    caveats.push(`This is the ${basisDay}-day read, which closed before I changed the page again on ${monthDay(cleanUntil)}. I am not counting the days after that against this change.`);
  }

  // Point 7: never claim clean causality. Every directional headline says
  // "compared to similar pages" and never "caused".
  const headline = buildHeadline({
    verdict, metric, lift, impressionsLift, basisDay: basisDay!,
    overlapCount: overlappingIds.length,
    overlapClosedOn: basisConfounded ? cleanUntil : null,
    ga4ExtraSessions: input.ga4ExtraSessions ?? null,
    ga4Trustworthy: input.ga4Trustworthy === true,
  }) + flipSentence(input, metric, basisDay, verdict);

  // Confidence from transparent conditions only (point: window maturity, data
  // availability, sample size, baseline stability, overlap).
  const mature = basisDay === 28 || basisDay === FOLLOW_UP_DAY;
  let confidence: KernelConfidence = "low";
  if (verdict === "confounded" || verdict === "no_clear_movement") {
    confidence = "low";
  } else if (controls >= CONTROLS_FOR_STRONG && input.baselineImpressions >= IMPRESSIONS_FOR_STRONG && mature) {
    confidence = "high";
  } else if (controls >= MIN_CONTROLS && input.baselineImpressions >= 800) {
    confidence = "medium";
  }
  confidenceReasons.push(`Read on the ${basisDay}-day window against ${controls} similar page${controls === 1 ? "" : "s"}.`);
  if (!mature) confidenceReasons.push("This will firm up when the 28-day window closes.");

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
    windows: marked,
    basisDay,
    lift,
    impressionsLift,
    verdict,
    headline,
    confidence,
    confidenceReasons,
    caveats,
    overlappingIds,
    cleanUntil,
    learning: shape(
      verdict === "stronger_improvement" || verdict === "directional_improvement" ? "up"
        : verdict === "directional_decline" ? "down"
          : verdict === "no_clear_movement" ? "flat" : "unclear",
    ),
    rankingSignal: Math.round(rankingSignal * 100) / 100,
  };
}

// ── Point 8: the ranking outcome signal, aggregated per action type ──────────

/**
 * Aggregate the per-change ranking signals into a per action-type prior in
 * [-1, 1], the small outcome signal recommendation ranking consumes. Only
 * cleanly settled reads contribute (waiting / insufficient / confounded / no
 * clear movement are all zero-signal and ignored). An action type needs at least
 * MIN_RANKING_SAMPLES contributing reads before it earns a prior. Pure.
 */
const MIN_RANKING_SAMPLES = 3;

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
    /** The close date the reading was taken on, so a settled window never moves with the anchor. */
    checkOn?: string | null;
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
  /** THE STAMP, on every Shipment and on no record written before there was one. */
  implementedAt?: string | null;
  /** What the operator says they applied. One record is ONE treatment however many
   *  components it carries, and page movement is never split between them. */
  componentsApplied?: ReadonlyArray<{ kind: string }> | null;
  /** Held on the proposal rather than the ledger today, so they ride the read when a
   *  caller has them and read null when nobody does. Never guessed. */
  diagnosisCause?: string | null;
  evidenceItemCount?: number | null;
};

/** Map a historical record to the kernel's normalized input. Pure. Reads only
 *  the small set of fields the kernel needs; everything else on the record is
 *  ignored (preserved in the store, untouched). */
export function toKernelInput(r: LedgerRecordLike): KernelInput {
  const windows = (r.windows ?? [])
    .filter((w): w is NonNullable<typeof w> =>
      w != null && (w.day === 7 || w.day === 14 || w.day === 28 || w.day === FOLLOW_UP_DAY))
    .map((w) => ({
      day: w.day as CheckpointDay,
      ran: w.ran === true,
      checkOn: w.checkOn ?? null,
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
    implementedAt: r.implementedAt ?? null,
    baselineImpressions: r.baseline?.impressions ?? 0,
    baselineClicks: r.baseline?.clicks ?? 0,
    windows,
    ga4ExtraSessions: r.ga4ExtraSessions ?? null,
    ga4Trustworthy: r.ga4Trustworthy === true,
    componentKinds: (r.componentsApplied ?? []).map((c) => c.kind),
    diagnosisCause: r.diagnosisCause ?? null,
    evidenceItemCount: r.evidenceItemCount ?? null,
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
  const overlaps = overlapClosures(
    inputs.map((i) => ({ id: i.id, path: i.path, anchoredAt: anchorOf(i) })),
  );
  return inputs.map((input) => {
    const o = overlaps.get(input.id) ?? { ids: [], cleanUntil: null };
    // The fourth checkpoint exists only on a record that actually earned a day-56 read.
    const followUp = input.windows.some((w) => w.day === FOLLOW_UP_DAY);
    const windows = evaluateWindows(anchorOf(input), now, latestGscDate, followUp);
    return evaluateChange(input, windows, o.ids, o.cleanUntil);
  });
}

// ── UI bands + labels (point 9) ──────────────────────────────────────────────

type ResultBand = "won" | "promising" | "learned" | "measuring";

/** A read is MATURE once its basis is the 28-day window, or the day-56 follow up that
 *  only an unsettled or dangerous change earns. Pure. */
function isMature(basisDay: CheckpointDay | null): boolean {
  return basisDay === 28 || basisDay === FOLLOW_UP_DAY;
}

/** Which Results band a read belongs to. Pure. "won" = a MATURE improvement;
 *  "promising" = an earlier improvement whose window has not closed (never sold
 *  as a win); "learned" = a mature decline or settled no-movement; "measuring" =
 *  everything else still in flight. */
export function bandOf(read: Pick<KernelRead, "verdict" | "basisDay">): ResultBand {
  if (read.verdict === "directional_improvement" || read.verdict === "stronger_improvement") {
    return isMature(read.basisDay) ? "won" : "promising";
  }
  if (isMature(read.basisDay) && (read.verdict === "directional_decline" || read.verdict === "no_clear_movement")) {
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
  if (closed.length === windows.length && closed.length > 0) return `All ${closed.length} check windows (${closed.join(", ")} days) have closed.`;
  if (closed.length > 0) return `${closed.join(" and ")}-day window${closed.length === 1 ? "" : "s"} closed; the rest are still open.`;
  if (pending) return "A check window has closed on the calendar, but Google has not finalized those days yet.";
  return "Still waiting on the first check window to close.";
}

// ── Learning / ranking compat: settled verdict from a stored record ──────────

/**
 * A window is treated as readable for LEARNING when the stored record already
 * marked it `ran` (Google data was available at measure time). Learning does not
 * re-derive Google's lag; it trusts the stored measurement, on the dates that
 * measurement was actually taken. Pure.
 */
function windowsFromRanFlags(input: KernelInput): KernelWindowRead[] {
  const days: CheckpointDay[] = input.windows.some((w) => w.day === FOLLOW_UP_DAY)
    ? [...WINDOW_DAYS, FOLLOW_UP_DAY] : [...WINDOW_DAYS];
  return settleRanWindows(input, days.map((day) => ({
    day, closesOn: addDays(anchorOf(input), day), state: "waiting" as WindowState,
  })));
}

/**
 * The legacy learning vocabulary ("won" / "lost" / "measuring") the ranking
 * priors consume, derived from a kernel read. Only a MATURE (28-day or day-56
 * basis) directional read is decided; everything weaker or confounded is held as
 * "measuring" (never trains ranking on an early or unseparable signal). Pure.
 */
export function learningVerdictOf(read: KernelRead): "won" | "lost" | "measuring" {
  if (!isMature(read.basisDay)) return "measuring";
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
  const overlaps = overlapClosures(
    inputs.map((i) => ({ id: i.id, path: i.path, anchoredAt: anchorOf(i) })),
  );
  return inputs.map((input, idx) => {
    if (records[idx].operatorVerdictOverride === "inconclusive") {
      // Operator pinned out of learning: read it as no clear movement (measuring).
      return evaluateChange({ ...input, windows: [] }, windowsFromRanFlags(input), []);
    }
    const o = overlaps.get(input.id) ?? { ids: [], cleanUntil: null };
    return evaluateChange(input, windowsFromRanFlags(input), o.ids, o.cleanUntil);
  });
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
