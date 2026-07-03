/**
 * decision-thresholds (R14b) - pins the /settings/how-i-decide registry to the
 * SOURCE constants: every displayed number is imported, never retyped, so the
 * plain-words page can never drift from the live values. Also pins the Beacon
 * voice rules (no lab words, no em or en dashes).
 */
import { describe, expect, it } from "vitest";

import { DECISION_THRESHOLDS } from "@/domains/settings/decision-thresholds";
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
import { MAX_DRAFTS_PER_WEEK } from "@/domains/page-factory/production-line";
import { DEFAULT_MONTHLY_CAP_USD } from "@/domains/serp/dataforseo-serp";
import { BUCKET_MIN_IMPRESSIONS, BUCKET_MIN_QUERIES } from "@/domains/forecast/tenant-ctr-curve";
import { NIGHTLY_PROMPT_CAP } from "@/domains/ai-visibility/engine-types";
import { MIN_SETTLED_FOR_CALIBRATION } from "@/domains/experiments/forecast-calibration";

function entry(id: string) {
  const found = DECISION_THRESHOLDS.find((t) => t.id === id);
  expect(found, `registry entry missing: ${id}`).toBeTruthy();
  return found!;
}

describe("decision-thresholds registry pins source constants", () => {
  it("measurement windows come from PROOF_WINDOW_DAYS", () => {
    expect(entry("measurement-windows").value).toBe(`${PROOF_WINDOW_DAYS.join(", ")} days`);
  });
  it("the before window comes from PROOF_BASELINE_WINDOW_DAYS", () => {
    expect(entry("before-window").value).toBe(`${PROOF_BASELINE_WINDOW_DAYS} days before`);
  });
  it("the impressions floor comes from MIN_BASELINE_IMPRESSIONS", () => {
    expect(entry("min-impressions").value).toBe(`${MIN_BASELINE_IMPRESSIONS} appearances`);
    expect(entry("min-impressions").sentence).toContain(String(MIN_BASELINE_IMPRESSIONS));
  });
  it("the comparison-page floor comes from MIN_CONTROLS_FOR_COMPUTED", () => {
    expect(entry("min-comparison-pages").value).toBe(`${MIN_CONTROLS_FOR_COMPUTED} pages`);
  });
  it("the win floor comes from DEFAULT_MIN_LIFT_CLICKS + MIN_LIFT_FRACTION", () => {
    const e = entry("min-lift");
    expect(e.value).toContain(String(DEFAULT_MIN_LIFT_CLICKS));
    expect(e.value).toContain(`${Math.round(MIN_LIFT_FRACTION * 100)} percent`);
  });
  it("the by-chance bar comes from PERMUTATION_P_HIGH_MAX", () => {
    expect(entry("by-chance-bar").value).toBe(`1 in ${Math.round(1 / PERMUTATION_P_HIGH_MAX)} pages`);
  });
  it("the learning floor comes from MIN_OUTCOME_SAMPLES", () => {
    expect(entry("learning-floor").value).toBe(`${MIN_OUTCOME_SAMPLES} finished results`);
  });
  it("the forecast-grading floor comes from MIN_SETTLED_FOR_CALIBRATION", () => {
    expect(entry("forecast-accuracy-floor").value).toBe(`${MIN_SETTLED_FOR_CALIBRATION} settled picks`);
  });
  it("the click-rate-curve trust floor comes from tenant-ctr-curve's bucket floors", () => {
    expect(entry("click-rate-curve-trust").value).toBe(
      `${BUCKET_MIN_IMPRESSIONS} appearances, ${BUCKET_MIN_QUERIES} searches`,
    );
  });
  it("the weekly page cap comes from MAX_DRAFTS_PER_WEEK", () => {
    expect(entry("weekly-page-cap").value).toBe(`${MAX_DRAFTS_PER_WEEK} pages`);
  });
  it("the monthly check budget comes from DEFAULT_MONTHLY_CAP_USD", () => {
    expect(entry("monthly-check-budget").value).toBe(`$${DEFAULT_MONTHLY_CAP_USD} a month`);
  });
  it("the nightly question cap comes from NIGHTLY_PROMPT_CAP", () => {
    expect(entry("nightly-question-cap").value).toBe(`${NIGHTLY_PROMPT_CAP} questions`);
  });
});

describe("decision-thresholds voice rules", () => {
  it("every entry has an id, label, value, and a full plain sentence", () => {
    for (const t of DECISION_THRESHOLDS) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.value).toBeTruthy();
      expect(t.sentence.endsWith(".")).toBe(true);
    }
  });
  it("never uses a lab word or a raw code word on the surface", () => {
    const all = DECISION_THRESHOLDS.map((t) => `${t.label} ${t.value} ${t.sentence}`).join(" ");
    for (const banned of [/\bexperiment/i, /\bcontrols?\b/i, /\bbaseline\b/i, /\btreatment\b/i, /\breservation\b/i, /\bSERP\b/i, /_/]) {
      expect(all, `banned word ${banned} leaked into the registry copy`).not.toMatch(banned);
    }
  });
  it("never emits an em or en dash", () => {
    const all = JSON.stringify(DECISION_THRESHOLDS);
    expect(all).not.toMatch(/[‒–—―]/);
  });
  it("ids are unique", () => {
    const ids = DECISION_THRESHOLDS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
