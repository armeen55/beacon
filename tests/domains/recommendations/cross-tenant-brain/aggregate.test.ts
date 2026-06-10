/**
 * 2026-05-26 Phase A.2 (Section 3.2 / E2/E3/E5) — cross-tenant pattern
 * aggregation core tests. Pure compute; synthetic multi-tenant fixtures.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateCrossTenantPatterns,
  type CrossTenantEditOutcome,
} from "@/domains/recommendations/cross-tenant-brain/aggregate";

const A = "tenant-a";
const SELF = "tenant-self";

function rec(
  tenantId: string,
  matchKey: string,
  helped: boolean,
): CrossTenantEditOutcome {
  return { tenantId, matchKey, helped };
}

// Build N records for one matchKey across distinct tenants.
function manyTenants(
  matchKey: string,
  count: number,
  helpedCount: number,
): CrossTenantEditOutcome[] {
  const out: CrossTenantEditOutcome[] = [];
  for (let i = 0; i < count; i++) {
    out.push(rec(`t${i}`, matchKey, i < helpedCount));
  }
  return out;
}

describe("aggregateCrossTenantPatterns — sample-size gate (E3, default 5)", () => {
  it("emits nothing below the gate (4 ships < 5)", () => {
    const recs = manyTenants("edit_type:add_h2_section", 4, 4);
    expect(
      aggregateCrossTenantPatterns(recs, {
        requestingTenantId: SELF,
        actionTypes: ["add_h2_section"],
        blocklist: [],
      }),
    ).toEqual([]);
  });

  it("emits at exactly the gate (5 ships)", () => {
    const recs = manyTenants("edit_type:add_h2_section", 5, 3);
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: ["add_h2_section"],
      blocklist: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.sampleSize).toBe(5);
    expect(out[0]!.helpingRate).toBe(0.6); // 3/5
  });

  it("honors a custom minSampleSize", () => {
    const recs = manyTenants("edit_type:add_faq", 2, 2);
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: ["add_faq"],
      blocklist: [],
      minSampleSize: 2,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.helpingRate).toBe(1);
  });
});

describe("aggregateCrossTenantPatterns — exclude-self (locked contract)", () => {
  it("drops the requesting tenant's own records from the aggregate", () => {
    const recs = [
      ...manyTenants("edit_type:add_h2_section", 5, 5),
      rec(SELF, "edit_type:add_h2_section", false),
      rec(SELF, "edit_type:add_h2_section", false),
    ];
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: ["add_h2_section"],
      blocklist: [],
    });
    // Self's 2 (false) records must NOT drag the rate or count.
    expect(out[0]!.sampleSize).toBe(5);
    expect(out[0]!.helpingRate).toBe(1);
  });

  it("returns [] when only the requesting tenant has records (n=1 reality)", () => {
    const recs = [
      rec(SELF, "edit_type:add_h2_section", true),
      rec(SELF, "edit_type:add_h2_section", true),
      rec(SELF, "edit_type:add_h2_section", true),
      rec(SELF, "edit_type:add_h2_section", true),
      rec(SELF, "edit_type:add_h2_section", true),
    ];
    expect(
      aggregateCrossTenantPatterns(recs, {
        requestingTenantId: SELF,
        actionTypes: ["add_h2_section"],
        blocklist: [],
      }),
    ).toEqual([]);
  });
});

describe("aggregateCrossTenantPatterns — action-type filter", () => {
  it("keeps only matchKeys referencing an allowed action type", () => {
    const recs = [
      ...manyTenants("edit_type:add_h2_section", 5, 5),
      ...manyTenants("edit_type:add_cost_section", 5, 5),
    ];
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: ["add_h2_section"],
      blocklist: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.matchKey).toContain("add_h2_section");
  });

  it("empty actionTypes = no filtering (keep all matchKeys)", () => {
    const recs = [
      ...manyTenants("edit_type:add_h2_section", 5, 5),
      ...manyTenants("edit_type:add_cost_section", 5, 5),
    ];
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: [],
      blocklist: [],
    });
    expect(out).toHaveLength(2);
  });
});

describe("aggregateCrossTenantPatterns — rank + cap (E5, default 5)", () => {
  it("ranks by helpingRate desc, then sampleSize desc, then matchKey asc", () => {
    const recs = [
      ...manyTenants("edit_type:aaa", 5, 1), // rate .2
      ...manyTenants("edit_type:bbb", 5, 5), // rate 1.0
      ...manyTenants("edit_type:ccc", 6, 3), // rate .5, n6
    ];
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: [],
      blocklist: [],
    });
    expect(out.map((p) => p.matchKey)).toEqual([
      "edit_type:bbb",
      "edit_type:ccc",
      "edit_type:aaa",
    ]);
  });

  it("caps the result count", () => {
    const recs = [
      ...manyTenants("edit_type:a", 5, 5),
      ...manyTenants("edit_type:b", 5, 4),
      ...manyTenants("edit_type:c", 5, 3),
    ];
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: [],
      blocklist: [],
      cap: 2,
    });
    expect(out).toHaveLength(2);
  });
});

describe("aggregateCrossTenantPatterns — privacy (E4 scrub + leak guard)", () => {
  it("scrubs blocklisted terms from descriptions", () => {
    // matchKey carries a (hypothetical) leaked brand token; ensure the
    // rendered description is scrubbed.
    const recs = manyTenants("edit_type:add_h2_section_Acme", 5, 5);
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: [],
      blocklist: ["Acme"],
    });
    // Either dropped (if leak survived) or scrubbed. Must not contain "Acme".
    for (const p of out) {
      expect(p.description.toLowerCase()).not.toContain("acme");
    }
  });
});

describe("aggregateCrossTenantPatterns — pattern shape + determinism", () => {
  it("patternId is stable for the same matchKey+schemaVersion", () => {
    const recs = manyTenants("edit_type:add_h2_section", 5, 5);
    const o1 = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: [],
      blocklist: [],
    });
    const o2 = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: [],
      blocklist: [],
    });
    expect(o1[0]!.patternId).toBe(o2[0]!.patternId);
    expect(o1[0]!.patternId).toMatch(/^ctp_[0-9a-f]{8}$/);
  });

  it("helpingRate is rounded to 2dp and within 0..1", () => {
    const recs = manyTenants("edit_type:add_faq", 7, 2); // 2/7 = 0.2857..
    const out = aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: [],
      blocklist: [],
    });
    expect(out[0]!.helpingRate).toBe(0.29);
    expect(out[0]!.helpingRate).toBeGreaterThanOrEqual(0);
    expect(out[0]!.helpingRate).toBeLessThanOrEqual(1);
  });

  it("empty input → []", () => {
    expect(
      aggregateCrossTenantPatterns([], {
        requestingTenantId: SELF,
        actionTypes: [],
        blocklist: [],
      }),
    ).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const recs = manyTenants("edit_type:add_faq", 5, 5);
    const snapshot = JSON.stringify(recs);
    aggregateCrossTenantPatterns(recs, {
      requestingTenantId: SELF,
      actionTypes: [],
      blocklist: [],
    });
    expect(JSON.stringify(recs)).toBe(snapshot);
  });
});
