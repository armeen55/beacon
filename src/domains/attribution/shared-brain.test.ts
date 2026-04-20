/**
 * Tests for shared-brain anonymization + aggregation.
 * Covers:
 *   - privacy audit rejects leaked URLs / source_ids / absolute counts
 *   - sanitize strips day-level dates to YYYY-MM
 *   - warning categorization is prefix-based
 *   - aggregate grouping respects minimum-N tiers
 *   - per-platform subpatterns suppress below-weak N
 *   - describePattern is conservative
 *   - cohort grouping requires ≥ 3 cohorts
 */

import { describe, it, expect } from "vitest";
import {
  auditBrainObservation,
  categorizeWarning,
  sanitizeStoredOutcomeForBrain,
  type BrainObservation,
  type WarningCategory,
} from "./brain-input";
import {
  aggregateBrainPatterns,
  describePattern,
  scorePatternStrength,
  summarizeBrain,
  DEFAULT_CONFIG,
  DEFAULT_AGGREGATE_THRESHOLDS,
  DEFAULT_PER_PLATFORM_THRESHOLDS,
  type BrainPattern,
} from "./shared-brain";
import type {
  StoredChangeOutcome,
  ComputedBlock,
  RawBlock,
} from "./change-outcome-store";
import type { PlatformLift, RawPrePost } from "./natural-controls";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mkLift(p: Partial<PlatformLift> = {}): PlatformLift {
  return {
    platform: p.platform ?? "overall",
    treated_pre_avg: p.treated_pre_avg ?? 5,
    treated_post_avg: p.treated_post_avg ?? 10,
    control_pre_avg: p.control_pre_avg ?? 5,
    control_post_avg: p.control_post_avg ?? 6,
    treated_delta: p.treated_delta ?? 5,
    control_delta: p.control_delta ?? 1,
    adjusted_lift: p.adjusted_lift ?? 4,
    relative_lift: p.relative_lift ?? 0.6,
    controls_used: p.controls_used ?? 3,
    pre_days_observed: p.pre_days_observed ?? 14,
    post_days_observed: p.post_days_observed ?? 14,
  };
}

function mkRaw(p: Partial<RawPrePost> = {}): RawPrePost {
  return {
    platform: p.platform ?? "overall",
    treated_pre_avg: p.treated_pre_avg ?? 0,
    treated_post_avg: p.treated_post_avg ?? 3,
    treated_delta: p.treated_delta ?? 3,
    pre_days_observed: p.pre_days_observed ?? 0,
    post_days_observed: p.post_days_observed ?? 14,
    caveat: p.caveat ?? "raw only",
  };
}

function mkStored(over: Partial<StoredChangeOutcome> = {}): StoredChangeOutcome {
  const computedBlock: ComputedBlock | null = over.computed !== undefined ? over.computed : null;
  const rawBlock: RawBlock | null = over.raw !== undefined ? over.raw : null;
  return {
    source_id: over.source_id ?? "cl-real-1",
    classifier_version: "v1",
    stored_at: "2026-04-20T00:00:00Z",
    taxonomy_layer: "change",
    primary_bucket: over.primary_bucket ?? "content.faq.add",
    child_tags: over.child_tags ?? [],
    paired_with: [],
    bundle_parent_id: null,
    bundle_size: 1,
    url: over.url ?? "/locations/somewhere",
    url_type: over.url_type ?? "location",
    treatment_date: over.treatment_date ?? "2026-04-10",
    pre_window: { start: "2026-03-27", end: "2026-04-09" },
    post_window: { start: "2026-04-11", end: "2026-04-24" },
    status: over.status ?? "computed",
    confidence: over.confidence ?? "medium",
    warnings: over.warnings ?? [],
    rationale: "test rationale",
    computed: computedBlock,
    raw: rawBlock,
    matched_control_count: over.matched_control_count ?? 3,
    matched_control_urls: over.matched_control_urls ?? ["/locations/a", "/locations/b"],
    excluded_control_count: 0,
    excluded_reasons: {},
    excluded_reasons_by_platform: {},
    sparklines: null,
    computed_at: "2026-04-20T00:00:00Z",
  };
}

function computedStored(relative_lift: number, overrides: Partial<StoredChangeOutcome> = {}): StoredChangeOutcome {
  return mkStored({
    ...overrides,
    status: "computed",
    computed: {
      kind: "computed",
      overall: mkLift({ relative_lift }),
      per_platform: overrides.computed?.per_platform ?? [
        mkLift({ platform: "ChatGPT", relative_lift }),
        mkLift({ platform: "Perplexity", relative_lift }),
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Privacy audit
// ---------------------------------------------------------------------------

describe("auditBrainObservation", () => {
  const safe: BrainObservation = {
    primary_bucket: "content.faq.add",
    child_tags: [],
    bundle_size: 1,
    url_type: "location",
    status: "computed",
    confidence: "medium",
    adjusted_lift_relative: 0.5,
    controls_used: 3,
    per_platform: [{ platform: "ChatGPT", adjusted_lift_relative: 0.6, controls_used: 3 }],
    warning_categories: [],
    tenant_cohort: "custom_home_builder",
    observation_month: "2026-04",
  };

  it("passes a well-formed observation", () => {
    expect(() => auditBrainObservation(safe)).not.toThrow();
  });

  it("rejects a URL path leaked into primary_bucket", () => {
    expect(() => auditBrainObservation({ ...safe, primary_bucket: "/locations/palo-alto" }))
      .toThrow(/URL-like/);
  });

  it("rejects a changelog source_id leaked into child_tags", () => {
    expect(() => auditBrainObservation({ ...safe, child_tags: ["cl-real-42"] }))
      .toThrow(/source_id-like/);
  });

  it("rejects a full URL in tenant_cohort", () => {
    expect(() => auditBrainObservation({ ...safe, tenant_cohort: "https://ritzbuilders.com" }))
      .toThrow(/URL-like/);
  });

  it("rejects a day-level observation_month", () => {
    expect(() => auditBrainObservation({ ...safe, observation_month: "2026-04-10" }))
      .toThrow(/observation_month/);
  });

  it("rejects an injected absolute-count field", () => {
    const leaky = { ...safe, treated_pre_avg: 5 } as unknown as BrainObservation;
    expect(() => auditBrainObservation(leaky)).toThrow(/unexpected field.*treated_pre/);
  });

  it("rejects an injected rationale string", () => {
    const leaky = { ...safe, rationale: "content.faq.add on /locations/x" } as unknown as BrainObservation;
    expect(() => auditBrainObservation(leaky)).toThrow(/unexpected field.*rationale/);
  });
});

// ---------------------------------------------------------------------------
// sanitize
// ---------------------------------------------------------------------------

describe("sanitizeStoredOutcomeForBrain", () => {
  it("copies the taxonomy + url_type through unchanged", () => {
    const stored = computedStored(0.4, { primary_bucket: "content.faq.add", url_type: "location" });
    const out = sanitizeStoredOutcomeForBrain(stored);
    expect(out.primary_bucket).toBe("content.faq.add");
    expect(out.url_type).toBe("location");
  });

  it("drops URL + source_id + matched_control_urls", () => {
    const stored = computedStored(0.4, {
      source_id: "cl-real-200",
      url: "/locations/menlo-park",
      matched_control_urls: ["/locations/atherton", "/locations/los-altos"],
    });
    const out = sanitizeStoredOutcomeForBrain(stored);
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("cl-real-200");
    expect(flat).not.toContain("/locations/menlo-park");
    expect(flat).not.toContain("/locations/atherton");
  });

  it("keeps RELATIVE lift and drops ABSOLUTE counts", () => {
    const stored = computedStored(0.45, {
      computed: {
        kind: "computed",
        overall: mkLift({ treated_pre_avg: 1234, treated_post_avg: 2000, adjusted_lift: 766, relative_lift: 0.45 }),
        per_platform: [],
      },
    });
    const out = sanitizeStoredOutcomeForBrain(stored);
    expect(out.adjusted_lift_relative).toBe(0.45);
    expect(JSON.stringify(out)).not.toContain("1234");
    expect(JSON.stringify(out)).not.toContain("2000");
  });

  it("coarsens treatment_date to YYYY-MM", () => {
    const stored = computedStored(0.3, { treatment_date: "2026-04-17T13:00:00Z" });
    const out = sanitizeStoredOutcomeForBrain(stored);
    expect(out.observation_month).toBe("2026-04");
  });

  it("categorizes warning strings to categories only — never keeps raw strings", () => {
    const stored = mkStored({
      warnings: [
        "treated_url_post_overlap: another change on /locations/menlo-park landed during post window",
        "thin_control_set: 2 viable control(s), target ≥3 for HIGH",
      ],
      status: "weak_estimate",
      raw: { kind: "raw", overall: mkRaw({ caveat: "no controls" }), per_platform: [] },
    });
    const out = sanitizeStoredOutcomeForBrain(stored);
    expect(out.warning_categories).toContain("treated_url_post_overlap");
    expect(out.warning_categories).toContain("thin_controls");
    expect(JSON.stringify(out)).not.toContain("/locations/menlo-park");
  });

  it("uses caller-supplied cohort resolver (broad label only)", () => {
    const stored = computedStored(0.3);
    const out = sanitizeStoredOutcomeForBrain(stored, () => "custom_home_builder");
    expect(out.tenant_cohort).toBe("custom_home_builder");
  });

  it("drops RAW-block numbers even for weak_estimate outcomes", () => {
    const stored = mkStored({
      status: "weak_estimate",
      raw: { kind: "raw", overall: mkRaw({ treated_delta: 33.7, caveat: "no controls" }), per_platform: [] },
    });
    const out = sanitizeStoredOutcomeForBrain(stored);
    expect(JSON.stringify(out)).not.toContain("33.7");
    expect(out.adjusted_lift_relative).toBeNull();
    expect(out.controls_used).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// warning categorization
// ---------------------------------------------------------------------------

describe("categorizeWarning", () => {
  const cases: Array<[string, WarningCategory]> = [
    ["treated_url_self_overlap: another change on same URL", "treated_url_self_overlap"],
    ["treated_url_post_overlap: another change landed post", "treated_url_post_overlap"],
    ["thin_control_set: only 2 controls", "thin_controls"],
    ["no_viable_controls: zero candidates", "no_viable_controls"],
    ["no_diff_in_diff: only 1 control", "no_diff_in_diff"],
    ["low_baseline: treated URL baseline=0.1 near zero", "low_baseline"],
    ["no_post_data: treated URL had zero citations post", "no_post_data"],
    ["weak_estimate: raw treated pre/post only", "weak_estimate"],
    ["no_controls_used: lift is raw delta only", "no_viable_controls"],
    ["some unfamiliar warning", "other"],
  ];
  for (const [input, expected] of cases) {
    it(`"${input.slice(0, 40)}..." → ${expected}`, () => {
      expect(categorizeWarning(input)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// scorePatternStrength
// ---------------------------------------------------------------------------

describe("scorePatternStrength", () => {
  it("respects aggregate tiers", () => {
    expect(scorePatternStrength(0, DEFAULT_AGGREGATE_THRESHOLDS)).toBe("not_enough_evidence");
    expect(scorePatternStrength(2, DEFAULT_AGGREGATE_THRESHOLDS)).toBe("not_enough_evidence");
    expect(scorePatternStrength(3, DEFAULT_AGGREGATE_THRESHOLDS)).toBe("weak_signal");
    expect(scorePatternStrength(9, DEFAULT_AGGREGATE_THRESHOLDS)).toBe("weak_signal");
    expect(scorePatternStrength(10, DEFAULT_AGGREGATE_THRESHOLDS)).toBe("emerging_signal");
    expect(scorePatternStrength(29, DEFAULT_AGGREGATE_THRESHOLDS)).toBe("emerging_signal");
    expect(scorePatternStrength(30, DEFAULT_AGGREGATE_THRESHOLDS)).toBe("strong_signal");
  });
  it("per-platform thresholds are stricter", () => {
    expect(scorePatternStrength(4, DEFAULT_PER_PLATFORM_THRESHOLDS)).toBe("not_enough_evidence");
    expect(scorePatternStrength(5, DEFAULT_PER_PLATFORM_THRESHOLDS)).toBe("weak_signal");
    expect(scorePatternStrength(15, DEFAULT_PER_PLATFORM_THRESHOLDS)).toBe("emerging_signal");
    expect(scorePatternStrength(45, DEFAULT_PER_PLATFORM_THRESHOLDS)).toBe("strong_signal");
  });
});

// ---------------------------------------------------------------------------
// aggregateBrainPatterns
// ---------------------------------------------------------------------------

describe("aggregateBrainPatterns", () => {
  it("groups by (primary_bucket, url_type)", () => {
    const obs: BrainObservation[] = [
      sanitizeStoredOutcomeForBrain(computedStored(0.3, { primary_bucket: "content.faq.add", url_type: "location" })),
      sanitizeStoredOutcomeForBrain(computedStored(0.4, { primary_bucket: "content.faq.add", url_type: "location" })),
      sanitizeStoredOutcomeForBrain(computedStored(0.5, { primary_bucket: "content.faq.add", url_type: "service" })),
    ];
    const patterns = aggregateBrainPatterns(obs);
    expect(patterns.length).toBe(2);
    const loc = patterns.find((p) => p.grouping.url_type === "location")!;
    expect(loc.computed_n).toBe(2);
  });

  it("tags not_enough_evidence below weak threshold", () => {
    const obs: BrainObservation[] = [
      sanitizeStoredOutcomeForBrain(computedStored(0.4)),
      sanitizeStoredOutcomeForBrain(computedStored(0.4)),
    ];
    const patterns = aggregateBrainPatterns(obs);
    expect(patterns[0].strength).toBe("not_enough_evidence");
    expect(patterns[0].description).toMatch(/Too few computed outcomes/);
  });

  it("tags weak_signal at N=3 and describes conservatively", () => {
    const obs = [
      computedStored(0.5),
      computedStored(0.3),
      computedStored(0.4),
    ].map((s) => sanitizeStoredOutcomeForBrain(s));
    const patterns = aggregateBrainPatterns(obs);
    expect(patterns[0].strength).toBe("weak_signal");
    expect(patterns[0].description).toMatch(/small sample.*N=3/);
    expect(patterns[0].description).toMatch(/usually associated|mixed/);
    expect(patterns[0].description).not.toMatch(/works|definitely|causes/i);
  });

  it("tags emerging_signal at N=10 and cites median", () => {
    const obs: BrainObservation[] = [];
    for (let i = 0; i < 10; i++) obs.push(sanitizeStoredOutcomeForBrain(computedStored(0.3)));
    const patterns = aggregateBrainPatterns(obs);
    expect(patterns[0].strength).toBe("emerging_signal");
    expect(patterns[0].description).toMatch(/10 computed outcomes/);
    expect(patterns[0].description).toMatch(/emerging signal/i);
    expect(patterns[0].description).not.toMatch(/definitely|proven|causes/i);
  });

  it("suppresses per-platform subpatterns below per-platform weak threshold", () => {
    const obs: BrainObservation[] = [];
    // N=10 aggregate → per-platform weak requires 5 per platform
    for (let i = 0; i < 10; i++) {
      obs.push(
        sanitizeStoredOutcomeForBrain(
          computedStored(0.3, {
            computed: {
              kind: "computed",
              overall: mkLift({ relative_lift: 0.3 }),
              // only ChatGPT is observed across all 10; Perplexity only in the first 3
              per_platform:
                i < 3
                  ? [mkLift({ platform: "ChatGPT", relative_lift: 0.3 }), mkLift({ platform: "Perplexity", relative_lift: 0.2 })]
                  : [mkLift({ platform: "ChatGPT", relative_lift: 0.3 })],
            },
          }),
        ),
      );
    }
    const patterns = aggregateBrainPatterns(obs);
    const platforms = patterns[0].per_platform.map((p) => p.platform);
    expect(platforms).toContain("ChatGPT");
    expect(platforms).not.toContain("Perplexity");
  });

  it("never emits absolute numbers in a pattern description", () => {
    const obs: BrainObservation[] = [];
    for (let i = 0; i < 5; i++) obs.push(sanitizeStoredOutcomeForBrain(computedStored(0.5)));
    const patterns = aggregateBrainPatterns(obs);
    // Pattern description should reference N + percent only, not absolute cit/day
    expect(patterns[0].description).not.toMatch(/\d+ cit\/day/);
  });

  it("respects minCohortsForCohortGrouping — single cohort input is grouped without cohort", () => {
    const obs: BrainObservation[] = [];
    for (let i = 0; i < 6; i++) {
      obs.push(sanitizeStoredOutcomeForBrain(computedStored(0.3), () => "custom_home_builder"));
    }
    const patterns = aggregateBrainPatterns(obs, { ...DEFAULT_CONFIG, groupByTenantCohort: true, minCohortsForCohortGrouping: 3 });
    // Only 1 cohort present — grouping should NOT key by cohort.
    expect(patterns[0].grouping.tenant_cohort).toBeUndefined();
    // cohort_count reported for transparency
    expect(patterns[0].cohort_count).toBe(1);
  });

  it("activates cohort grouping when ≥ minCohorts present", () => {
    const obs: BrainObservation[] = [];
    const cohorts = ["a", "b", "c"];
    for (let i = 0; i < 9; i++) {
      const c = cohorts[i % 3];
      obs.push(sanitizeStoredOutcomeForBrain(computedStored(0.3), () => c));
    }
    const patterns = aggregateBrainPatterns(obs, { ...DEFAULT_CONFIG, groupByTenantCohort: true, minCohortsForCohortGrouping: 3 });
    // 3 patterns — one per cohort
    expect(patterns.length).toBe(3);
    expect(patterns.every((p) => p.grouping.tenant_cohort !== undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describePattern
// ---------------------------------------------------------------------------

describe("describePattern", () => {
  const base: BrainPattern = {
    grouping: { primary_bucket: "content.faq.add", url_type: "location" },
    total_n: 3,
    computed_n: 3,
    status_mix: { computed: 3 },
    confidence_mix: { medium: 3 },
    computed_stats: { mean_relative_lift: 0.4, median_relative_lift: 0.4, positive_count: 3, negative_count: 0, near_zero_count: 0 },
    per_platform: [],
    warning_prevalence: {},
    strength: "weak_signal",
    description: "",
    cohort_count: 1,
  };

  it("uses qualified 'associated with' for weak signals", () => {
    const desc = describePattern(base);
    expect(desc).toMatch(/small sample.*associated with positive/);
    expect(desc).not.toMatch(/works|prove|cause|definitely|win/i);
  });

  it("uses 'emerging signal' language at emerging tier", () => {
    const p: BrainPattern = { ...base, computed_n: 12, strength: "emerging_signal", total_n: 12, computed_stats: { ...base.computed_stats!, positive_count: 10, negative_count: 1, near_zero_count: 1 } };
    expect(describePattern(p)).toMatch(/12 computed outcomes.*positive|Emerging signal/i);
  });

  it("calls out mixed results honestly", () => {
    const p: BrainPattern = {
      ...base,
      computed_n: 10,
      strength: "emerging_signal",
      computed_stats: { ...base.computed_stats!, positive_count: 4, negative_count: 4, near_zero_count: 2 },
    };
    expect(describePattern(p)).toMatch(/mixed/i);
  });

  it("never says 'Beacon learned'/'definitely'/'causes'", () => {
    const strong: BrainPattern = {
      ...base,
      total_n: 40,
      computed_n: 40,
      strength: "strong_signal",
      computed_stats: { mean_relative_lift: 0.45, median_relative_lift: 0.5, positive_count: 36, negative_count: 2, near_zero_count: 2 },
    };
    const s = describePattern(strong);
    expect(s).not.toMatch(/beacon learned|definitely|causes|proven/i);
    expect(s).toMatch(/associates consistently with positive/i);
  });
});

// ---------------------------------------------------------------------------
// summarizeBrain
// ---------------------------------------------------------------------------

describe("summarizeBrain", () => {
  it("reports pattern counts by strength", () => {
    const obs: BrainObservation[] = [];
    // Two buckets. Bucket A has N=3 (weak). Bucket B has N=1 (not_enough_evidence).
    for (let i = 0; i < 3; i++) obs.push(sanitizeStoredOutcomeForBrain(computedStored(0.3, { primary_bucket: "a.x.add" })));
    obs.push(sanitizeStoredOutcomeForBrain(computedStored(0.3, { primary_bucket: "b.y.add" })));
    const patterns = aggregateBrainPatterns(obs);
    const summary = summarizeBrain(obs, patterns);
    expect(summary.patterns_by_strength.weak_signal).toBe(1);
    expect(summary.patterns_by_strength.not_enough_evidence).toBe(1);
    expect(summary.distinct_buckets).toBe(2);
  });
});
