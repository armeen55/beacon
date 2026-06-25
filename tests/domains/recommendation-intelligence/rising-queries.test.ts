import { describe, it, expect } from "vitest";

import { risesForPage, type QueryAgg } from "@/domains/recommendation-intelligence/gsc-page-queries";

const agg = (clicks: number, impressions = clicks * 10, position = 5): QueryAgg => ({
  clicks,
  impressions,
  posW: position * impressions,
});

function m(entries: Record<string, QueryAgg>): Map<string, QueryAgg> {
  return new Map(Object.entries(entries));
}

describe("risesForPage", () => {
  it("flags a query with real recent demand that grew ≥ minGainPct", () => {
    const rises = risesForPage(m({ grow: agg(50) }), m({ grow: agg(20) })); // +150%
    expect(rises).toHaveLength(1);
    expect(rises[0]!.query).toBe("grow");
    expect(rises[0]!.gainPct).toBe(150);
    expect(rises[0]!.isNew).toBe(false);
  });

  it("flags a newly-emerging query (prior ~0) and marks it new", () => {
    const rises = risesForPage(m({ nowruz: agg(30) }), m({}));
    expect(rises[0]!.isNew).toBe(true);
    expect(rises[0]!.gainPct).toBe(999);
  });

  it("ignores queries without real recent demand or that didn't grow enough", () => {
    const rises = risesForPage(
      m({ tiny: agg(3), flat: agg(22) }),
      m({ tiny: agg(0), flat: agg(20) }), // flat = +10%, below 40% floor
    );
    expect(rises).toHaveLength(0);
  });

  it("ranks by absolute clicks gained, biggest mover first", () => {
    const rises = risesForPage(
      m({ small: agg(15), big: agg(90) }),
      m({ small: agg(5), big: agg(10) }),
    );
    expect(rises[0]!.query).toBe("big"); // +80 vs +10
  });
});
