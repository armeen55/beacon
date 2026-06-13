/**
 * causal-self-forecast — the Move Forecast's n=1 engine.
 *
 * Pins reference-class forecasting over the tenant's OWN proven outcomes:
 *   • base rate counts ONLY causal-grade priors — computed AND placebo-
 *     significant (p<0.1); weak/raw/ineligible AND placebo-FAILED computed
 *     outcomes never enter the reference class (honesty gate 2026-06-13);
 *   • "measurably helped/hurt" uses the flat-move bar (±FLAT_LIFT_THRESHOLD);
 *   • suppress below CAUSAL_FORECAST_SUPPRESS_BELOW (nothing honest to say);
 *   • seeded caveat in the small-class band;
 *   • (bucket × url_type) reference class, widening to (bucket) when narrow;
 *   • the loader is tenant-scoped via an injectable outcome reader.
 */

import { describe, it, expect } from "vitest";

import {
  buildCausalSelfForecast,
  loadCausalSelfForecast,
  CAUSAL_FORECAST_SUPPRESS_BELOW,
  CAUSAL_FORECAST_SEEDED_BELOW,
} from "./causal-self-forecast";
import type { StoredChangeOutcome } from "./change-outcome-store";

/** Minimal valid persisted outcome. `adjusted_lift`/`relative_lift` drive
 *  the base rate; everything else is inert context. */
function outcome(
  partial: {
    source_id: string;
    primary_bucket: string;
    url_type?: string | null;
    status?: StoredChangeOutcome["status"];
    adjusted_lift?: number | null;
    relative_lift?: number | null;
    /** Defaults to placebo-SIGNIFICANT (0.05) so a fixture is causal-grade
     *  unless a test explicitly makes it placebo-failed. */
    placebo_p?: number | null;
  },
): StoredChangeOutcome {
  const isComputed =
    partial.status === "computed" || partial.status === undefined;
  const lift = partial.adjusted_lift ?? 1;
  const computed: StoredChangeOutcome["computed"] = isComputed
    ? {
        kind: "computed",
        overall: {
          platform: "all",
          treated_pre_avg: 1,
          treated_post_avg: 1 + lift,
          control_pre_avg: 1,
          control_post_avg: 1,
          treated_delta: lift,
          control_delta: 0,
          adjusted_lift: lift,
          relative_lift: partial.relative_lift ?? null,
          controls_used: 3,
          pre_days_observed: 14,
          post_days_observed: 14,
          // Distinguish explicit `null` (placebo absent → excluded) from
          // omitted (default to placebo-significant).
          placebo_p:
            partial.placebo_p === undefined ? 0.05 : partial.placebo_p,
        },
        per_platform: [],
      }
    : null;
  return {
    source_id: partial.source_id,
    classifier_version: "test",
    stored_at: "2026-05-30T00:00:00.000Z",
    taxonomy_layer: "change",
    primary_bucket: partial.primary_bucket,
    child_tags: [],
    paired_with: [],
    bundle_parent_id: null,
    bundle_size: 1,
    url: `/p/${partial.source_id}`,
    url_type: partial.url_type ?? "service",
    treatment_date: "2026-05-15",
    pre_window: { start: "2026-05-01", end: "2026-05-14" },
    post_window: { start: "2026-05-16", end: "2026-05-29" },
    status: partial.status ?? "computed",
    confidence: "medium",
    warnings: [],
    rationale: "test",
    computed,
    raw: null,
    matched_control_count: 3,
    matched_control_urls: [],
    excluded_control_count: 0,
    excluded_reasons: {},
    excluded_reasons_by_platform: {},
    sparklines: null,
    computed_at: "2026-05-30T00:00:00.000Z",
  };
}

describe("buildCausalSelfForecast", () => {
  it("returns null when there are fewer than SUPPRESS_BELOW causal priors", () => {
    const outcomes = [
      outcome({ source_id: "a", primary_bucket: "content.faq.add", adjusted_lift: 2 }),
    ];
    expect(outcomes.length).toBeLessThan(CAUSAL_FORECAST_SUPPRESS_BELOW);
    expect(
      buildCausalSelfForecast(outcomes, { primary_bucket: "content.faq.add" }),
    ).toBeNull();
  });

  it("counts ONLY causal-grade (computed) priors — weak/raw outcomes are excluded", () => {
    const outcomes = [
      outcome({ source_id: "a", primary_bucket: "content.faq.add", adjusted_lift: 2, relative_lift: 0.5 }),
      outcome({ source_id: "b", primary_bucket: "content.faq.add", adjusted_lift: 1, relative_lift: 0.3 }),
      // weak / ineligible — must NOT enter the reference class:
      outcome({ source_id: "c", primary_bucket: "content.faq.add", status: "weak_estimate" }),
      outcome({ source_id: "d", primary_bucket: "content.faq.add", status: "ineligible_layer" }),
    ];
    const f = buildCausalSelfForecast(outcomes, {
      primary_bucket: "content.faq.add",
    })!;
    expect(f).not.toBeNull();
    expect(f.sampleSize).toBe(2); // only a + b
    expect(f.helpedCount).toBe(2);
    expect(f.helpingRate).toBe(1);
    expect(f.typicalRelativeLift).toBe(0.4); // median(0.5, 0.3)
    expect(f.kind).toBe("self_causal_forecast");
  });

  it("excludes placebo-FAILED computed priors — chance-level lifts never enter the base rate", () => {
    const outcomes = [
      // Two genuine causal-grade priors (placebo-significant):
      outcome({ source_id: "a", primary_bucket: "content.faq.add", adjusted_lift: 2, relative_lift: 0.5, placebo_p: 0.02 }),
      outcome({ source_id: "b", primary_bucket: "content.faq.add", adjusted_lift: 1, relative_lift: 0.3, placebo_p: 0.05 }),
      // Placebo-FAILED computed (engine verdict: moved by chance) — MUST be excluded:
      outcome({ source_id: "c", primary_bucket: "content.faq.add", adjusted_lift: 9, relative_lift: 2, placebo_p: 0.5 }),
      outcome({ source_id: "d", primary_bucket: "content.faq.add", adjusted_lift: 9, relative_lift: 2, placebo_p: null }),
    ];
    const f = buildCausalSelfForecast(outcomes, {
      primary_bucket: "content.faq.add",
    })!;
    expect(f).not.toBeNull();
    expect(f.sampleSize).toBe(2); // only the two placebo-significant priors
    expect(f.helpedCount).toBe(2);
    expect(f.helpingRate).toBe(1);
  });

  it("a credibly-measured-but-FLAT lift (|lift| < threshold) counts as neither help nor hurt", () => {
    const outcomes = [
      outcome({ source_id: "a", primary_bucket: "content.body.rewrite", adjusted_lift: 3, relative_lift: 0.6, placebo_p: 0.02 }),
      outcome({ source_id: "b", primary_bucket: "content.body.rewrite", adjusted_lift: 2, relative_lift: 0.4, placebo_p: 0.02 }),
      // flat: placebo-significant but a tiny lift below the flat bar — in the
      // denominator, but not "measurably helped":
      outcome({ source_id: "c", primary_bucket: "content.body.rewrite", adjusted_lift: 0.2, relative_lift: 0.05, placebo_p: 0.02 }),
      outcome({ source_id: "d", primary_bucket: "content.body.rewrite", adjusted_lift: 0.4, relative_lift: 0.05, placebo_p: 0.02 }),
    ];
    const f = buildCausalSelfForecast(outcomes, {
      primary_bucket: "content.body.rewrite",
    })!;
    expect(f.sampleSize).toBe(4); // all four are credibly measured
    expect(f.helpedCount).toBe(2); // only the two that cleared the flat bar
    expect(f.hurtCount).toBe(0);
    expect(f.helpingRate).toBe(0.5); // 2 of 4 — noise doesn't inflate it
  });

  it("computes an honest base rate with helped + hurt priors", () => {
    const outcomes = [
      outcome({ source_id: "a", primary_bucket: "content.body.rewrite", adjusted_lift: 3, relative_lift: 0.6 }),
      outcome({ source_id: "b", primary_bucket: "content.body.rewrite", adjusted_lift: 2, relative_lift: 0.4 }),
      outcome({ source_id: "c", primary_bucket: "content.body.rewrite", adjusted_lift: 1, relative_lift: 0.2 }),
      outcome({ source_id: "d", primary_bucket: "content.body.rewrite", adjusted_lift: -1, relative_lift: null }),
    ];
    const f = buildCausalSelfForecast(outcomes, {
      primary_bucket: "content.body.rewrite",
    })!;
    expect(f.sampleSize).toBe(4);
    expect(f.helpedCount).toBe(3);
    expect(f.hurtCount).toBe(1);
    expect(f.helpingRate).toBe(0.75);
    expect(f.seeded).toBe(false); // 4 ≥ SEEDED_BELOW
    expect(f.line).toContain("3 of your last 4");
  });

  it("flags `seeded` in the small-reference-class band", () => {
    const outcomes = [
      outcome({ source_id: "a", primary_bucket: "content.faq.add", adjusted_lift: 2, relative_lift: 0.5 }),
      outcome({ source_id: "b", primary_bucket: "content.faq.add", adjusted_lift: 1, relative_lift: 0.3 }),
    ];
    const f = buildCausalSelfForecast(outcomes, {
      primary_bucket: "content.faq.add",
    })!;
    expect(f.sampleSize).toBeGreaterThanOrEqual(CAUSAL_FORECAST_SUPPRESS_BELOW);
    expect(f.sampleSize).toBeLessThan(CAUSAL_FORECAST_SEEDED_BELOW);
    expect(f.seeded).toBe(true);
    expect(f.line.toLowerCase()).toContain("early read");
  });

  it("prefers (bucket × url_type), widening to (bucket) when the narrow class is too thin", () => {
    const outcomes = [
      // service-page FAQs (the narrow class) — only 1, below SUPPRESS:
      outcome({ source_id: "s1", primary_bucket: "content.faq.add", url_type: "service", adjusted_lift: 5, relative_lift: 0.9 }),
      // location-page FAQs — bucket matches, url_type doesn't:
      outcome({ source_id: "l1", primary_bucket: "content.faq.add", url_type: "location", adjusted_lift: 1, relative_lift: 0.2 }),
      outcome({ source_id: "l2", primary_bucket: "content.faq.add", url_type: "location", adjusted_lift: 1, relative_lift: 0.2 }),
    ];
    // url_type=service has only 1 prior → widen to bucket (all 3).
    const f = buildCausalSelfForecast(outcomes, {
      primary_bucket: "content.faq.add",
      url_type: "service",
    })!;
    expect(f.matched_on).toBe("bucket");
    expect(f.sampleSize).toBe(3);
  });

  it("uses the narrow (bucket × url_type) class when it is rich enough", () => {
    const outcomes = [
      outcome({ source_id: "s1", primary_bucket: "content.faq.add", url_type: "service", adjusted_lift: 5, relative_lift: 0.9 }),
      outcome({ source_id: "s2", primary_bucket: "content.faq.add", url_type: "service", adjusted_lift: 4, relative_lift: 0.7 }),
      outcome({ source_id: "l1", primary_bucket: "content.faq.add", url_type: "location", adjusted_lift: -2, relative_lift: null }),
    ];
    const f = buildCausalSelfForecast(outcomes, {
      primary_bucket: "content.faq.add",
      url_type: "service",
    })!;
    expect(f.matched_on).toBe("bucket+url_type");
    expect(f.sampleSize).toBe(2); // both service-page priors, not the location one
    expect(f.helpingRate).toBe(1);
  });
});

describe("loadCausalSelfForecast", () => {
  it("builds from the tenant-scoped store via the injectable loader", async () => {
    const outcomes = [
      outcome({ source_id: "a", primary_bucket: "content.faq.add", adjusted_lift: 2, relative_lift: 0.5 }),
      outcome({ source_id: "b", primary_bucket: "content.faq.add", adjusted_lift: 3, relative_lift: 0.7 }),
      outcome({ source_id: "c", primary_bucket: "content.faq.add", adjusted_lift: 1, relative_lift: 0.3 }),
      outcome({ source_id: "d", primary_bucket: "content.faq.add", adjusted_lift: 2, relative_lift: 0.4 }),
    ];
    const f = await loadCausalSelfForecast(
      { primary_bucket: "content.faq.add" },
      { loadOutcomes: async () => outcomes },
    );
    expect(f).not.toBeNull();
    expect(f!.sampleSize).toBe(4);
    expect(f!.helpingRate).toBe(1);
    expect(f!.seeded).toBe(false);
  });

  it("returns null when the tenant has no causal-grade history for the bucket", async () => {
    const f = await loadCausalSelfForecast(
      { primary_bucket: "content.faq.add" },
      { loadOutcomes: async () => [] },
    );
    expect(f).toBeNull();
  });
});
