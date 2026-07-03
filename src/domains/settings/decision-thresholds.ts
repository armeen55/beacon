/**
 * decision-thresholds (R14b, P1 trust receipts, 2026-07-03) - THE one registry
 * of every live decision threshold, in plain words, for /settings/how-i-decide.
 *
 * HONESTY CONTRACT: every number here is IMPORTED from the module that actually
 * enforces it - never retyped. Change the source constant and this page changes
 * with it; tests/domains/settings/decision-thresholds.test.ts pins registry
 * values === source constants so a drift can never ship.
 *
 * Beacon voice: plain words only. No lab words (comparison pages, never
 * "controls"; the 28 days before, never "baseline"), no em or en dashes.
 */

import {
  DEFAULT_MIN_LIFT_CLICKS,
  MIN_BASELINE_IMPRESSIONS,
  MIN_CONTROLS_FOR_COMPUTED,
  MIN_LIFT_FRACTION,
  PERMUTATION_P_HIGH_MAX,
  PROOF_BASELINE_WINDOW_DAYS,
  PROOF_WINDOW_DAYS,
} from "@/domains/proof-gsc/measure";
import { MIN_OUTCOME_SAMPLES } from "@/domains/recommendation-intelligence/outcome-prior";
import { MAX_DRAFTS_PER_WEEK, WEEKLY_LLM_CEILING_USD } from "@/domains/page-factory/production-line";
import { DEFAULT_MONTHLY_CAP_USD, SERP_COST_USD } from "@/domains/serp/dataforseo-serp";
import { BUCKET_MIN_IMPRESSIONS, BUCKET_MIN_QUERIES } from "@/domains/forecast/tenant-ctr-curve";
import { NIGHTLY_PROMPT_CAP } from "@/domains/ai-visibility/engine-types";
import { MIN_SETTLED_FOR_CALIBRATION } from "@/domains/experiments/forecast-calibration";

export type DecisionThreshold = {
  id: string;
  /** Short plain title ("When I trust a verdict"). */
  label: string;
  /** The live value, formatted for display. Built FROM the imported constant. */
  value: string;
  /** One plain sentence: what this threshold governs and why it exists. */
  sentence: string;
};

const pct = (fraction: number): string => `${Math.round(fraction * 100)} percent`;
const oneIn = (fraction: number): string => `1 in ${Math.round(1 / fraction)}`;

export const DECISION_THRESHOLDS: ReadonlyArray<DecisionThreshold> = [
  {
    id: "measurement-windows",
    label: "How long I measure every change",
    value: `${PROOF_WINDOW_DAYS.join(", ")} days`,
    sentence: `I check every shipped change at ${PROOF_WINDOW_DAYS.join(", then ")} days. Only the ${PROOF_WINDOW_DAYS[PROOF_WINDOW_DAYS.length - 1]} day read is final; anything earlier is a signal, never a verdict.`,
  },
  {
    id: "before-window",
    label: "What I compare against",
    value: `${PROOF_BASELINE_WINDOW_DAYS} days before`,
    sentence: `Every read compares the page to its own ${PROOF_BASELINE_WINDOW_DAYS} days before the change, and to similar pages we did not touch over the same dates.`,
  },
  {
    id: "min-impressions",
    label: "When a page has enough data to judge",
    value: `${MIN_BASELINE_IMPRESSIONS} appearances`,
    sentence: `A page needs at least ${MIN_BASELINE_IMPRESSIONS} appearances in Google search in the ${PROOF_BASELINE_WINDOW_DAYS} days before the change, or I say the data is too thin instead of guessing.`,
  },
  {
    id: "min-comparison-pages",
    label: "How many comparison pages a verdict needs",
    value: `${MIN_CONTROLS_FOR_COMPUTED} pages`,
    sentence: `A computed verdict needs at least ${MIN_CONTROLS_FOR_COMPUTED} similar pages we did not change, so ordinary sitewide swings never get credited to your edit.`,
  },
  {
    id: "min-lift",
    label: "What counts as a real win",
    value: `${DEFAULT_MIN_LIFT_CLICKS} clicks and ${pct(MIN_LIFT_FRACTION)}`,
    sentence: `A clicks win must add at least ${DEFAULT_MIN_LIFT_CLICKS} clicks and beat the page's own before numbers by at least ${pct(MIN_LIFT_FRACTION)}, so normal wobble never counts as a win.`,
  },
  {
    id: "by-chance-bar",
    label: "The by-chance bar for high confidence",
    value: `${oneIn(PERMUTATION_P_HIGH_MAX)} pages`,
    sentence: `Before I call a result high confidence, I check pages we never touched: at most ${oneIn(PERMUTATION_P_HIGH_MAX)} of them may move that much on their own, or I keep the confidence modest.`,
  },
  {
    id: "learning-floor",
    label: "When past results start steering my picks",
    value: `${MIN_OUTCOME_SAMPLES} finished results`,
    sentence: `A change type needs ${MIN_OUTCOME_SAMPLES} finished results before its track record starts nudging what I recommend first. Below that I stay neutral.`,
  },
  {
    id: "forecast-accuracy-floor",
    label: "When I grade my own forecasts",
    value: `${MIN_SETTLED_FOR_CALIBRATION} settled picks`,
    sentence: `Once ${MIN_SETTLED_FOR_CALIBRATION} picks have finished their full read, I start reporting how my promised ranges compared to what actually happened, and I correct future ranges with that record.`,
  },
  {
    id: "click-rate-curve-trust",
    label: "When I trust your own click rates",
    value: `${BUCKET_MIN_IMPRESSIONS} appearances, ${BUCKET_MIN_QUERIES} searches`,
    sentence: `I size forecasts from your own click rate at each Google position only once that position has ${BUCKET_MIN_IMPRESSIONS} appearances across ${BUCKET_MIN_QUERIES} searches. Until then I use standard rates.`,
  },
  {
    id: "weekly-page-cap",
    label: "How many new pages I draft a week",
    value: `${MAX_DRAFTS_PER_WEEK} pages`,
    sentence: `The weekly page line drafts at most ${MAX_DRAFTS_PER_WEEK} new pages, spends at most $${WEEKLY_LLM_CEILING_USD.toFixed(2)} writing them, and never publishes anything itself. You approve every page.`,
  },
  {
    id: "monthly-check-budget",
    label: "My monthly budget for live Google checks",
    value: `$${DEFAULT_MONTHLY_CAP_USD} a month`,
    sentence: `I stop buying live Google result checks at $${DEFAULT_MONTHLY_CAP_USD} a month. Each check costs about $${SERP_COST_USD.toFixed(3)}, and every paid call is logged before it runs, so the cap can never be overrun.`,
  },
  {
    id: "nightly-question-cap",
    label: "How many AI questions I check a night",
    value: `${NIGHTLY_PROMPT_CAP} questions`,
    sentence: `Each night I ask AI assistants at most ${NIGHTLY_PROMPT_CAP} of your tracked questions, so the answer history grows steadily without surprise costs.`,
  },
];
