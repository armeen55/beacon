/**
 * rr-pattern.test.ts (BEACON_500 item 66) — key generalization, aggregation math,
 * and the anonymity pin (no tenant identifiers ever land in an RrPatternCell).
 */
import { describe, it, expect } from "vitest";
import {
  siteCategoryFromSegment,
  intentBucketFromQuery,
  positionBand,
  rrPatternKeyId,
  deriveRrPatternKey,
  aggregateRrPatternCells,
  cellMeetsSurfaceFloor,
  MIN_DISTINCT_TENANTS_TO_SURFACE,
  type RrCellObservation,
  type RrPatternKey,
} from "./rr-pattern";

// ---------------------------------------------------------------------------
// Dimension derivation
// ---------------------------------------------------------------------------

describe("siteCategoryFromSegment", () => {
  it("passes through a known segment", () => {
    expect(siteCategoryFromSegment("content_publisher")).toBe("content_publisher");
  });
  it("defaults to unknown when segment is missing so local engines/patterns do not activate", () => {
    expect(siteCategoryFromSegment(null)).toBe("unknown");
    expect(siteCategoryFromSegment(undefined)).toBe("unknown");
  });
});

describe("intentBucketFromQuery", () => {
  it("classifies a commercial query", () => {
    expect(intentBucketFromQuery("best plumber near me")).not.toBe("informational");
  });
  it("defaults to informational for an empty/unknown query (honest fallback, not a drop)", () => {
    expect(intentBucketFromQuery(null)).toBe("informational");
    expect(intentBucketFromQuery("")).toBe("informational");
    expect(intentBucketFromQuery("   ")).toBe("informational");
  });
  it("classifies a plain question as informational", () => {
    expect(intentBucketFromQuery("what is chaharshanbe suri")).toBe("informational");
  });
});

describe("positionBand", () => {
  it("buckets 1-3, 4-10, 11-20, 21+", () => {
    expect(positionBand(1)).toBe("1-3");
    expect(positionBand(3)).toBe("1-3");
    expect(positionBand(3.9)).toBe("4-10");
    expect(positionBand(4)).toBe("4-10");
    expect(positionBand(10)).toBe("4-10");
    expect(positionBand(10.1)).toBe("11-20");
    expect(positionBand(20)).toBe("11-20");
    expect(positionBand(20.5)).toBe("21+");
    expect(positionBand(50)).toBe("21+");
  });
  it("returns unranked for null/undefined/zero/negative/NaN", () => {
    expect(positionBand(null)).toBe("unranked");
    expect(positionBand(undefined)).toBe("unranked");
    expect(positionBand(0)).toBe("unranked");
    expect(positionBand(-1)).toBe("unranked");
    expect(positionBand(NaN)).toBe("unranked");
  });
});

describe("rrPatternKeyId", () => {
  it("is stable for the same key", () => {
    const key: RrPatternKey = {
      siteCategory: "content_publisher",
      canonicalMoveType: "answer_block",
      intentBucket: "informational",
      positionBand: "4-10",
    };
    expect(rrPatternKeyId(key)).toBe(rrPatternKeyId({ ...key }));
  });
  it("differs when any single dimension differs", () => {
    const base: RrPatternKey = {
      siteCategory: "content_publisher",
      canonicalMoveType: "answer_block",
      intentBucket: "informational",
      positionBand: "4-10",
    };
    expect(rrPatternKeyId(base)).not.toBe(rrPatternKeyId({ ...base, siteCategory: "local_service" }));
    expect(rrPatternKeyId(base)).not.toBe(rrPatternKeyId({ ...base, canonicalMoveType: "edit_page" }));
    expect(rrPatternKeyId(base)).not.toBe(rrPatternKeyId({ ...base, intentBucket: "commercial" }));
    expect(rrPatternKeyId(base)).not.toBe(rrPatternKeyId({ ...base, positionBand: "11-20" }));
  });
});

describe("deriveRrPatternKey", () => {
  it("collapses actionType through the SAME canonicalMoveType used by the tenant-level prior", () => {
    const key = deriveRrPatternKey({
      segment: "content_publisher",
      actionType: "edit_title",
      targetQuery: "iran flag meaning",
      prePosition: 7,
    });
    expect(key.canonicalMoveType).toBe("edit_page");
    expect(key.siteCategory).toBe("content_publisher");
    expect(key.intentBucket).toBe("informational");
    expect(key.positionBand).toBe("4-10");
  });

  it("is honest about missing inputs (unranked position, informational default intent)", () => {
    const key = deriveRrPatternKey({
      segment: null,
      actionType: null,
      targetQuery: null,
      prePosition: null,
    });
    expect(key.siteCategory).toBe("unknown");
    expect(key.canonicalMoveType).toBe("other");
    expect(key.intentBucket).toBe("informational");
    expect(key.positionBand).toBe("unranked");
  });
});

// ---------------------------------------------------------------------------
// Aggregation math
// ---------------------------------------------------------------------------

function obs(over: Partial<RrCellObservation> = {}): RrCellObservation {
  return {
    tenantId: "t1",
    key: { siteCategory: "content_publisher", canonicalMoveType: "answer_block", intentBucket: "informational", positionBand: "4-10" },
    won: true,
    clicksLift: 10,
    ...over,
  };
}

describe("aggregateRrPatternCells", () => {
  it("returns [] for no observations", () => {
    expect(aggregateRrPatternCells([])).toEqual([]);
  });

  it("groups by the FULL key, not a partial match", () => {
    const cells = aggregateRrPatternCells([
      obs({ tenantId: "t1" }),
      obs({ tenantId: "t2", key: { ...obs().key, positionBand: "1-3" } }),
    ]);
    expect(cells).toHaveLength(2);
  });

  it("counts n as total observations and distinctTenants as the unique tenant count", () => {
    const cells = aggregateRrPatternCells([
      obs({ tenantId: "t1" }),
      obs({ tenantId: "t1" }), // same tenant twice — n increments, distinctTenants does not
      obs({ tenantId: "t2" }),
    ]);
    expect(cells).toHaveLength(1);
    expect(cells[0]!.n).toBe(3);
    expect(cells[0]!.distinctTenants).toBe(2);
  });

  it("computes winRate as wins / total", () => {
    const cells = aggregateRrPatternCells([
      obs({ tenantId: "t1", won: true }),
      obs({ tenantId: "t2", won: true }),
      obs({ tenantId: "t3", won: false }),
      obs({ tenantId: "t4", won: false }),
    ]);
    expect(cells[0]!.winRate).toBe(0.5);
  });

  it("computes liftP25/liftP75 from the clicksLift distribution, excluding nulls", () => {
    const cells = aggregateRrPatternCells([
      obs({ tenantId: "t1", clicksLift: 0 }),
      obs({ tenantId: "t2", clicksLift: 10 }),
      obs({ tenantId: "t3", clicksLift: 20 }),
      obs({ tenantId: "t4", clicksLift: 30 }),
      obs({ tenantId: "t5", clicksLift: null }), // excluded from percentile, still counted in n
    ]);
    expect(cells[0]!.n).toBe(5);
    expect(cells[0]!.liftP25).not.toBeNull();
    expect(cells[0]!.liftP75).not.toBeNull();
    expect(cells[0]!.liftP25!).toBeLessThan(cells[0]!.liftP75!);
  });

  it("liftP25/liftP75 are null when every observation lacks a numeric lift", () => {
    const cells = aggregateRrPatternCells([obs({ tenantId: "t1", clicksLift: null }), obs({ tenantId: "t2", clicksLift: null })]);
    expect(cells[0]!.liftP25).toBeNull();
    expect(cells[0]!.liftP75).toBeNull();
  });

  it("is deterministic (same input -> same output, order included)", () => {
    const input = [obs({ tenantId: "t1" }), obs({ tenantId: "t2", key: { ...obs().key, positionBand: "1-3" } })];
    // Hold the clock constant so this asserts the aggregation's OWN determinism
    // (grouping, math, and output ordering) rather than wall-clock skew between
    // two default `new Date()` calls; under load those two calls can straddle a
    // millisecond boundary and give different `updatedAt`, which is not the
    // property this test is meant to guard.
    const now = new Date("2026-07-10T00:00:00.000Z");
    expect(aggregateRrPatternCells(input, now)).toEqual(aggregateRrPatternCells(input, now));
  });

  it("does not mutate the input array", () => {
    const input = [obs({ tenantId: "t1" })];
    const copy = JSON.parse(JSON.stringify(input));
    aggregateRrPatternCells(input);
    expect(input).toEqual(copy);
  });

  // -------------------------------------------------------------------------
  // Anonymity pin — the load-bearing privacy guarantee.
  // -------------------------------------------------------------------------
  it("ANONYMITY: no tenant id, page, domain, or query text appears anywhere in a cell", () => {
    const cells = aggregateRrPatternCells([
      obs({ tenantId: "tenant-ritz-founder-secret" }),
      obs({ tenantId: "tenant-iranopedia-abc123" }),
    ]);
    const json = JSON.stringify(cells);
    expect(json).not.toContain("tenant-ritz-founder-secret");
    expect(json).not.toContain("tenant-iranopedia-abc123");
    expect(json).not.toContain("ritzbuilders.com");
    expect(json).not.toContain("iranopedia.com");
    // structural pin: no key on the cell is named anything tenant/identity-shaped
    for (const cell of cells) {
      expect(Object.keys(cell)).not.toContain("tenantId");
      expect(Object.keys(cell)).not.toContain("tenantIds");
      expect(Object.keys(cell)).not.toContain("contributing_tenant_ids");
      expect(Object.keys(cell)).not.toContain("page");
      expect(Object.keys(cell)).not.toContain("url");
      expect(Object.keys(cell)).not.toContain("query");
    }
  });
});

describe("cellMeetsSurfaceFloor / MIN_DISTINCT_TENANTS_TO_SURFACE", () => {
  it("floor is 3 (matches contracts.ts's locked confidence gate)", () => {
    expect(MIN_DISTINCT_TENANTS_TO_SURFACE).toBe(3);
  });
  it("a single real tenant today never meets the floor (seeding honesty)", () => {
    expect(cellMeetsSurfaceFloor({ distinctTenants: 1 })).toBe(false);
  });
  it("meets the floor at exactly 3", () => {
    expect(cellMeetsSurfaceFloor({ distinctTenants: 3 })).toBe(true);
    expect(cellMeetsSurfaceFloor({ distinctTenants: 2 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dash guard (hard rule) — this module emits no operator-facing narrative
// strings itself (that lives in experiment-prior.ts's globalTagFor, pinned
// separately), but the source is checked here as defense-in-depth.
// ---------------------------------------------------------------------------
describe("no em or en dashes in rr-pattern.ts source", () => {
  it("contains no em or en dashes", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "./rr-pattern.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
