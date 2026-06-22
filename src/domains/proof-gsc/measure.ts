/**
 * GSC Proof ledger — measurement math (Phase 5, Path B). PURE, deterministic.
 *
 * Measures a MANUALLY-shipped change against the page's own before/after Search
 * (GSC) metrics, adjusted by same-site control pages (observational diff-in-diff,
 * NOT causal — we don't run experiments). This is SEPARATE from the citation
 * proof engine (change_outcomes_v2 / natural-controls); it reuses NONE of its
 * enums or thresholds by design.
 *
 *   adjustedLift = (treatedPost − treatedPre) − mean(controlPost − controlPre)
 *
 * No I/O here — callers pass the GSC window readings. `gsc-window.ts` reads them.
 */

export type GscWindowMetrics = {
  clicks: number;
  impressions: number;
  /** 0–1. */
  ctr: number;
  /** Impressions-weighted average position over the window. */
  position: number;
};

/** Ledger verdict — DISTINCT from the citation engine's ResultStatus. */
export type GscProofVerdict =
  | "measuring" // shipped, post-window not finalized yet
  | "won" // treated page beat its controls by a meaningful margin
  | "lost" // treated page fell behind its controls
  | "inconclusive" // movement within noise / no meaningful lift
  | "insufficient_data"; // not enough impressions or controls to judge

export type GscProofConfidence = "high" | "medium" | "low";

export type ProofWindowDay = 7 | 14 | 28;

/** Which Search metric drives the verdict for a given change type. A snippet
 *  play (title/meta/answer/schema) is judged on CTR at the held rank; a rank
 *  play (sections/internal links/new page) on position improvement; everything
 *  else on raw clicks. Clicks alone can't judge a meta-only CTR test (the
 *  audit's gap: /cities + /funny-farsi are CTR tests). */
export type ProofMetric = "clicks" | "ctr" | "position";

export type ProofWindowResult = {
  day: ProofWindowDay;
  /** YYYY-MM-DD the window closes (shippedAt + day). */
  checkOn: string;
  /** True once that window has finalized GSC data to read. */
  ran: boolean;
  /** Treated page: post-window clicks − pre-window clicks. */
  treatedDelta: number;
  /** Mean control page click delta over the same windows. */
  controlDelta: number;
  /** treatedDelta − controlDelta (the observational CLICKS lift). */
  adjustedLift: number;
  /** Treated CTR delta (post − pre), 0 when a window lacked impressions. */
  treatedCtrDelta: number;
  controlCtrDelta: number;
  /** treated − control CTR delta (observational CTR lift, 0–1 scale). */
  adjustedCtrLift: number;
  /** Treated position IMPROVEMENT (pre − post; positive = moved up), 0 when no data. */
  treatedPosDelta: number;
  controlPosDelta: number;
  /** treated − control position improvement (observational rank lift). */
  adjustedPosLift: number;
  /** How many control pages had usable data this window. */
  controlsUsed: number;
};

/** Map a shipped change's action type to the Search metric that actually
 *  measures it. Pure. Unknown/keep types fall back to clicks. */
const CTR_LEVER_ACTIONS = new Set([
  "title", "edit_title", "meta", "edit_meta", "h1", "change_h1",
  "intro_answer_block", "answer_block", "faq", "schema", "add_schema", "fix_schema",
]);
const POSITION_LEVER_ACTIONS = new Set([
  "section_add", "section_remove", "section_reorder", "internal_link",
  "add_internal_link", "create_new_page", "expand_content", "section_content",
]);
export function pickProofMetric(actionType: string): ProofMetric {
  const a = (actionType || "").toLowerCase();
  if (CTR_LEVER_ACTIONS.has(a)) return "ctr";
  if (POSITION_LEVER_ACTIONS.has(a)) return "position";
  return "clicks";
}

export const PROOF_WINDOW_DAYS: ProofWindowDay[] = [7, 14, 28];

// ── Thresholds (observational, conservative). Named so they're auditable. ──
/** A page needs at least this many baseline impressions for any verdict. */
const MIN_BASELINE_IMPRESSIONS = 200;
/** Lift must clear the larger of this many clicks OR this fraction of baseline. */
const MIN_LIFT_CLICKS = 3;
const MIN_LIFT_FRACTION = 0.1;
/** ≥ this many usable controls ⇒ a computed (not raw) comparison. */
const MIN_CONTROLS_FOR_COMPUTED = 2;
const MIN_CONTROLS_FOR_HIGH = 3;
/** CTR lift floor (absolute, 0–1): a 0.3 percentage-point diff-in-diff clears it. */
const MIN_LIFT_CTR = 0.003;
/** Position lift floor: moving up half a rank more than controls clears it. */
const MIN_LIFT_POSITION = 0.5;

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Add `days` to a YYYY-MM-DD (or ISO) date, returning YYYY-MM-DD. Pure (UTC). */
export function addDays(dateStr: string, days: number): string {
  const base = dateStr.length > 10 ? dateStr.slice(0, 10) : dateStr;
  const [y, m, d] = base.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** The 7/14/28-day check-in dates after a ship date. Pure. */
export function proofCheckDates(shippedAtIso: string): Record<ProofWindowDay, string> {
  return {
    7: addDays(shippedAtIso, 7),
    14: addDays(shippedAtIso, 14),
    28: addDays(shippedAtIso, 28),
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const mean = (xs: number[]): number =>
  xs.length > 0 ? xs.reduce((s, d) => s + d, 0) / xs.length : 0;
/** CTR only moves meaningfully when BOTH windows had impressions (a window with
 *  zero impressions has no real CTR, so 0 is not "CTR fell to zero"). */
const ctrDelta = (m0: GscWindowMetrics, m1: GscWindowMetrics): number =>
  m0.impressions > 0 && m1.impressions > 0 ? m1.ctr - m0.ctr : 0;
/** Position improvement = pre − post (lower rank is better); needs real ranks. */
const posImprove = (m0: GscWindowMetrics, m1: GscWindowMetrics): number =>
  m0.position > 0 && m1.position > 0 ? m0.position - m1.position : 0;

/**
 * One window's observational diff-in-diff across all three Search metrics
 * (clicks, CTR, position) from already-read treated + control window readings.
 * Pure. CTR/position are impression/rank-guarded so a no-data window can't fake
 * a swing; clicks use 0 as a valid value.
 */
export function computeWindowLift(args: {
  day: ProofWindowDay;
  checkOn: string;
  ran: boolean;
  treatedPre: GscWindowMetrics;
  treatedPost: GscWindowMetrics;
  /** Per-control pre/post readings for controls with usable data. */
  controls: ReadonlyArray<{ pre: GscWindowMetrics; post: GscWindowMetrics }>;
}): ProofWindowResult {
  const { treatedPre, treatedPost, controls } = args;

  const treatedDelta = treatedPost.clicks - treatedPre.clicks;
  const treatedCtrDelta = ctrDelta(treatedPre, treatedPost);
  const treatedPosDelta = posImprove(treatedPre, treatedPost);

  const controlDelta = mean(controls.map((c) => c.post.clicks - c.pre.clicks));
  const controlCtrDelta = mean(controls.map((c) => ctrDelta(c.pre, c.post)));
  const controlPosDelta = mean(controls.map((c) => posImprove(c.pre, c.post)));

  return {
    day: args.day,
    checkOn: args.checkOn,
    ran: args.ran,
    treatedDelta,
    controlDelta: round2(controlDelta),
    adjustedLift: round2(treatedDelta - controlDelta),
    treatedCtrDelta: round4(treatedCtrDelta),
    controlCtrDelta: round4(controlCtrDelta),
    adjustedCtrLift: round4(treatedCtrDelta - controlCtrDelta),
    treatedPosDelta: round2(treatedPosDelta),
    controlPosDelta: round2(controlPosDelta),
    adjustedPosLift: round2(treatedPosDelta - controlPosDelta),
    controlsUsed: controls.length,
  };
}

/**
 * Roll the per-window results + baseline into a single verdict + confidence. Pure.
 * Uses the LONGEST window that has run (28 > 14 > 7) — the most-settled signal.
 */
export function summarizeVerdict(args: {
  windows: ReadonlyArray<ProofWindowResult>;
  baselineImpressions: number;
  baselineClicks: number;
  /** Which metric judges this change (default clicks for back-compat). */
  metric?: ProofMetric;
}): {
  verdict: GscProofVerdict;
  confidence: GscProofConfidence;
  basis: ProofWindowResult | null;
  metric: ProofMetric;
  /** The basis window's adjusted lift on the chosen metric. */
  lift: number;
} {
  const metric = args.metric ?? "clicks";
  const ran = args.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day);
  const basis = ran[0] ?? null;

  const liftOf = (w: ProofWindowResult): number =>
    metric === "ctr" ? w.adjustedCtrLift : metric === "position" ? w.adjustedPosLift : w.adjustedLift;
  const lift = basis ? liftOf(basis) : 0;

  if (args.baselineImpressions < MIN_BASELINE_IMPRESSIONS) {
    return { verdict: "insufficient_data", confidence: "low", basis, metric, lift };
  }
  if (!basis) {
    return { verdict: "measuring", confidence: "low", basis: null, metric, lift: 0 };
  }
  // A single comparator is "treated minus one arbitrary page", not a diff-in-diff.
  // Require the same floor the recorder enforces (>=2) before naming a won/lost.
  if (basis.controlsUsed < MIN_CONTROLS_FOR_COMPUTED) {
    return { verdict: "insufficient_data", confidence: "low", basis, metric, lift };
  }

  const floor =
    metric === "ctr"
      ? MIN_LIFT_CTR
      : metric === "position"
        ? MIN_LIFT_POSITION
        : Math.max(MIN_LIFT_CLICKS, args.baselineClicks * MIN_LIFT_FRACTION);
  let verdict: GscProofVerdict;
  if (lift >= floor) verdict = "won";
  else if (lift <= -floor) verdict = "lost";
  else verdict = "inconclusive";

  let confidence: GscProofConfidence = "low";
  if (basis.controlsUsed >= MIN_CONTROLS_FOR_HIGH && args.baselineImpressions >= 3000) {
    confidence = "high";
  } else if (
    basis.controlsUsed >= MIN_CONTROLS_FOR_COMPUTED &&
    args.baselineImpressions >= 800
  ) {
    confidence = "medium";
  }
  return { verdict, confidence, basis, metric, lift };
}

/** Format the metric-specific lift as a plain-English magnitude (no dashes). */
export function formatLift(metric: ProofMetric, lift: number): string {
  if (metric === "ctr") {
    const pp = Math.round(lift * 1000) / 10; // 0–1 fraction → percentage points, 1dp
    return `${pp >= 0 ? "+" : ""}${pp}pp CTR`;
  }
  if (metric === "position") {
    const r = Math.round(Math.abs(lift) * 10) / 10;
    return `${r} ${r === 1 ? "rank" : "ranks"}`;
  }
  const c = Math.round(lift);
  return `${c >= 0 ? "+" : ""}${c} clicks`;
}

/**
 * Per-window lift in the SAME unit the verdict is judged on, so the window
 * breakdown can never contradict the headline sentence. Reads the metric's own
 * adjusted delta (clicks / ctr / position) instead of always showing clicks.
 * For position (an unsigned magnitude) it appends the direction, since a smaller
 * position number is an improvement.
 */
export function formatWindowLift(
  metric: ProofMetric,
  w: Pick<ProofWindowResult, "adjustedLift" | "adjustedCtrLift" | "adjustedPosLift">,
): string {
  if (metric === "ctr") return formatLift("ctr", w.adjustedCtrLift);
  if (metric === "position") {
    // adjustedPosLift > 0 = treated page moved UP vs controls (pre−post).
    const lift = w.adjustedPosLift;
    const mag = formatLift("position", lift);
    if (lift === 0) return `${mag} (no change)`;
    return `${mag} ${lift > 0 ? "up" : "down"}`;
  }
  return formatLift("clicks", w.adjustedLift);
}

/** Plain-English, honesty-gated outcome line for the UI. Pure. Metric-aware:
 *  a meta/title test reads in CTR, a content test in position, else clicks. */
export function proofOutcomeSentence(args: {
  verdict: GscProofVerdict;
  confidence: GscProofConfidence;
  basis: ProofWindowResult | null;
  metric?: ProofMetric;
  lift?: number;
}): string {
  const { verdict, confidence, basis } = args;
  const metric = args.metric ?? "clicks";
  if (verdict === "measuring") {
    return "Measuring, waiting for the first check-in window to close.";
  }
  if (verdict === "insufficient_data") {
    return "Not enough Search data (or control pages) to judge this change yet.";
  }
  const win = basis ? `${basis.day}-day` : "";
  const lift =
    args.lift ??
    (basis
      ? metric === "ctr"
        ? basis.adjustedCtrLift
        : metric === "position"
          ? basis.adjustedPosLift
          : basis.adjustedLift
      : 0);
  if (verdict === "won") {
    const dir = metric === "position" ? " (moved up)" : "";
    return `Likely helping: ${formatLift(metric, lift)}${dir} vs comparable pages over the ${win} window (${confidence} confidence, observational).`;
  }
  if (verdict === "lost") {
    const dir = metric === "position" ? " (slipped)" : "";
    return `Likely hurting: ${formatLift(metric, lift)}${dir} vs comparable pages over the ${win} window (${confidence} confidence, observational).`;
  }
  return `No clear effect yet: movement is within the range of comparable pages (${win}, ${confidence} confidence).`;
}
