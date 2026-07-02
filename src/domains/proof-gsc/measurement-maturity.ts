/**
 * measurement-maturity (2026-06-30, Move 2) — THE single, pure source of measurement
 * TRUTH for the whole product. Separates three concepts a proof record conflates:
 *
 *   MATURITY  — how far the measurement has progressed (collecting → early → interim
 *               → mature), independent of which way it moved.
 *   DIRECTION — which way the basis window moved (positive / negative / neutral).
 *   VERDICT   — the FINAL operator-facing call. Exists ONLY at mature_result.
 *
 * Why this module exists: the stored `verdict`/`confidence` on a ShippedChangeRecord
 * are computed from "the longest window that has run", so a record whose ONLY closed
 * window is the 7-day one can be persisted as verdict="lost", confidence="high"
 * (measure.ts:summarizeVerdict). That is an EARLY signal, not a final loss. Every
 * surface (Results, Changes, MoveCard, learning, aggregates) must reinterpret the
 * stored fields through THIS resolver so a 7-day read can never masquerade as a final
 * verdict, never earn mature high confidence, and never permanently train ranking.
 *
 * PURE — no I/O. Reads the record's `windows` (the ground truth for which checkpoint
 * actually closed) + the finalized GSC watermark. Pinned by measurement-maturity.test.ts.
 */

import { addDays, proofCheckDates, PROOF_WINDOW_DAYS, type ProofWindowDay } from "./measure";

export type MeasurementMaturity =
  | "scheduled" // not yet live / activated — no measurement language at all
  | "collecting" // live; first checkpoint not open OR required GSC data not in yet
  | "early_checkpoint" // 7-day window closed — directional only, never final
  | "interim_checkpoint" // 14-day window closed — stronger, still not final
  | "mature_result" // 28-day window closed + sufficient data — final verdict eligible
  | "inconclusive" // mature window closed but evidence insufficient/within noise
  | "blocked_data" // checkpoint date passed but the GSC/GA4 data it needs isn't in
  | "attribution_limited"; // a measurement exists but an overlapping edit weakens it

export type MeasurementDirection = "positive" | "negative" | "neutral" | "unknown";
export type AttributionQuality = "clean" | "limited" | "compound";
export type PresentationConfidence = "high" | "medium" | "low";
export type EvidenceStrength = "strong" | "directional" | "tracking";

/** A change that overlaps this measurement window on the same page. */
export type OverlapContext = {
  /** "compound" = intentionally shipped together (one package); "overlap" = a second
   *  edit landed while this one was still measuring (accidental → weakens attribution). */
  kind: "compound" | "overlap";
  otherChangeCount: number;
};

/** Everything the resolver needs — all derivable from a ShippedChangeRecord + the
 *  finalized GSC watermark, with NO extra I/O. */
export type MaturityInput = {
  /** Ship date (ISO or YYYY-MM-DD). null/empty ⇒ not shipped ⇒ scheduled. */
  shippedAt: string | null;
  now: Date;
  /** Latest finalized GSC date (the watermark) — null when no GSC data at all. */
  latestGscDate: string | null;
  /** The record's proof windows (day + whether that window has closed/ran). */
  windows: ReadonlyArray<{ day: number; ran: boolean }>;
  /** The stored GSC verdict (won/lost/inconclusive/measuring/insufficient_data). */
  verdict: string;
  /** Usable controls on the basis window (diff-in-diff comparators). */
  controlsUsed: number;
  /** Treated page baseline impressions (sufficiency gate). */
  baselineImpressions: number;
  /** Overlap/compound context, when another edit touches the same page+window. */
  overlap?: OverlapContext | null;
  /** Whether the change is live/activated. Defaults to true (proof rows are live). */
  live?: boolean;
};

/** Minimum sufficiency for a MATURE verdict (mirrors measure.ts thresholds). */
const MIN_CONTROLS_FOR_MATURE = 2;
const MIN_BASELINE_FOR_MATURE = 200;

const dayStr = (now: Date): string => now.toISOString().slice(0, 10);

/** The latest proof window day that has actually CLOSED (28 > 14 > 7), or null. */
export function basisDayOf(windows: ReadonlyArray<{ day: number; ran: boolean }>): ProofWindowDay | null {
  const ran = windows.filter((w) => w.ran).map((w) => w.day).sort((a, b) => b - a);
  const top = ran[0];
  return top === 7 || top === 14 || top === 28 ? (top as ProofWindowDay) : null;
}

/** Which way the basis window moved (independent of maturity). PURE. */
export function directionOf(verdict: string): MeasurementDirection {
  if (verdict === "won") return "positive";
  if (verdict === "lost") return "negative";
  if (verdict === "inconclusive" || verdict === "insufficient_data") return "neutral";
  return "unknown"; // measuring / unknown
}

function attributionQualityOf(overlap?: OverlapContext | null): AttributionQuality {
  if (!overlap) return "clean";
  return overlap.kind === "compound" ? "compound" : "limited";
}

/**
 * The single maturity resolver. PURE. Reads which window actually CLOSED (not the
 * stored verdict) plus the GSC watermark, so an early read is always recognized as
 * early. Precedence is "dominant caveat first": scheduled → accidental-overlap →
 * blocked-data → by basis window (28/14/7) → collecting.
 */
export function deriveMeasurementMaturity(input: MaturityInput): MeasurementMaturity {
  if (!input.shippedAt || input.live === false) return "scheduled";
  const basis = basisDayOf(input.windows);

  // Accidental overlap weakens attribution for ANY readable/active measurement — it
  // dominates the headline (a package shipped on purpose is "compound", not limited).
  if (input.overlap?.kind === "overlap" && input.overlap.otherChangeCount > 0) {
    return "attribution_limited";
  }

  if (basis === 28) {
    const sufficient =
      input.controlsUsed >= MIN_CONTROLS_FOR_MATURE &&
      input.baselineImpressions >= MIN_BASELINE_FOR_MATURE &&
      (input.verdict === "won" || input.verdict === "lost");
    return sufficient ? "mature_result" : "inconclusive";
  }
  if (basis === 14) return "interim_checkpoint";
  if (basis === 7) return "early_checkpoint";

  // No window has closed yet. Distinguish "still waiting on the calendar" (collecting)
  // from "the date passed but Google's data hasn't arrived" (blocked_data).
  const nextDay = PROOF_WINDOW_DAYS.find((d) => !input.windows.some((w) => w.day === d && w.ran)) ?? null;
  if (nextDay != null) {
    const checkOn = proofCheckDates(input.shippedAt)[nextDay as ProofWindowDay];
    const requiredGscDate = addDays(checkOn, -1);
    const calendarClosed = dayStr(input.now) >= checkOn;
    const gscAvailable = input.latestGscDate != null && input.latestGscDate >= requiredGscDate;
    if (calendarClosed && !gscAvailable) return "blocked_data";
  }
  return "collecting";
}

// ── Presentation: the view-model every surface renders from ──

export type MeasurementPresentation = {
  maturity: MeasurementMaturity;
  direction: MeasurementDirection;
  /** The FINAL verdict — non-null ONLY at mature_result. */
  verdict: "helped" | "no_lift" | "did_not_help" | null;
  confidence: PresentationConfidence;
  /** Short operator-facing headline (the only line a compact row needs). */
  headline: string;
  /** One honest follow-on sentence (next checkpoint / waiting-for-data / overlap). */
  explanation: string;
  /** Soonest future checkpoint date (YYYY-MM-DD), or null. */
  nextCheckpoint: string | null;
  /** The GSC date the next/last window needs, and what Google currently has. */
  requiredDataThrough: string | null;
  availableDataThrough: string | null;
  evidenceStrength: EvidenceStrength;
  attributionQuality: AttributionQuality;
  /** True ONLY when a mature, cleanly-attributed result may train ranking. */
  learningEligibility: boolean;
  /** The window day this reads from (7/14/28), or null when nothing has closed. */
  basisDay: ProofWindowDay | null;
  /** Semantic tone for UI color — never red/green before maturity. */
  tone: "positive" | "negative" | "neutral" | "progress" | "waiting";
};

function maturityConfidence(
  maturity: MeasurementMaturity,
  controlsUsed: number,
  baselineImpressions: number,
): PresentationConfidence {
  if (maturity !== "mature_result") {
    return maturity === "interim_checkpoint" ? "medium" : "low";
  }
  // Mature: high requires strong sufficiency; never from control count alone at 7d
  // (that path can't reach here — maturity gates it).
  if (controlsUsed >= 3 && baselineImpressions >= 3000) return "high";
  if (controlsUsed >= 2 && baselineImpressions >= 800) return "medium";
  return "low";
}

function evidenceStrengthOf(maturity: MeasurementMaturity, attribution: AttributionQuality): EvidenceStrength {
  if (maturity === "mature_result" && attribution === "clean") return "strong";
  if (maturity === "scheduled" || maturity === "collecting" || maturity === "blocked_data") return "tracking";
  return "directional"; // early / interim / inconclusive / attribution_limited
}

/** Build the full presentation for a record. PURE — the one place language is decided. */
export function buildMeasurementPresentation(input: MaturityInput): MeasurementPresentation {
  const maturity = deriveMeasurementMaturity(input);
  const direction = directionOf(input.verdict);
  const attributionQuality = attributionQualityOf(input.overlap);
  const basisDay = basisDayOf(input.windows);
  const checks = input.shippedAt ? proofCheckDates(input.shippedAt) : null;

  const nextDay = input.shippedAt
    ? (PROOF_WINDOW_DAYS.find((d) => !input.windows.some((w) => w.day === d && w.ran)) ?? null)
    : null;
  const nextCheckpoint = nextDay != null && checks ? checks[nextDay as ProofWindowDay] : null;
  const finalCheckpoint = checks ? checks[28] : null;
  const requiredDataThrough =
    maturity === "blocked_data" && nextCheckpoint ? addDays(nextCheckpoint, -1) : null;

  const confidence = maturityConfidence(maturity, input.controlsUsed, input.baselineImpressions);
  const evidenceStrength = evidenceStrengthOf(maturity, attributionQuality);
  const learningEligibility = maturity === "mature_result" && attributionQuality === "clean";

  const verdict: MeasurementPresentation["verdict"] =
    maturity === "mature_result"
      ? direction === "positive" ? "helped" : direction === "negative" ? "did_not_help" : "no_lift"
      : null;

  let headline = "";
  let explanation = "";
  let tone: MeasurementPresentation["tone"] = "neutral";

  switch (maturity) {
    case "scheduled":
      headline = "Not shipped yet";
      explanation = "Measurement starts once this change is live.";
      tone = "neutral";
      break;
    case "collecting":
      headline = "Collecting data";
      explanation = nextCheckpoint
        ? `First checkpoint opens ${nextCheckpoint}.${input.latestGscDate ? ` Google data currently available through ${input.latestGscDate}.` : ""}`
        : "Gathering the first Search Console window.";
      tone = "progress";
      break;
    case "early_checkpoint":
      headline = direction === "positive" ? "Early positive signal" : direction === "negative" ? "Early negative signal" : "Too early to call";
      explanation = `7-day signal, directional only.${finalCheckpoint ? ` Final checkpoint opens ${finalCheckpoint}.` : ""}`;
      tone = direction === "positive" ? "progress" : direction === "negative" ? "progress" : "neutral";
      break;
    case "interim_checkpoint":
      headline = direction === "positive" ? "Interim positive signal" : direction === "negative" ? "Interim negative signal" : "Still inconclusive";
      explanation = `Evidence strengthening at 14 days.${finalCheckpoint ? ` Final checkpoint opens ${finalCheckpoint}.` : ""}`;
      tone = "progress";
      break;
    case "mature_result":
      if (verdict === "helped") { headline = confidence === "high" ? "Helped" : "Likely helped"; tone = "positive"; }
      else if (verdict === "did_not_help") { headline = confidence === "high" ? "Did not help" : "Likely hurt"; tone = "negative"; }
      else { headline = "No clear lift"; tone = "neutral"; }
      explanation = "Measured over the full 28-day window versus comparison pages.";
      break;
    case "inconclusive":
      headline = "No clear result";
      explanation = "The 28-day window closed but the change didn't move the metric beyond normal variation.";
      tone = "neutral";
      break;
    case "blocked_data":
      headline = "Waiting for Google data";
      explanation = `Checkpoint date reached, waiting for Search Console data through ${requiredDataThrough ?? "the window close"}. This measurement is not stalled.`;
      tone = "waiting";
      break;
    case "attribution_limited":
      headline = direction === "positive" ? "Directional (overlapping edit)" : direction === "negative" ? "Directional (overlapping edit)" : "Directional only";
      explanation = "Another change on this page overlaps this measurement, so attribution is weakened; read as directional.";
      tone = "neutral";
      break;
  }

  return {
    maturity,
    direction,
    verdict,
    confidence,
    headline,
    explanation,
    nextCheckpoint,
    requiredDataThrough,
    availableDataThrough: input.latestGscDate,
    evidenceStrength,
    attributionQuality,
    learningEligibility,
    basisDay,
    tone,
  };
}

const MAX_WINDOW_DAYS = Math.max(...PROOF_WINDOW_DAYS);

const normPath = (p: string): string =>
  ((p || "/").replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/$/, "") || "/";

/**
 * Derive overlap context for each proof record from ship timestamps alone (no new
 * table): two records on the SAME page whose 28-day measurement windows intersect
 * weaken each other's attribution. PURE. Returns a Map keyed by record id; absence
 * = clean. Intentional same-day packages collapse to one proof id upstream
 * (id = path::date), so anything detected here is an accidental overlap.
 */
export function detectMeasurementOverlaps(
  records: ReadonlyArray<{ id: string; path: string; shippedAt: string }>,
): Map<string, OverlapContext> {
  const out = new Map<string, OverlapContext>();
  for (let i = 0; i < records.length; i++) {
    const a = records[i];
    if (!a.shippedAt) continue;
    let count = 0;
    for (let j = 0; j < records.length; j++) {
      if (i === j) continue;
      const b = records[j];
      if (!b.shippedAt || normPath(a.path) !== normPath(b.path)) continue;
      const diffDays = Math.abs(Date.parse(a.shippedAt) - Date.parse(b.shippedAt)) / 86_400_000;
      if (diffDays < MAX_WINDOW_DAYS) count++;
    }
    if (count > 0) out.set(a.id, { kind: "overlap", otherChangeCount: count });
  }
  return out;
}

/** Does this record's measurement count as a FINAL outcome (for aggregates)? PURE. */
export function isMatureOutcome(maturity: MeasurementMaturity): boolean {
  return maturity === "mature_result";
}

/** Is this still in-flight (belongs in "Measuring", not a final bucket)? PURE. */
export function isInFlight(maturity: MeasurementMaturity): boolean {
  return (
    maturity === "scheduled" ||
    maturity === "collecting" ||
    maturity === "early_checkpoint" ||
    maturity === "interim_checkpoint" ||
    maturity === "blocked_data" ||
    maturity === "attribution_limited"
  );
}
