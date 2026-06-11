/**
 * 2026-06-11 (night shift, fuel #4) — freshness bands + the NaN guard
 * added this session. getFreshnessStatus drives the
 * staleness/abandonment surfacing; it had no dedicated test.
 */

import { describe, it, expect } from "vitest";

import { getFreshnessStatus } from "@/domains/opportunities/freshness";
import type { Opportunity } from "@/domains/opportunities/types";

const NOW = new Date("2026-06-30T00:00:00Z");

function opp(over: Partial<Opportunity>): Opportunity {
  return {
    current_status: "active",
    priority: "medium",
    created_at: "2026-06-01T00:00:00Z",
    updated_at: null,
    activated_at: null,
    captured_at: null,
    last_verified_at: null,
    assessed_at: null,
    regressed_at: null,
    ...over,
  } as unknown as Opportunity;
}

describe("getFreshnessStatus — terminal states", () => {
  for (const status of ["captured", "closed", "deferred"] as const) {
    it(`"${status}" is always fresh (0 days), no message`, () => {
      const r = getFreshnessStatus(opp({ current_status: status, created_at: "2020-01-01T00:00:00Z" }), NOW);
      expect(r.level).toBe("fresh");
      expect(r.daysSinceActivity).toBe(0);
    });
  }
});

describe("getFreshnessStatus — medium-priority bands (7/14/30)", () => {
  const at = (daysAgo: number) =>
    new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

  // created_at older than updated_at so the activity date IS updated_at
  // (getLastActivityDate picks the MOST RECENT of all timestamps).
  it("fresh below the aging threshold", () => {
    expect(getFreshnessStatus(opp({ created_at: at(90), updated_at: at(5) }), NOW).level).toBe("fresh");
  });
  it("aging at 7d, stale at 14d, abandoned at 30d (inclusive boundaries)", () => {
    expect(getFreshnessStatus(opp({ created_at: at(90), updated_at: at(7) }), NOW).level).toBe("aging");
    expect(getFreshnessStatus(opp({ created_at: at(90), updated_at: at(14) }), NOW).level).toBe("stale");
    expect(getFreshnessStatus(opp({ created_at: at(90), updated_at: at(30) }), NOW).level).toBe("abandoned");
  });
});

describe("getFreshnessStatus — latest activity wins + unknown priority", () => {
  const at = (daysAgo: number) =>
    new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

  it("uses the MOST RECENT of the activity timestamps", () => {
    // created 40d ago but last_verified 2d ago → fresh (recent activity).
    const r = getFreshnessStatus(
      opp({ created_at: at(40), last_verified_at: at(2) }),
      NOW,
    );
    expect(r.level).toBe("fresh");
    expect(r.daysSinceActivity).toBe(2);
  });

  it("unknown priority falls back to medium thresholds", () => {
    expect(
      getFreshnessStatus(opp({ priority: "weird" as Opportunity["priority"], created_at: at(90), updated_at: at(14) }), NOW).level,
    ).toBe("stale");
  });
});

describe("getFreshnessStatus — NaN guard (night-shift 2026-06-11)", () => {
  it("an unparseable created_at with no other dates does not produce an Invalid Date / NaN days", () => {
    const r = getFreshnessStatus(
      opp({ created_at: "not-a-date" }),
      NOW,
    );
    // Pre-guard this yielded Invalid Date → NaN days; now it falls back
    // to epoch → a large finite day count (abandoned), never NaN.
    expect(Number.isFinite(r.daysSinceActivity)).toBe(true);
    expect(r.level).toBe("abandoned");
  });
});
