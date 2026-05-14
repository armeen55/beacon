/**
 * Phase A.2 Step 2 — pure per-tenant threshold compute tests.
 *
 * Covers inclusion rule, decision rule, threshold math, edge cases,
 * dep injection, determinism, and immutability. Every percentile
 * expectation in this file is hand-computed against the
 * documented nearest-rank rule: `idx = clamp(ceil(p * n) - 1, 0,
 * n - 1)`.
 */

import { describe, expect, it } from "vitest";

import {
  computeTenantThresholds,
  type TenantLifecycleRecord,
} from "@/domains/recommendations/cross-tenant-brain/compute-tenant-thresholds";
import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";
import { BRAIN_SAMPLE_THRESHOLDS } from "@/domains/recommendations/cross-tenant-brain/thresholds";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<TenantLifecycleRecord> & {
    days_to_first_citation: number | null;
    lifecycle_stage: TenantLifecycleRecord["lifecycle_stage"];
  },
): TenantLifecycleRecord {
  const firstCitationDateDefault =
    overrides.days_to_first_citation != null
      ? "2026-04-05T00:00:00.000Z"
      : null;
  return {
    edit_id: `edit-${Math.random().toString(36).slice(2, 8)}`,
    action_type: "add_h2_section",
    live_at: "2026-04-01T00:00:00.000Z",
    first_citation_date_iso: firstCitationDateDefault,
    is_partial_live: false,
    ...overrides,
  };
}

/** Build N cited_typical records whose days_to_first_citation matches
 *  the provided array, in order. */
function citedRecordsWithDays(
  days: number[],
  stage: TenantLifecycleRecord["lifecycle_stage"] = "cited_typical",
): TenantLifecycleRecord[] {
  return days.map((d, i) =>
    makeRecord({
      edit_id: `edit-${i}`,
      days_to_first_citation: d,
      lifecycle_stage: stage,
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────
// 1. Empty input
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — empty + sub-gate", () => {
  it("case 1: empty input returns profound_default with sample_size=0, excluded_count=0", () => {
    const result = computeTenantThresholds([]);
    expect(result.source).toBe("profound_default");
    expect(result.thresholds).toEqual(T2C_THRESHOLDS);
    expect(result.sample_size).toBe(0);
    expect(result.excluded_count).toBe(0);
    expect(result.percentile_used).toEqual({
      fast: 0.5,
      median: 0.75,
      late: 0.9,
    });
  });

  // 2. 19 cited records returns profound_default
  it("case 2: 19 cited records returns profound_default (just below the locked v1 gate of 20)", () => {
    const days = Array.from({ length: 19 }, (_, i) => i + 1);
    const result = computeTenantThresholds(citedRecordsWithDays(days));
    expect(result.source).toBe("profound_default");
    expect(result.thresholds).toEqual(T2C_THRESHOLDS);
    expect(result.sample_size).toBe(19);
    expect(result.excluded_count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Exactly 20 cited records → per_tenant
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — at + above gate", () => {
  it("case 3: exactly 20 cited records crosses the gate (per_tenant)", () => {
    // days = [1..20]. n=20.
    // p50: ceil(0.5*20)-1 = 9 → days[9] = 10.
    // p75: ceil(0.75*20)-1 = 14 → days[14] = 15.
    // p90: ceil(0.9*20)-1 = 17 → days[17] = 18.
    const days = Array.from({ length: 20 }, (_, i) => i + 1);
    const result = computeTenantThresholds(citedRecordsWithDays(days));
    expect(result.source).toBe("per_tenant");
    expect(result.sample_size).toBe(20);
    expect(result.excluded_count).toBe(0);
    expect(result.thresholds).toEqual({
      fast_days: 10,
      median_days: 15,
      late_days: 18,
    });
  });

  // 4. 25 cited records with hand-computed p50 / p75 / p90.
  it("case 4: 25 cited records — hand-computed nearest-rank quantiles", () => {
    // days = [1..25]. n=25.
    // p50: ceil(0.5*25)-1 = ceil(12.5)-1 = 12 → days[12] = 13.
    // p75: ceil(0.75*25)-1 = ceil(18.75)-1 = 18 → days[18] = 19.
    // p90: ceil(0.9*25)-1 = ceil(22.5)-1 = 22 → days[22] = 23.
    const days = Array.from({ length: 25 }, (_, i) => i + 1);
    const result = computeTenantThresholds(citedRecordsWithDays(days));
    expect(result.source).toBe("per_tenant");
    expect(result.sample_size).toBe(25);
    expect(result.thresholds).toEqual({
      fast_days: 13,
      median_days: 19,
      late_days: 23,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. Mixed input: 20 cited + 10 uncited/stuck → 20 in / 10 out
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — inclusion / exclusion rule", () => {
  it("case 5: 30 records (20 cited + 5 live_not_yet_cited + 5 stuck) → sample_size=20, excluded_count=10", () => {
    const citedDays = Array.from({ length: 20 }, (_, i) => i + 1);
    const records: TenantLifecycleRecord[] = [
      ...citedRecordsWithDays(citedDays),
      ...Array.from({ length: 5 }, () =>
        makeRecord({
          days_to_first_citation: null,
          lifecycle_stage: "live_not_yet_cited",
        }),
      ),
      ...Array.from({ length: 5 }, () =>
        makeRecord({
          days_to_first_citation: null,
          lifecycle_stage: "stuck",
        }),
      ),
    ];
    const result = computeTenantThresholds(records);
    expect(result.source).toBe("per_tenant");
    expect(result.sample_size).toBe(20);
    expect(result.excluded_count).toBe(10);
    // Same thresholds as case 3 — the uncited rows are dropped.
    expect(result.thresholds).toEqual({
      fast_days: 10,
      median_days: 15,
      late_days: 18,
    });
  });

  it("case 6: records with negative days_to_first_citation are excluded", () => {
    // 20 valid cited + 5 cited_fast with negative days (should NOT
    // have reached this layer post-clamp, but defensive).
    const valid = citedRecordsWithDays(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const negative = Array.from({ length: 5 }, () =>
      makeRecord({
        days_to_first_citation: -3,
        lifecycle_stage: "cited_fast",
      }),
    );
    const result = computeTenantThresholds([...valid, ...negative]);
    expect(result.sample_size).toBe(20);
    expect(result.excluded_count).toBe(5);
  });

  it("case 13: cited_very_late records ARE included", () => {
    const records = citedRecordsWithDays(
      Array.from({ length: 20 }, (_, i) => (i + 1) * 5),
      "cited_very_late",
    );
    const result = computeTenantThresholds(records);
    expect(result.source).toBe("per_tenant");
    expect(result.sample_size).toBe(20);
    expect(result.excluded_count).toBe(0);
  });

  it("case 14: live_not_yet_cited records are excluded", () => {
    // 25 live_not_yet_cited records → no eligible rows → profound.
    const records = Array.from({ length: 25 }, () =>
      makeRecord({
        days_to_first_citation: null,
        lifecycle_stage: "live_not_yet_cited",
      }),
    );
    const result = computeTenantThresholds(records);
    expect(result.source).toBe("profound_default");
    expect(result.sample_size).toBe(0);
    expect(result.excluded_count).toBe(25);
  });

  it("case 15: stuck records are excluded", () => {
    // 25 stuck records → no eligible rows → profound.
    const records = Array.from({ length: 25 }, () =>
      makeRecord({
        days_to_first_citation: null,
        lifecycle_stage: "stuck",
      }),
    );
    const result = computeTenantThresholds(records);
    expect(result.source).toBe("profound_default");
    expect(result.sample_size).toBe(0);
    expect(result.excluded_count).toBe(25);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. Floor + monotonicity edge cases
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — floor + monotonicity", () => {
  it("case 7: all same-day citations (days=0) floor thresholds to 1 across all bands", () => {
    const records = citedRecordsWithDays(
      Array.from({ length: 20 }, () => 0),
      "cited_fast",
    );
    const result = computeTenantThresholds(records);
    expect(result.source).toBe("per_tenant");
    expect(result.thresholds).toEqual({
      fast_days: 1,
      median_days: 1,
      late_days: 1,
    });
  });

  it("case 8: all day-3 citations collapse bands to fast=median=late=3", () => {
    const records = citedRecordsWithDays(
      Array.from({ length: 20 }, () => 3),
      "cited_fast",
    );
    const result = computeTenantThresholds(records);
    expect(result.source).toBe("per_tenant");
    expect(result.thresholds).toEqual({
      fast_days: 3,
      median_days: 3,
      late_days: 3,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9 + 10. Dep injection
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — dep injection", () => {
  it("case 9: profoundDefaults override is returned verbatim below the gate", () => {
    const customDefaults = { fast_days: 4, median_days: 12, late_days: 30 };
    const result = computeTenantThresholds([], {
      profoundDefaults: customDefaults,
    });
    expect(result.source).toBe("profound_default");
    expect(result.thresholds).toBe(customDefaults); // same reference, verbatim
  });

  it("case 10: sampleSizeFloor override lowers the gate", () => {
    // 5 cited records normally would fall below the v1 default
    // gate of 20. With sampleSizeFloor=5, it crosses.
    const days = [1, 2, 3, 4, 5];
    const result = computeTenantThresholds(citedRecordsWithDays(days), {
      sampleSizeFloor: 5,
    });
    expect(result.source).toBe("per_tenant");
    expect(result.sample_size).toBe(5);
    // n=5; p50 → idx 2 → days[2]=3; p75 → idx 3 → 4; p90 → idx 4 → 5.
    expect(result.thresholds).toEqual({
      fast_days: 3,
      median_days: 4,
      late_days: 5,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 11. Percentile_used field always reports {0.5, 0.75, 0.9}
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — explainability", () => {
  it("case 11: percentile_used always returns the locked {fast: 0.5, median: 0.75, late: 0.9} regardless of source", () => {
    const empty = computeTenantThresholds([]);
    const aboveGate = computeTenantThresholds(
      citedRecordsWithDays(Array.from({ length: 20 }, (_, i) => i + 1)),
    );
    expect(empty.percentile_used).toEqual({
      fast: 0.5,
      median: 0.75,
      late: 0.9,
    });
    expect(aboveGate.percentile_used).toEqual({
      fast: 0.5,
      median: 0.75,
      late: 0.9,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// 12. Determinism + 18. No-mutation
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — determinism + immutability", () => {
  it("case 12: same records in different order produce same output", () => {
    const days = Array.from({ length: 20 }, (_, i) => i + 1);
    const ascending = citedRecordsWithDays(days);
    const descending = ascending.slice().reverse();
    const shuffled = [...ascending].sort(() => 0.5 - 0.5); // stable identity sort
    // Add a deterministic shuffle: rotate.
    const rotated = [...ascending.slice(7), ...ascending.slice(0, 7)];

    const r1 = computeTenantThresholds(ascending);
    const r2 = computeTenantThresholds(descending);
    const r3 = computeTenantThresholds(shuffled);
    const r4 = computeTenantThresholds(rotated);

    expect(r1).toEqual(r2);
    expect(r1).toEqual(r3);
    expect(r1).toEqual(r4);
  });

  it("case 18: does NOT mutate the input array (preserves order + length)", () => {
    const days = [5, 1, 3, 2, 4];
    const records = citedRecordsWithDays(days);
    const recordsClone = records.map((r) => ({ ...r }));
    const recordsRefsClone = [...records];

    computeTenantThresholds(records, { sampleSizeFloor: 3 });

    // Array length + reference order unchanged.
    expect(records.length).toBe(recordsRefsClone.length);
    expect(records).toEqual(recordsRefsClone);
    // Per-element field equality.
    for (let i = 0; i < records.length; i++) {
      expect(records[i]).toEqual(recordsClone[i]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 16. Null first_citation_date_iso decision — INCLUDE
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — null first_citation_date_iso", () => {
  it("case 16: records with null first_citation_date_iso but cited stage + non-null days ARE included", () => {
    // Decision: include. The inclusion rule examines
    // days_to_first_citation + lifecycle_stage; first_citation_date_iso
    // is a complementary field but not the gate. A caller that
    // constructs records from a compressed projection (without the
    // ISO date) should still be usable. Documented at the source.
    const records: TenantLifecycleRecord[] = Array.from(
      { length: 20 },
      (_, i) =>
        makeRecord({
          edit_id: `e-${i}`,
          days_to_first_citation: i + 1,
          lifecycle_stage: "cited_typical",
          first_citation_date_iso: null, // explicitly null
        }),
    );
    const result = computeTenantThresholds(records);
    expect(result.source).toBe("per_tenant");
    expect(result.sample_size).toBe(20);
    expect(result.excluded_count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 17. Partial-live records — INCLUDE when cited
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — is_partial_live records", () => {
  it("case 17: is_partial_live records ARE included when cited stage + valid days", () => {
    const records: TenantLifecycleRecord[] = Array.from(
      { length: 20 },
      (_, i) =>
        makeRecord({
          edit_id: `e-${i}`,
          days_to_first_citation: i + 1,
          lifecycle_stage: "cited_typical",
          is_partial_live: true,
        }),
    );
    const result = computeTenantThresholds(records);
    expect(result.source).toBe("per_tenant");
    expect(result.sample_size).toBe(20);
    expect(result.excluded_count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Sanity: the locked v1 sample-size floor IS 20
// ─────────────────────────────────────────────────────────────────────

describe("computeTenantThresholds — production gate matches lock", () => {
  it("uses BRAIN_SAMPLE_THRESHOLDS.threshold_replacement (=20) as the production gate", () => {
    expect(BRAIN_SAMPLE_THRESHOLDS.threshold_replacement).toBe(20);
    // 19 cited rows → below gate.
    const result19 = computeTenantThresholds(
      citedRecordsWithDays(Array.from({ length: 19 }, (_, i) => i + 1)),
    );
    expect(result19.source).toBe("profound_default");
    // 20 cited rows → above gate.
    const result20 = computeTenantThresholds(
      citedRecordsWithDays(Array.from({ length: 20 }, (_, i) => i + 1)),
    );
    expect(result20.source).toBe("per_tenant");
  });
});
