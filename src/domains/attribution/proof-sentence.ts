/**
 * proof-sentence — the causal Proof Engine's plain-English voice (2026-06-11).
 *
 * The Proof Engine (natural-controls → StoredChangeOutcome) produces a
 * rigorous diff-in-differences result, but the only customer surface that
 * renders it (AttributionDrilldown) speaks analyst: "diff-in-differences
 * estimate · N_controls=3 · treated Δ=+2 · control Δ=0". Beacon's buyer is a
 * non-technical local-business owner — the wedge ("we proved your edit caused
 * the lift") is worthless if they can't read it.
 *
 * This turns one StoredChangeOutcome into ONE honest plain-English sentence
 * (+ a supporting caveat line). Deterministic, pure, no I/O. The causal
 * framing ("more than comparable pages that DIDN'T change") is exactly what
 * diff-in-differences licenses — and the honesty rules below mirror the
 * engine's own computed-vs-weak_estimate discipline:
 *   • a cause-and-effect claim ONLY for `computed` outcomes (≥ minControls
 *     comparable untreated pages); the confidence tier is spoken, not hidden;
 *   • `weak_estimate` / `no_controls` / `insufficient_*` / `zero_signal` are
 *     "still measuring" — explicitly NOT a causal claim;
 *   • parallel-trends is unverifiable from data, so even a high-confidence
 *     result is phrased as "measured", and low-confidence is softened to
 *     "an early read", never overstated.
 *
 * Grounding for the causal language + its caveats (≥5 sources): see
 * changelog-classifier.ts / causal-self-forecast.ts headers (Huntington-Klein
 * "The Effect" ch.18 DiD; Cunningham "Mixtape" ch.9; the parallel-trends
 * make-or-break assumption; synthetic-control comparable-unit selection; AI-
 * citation frequency as the unit). This module adds NO new claim — it only
 * narrates, conservatively, what the engine already computed.
 *
 * Pinned by proof-sentence.test.ts.
 */

import type { StoredChangeOutcome } from "./change-outcome-store";
import type { ConfidenceTier } from "./natural-controls";

export type ProofTone = "helping" | "hurting" | "flat" | "watching" | "none";

export type ProofSentence = {
  tone: ProofTone;
  /** The one big plain-English line. Always present. */
  headline: string;
  /** Honest supporting caveat / confidence line. May be empty. */
  sub: string;
};

/** cit/day magnitude below which a computed result reads as "no real move". */
const FLAT_LIFT_THRESHOLD = 0.5;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function confidencePhrase(tier: ConfidenceTier): string {
  switch (tier) {
    case "high":
      return "a strong, clearly measured result";
    case "medium":
      return "a moderate signal";
    case "low":
      return "an early, low-confidence read";
  }
}

function controlsPhrase(controls: number): string {
  return controls === 1
    ? "1 similar page that didn't change"
    : `${controls} similar pages that didn't change`;
}

function relativeClause(relative_lift: number | null): string {
  if (relative_lift == null || relative_lift <= 0) return "";
  return ` — about +${Math.round(relative_lift * 100)}% more`;
}

/**
 * Build the customer-facing plain-English proof for one stored outcome.
 * Never overstates: causal language is reserved for `computed`, and the
 * confidence tier is always spoken.
 */
export function buildProofSentence(outcome: StoredChangeOutcome): ProofSentence {
  const { status, confidence } = outcome;

  if (status === "computed" && outcome.computed?.overall) {
    const lift = outcome.computed.overall.adjusted_lift;
    const rel = outcome.computed.overall.relative_lift;
    const controls = outcome.computed.overall.controls_used;
    const conf = confidencePhrase(confidence);

    if (lift >= FLAT_LIFT_THRESHOLD) {
      const softener =
        confidence === "low"
          ? " It's an early read, so treat it as a hint rather than a guarantee."
          : " That's cause-and-effect, not just a coincidence of timing.";
      return {
        tone: "helping",
        headline: `This change brought in about +${round1(lift)} more AI citation${round1(lift) === 1 ? "" : "s"} a day than comparable pages that didn't change${relativeClause(rel)}.`,
        sub: `Measured against ${controlsPhrase(controls)} — ${conf}.${softener}`,
      };
    }
    if (lift <= -FLAT_LIFT_THRESHOLD) {
      return {
        tone: "hurting",
        headline: `Since this change, this page lost about ${round1(Math.abs(lift))} AI citation${round1(Math.abs(lift)) === 1 ? "" : "s"} a day relative to comparable pages that didn't change — it may be working against you.`,
        sub: `Measured against ${controlsPhrase(controls)} — ${conf}. Worth a second look before doing more like it.`,
      };
    }
    return {
      tone: "flat",
      headline: `This change didn't move your AI citations either way, compared with comparable pages that didn't change.`,
      sub: `Measured against ${controlsPhrase(controls)} — ${conf}.`,
    };
  }

  switch (status) {
    case "weak_estimate":
    case "no_controls":
      return {
        tone: "watching",
        headline: `Still measuring — Beacon can't yet prove whether this change moved your AI citations.`,
        sub: `There aren't enough comparable pages to separate this change's effect from everything else going on. Watching as more data comes in.`,
      };
    case "insufficient_post_data":
      return {
        tone: "watching",
        headline: `Too soon to tell — not enough days have passed since this change to measure its effect.`,
        sub: `Check back after the measurement window closes.`,
      };
    case "insufficient_baseline":
      return {
        tone: "watching",
        headline: `Not enough history before this change to measure its effect reliably yet.`,
        sub: `As this page builds a citation track record, Beacon will be able to measure future changes.`,
      };
    case "zero_signal":
      return {
        tone: "none",
        headline: `AI tools haven't cited this page before or after this change — there's nothing to measure yet.`,
        sub: ``,
      };
    default:
      // unsupported_scope / ineligible_layer / ineligible_event
      return {
        tone: "none",
        headline: `This change isn't something Beacon can measure page-by-page (it's site-wide, off-site, or not a page edit).`,
        sub: ``,
      };
  }
}
