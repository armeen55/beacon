/**
 * forecast-for-recommended-edit — the rec → forecast bridge.
 *
 * Pins the action_type → (primary_bucket, url_type) resolution against the
 * registry, and the end-to-end loader over an injected outcome store:
 *   • add_faq on a service page → content.faq.add / service;
 *   • title/body content edits → content.body.rewrite;
 *   • infra actions (fix_robots) → null (not URL-level forecastable);
 *   • the loader returns the forecast keyed on the resolved target.
 */

import { describe, it, expect } from "vitest";

import {
  forecastTargetForActionType,
  loadForecastForRecommendedEdit,
} from "./forecast-for-recommended-edit";
import type { StoredChangeOutcome } from "./change-outcome-store";

function computedOutcome(
  source_id: string,
  primary_bucket: string,
  url_type: string,
  adjusted_lift: number,
  relative_lift: number | null,
): StoredChangeOutcome {
  return {
    source_id,
    classifier_version: "test",
    stored_at: "2026-05-30T00:00:00.000Z",
    taxonomy_layer: "change",
    primary_bucket,
    child_tags: [],
    paired_with: [],
    bundle_parent_id: null,
    bundle_size: 1,
    url: `/p/${source_id}`,
    url_type,
    treatment_date: "2026-05-15",
    pre_window: { start: "2026-05-01", end: "2026-05-14" },
    post_window: { start: "2026-05-16", end: "2026-05-29" },
    status: "computed",
    confidence: "medium",
    warnings: [],
    rationale: "test",
    computed: {
      kind: "computed",
      overall: {
        platform: "all",
        treated_pre_avg: 1,
        treated_post_avg: 1 + adjusted_lift,
        control_pre_avg: 1,
        control_post_avg: 1,
        treated_delta: adjusted_lift,
        control_delta: 0,
        adjusted_lift,
        relative_lift,
        controls_used: 3,
        pre_days_observed: 14,
        post_days_observed: 14,
        placebo_p: 0.05, // placebo-significant → causal-grade for the base rate
      },
      per_platform: [],
    },
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

describe("forecastTargetForActionType", () => {
  it("maps add_faq → content.faq.add, url_type from the URL", () => {
    const t = forecastTargetForActionType("add_faq", "https://acme.com/services/roofing");
    expect(t).toEqual({ primary_bucket: "content.faq.add", url_type: "service" });
  });

  it("maps a content copy edit (edit_title) → content.body.rewrite", () => {
    const t = forecastTargetForActionType("edit_title", "https://acme.com/services/roofing");
    expect(t?.primary_bucket).toBe("content.body.rewrite");
  });

  it("returns null for an infra action (fix_robots) — not URL-level forecastable", () => {
    expect(forecastTargetForActionType("fix_robots", "https://acme.com/robots.txt")).toBeNull();
  });

  it("falls back to the action's default asset_type for url_type when the path is generic", () => {
    // A bare/opaque path yields no structural url_type → asset_type fallback.
    const t = forecastTargetForActionType("add_faq", "https://acme.com/x");
    expect(t?.primary_bucket).toBe("content.faq.add");
    expect(t?.url_type).toBe("service"); // add_faq.changelogAssetType === "service_page"
  });
});

describe("loadForecastForRecommendedEdit", () => {
  it("returns the causal self-forecast keyed on the resolved target", async () => {
    const outcomes = [
      computedOutcome("a", "content.faq.add", "service", 2, 0.5),
      computedOutcome("b", "content.faq.add", "service", 3, 0.7),
      computedOutcome("c", "content.faq.add", "service", 1, 0.3),
      computedOutcome("d", "content.faq.add", "service", 2, 0.4),
      // a different bucket — must NOT contaminate the FAQ reference class:
      computedOutcome("e", "content.body.rewrite", "service", -5, null),
    ];
    const f = await loadForecastForRecommendedEdit(
      { action_type: "add_faq", target_url: "https://acme.com/services/roofing" },
      { loadOutcomes: async () => outcomes },
    );
    expect(f).not.toBeNull();
    expect(f!.primary_bucket).toBe("content.faq.add");
    expect(f!.sampleSize).toBe(4); // the 4 FAQ outcomes, not the body.rewrite one
    expect(f!.helpingRate).toBe(1);
  });

  it("returns null for a non-forecastable action regardless of history", async () => {
    const f = await loadForecastForRecommendedEdit(
      { action_type: "fix_robots", target_url: "https://acme.com/robots.txt" },
      { loadOutcomes: async () => [] },
    );
    expect(f).toBeNull();
  });
});
