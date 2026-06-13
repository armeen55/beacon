/**
 * causal-self-forecast — the Move Forecast's n=1 engine (2026-06-11 day shift).
 *
 * THE LOOP, CLOSED. The Proof Engine (proof-engine.ts) proves causally what
 * each SHIPPED edit drove (diff-in-diff `adjusted_lift`, persisted per
 * tenant). This module reads that proven history back out and turns it into
 * a forward-looking forecast for the NEXT, not-yet-shipped edit of the same
 * kind:
 *
 *     "In your history, M of your last N changes like this measurably
 *      lifted how often AI tools cite you — typically +X%."
 *
 * It is the dream's stage 3 ("forecast an edit's citation lift BEFORE you
 * ship it"), made real at n=1 — no second tenant, no network, no paid API.
 *
 * Why this is honest, and where it sits next to the two forecasts that
 * already exist:
 *   • simulateAction (whatif-engine.ts) forecasts from coarse action-
 *     TRACKING (was a past recommendation accepted / did its scorecard
 *     validate). Useful, but it never sees the causal diff-in-diff lift.
 *   • buildPeerMoveForecast (move-forecast.ts) forecasts from CROSS-TENANT
 *     peer patterns — inert until a 2nd tenant exists + the gate is on.
 *   • THIS forecasts from the tenant's OWN causal-grade outcomes — the
 *     strongest first-party evidence Beacon has, available from day one.
 *
 * METHOD — reference-class forecasting (a.k.a. taking the "outside view"):
 * build a reference class of comparable past changes, then read the
 * empirical base rate off that class rather than guessing from the inside.
 * The forecast is ASSOCIATIVE (a base rate over priors), NOT a causal claim
 * about the future edit — that distinction is the whole point of the
 * outside view, and it keeps this honest where a naive "this will lift you
 * +X" would not be. Reference classes must be "broad enough to be
 * statistically meaningful but narrow enough to be truly comparable", so we
 * prefer (bucket × url_type) and fall back to (bucket) when the narrow
 * class is too thin (reported via `matched_on`).
 *
 * Research backing (≥5 credible sources):
 *   1. Reference class forecasting (the outside view; broad-enough/narrow-
 *      enough reference-class rule): https://en.wikipedia.org/wiki/Reference_class_forecasting
 *   2. Flyvbjerg & Kahneman, RCF from Nobel-prize work to practice (base
 *      rates beat naive inside-view forecasts, empirically calibrated):
 *      https://www.pmi.org/learning/library/nobel-project-management-reference-class-forecasting-8068
 *   3. Flyvbjerg, "RCF: promises, problems, and a research agenda" (2025):
 *      https://www.tandfonline.com/doi/full/10.1080/09537287.2025.2578708
 *   4. Huntington-Klein, "The Effect" ch.18 (the diff-in-diff lift that
 *      defines a "helped" prior): https://theeffectbook.net/ch-DifferenceinDifference.html
 *   5. Averi, AI-citation tracking (the forecast unit = citation frequency
 *      change): https://www.averi.ai/blog/ai-citation-tracking-chatgpt-perplexity-claude
 *   6. digitalapplied, AI share-of-voice framework 2026:
 *      https://www.digitalapplied.com/blog/ai-share-of-voice-tracking-brand-citations-framework-2026
 *
 * PURE core (`buildCausalSelfForecast`) + a thin injectable loader
 * (`loadCausalSelfForecast`) over the tenant-scoped outcome store. No LLM,
 * no paid API, deterministic. Pinned by causal-self-forecast.test.ts.
 */

import type { StoredChangeOutcome } from "./change-outcome-store";
import { isPlaceboSignificant } from "./placebo-inference";
import { FLAT_LIFT_THRESHOLD } from "./proof-sentence";

/** Below this many causal-grade priors, there is nothing honest to say. */
export const CAUSAL_FORECAST_SUPPRESS_BELOW = 2;
/** At/above SUPPRESS but below this, render with an early-signal caveat. */
export const CAUSAL_FORECAST_SEEDED_BELOW = 4;

export type CausalSelfForecast = {
  kind: "self_causal_forecast";
  primary_bucket: string;
  /** The url_type the forecast was requested for (may be broader than matched). */
  url_type: string | null;
  /** Granularity of the reference class actually used (honesty). */
  matched_on: "bucket+url_type" | "bucket";
  /** # of causal-grade (computed AND placebo-significant) priors in the class. */
  sampleSize: number;
  /** # of those whose diff-in-diff adjusted_lift cleared +FLAT_LIFT_THRESHOLD
   *  (a real measured help, not statistical noise). */
  helpedCount: number;
  /** # whose adjusted_lift was at/below -FLAT_LIFT_THRESHOLD (measurably hurt). */
  hurtCount: number;
  /** 0..1 base rate of measurable help among causal-grade priors (2dp). */
  helpingRate: number;
  /** Median relative_lift among HELPED priors (0..1), or null if none carry it. */
  typicalRelativeLift: number | null;
  /** True in the seeded band — the reference class is small; treat as a hint. */
  seeded: boolean;
  /** Customer-facing one-liner. Plain English, base-rate (the outside view). */
  line: string;
};

export type CausalSelfForecastTarget = {
  primary_bucket: string;
  /** Optional narrower reference class; omitted/null → bucket-level. */
  url_type?: string | null;
};

/** Median of a non-empty numeric list (sorted copy; deterministic). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

/** True iff this outcome is causal-grade evidence for the base rate.
 *  HARDENED 2026-06-13: a computed lift only earns a place in the reference
 *  class if it is PLACEBO-SIGNIFICANT (p < 0.1) — i.e. the engine could
 *  distinguish it from "untreated pages moving by chance." A placebo-FAILED
 *  computed result (the engine's own verdict: "moved this much by chance")
 *  is NOT credible causal evidence and must never inflate the "M of N
 *  measurably lifted" base rate the customer reads BEFORE shipping. */
function isCausalGrade(o: StoredChangeOutcome): boolean {
  return (
    o.status === "computed" &&
    o.computed?.overall != null &&
    isPlaceboSignificant(o.computed.overall.placebo_p ?? null)
  );
}

function composeLine(args: {
  sampleSize: number;
  helpedCount: number;
  helpingRate: number;
  typicalRelativeLift: number | null;
  seeded: boolean;
}): string {
  const { sampleSize, helpedCount, helpingRate, typicalRelativeLift, seeded } =
    args;
  const liftPhrase =
    typicalRelativeLift != null && typicalRelativeLift > 0
      ? ` — typically about +${Math.round(typicalRelativeLift * 100)}% more AI citations`
      : "";

  if (seeded) {
    return (
      `Early read from your own results: ${helpedCount} of your last ${sampleSize} ` +
      `changes like this measurably lifted how often AI tools cite you${liftPhrase}. ` +
      `Small sample so far — treat this as a hint, not a promise.`
    );
  }
  if (helpingRate >= 0.6) {
    return (
      `In your history, ${helpedCount} of your last ${sampleSize} changes like this ` +
      `measurably increased how often AI tools cite you${liftPhrase}. ` +
      `Good odds this one helps too.`
    );
  }
  if (helpingRate <= 0.3) {
    return (
      `Heads up: only ${helpedCount} of your last ${sampleSize} changes like this ` +
      `measurably helped your AI citations. This kind of change hasn't moved the ` +
      `needle much for you before.`
    );
  }
  return (
    `Mixed track record: ${helpedCount} of your last ${sampleSize} changes like this ` +
    `measurably helped your AI citations${liftPhrase}. Worth trying, but no guarantee.`
  );
}

/**
 * Build a causal self-forecast for a proposed Move, or null when the
 * tenant's own causal-grade history is too thin to say anything honest.
 *
 * Reference-class selection: prefer (bucket × url_type); if that narrow
 * class has fewer than SUPPRESS_BELOW causal priors, widen to (bucket) so
 * the base rate stays statistically meaningful. `matched_on` reports which.
 */
export function buildCausalSelfForecast(
  outcomes: ReadonlyArray<StoredChangeOutcome>,
  target: CausalSelfForecastTarget,
): CausalSelfForecast | null {
  const wantUrlType =
    target.url_type !== undefined && target.url_type !== null;

  const bucketClass = outcomes.filter(
    (o) => isCausalGrade(o) && o.primary_bucket === target.primary_bucket,
  );
  const narrowClass = wantUrlType
    ? bucketClass.filter((o) => o.url_type === target.url_type)
    : [];

  let refClass: StoredChangeOutcome[];
  let matched_on: CausalSelfForecast["matched_on"];
  if (wantUrlType && narrowClass.length >= CAUSAL_FORECAST_SUPPRESS_BELOW) {
    refClass = narrowClass;
    matched_on = "bucket+url_type";
  } else {
    refClass = bucketClass;
    matched_on = "bucket";
  }

  const sampleSize = refClass.length;
  if (sampleSize < CAUSAL_FORECAST_SUPPRESS_BELOW) return null;

  // "Measurably helped/hurt" uses the SAME flat-move bar as the proof
  // sentence (FLAT_LIFT_THRESHOLD): a lift between ±threshold is a credibly-
  // measured-but-FLAT result — it stays in the denominator (sampleSize) but
  // counts as neither help nor harm, so the base rate never reports noise as
  // a "measurable lift."
  const lifts = refClass.map((o) => o.computed!.overall!.adjusted_lift);
  const helpedCount = lifts.filter((l) => l >= FLAT_LIFT_THRESHOLD).length;
  const hurtCount = lifts.filter((l) => l <= -FLAT_LIFT_THRESHOLD).length;
  const helpingRate = Math.round((helpedCount / sampleSize) * 100) / 100;

  const helpedRelativeLifts = refClass
    .filter((o) => o.computed!.overall!.adjusted_lift >= FLAT_LIFT_THRESHOLD)
    .map((o) => o.computed!.overall!.relative_lift)
    .filter((r): r is number => r != null && r > 0);
  const typicalRelativeLift = median(helpedRelativeLifts);

  const seeded = sampleSize < CAUSAL_FORECAST_SEEDED_BELOW;

  return {
    kind: "self_causal_forecast",
    primary_bucket: target.primary_bucket,
    url_type: target.url_type ?? null,
    matched_on,
    sampleSize,
    helpedCount,
    hurtCount,
    helpingRate,
    typicalRelativeLift,
    seeded,
    line: composeLine({
      sampleSize,
      helpedCount,
      helpingRate,
      typicalRelativeLift,
      seeded,
    }),
  };
}

export type CausalSelfForecastDeps = {
  /** Defaults to the tenant-scoped store reader. Injectable for tests. */
  loadOutcomes?: () => Promise<StoredChangeOutcome[]>;
};

/**
 * Load the tenant's persisted change outcomes and build a causal self-
 * forecast for the target Move. Tenant-scoped by construction (the default
 * loader reads the ambient per-tenant store). Returns null when there is no
 * causal-grade history for this kind of change yet.
 */
export async function loadCausalSelfForecast(
  target: CausalSelfForecastTarget,
  deps: CausalSelfForecastDeps = {},
): Promise<CausalSelfForecast | null> {
  const loadOutcomes =
    deps.loadOutcomes ??
    (async () => {
      const { loadAllChangeOutcomes } = await import("./change-outcome-store");
      return loadAllChangeOutcomes();
    });
  const outcomes = await loadOutcomes();
  return buildCausalSelfForecast(outcomes, target);
}
