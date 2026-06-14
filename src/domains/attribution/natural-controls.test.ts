/**
 * Unit tests for the natural-controls attribution engine.
 * Covers pure-function contracts; no I/O.
 */

import { describe, it, expect } from "vitest";
import type { ClassifiedEvent } from "./change-taxonomy";
import type { UrlCitationHistory, UrlCitationSeries } from "../product/url-citation-history";
import {
  DEFAULT_CONFIG,
  attributeEvent,
  buildTreatmentIndex,
  buildWindows,
  computeDiffInDiff,
  eligibilityCheck,
  extractWindowSeries,
  findControls,
  gradeConfidence,
  hasTreatmentInRange,
  linearSlope,
  shiftDate,
} from "./natural-controls";

// ---------------------------------------------------------------------------
// Helpers for building test fixtures
// ---------------------------------------------------------------------------

const CLASSIFIER_VERSION = "v1.0-test";

function mkEvent(partial: Partial<ClassifiedEvent> & { source_id: string; observed_at: string }): ClassifiedEvent {
  return {
    source_id: partial.source_id,
    source_type: partial.source_type ?? "changelog",
    classifier_version: CLASSIFIER_VERSION,
    taxonomy_layer: partial.taxonomy_layer ?? "change",
    primary_bucket: partial.primary_bucket ?? "content.faq.add",
    child_tags: partial.child_tags ?? [],
    paired_with: partial.paired_with ?? [],
    scope: partial.scope ?? "single_url",
    url: "url" in partial ? partial.url! : "/test",
    url_type: partial.url_type ?? "location",
    offsite_platform: partial.offsite_platform ?? null,
    authorship: partial.authorship ?? "user_authored",
    confidence: partial.confidence ?? "high",
    classifier_rationale: partial.classifier_rationale ?? "test",
    bundle_parent_id: partial.bundle_parent_id ?? null,
    bundle_size: partial.bundle_size ?? 1,
    observed_at: partial.observed_at,
    tenant_id: partial.tenant_id ?? "tenant-test",
  };
}

function mkSeries(url: string, daily: Array<{ date: string; count: number; by_platform?: Record<string, number> }>): UrlCitationSeries {
  return {
    url,
    raw_urls: [url],
    is_owned: true,
    daily: daily.map((d) => ({
      date: d.date,
      count: d.count,
      by_platform: d.by_platform ?? { ChatGPT: d.count },
    })),
  };
}

function daysFrom(start: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(shiftDate(start, i));
  return out;
}

/** Build a series with constant daily count on `range` days starting at `start`. */
function constantSeries(url: string, start: string, days: number, count: number, platform = "ChatGPT"): UrlCitationSeries {
  return mkSeries(
    url,
    daysFrom(start, days).map((d) => ({ date: d, count, by_platform: { [platform]: count } })),
  );
}

function linearSeries(url: string, start: string, days: number, startCount: number, step: number, platform = "ChatGPT"): UrlCitationSeries {
  return mkSeries(
    url,
    daysFrom(start, days).map((d, i) => {
      const v = Math.max(0, startCount + i * step);
      return { date: d, count: v, by_platform: { [platform]: v } };
    }),
  );
}

function mkHistory(series: UrlCitationSeries[]): UrlCitationHistory {
  const allDates = new Set<string>();
  for (const s of series) for (const d of s.daily) allDates.add(d.date);
  const sorted = [...allDates].sort();
  return {
    built_at: new Date().toISOString(),
    date_range: { first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null },
    distinct_urls: series.length,
    series,
  };
}

const inferTestUrlType = (url: string): string | null => {
  if (url.startsWith("/locations/")) return "location";
  if (url.startsWith("/services/")) return "service";
  return "other";
};

// ---------------------------------------------------------------------------
// eligibilityCheck
// ---------------------------------------------------------------------------

describe("eligibilityCheck", () => {
  it("accepts change layer + single_url + high confidence + no parent", () => {
    const e = mkEvent({ source_id: "e1", observed_at: "2026-04-01", taxonomy_layer: "change", scope: "single_url", url: "/locations/x", confidence: "high" });
    expect(eligibilityCheck(e).eligible).toBe(true);
  });

  it("rejects non-change layers with ineligible_layer", () => {
    for (const layer of ["finding", "status", "noise", "infra", "offsite_owned_change", "offsite_external_signal"] as const) {
      const e = mkEvent({ source_id: "x", observed_at: "2026-04-01", taxonomy_layer: layer, scope: "tenant-global" });
      const res = eligibilityCheck(e);
      expect(res.eligible).toBe(false);
      if (!res.eligible) expect(res.status).toBe("ineligible_layer");
    }
  });

  it("rejects sitewide scope as unsupported_scope", () => {
    const e = mkEvent({ source_id: "e1", observed_at: "2026-04-01", taxonomy_layer: "change", scope: "sitewide" });
    const res = eligibilityCheck(e);
    expect(res.eligible).toBe(false);
    if (!res.eligible) expect(res.status).toBe("unsupported_scope");
  });

  it("rejects low-confidence events", () => {
    const e = mkEvent({ source_id: "e1", observed_at: "2026-04-01", confidence: "low" });
    const res = eligibilityCheck(e);
    expect(res.eligible).toBe(false);
    if (!res.eligible) expect(res.status).toBe("ineligible_event");
  });

  it("rejects bundle children (non-null bundle_parent_id)", () => {
    const e = mkEvent({ source_id: "e1", observed_at: "2026-04-01", bundle_parent_id: "parent-1" });
    const res = eligibilityCheck(e);
    expect(res.eligible).toBe(false);
    if (!res.eligible) expect(res.status).toBe("ineligible_event");
  });

  it("rejects events with null url", () => {
    const e = mkEvent({ source_id: "e1", observed_at: "2026-04-01", url: null });
    const res = eligibilityCheck(e);
    expect(res.eligible).toBe(false);
    if (!res.eligible) expect(res.status).toBe("ineligible_event");
  });
});

// ---------------------------------------------------------------------------
// buildWindows
// ---------------------------------------------------------------------------

describe("buildWindows", () => {
  it("constructs 14d pre + 14d post with the treatment day excluded", () => {
    const w = buildWindows("2026-04-15", { ...DEFAULT_CONFIG, preWindowDays: 14, postWindowDays: 14 });
    expect(w.treatment).toBe("2026-04-15");
    expect(w.pre.end).toBe("2026-04-14");
    expect(w.pre.start).toBe("2026-04-01");
    expect(w.post.start).toBe("2026-04-16");
    expect(w.post.end).toBe("2026-04-29");
  });

  it("clamps post-window to today", () => {
    const w = buildWindows("2026-04-15", DEFAULT_CONFIG, "2026-04-20");
    expect(w.post.start).toBe("2026-04-16");
    expect(w.post.end).toBe("2026-04-20");
  });

  it("respects non-default window sizes", () => {
    const w = buildWindows("2026-04-15", { ...DEFAULT_CONFIG, preWindowDays: 7, postWindowDays: 3 });
    expect(w.pre.start).toBe("2026-04-08");
    expect(w.pre.end).toBe("2026-04-14");
    expect(w.post.start).toBe("2026-04-16");
    expect(w.post.end).toBe("2026-04-18");
  });
});

// ---------------------------------------------------------------------------
// linearSlope
// ---------------------------------------------------------------------------

describe("linearSlope", () => {
  it("returns 0 for constant series", () => {
    expect(linearSlope([5, 5, 5, 5, 5])).toBe(0);
  });

  it("returns positive slope for rising series", () => {
    expect(linearSlope([0, 1, 2, 3, 4])).toBeCloseTo(1, 6);
  });

  it("returns negative slope for falling series", () => {
    expect(linearSlope([10, 8, 6, 4, 2])).toBeCloseTo(-2, 6);
  });

  it("handles empty / single-element input", () => {
    expect(linearSlope([])).toBe(0);
    expect(linearSlope([42])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildTreatmentIndex + hasTreatmentInRange (overlap)
// ---------------------------------------------------------------------------

describe("buildTreatmentIndex + hasTreatmentInRange", () => {
  it("indexes change-layer events by url", () => {
    const events = [
      mkEvent({ source_id: "a", observed_at: "2026-04-01", url: "/locations/x" }),
      mkEvent({ source_id: "b", observed_at: "2026-04-05", url: "/locations/x" }),
      mkEvent({ source_id: "c", observed_at: "2026-04-02", url: "/locations/y" }),
      mkEvent({ source_id: "d", observed_at: "2026-04-03", url: "/locations/z", taxonomy_layer: "finding" }), // excluded
    ];
    const idx = buildTreatmentIndex(events);
    expect(idx.get("/locations/x")).toEqual(["2026-04-01", "2026-04-05"]);
    expect(idx.get("/locations/y")).toEqual(["2026-04-02"]);
    expect(idx.has("/locations/z")).toBe(false);
  });

  it("detects overlap within range", () => {
    const idx = new Map([["/u", ["2026-04-05", "2026-04-10"]]]);
    expect(hasTreatmentInRange(idx, "/u", "2026-04-03", "2026-04-08")).toBe(true);
    expect(hasTreatmentInRange(idx, "/u", "2026-04-06", "2026-04-09")).toBe(false);
    expect(hasTreatmentInRange(idx, "/u", "2026-04-11", "2026-04-20")).toBe(false);
    expect(hasTreatmentInRange(idx, "/other", "2026-04-01", "2026-04-30")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractWindowSeries
// ---------------------------------------------------------------------------

describe("extractWindowSeries", () => {
  it("zero-fills missing days in range (aggregate)", () => {
    const s = mkSeries("/x", [
      { date: "2026-04-01", count: 3 },
      { date: "2026-04-03", count: 5 },
    ]);
    const out = extractWindowSeries(s, { start: "2026-04-01", end: "2026-04-03" }, null);
    // Commit 2 (2026-04-24): denseSeries now tags every emitted point as
    // source_type="benchmark" so the pure-split abstain guard in
    // url-verdict.ts becomes source-aware. Test expectation updated to
    // match the new output shape.
    expect(out).toEqual([
      { date: "2026-04-01", count: 3, source_type: "benchmark" },
      { date: "2026-04-02", count: 0, source_type: "benchmark" },
      { date: "2026-04-03", count: 5, source_type: "benchmark" },
    ]);
  });

  it("filters by platform", () => {
    const s = mkSeries("/x", [
      { date: "2026-04-01", count: 3, by_platform: { ChatGPT: 2, Perplexity: 1 } },
      { date: "2026-04-02", count: 0, by_platform: {} },
      { date: "2026-04-03", count: 4, by_platform: { ChatGPT: 4 } },
    ]);
    const cg = extractWindowSeries(s, { start: "2026-04-01", end: "2026-04-03" }, "ChatGPT").map((d) => d.count);
    const pp = extractWindowSeries(s, { start: "2026-04-01", end: "2026-04-03" }, "Perplexity").map((d) => d.count);
    expect(cg).toEqual([2, 0, 4]);
    expect(pp).toEqual([1, 0, 0]);
  });
});

// ---------------------------------------------------------------------------
// findControls — platform-aware + trend matching
// ---------------------------------------------------------------------------

describe("findControls", () => {
  const treatedUrl = "/locations/treated";
  const window = buildWindows("2026-04-15", DEFAULT_CONFIG);

  function historyWith(...series: UrlCitationSeries[]) { return mkHistory(series); }

  it("excludes the treated URL itself", () => {
    const treated = constantSeries(treatedUrl, "2026-04-01", 28, 5);
    const history = historyWith(treated);
    const res = findControls({
      treatedUrl, treatedUrlType: "location", treatedPreAvg: 5, treatedPreSlope: 0,
      window, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, platform: null, inferUrlType: inferTestUrlType,
    });
    expect(res.controls.length).toBe(0);
    expect(res.excluded.is_treated_url).toBe(1);
  });

  it("excludes candidates with treatment overlap", () => {
    const treated = constantSeries(treatedUrl, "2026-04-01", 28, 5);
    const c1 = constantSeries("/locations/c1", "2026-04-01", 28, 5);
    const history = historyWith(treated, c1);
    const treatmentIndex = new Map([["/locations/c1", ["2026-04-10"]]]);
    const res = findControls({
      treatedUrl, treatedUrlType: "location", treatedPreAvg: 5, treatedPreSlope: 0,
      window, history, treatmentIndex, config: DEFAULT_CONFIG, platform: null, inferUrlType: inferTestUrlType,
    });
    expect(res.controls.length).toBe(0);
    expect(res.excluded.treatment_overlap).toBe(1);
  });

  it("excludes url_type mismatches", () => {
    const treated = constantSeries(treatedUrl, "2026-04-01", 28, 5);
    const c1 = constantSeries("/services/x", "2026-04-01", 28, 5);
    const history = historyWith(treated, c1);
    const res = findControls({
      treatedUrl, treatedUrlType: "location", treatedPreAvg: 5, treatedPreSlope: 0,
      window, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, platform: null, inferUrlType: inferTestUrlType,
    });
    expect(res.controls.length).toBe(0);
    expect(res.excluded.url_type_mismatch).toBe(1);
  });

  it("excludes candidates below aggregate baseline floor", () => {
    const treated = constantSeries(treatedUrl, "2026-04-01", 28, 5);
    const c1 = constantSeries("/locations/c1", "2026-04-01", 28, 0); // zero citations
    const history = historyWith(treated, c1);
    const res = findControls({
      treatedUrl, treatedUrlType: "location", treatedPreAvg: 5, treatedPreSlope: 0,
      window, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, platform: null, inferUrlType: inferTestUrlType,
    });
    expect(res.controls.length).toBe(0);
    expect(res.excluded.below_baseline_floor).toBe(1);
  });

  it("at ZERO treated baseline, excludes a high-baseline control (wave-5 #2 level-match at low end)", () => {
    // treatedPreAvg=0: the ratio level-filter is undefined and used to be
    // SKIPPED, admitting this 5 cit/day control as 'comparable' to a 0
    // cit/day treated URL and biasing the diff-in-diff. The fix level-matches
    // at the low end → a >=0.5 cit/day candidate is excluded.
    const treated = constantSeries(treatedUrl, "2026-04-01", 28, 0);
    const cHigh = constantSeries("/locations/c-high", "2026-04-01", 28, 5);
    const history = historyWith(treated, cHigh);
    const res = findControls({
      treatedUrl,
      treatedUrlType: "location",
      treatedPreAvg: 0,
      treatedPreSlope: 0,
      window,
      history,
      treatmentIndex: new Map(),
      config: DEFAULT_CONFIG,
      platform: null,
      inferUrlType: inferTestUrlType,
    });
    expect(res.controls.length).toBe(0);
    expect(res.excluded.baseline_similarity_fail).toBe(1);
  });

  it("excludes candidates with zero platform activity when filtering by platform", () => {
    // c1 has 5 cit/day on ChatGPT, 0 on Perplexity.
    const treated = mkSeries(treatedUrl, daysFrom("2026-04-01", 28).map((d) => ({ date: d, count: 5, by_platform: { Perplexity: 5 } })));
    const c1 = mkSeries("/locations/c1", daysFrom("2026-04-01", 28).map((d) => ({ date: d, count: 5, by_platform: { ChatGPT: 5 } })));
    const history = historyWith(treated, c1);

    // Aggregate pass accepts c1
    const aggRes = findControls({
      treatedUrl, treatedUrlType: "location", treatedPreAvg: 5, treatedPreSlope: 0,
      window, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, platform: null, inferUrlType: inferTestUrlType,
    });
    expect(aggRes.controls.length).toBe(1);

    // Perplexity pass rejects c1 (0 Perplexity citations)
    const pxRes = findControls({
      treatedUrl, treatedUrlType: "location", treatedPreAvg: 5, treatedPreSlope: 0,
      window, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, platform: "Perplexity", inferUrlType: inferTestUrlType,
    });
    expect(pxRes.controls.length).toBe(0);
    expect(pxRes.excluded.below_platform_floor).toBe(1);
  });

  it("excludes candidates whose pre-trend slope diverges beyond the threshold", () => {
    const treated = constantSeries(treatedUrl, "2026-04-01", 28, 5); // slope = 0
    // Steep rising candidate with similar level but opposite behavior over the pre-window
    const c1 = linearSeries("/locations/rising", "2026-04-01", 28, 2, 1);
    const history = historyWith(treated, c1);
    // DEFAULT_CONFIG.maxTrendSlopeDivergence = 0.6; c1 slope is 1.0 → diff 1.0 > 0.6 → reject
    const res = findControls({
      treatedUrl, treatedUrlType: "location", treatedPreAvg: 5, treatedPreSlope: 0,
      window, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, platform: null, inferUrlType: inferTestUrlType,
    });
    expect(res.excluded.trend_slope_fail).toBeGreaterThanOrEqual(1);
  });

  it("accepts candidates matching level and trend", () => {
    const treated = constantSeries(treatedUrl, "2026-04-01", 28, 5);
    const c1 = constantSeries("/locations/ok", "2026-04-01", 28, 6); // level similar, slope 0
    const history = historyWith(treated, c1);
    const res = findControls({
      treatedUrl, treatedUrlType: "location", treatedPreAvg: 5, treatedPreSlope: 0,
      window, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, platform: null, inferUrlType: inferTestUrlType,
    });
    expect(res.controls.length).toBe(1);
    expect(res.controls[0].url).toBe("/locations/ok");
  });
});

// ---------------------------------------------------------------------------
// computeDiffInDiff
// ---------------------------------------------------------------------------

describe("computeDiffInDiff", () => {
  const controls = [
    { url: "/c1", series: {} as UrlCitationSeries, url_type: null, pre_avg: 5, post_avg: 6, delta: 1, pre_slope: 0 },
    { url: "/c2", series: {} as UrlCitationSeries, url_type: null, pre_avg: 4, post_avg: 5, delta: 1, pre_slope: 0 },
  ];

  it("computes adjusted_lift = treated_delta - mean(control_delta)", () => {
    const lift = computeDiffInDiff(
      { pre_avg: 5, post_avg: 10, pre_days_observed: 14, post_days_observed: 14 },
      controls,
      DEFAULT_CONFIG,
      "overall",
    );
    expect(lift.treated_delta).toBe(5);
    expect(lift.control_delta).toBe(1);
    expect(lift.adjusted_lift).toBe(4);
    expect(lift.relative_lift).toBeCloseTo(0.8, 6); // 4 / max(5, 0.5) = 0.8
    expect(lift.controls_used).toBe(2);
  });

  it("suppresses relative_lift when treated baseline is near zero", () => {
    const lift = computeDiffInDiff(
      { pre_avg: 0, post_avg: 3, pre_days_observed: 0, post_days_observed: 10 },
      controls,
      DEFAULT_CONFIG,
      "overall",
    );
    expect(lift.adjusted_lift).toBe(2); // 3 - 1
    expect(lift.relative_lift).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// gradeConfidence
// ---------------------------------------------------------------------------

describe("gradeConfidence", () => {
  it("low + no_diff_in_diff when controls below computed threshold", () => {
    const g = gradeConfidence({
      controls_used: 1, treated_pre_avg: 5, post_days_observed: 10,
      full_post_window_days: 14, config: DEFAULT_CONFIG,
    });
    expect(g.tier).toBe("low");
    expect(g.warnings.join(" ")).toContain("no_diff_in_diff");
  });

  it("medium when controls ≥ computed threshold but < high threshold", () => {
    const g = gradeConfidence({
      controls_used: 2, treated_pre_avg: 5, post_days_observed: 14,
      full_post_window_days: 14, config: DEFAULT_CONFIG,
    });
    expect(g.tier).toBe("medium");
  });

  it("high when controls ≥ high threshold and baseline not near-zero", () => {
    const g = gradeConfidence({
      controls_used: 3, treated_pre_avg: 5, post_days_observed: 14,
      full_post_window_days: 14, config: DEFAULT_CONFIG,
    });
    expect(g.tier).toBe("high");
  });

  it("drops to medium for low baseline even if controls are plentiful", () => {
    const g = gradeConfidence({
      controls_used: 5, treated_pre_avg: 0.1, post_days_observed: 14,
      full_post_window_days: 14, config: DEFAULT_CONFIG,
    });
    expect(g.tier).toBe("medium");
    expect(g.warnings.join(" ")).toContain("low_baseline");
  });

  it("drops to low when zero post-window days observed", () => {
    const g = gradeConfidence({
      controls_used: 5, treated_pre_avg: 5, post_days_observed: 0,
      full_post_window_days: 14, config: DEFAULT_CONFIG,
    });
    expect(g.tier).toBe("low");
    expect(g.warnings.join(" ")).toContain("no_post_data");
  });
});

// ---------------------------------------------------------------------------
// attributeEvent — end-to-end status + structural-split guarantees
// ---------------------------------------------------------------------------

describe("attributeEvent — structural split (no adjusted_lift leakage)", () => {
  const treatmentDate = "2026-04-15";

  it("status=computed → overall populated, raw_overall is null", () => {
    const treated = constantSeries("/locations/t", "2026-04-01", 28, 5);
    // 3 controls similar baseline + flat slope
    const c1 = constantSeries("/locations/c1", "2026-04-01", 28, 6);
    const c2 = constantSeries("/locations/c2", "2026-04-01", 28, 5);
    const c3 = constantSeries("/locations/c3", "2026-04-01", 28, 4);
    const history = mkHistory([treated, c1, c2, c3]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("computed");
    expect(r.overall).not.toBeNull();
    expect(r.raw_overall).toBeNull();
  });

  it("weak_estimate with exactly 1 control → overall is null, raw_overall populated, no adjusted_lift field exists on raw", () => {
    const treated = constantSeries("/locations/t", "2026-04-01", 28, 5);
    const c1 = constantSeries("/locations/c1", "2026-04-01", 28, 5);
    const history = mkHistory([treated, c1]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("weak_estimate");
    expect(r.overall).toBeNull();
    expect(r.raw_overall).not.toBeNull();
    // Structural guarantee: RawPrePost has no adjusted_lift property, by type AND runtime.
    expect((r.raw_overall as unknown as Record<string, unknown>).adjusted_lift).toBeUndefined();
    expect(r.raw_overall!.caveat).toMatch(/not a causal estimate|below computed threshold/i);
  });

  it("no_controls → overall null, raw_overall populated with explicit caveat", () => {
    const treated = constantSeries("/locations/t", "2026-04-01", 28, 5);
    // Only control is the treated URL itself, so after exclusion there are zero candidates.
    const history = mkHistory([treated]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("no_controls");
    expect(r.overall).toBeNull();
    expect(r.raw_overall!.caveat).toMatch(/no viable controls/i);
  });

  it("zero_signal → overall null, raw_overall null, status set", () => {
    const treated = constantSeries("/locations/t", "2026-04-01", 28, 0);
    const history = mkHistory([treated]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("zero_signal");
    expect(r.overall).toBeNull();
    expect(r.raw_overall).toBeNull();
  });

  it("insufficient_baseline when treatment date predates history", () => {
    const treated = constantSeries("/locations/t", "2026-04-10", 14, 5);
    const history = mkHistory([treated]);
    const event = mkEvent({ source_id: "e1", observed_at: "2026-04-01", url: "/locations/t" }); // before history.first
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("insufficient_baseline");
  });

  it("unsupported_scope propagates through attributeEvent", () => {
    const event = mkEvent({ source_id: "e1", observed_at: "2026-04-15", url: null, scope: "sitewide" });
    const r = attributeEvent({
      event, history: mkHistory([]), treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("unsupported_scope");
    expect(r.overall).toBeNull();
    expect(r.raw_overall).toBeNull();
  });

  it("ineligible_layer for non-change events", () => {
    const event = mkEvent({ source_id: "e1", observed_at: "2026-04-15", taxonomy_layer: "finding", scope: "single_url" });
    const r = attributeEvent({
      event, history: mkHistory([]), treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("ineligible_layer");
  });
});

// ---------------------------------------------------------------------------
// Placebo wiring (#64 → engine, 2026-06-12 night shift): HIGH confidence on
// computed results additionally requires the lift to beat the leave-one-out
// placebo distribution of the engine's own control deltas (p < 0.1).
// ---------------------------------------------------------------------------

function stepSeries(url: string, start: string, preDays: number, preCount: number, postDays: number, postCount: number, platform = "ChatGPT"): UrlCitationSeries {
  return mkSeries(
    url,
    daysFrom(start, preDays + postDays).map((d, i) => {
      const count = i < preDays ? preCount : postCount;
      return { date: d, count, by_platform: { [platform]: count } };
    }),
  );
}

describe("attributeEvent — placebo inference gates HIGH confidence", () => {
  const treatmentDate = "2026-04-15";

  it("a real lift vs flat controls clears the placebo bar → HIGH, placebo_p persisted", () => {
    // Treated: 5/day pre → 9/day post. Controls: flat (deltas ≈ 0).
    const treated = stepSeries("/locations/t", "2026-04-01", 14, 5, 14, 9);
    const c1 = constantSeries("/locations/c1", "2026-04-01", 28, 6);
    const c2 = constantSeries("/locations/c2", "2026-04-01", 28, 5);
    const c3 = constantSeries("/locations/c3", "2026-04-01", 28, 4);
    const history = mkHistory([treated, c1, c2, c3]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("computed");
    expect(r.confidence).toBe("high");
    expect(r.overall!.placebo_p).toBe(0); // no flat control matched a +4 lift
    expect(r.warnings.join(" ")).not.toContain("placebo_not_significant");
  });

  it("a chance-level lift (treated flat like the controls) is capped at MEDIUM with the warning", () => {
    const treated = constantSeries("/locations/t", "2026-04-01", 28, 5);
    const c1 = constantSeries("/locations/c1", "2026-04-01", 28, 6);
    const c2 = constantSeries("/locations/c2", "2026-04-01", 28, 5);
    const c3 = constantSeries("/locations/c3", "2026-04-01", 28, 4);
    const history = mkHistory([treated, c1, c2, c3]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("computed"); // the point estimate is unchanged
    expect(r.confidence).toBe("medium"); // ...but never sold as HIGH
    expect(r.overall!.placebo_p).toBe(1); // every placebo matched a 0 lift
    expect(r.warnings.join(" ")).toContain("placebo_not_significant");
  });
});

// ---------------------------------------------------------------------------
// Platform-aware post windows (2026-06-12 night shift): a platform's
// breakdown may measure over its own longer window (engines reflect content
// changes at different speeds); the aggregate window/status/confidence are
// untouched. Defaults are EMPTY — behavior is identical until calibration
// constants ship with sources.
// ---------------------------------------------------------------------------

describe("attributeEvent — platform-aware post windows", () => {
  const treatmentDate = "2026-04-15";

  /** Pre 14d at `preCount`; post days 1-14 flat at `preCount`; post days
   *  15-21 at `lateCount` — a lift only a longer window can see. */
  function lateLiftSeries(url: string, lateCount: number): UrlCitationSeries {
    return mkSeries(
      url,
      daysFrom("2026-04-01", 35).map((d, i) => {
        // Index 14 = the 04-15 treatment day; the 14d post window ends at
        // index 28 (04-29). The lift starts at index 29 — outside it.
        const count = i < 29 ? 5 : lateCount;
        return { date: d, count, by_platform: { ChatGPT: count } };
      }),
    );
  }

  function flat35(url: string, count: number): UrlCitationSeries {
    return mkSeries(
      url,
      daysFrom("2026-04-01", 35).map((d) => ({
        date: d,
        count,
        by_platform: { ChatGPT: count },
      })),
    );
  }

  it("a configured platform measures over its own window and says so", () => {
    const treated = lateLiftSeries("/locations/t", 12);
    const history = mkHistory([
      treated,
      flat35("/locations/c1", 6),
      flat35("/locations/c2", 5),
      flat35("/locations/c3", 4),
    ]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const config = {
      ...DEFAULT_CONFIG,
      platformPostWindowDays: { ChatGPT: 21 },
    };
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("computed");
    // Aggregate (14d) saw no lift — the late move is outside its window.
    expect(Math.abs(r.overall!.adjusted_lift)).toBeLessThan(0.5);
    // The ChatGPT breakdown measured over ITS 21-day window and caught it.
    const cg = r.per_platform.find((l) => l.platform === "ChatGPT");
    expect(cg).toBeDefined();
    // 21 configured, honestly clamped to the history's last day (05-05):
    // 04-16..05-05 = 20 days. The field reports what was MEASURED.
    expect(cg!.post_window_days).toBe(20);
    expect(cg!.adjusted_lift).toBeGreaterThan(1.5);
  });

  it("an explicitly empty platformPostWindowDays changes nothing", () => {
    const treated = lateLiftSeries("/locations/t", 12);
    const history = mkHistory([
      treated,
      flat35("/locations/c1", 6),
      flat35("/locations/c2", 5),
      flat35("/locations/c3", 4),
    ]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: { ...DEFAULT_CONFIG, platformPostWindowDays: {} }, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("computed");
    const cg = r.per_platform.find((l) => l.platform === "ChatGPT");
    expect(cg!.post_window_days).toBe(14);
    expect(Math.abs(cg!.adjusted_lift)).toBeLessThan(0.5);
  });

  it("DEFAULT calibration resolves display-case platform keys via the canonical slug", () => {
    // History keys carry "ChatGPT" (legacy display case); the shipped
    // calibration is keyed by the slug "chatgpt" (60d) — the
    // normalizePlatform fallback must connect them. 60d clamps to the
    // history's last day: 04-16..05-05 = 20 measured days.
    const treated = lateLiftSeries("/locations/t", 12);
    const history = mkHistory([
      treated,
      flat35("/locations/c1", 6),
      flat35("/locations/c2", 5),
      flat35("/locations/c3", 4),
    ]);
    const event = mkEvent({ source_id: "e1", observed_at: treatmentDate, url: "/locations/t" });
    const r = attributeEvent({
      event, history, treatmentIndex: new Map(), config: DEFAULT_CONFIG, inferUrlType: inferTestUrlType, classifierVersion: CLASSIFIER_VERSION,
    });
    expect(r.status).toBe("computed");
    const cg = r.per_platform.find((l) => l.platform === "ChatGPT");
    expect(cg!.post_window_days).toBe(20);
    expect(cg!.adjusted_lift).toBeGreaterThan(1.5);
  });
});
