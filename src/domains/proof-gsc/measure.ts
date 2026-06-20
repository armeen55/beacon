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
  /** treatedDelta − controlDelta (the observational lift). */
  adjustedLift: number;
  /** How many control pages had usable data this window. */
  controlsUsed: number;
};

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

/** One window's diff-in-diff from already-read treated + control click deltas. Pure. */
export function computeWindowLift(args: {
  day: ProofWindowDay;
  checkOn: string;
  ran: boolean;
  treatedPreClicks: number;
  treatedPostClicks: number;
  /** Per-control [preClicks, postClicks] for controls with usable data. */
  controls: ReadonlyArray<{ preClicks: number; postClicks: number }>;
}): ProofWindowResult {
  const treatedDelta = args.treatedPostClicks - args.treatedPreClicks;
  const controlDeltas = args.controls.map((c) => c.postClicks - c.preClicks);
  const controlDelta =
    controlDeltas.length > 0
      ? controlDeltas.reduce((s, d) => s + d, 0) / controlDeltas.length
      : 0;
  return {
    day: args.day,
    checkOn: args.checkOn,
    ran: args.ran,
    treatedDelta,
    controlDelta: Math.round(controlDelta * 100) / 100,
    adjustedLift: Math.round((treatedDelta - controlDelta) * 100) / 100,
    controlsUsed: controlDeltas.length,
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
}): { verdict: GscProofVerdict; confidence: GscProofConfidence; basis: ProofWindowResult | null } {
  const ran = args.windows.filter((w) => w.ran).sort((a, b) => b.day - a.day);
  const basis = ran[0] ?? null;

  if (args.baselineImpressions < MIN_BASELINE_IMPRESSIONS) {
    return { verdict: "insufficient_data", confidence: "low", basis };
  }
  if (!basis) {
    return { verdict: "measuring", confidence: "low", basis: null };
  }
  // A single comparator is "treated minus one arbitrary page", not a diff-in-diff.
  // Require the same floor the recorder enforces (>=2) before naming a won/lost.
  if (basis.controlsUsed < MIN_CONTROLS_FOR_COMPUTED) {
    return { verdict: "insufficient_data", confidence: "low", basis };
  }

  const liftFloor = Math.max(MIN_LIFT_CLICKS, args.baselineClicks * MIN_LIFT_FRACTION);
  let verdict: GscProofVerdict;
  if (basis.adjustedLift >= liftFloor) verdict = "won";
  else if (basis.adjustedLift <= -liftFloor) verdict = "lost";
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
  return { verdict, confidence, basis };
}

/** Plain-English, honesty-gated outcome line for the UI. Pure. */
export function proofOutcomeSentence(args: {
  verdict: GscProofVerdict;
  confidence: GscProofConfidence;
  basis: ProofWindowResult | null;
}): string {
  const { verdict, confidence, basis } = args;
  if (verdict === "measuring") {
    return "Measuring, waiting for the first check-in window to close.";
  }
  if (verdict === "insufficient_data") {
    return "Not enough Search data (or control pages) to judge this change yet.";
  }
  const lift = basis ? Math.round(basis.adjustedLift) : 0;
  const win = basis ? `${basis.day}-day` : "";
  if (verdict === "won") {
    return `Likely helping: +${lift} clicks vs comparable pages over the ${win} window (${confidence} confidence, observational).`;
  }
  if (verdict === "lost") {
    return `Likely hurting: ${lift} clicks vs comparable pages over the ${win} window (${confidence} confidence, observational).`;
  }
  return `No clear effect yet: movement is within the range of comparable pages (${win}, ${confidence} confidence).`;
}
