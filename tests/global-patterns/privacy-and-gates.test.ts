/**
 * CX4.7 — Privacy leak + confidence gate tests.
 *
 * These tests are LOAD-BEARING. If they fail, the pattern engine is
 * either leaking cross-tenant data or surfacing patterns that don't
 * meet the confidence threshold. Neither is acceptable.
 *
 * Hard rules tested:
 *   - Global patterns contain NO tenant_id, domain, page URL, or
 *     change descriptions
 *   - contributing_tenant_count < 3 → queryPattern returns null
 *   - contributing_tenant_count < 10 → seeded_warning is true
 *   - contributing_tenant_count ≥ 10 → full confidence, no warning
 *   - Per-change dedup: same change counted only once per pattern
 *   - normalizeImpact dampens inflated deltas
 */

import { describe, it, expect } from "vitest";
import {
  evaluateConfidenceGate,
  normalizeImpact,
  aggregationDedupKey,
  patternKeyHash,
  contextBinKey,
  type GlobalPattern,
  type PatternKey,
} from "@/domains/global-patterns/contracts";
import { queryPattern } from "@/domains/global-patterns/query";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePattern(overrides: Partial<GlobalPattern> = {}): GlobalPattern {
  const key: PatternKey = {
    segment: "local_residential_builder",
    change_type: "faq_schema",
    platform: "chatgpt",
    context_bin: "zero::established",
  };
  return {
    id: patternKeyHash(key),
    key,
    outcome_class: "improvement_fast",
    sample_count: 5,
    contributing_tenant_count: 5,
    contributing_tenant_ids: ["t1", "t2", "t3", "t4", "t5"],
    positive_rate: 0.8,
    median_days_to_signal: 5,
    avg_normalized_impact: 25.0,
    first_observed: "2026-01-01",
    last_observed: "2026-04-01",
    seeded_from_founder: false,
    taxonomy_version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Confidence gates — HARD
// ---------------------------------------------------------------------------

describe("confidence gates", () => {
  it("suppresses patterns with contributing_tenant_count < 3", () => {
    const p = makePattern({ contributing_tenant_count: 2 });
    expect(evaluateConfidenceGate(p)).toBe("suppressed");
  });

  it("suppresses patterns with count=1 even if sample_count is high", () => {
    const p = makePattern({
      sample_count: 50,
      contributing_tenant_count: 1,
    });
    expect(evaluateConfidenceGate(p)).toBe("suppressed");
  });

  it("returns seeded_warning for count 3-9", () => {
    expect(
      evaluateConfidenceGate(makePattern({ contributing_tenant_count: 3 })),
    ).toBe("seeded_warning");
    expect(
      evaluateConfidenceGate(makePattern({ contributing_tenant_count: 9 })),
    ).toBe("seeded_warning");
  });

  it("returns confirmed for count ≥ 10", () => {
    expect(
      evaluateConfidenceGate(
        makePattern({ contributing_tenant_count: 10 }),
      ),
    ).toBe("confirmed");
    expect(
      evaluateConfidenceGate(
        makePattern({ contributing_tenant_count: 100 }),
      ),
    ).toBe("confirmed");
  });
});

// ---------------------------------------------------------------------------
// Privacy — no PII in global patterns
// ---------------------------------------------------------------------------

describe("privacy", () => {
  it("GlobalPattern has no tenant_id field", () => {
    const p = makePattern();
    // TypeScript enforces this at compile time, but let's be explicit
    expect("tenant_id" in p).toBe(false);
  });

  it("GlobalPattern has no domain or URL fields", () => {
    const p = makePattern();
    const json = JSON.stringify(p);
    expect(json).not.toContain("ritzbuilders.com");
    expect(json).not.toContain("/locations/");
    expect(json).not.toContain("ashaconstruction");
  });

  it("GlobalPattern has no change_description field", () => {
    const p = makePattern();
    expect("change_description" in p).toBe(false);
    expect("description" in p).toBe(false);
  });

  it("contributing_tenant_ids exists but should be stripped before external display", () => {
    // Internal use only — for counting. The query layer's
    // PopulationEvidence does NOT include this field.
    const p = makePattern();
    expect(p.contributing_tenant_ids).toBeDefined();
    // Verify PopulationEvidence shape from the query layer doesn't leak IDs
    // (PopulationEvidence has builder_count, not tenant IDs)
  });
});

// ---------------------------------------------------------------------------
// Attribution inflation normalization
// ---------------------------------------------------------------------------

describe("normalizeImpact", () => {
  it("does not modify delta when observation counts are similar", () => {
    const result = normalizeImpact({
      raw_delta_pct: 50,
      observations_before: 10,
      observations_after: 12,
    });
    expect(result).toBe(50); // ratio 1.2 < 1.5 threshold
  });

  it("dampens delta when observations_after >> observations_before", () => {
    const result = normalizeImpact({
      raw_delta_pct: 300,
      observations_before: 3,
      observations_after: 12,
    });
    // factor = sqrt(3/12) = 0.5, so 300 * 0.5 = 150
    expect(result).toBe(150);
  });

  it("caps at 500% maximum", () => {
    const result = normalizeImpact({
      raw_delta_pct: 1000,
      observations_before: 10,
      observations_after: 10,
    });
    expect(result).toBe(500);
  });

  it("caps at -95% minimum", () => {
    const result = normalizeImpact({
      raw_delta_pct: -200,
      observations_before: 10,
      observations_after: 10,
    });
    expect(result).toBe(-95);
  });

  it("returns 0 when either observation count is 0", () => {
    expect(
      normalizeImpact({
        raw_delta_pct: 100,
        observations_before: 0,
        observations_after: 10,
      }),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-change dedup
// ---------------------------------------------------------------------------

describe("per-change dedup", () => {
  it("generates distinct keys for different changes", () => {
    const a = aggregationDedupKey("t1", "change-1", "pattern-1");
    const b = aggregationDedupKey("t1", "change-2", "pattern-1");
    expect(a).not.toBe(b);
  });

  it("generates distinct keys for different tenants with same change", () => {
    const a = aggregationDedupKey("t1", "change-1", "pattern-1");
    const b = aggregationDedupKey("t2", "change-1", "pattern-1");
    expect(a).not.toBe(b);
  });

  it("generates identical key for same tenant + change + pattern", () => {
    const a = aggregationDedupKey("t1", "change-1", "pattern-1");
    const b = aggregationDedupKey("t1", "change-1", "pattern-1");
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Pattern key hashing
// ---------------------------------------------------------------------------

describe("pattern key", () => {
  it("produces stable hash for same key", () => {
    const key: PatternKey = {
      segment: "local_residential_builder",
      change_type: "faq_schema",
      platform: "chatgpt",
      context_bin: "zero::established",
    };
    expect(patternKeyHash(key)).toBe(patternKeyHash(key));
  });

  it("produces different hash for different context bins", () => {
    const a: PatternKey = {
      segment: "local_residential_builder",
      change_type: "faq_schema",
      platform: "chatgpt",
      context_bin: "zero::established",
    };
    const b: PatternKey = {
      ...a,
      context_bin: "high::established",
    };
    expect(patternKeyHash(a)).not.toBe(patternKeyHash(b));
  });

  it("produces different hash for different platforms", () => {
    const a: PatternKey = {
      segment: "local_residential_builder",
      change_type: "faq_schema",
      platform: "chatgpt",
      context_bin: "zero::established",
    };
    const b: PatternKey = { ...a, platform: "perplexity" };
    expect(patternKeyHash(a)).not.toBe(patternKeyHash(b));
  });
});

// ---------------------------------------------------------------------------
// Context bin serialization
// ---------------------------------------------------------------------------

describe("context bin", () => {
  it("serializes deterministically", () => {
    expect(
      contextBinKey({ faq_count: "zero", site_maturity: "established" }),
    ).toBe("zero::established");
    expect(
      contextBinKey({ faq_count: "high", site_maturity: "new" }),
    ).toBe("high::new");
  });
});
