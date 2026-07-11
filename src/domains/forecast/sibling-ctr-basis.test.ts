import { describe, expect, it } from "vitest";
import {
  computeSiblingCtrBasis,
  qualifyingSiblings,
  percentile,
  SIBLING_MIN_QUALIFYING,
  SIBLING_MIN_IMPRESSIONS_28D,
  SIBLING_HEALTHY_CTR_FLOOR,
  SIBLING_POSITION_BAND,
  type SiblingPageStat,
} from "./sibling-ctr-basis";

/**
 * The singers-shaped fixture (Wave 4 G8): /famous-iranian-singers earns 0.76 percent CTR at
 * 4,765 monthly impressions and position 6, while five of the tenant's own sibling list pages
 * (positions 4-9, all within the +/-3 band) earn 2.0/2.5/5.0/5.5/5.9 percent CTR at >=500
 * monthly impressions each. p25 = 2.5 percent, median = 5.0 percent - the conservative-to-base
 * band - producing a range of roughly +85 to +200 clicks a month, matching the pilot's own
 * by-hand math ballpark.
 */
const singersOwn = { ownPage: "/famous-iranian-singers", ownPosition: 6, ownCtr: 0.0076, ownImpressions28d: 4765 };
const singersSiblings: SiblingPageStat[] = [
  { page: "/famous-iranian-actors", position: 4, ctr: 0.02, impressions28d: 700 },
  { page: "/famous-iranian-poets", position: 5, ctr: 0.025, impressions28d: 900 },
  { page: "/famous-iranian-athletes", position: 6, ctr: 0.05, impressions28d: 1100 },
  { page: "/famous-iranian-scientists", position: 7, ctr: 0.055, impressions28d: 1300 },
  { page: "/famous-iranian-directors", position: 9, ctr: 0.059, impressions28d: 1500 },
];

describe("computeSiblingCtrBasis - the singers-shaped fixture", () => {
  it("produces a range in the +85 to +200 clicks/mo ballpark, with the transparent basis line", () => {
    const result = computeSiblingCtrBasis({ ...singersOwn, siblings: singersSiblings });
    expect(result).not.toBeNull();
    expect(result!.lowPerMonth).toBe(85);
    expect(result!.highPerMonth).toBe(200);
    expect(result!.siblingCount).toBe(5);
    // Beacon voice: names the real evidence, always a number, no dash anywhere.
    expect(result!.basis).toContain("Based on your own pages at similar positions");
    expect(result!.basis).toContain("2.5 to 5 percent of views as clicks");
    expect(result!.basis).toContain("this page earns 0.8 percent on 4,765 views a month");
    expect(result!.basis).toContain("position 6");
    expect(result!.basis).toContain("85 to 200 extra clicks a month");
    expect(result!.basis).not.toMatch(/[\u2013\u2014]/); // no em/en dash
  });

  it("the conservative band (p25 to median) never exceeds the single best sibling's CTR", () => {
    const ctrs = singersSiblings.map((s) => s.ctr);
    const best = Math.max(...ctrs);
    const p25 = percentile([...ctrs].sort((a, b) => a - b), 0.25);
    const median = percentile([...ctrs].sort((a, b) => a - b), 0.5);
    expect(p25).toBeLessThanOrEqual(best);
    expect(median).toBeLessThanOrEqual(best);
  });
});

describe("computeSiblingCtrBasis - honest abstention preserved", () => {
  it("fewer than SIBLING_MIN_QUALIFYING (3) qualifying siblings -> null, abstention unchanged", () => {
    expect(SIBLING_MIN_QUALIFYING).toBe(3);
    const onlyTwo = singersSiblings.slice(0, 2);
    const result = computeSiblingCtrBasis({ ...singersOwn, siblings: onlyTwo });
    expect(result).toBeNull();
  });

  it("exactly 2 qualifying siblings after position/impression/CTR filtering -> null", () => {
    // Five candidates, but three fail one honesty floor each - only 2 genuinely qualify.
    const mixed: SiblingPageStat[] = [
      { page: "/a", position: 6, ctr: 0.025, impressions28d: 900 }, // qualifies
      { page: "/b", position: 6, ctr: 0.05, impressions28d: 1100 }, // qualifies
      { page: "/c", position: 20, ctr: 0.05, impressions28d: 1100 }, // fails position band
      { page: "/d", position: 6, ctr: 0.002, impressions28d: 1100 }, // fails healthy-CTR floor
      { page: "/e", position: 6, ctr: 0.05, impressions28d: 100 }, // fails impressions floor
    ];
    expect(qualifyingSiblings(singersOwn.ownPage, singersOwn.ownPosition, mixed)).toHaveLength(2);
    expect(computeSiblingCtrBasis({ ...singersOwn, siblings: mixed })).toBeNull();
  });

  it("no siblings at all -> null", () => {
    expect(computeSiblingCtrBasis({ ...singersOwn, siblings: [] })).toBeNull();
  });

  it("own page below the material-impressions floor -> null, defensively re-checked here too", () => {
    const result = computeSiblingCtrBasis({ ...singersOwn, ownImpressions28d: 100, siblings: singersSiblings });
    expect(result).toBeNull();
  });

  it("a non-finite own position -> null", () => {
    expect(computeSiblingCtrBasis({ ...singersOwn, ownPosition: NaN, siblings: singersSiblings })).toBeNull();
  });
});

describe("computeSiblingCtrBasis - zero floor: never a negative promise", () => {
  it("a page already at/above the conservative band's high end reads 'already ahead', not a negative range", () => {
    const result = computeSiblingCtrBasis({ ...singersOwn, ownCtr: 0.06, siblings: singersSiblings });
    expect(result).not.toBeNull();
    expect(result!.lowPerMonth).toBeNull();
    expect(result!.highPerMonth).toBeNull();
    expect(result!.basis).toContain("already ahead of similar pages");
    expect(result!.basis).not.toMatch(/-\d/); // no negative number anywhere
  });

  it("a page exactly at the median reads already-ahead too (>=, not >)", () => {
    const result = computeSiblingCtrBasis({ ...singersOwn, ownCtr: 0.05, siblings: singersSiblings });
    expect(result!.lowPerMonth).toBeNull();
    expect(result!.basis).toContain("already ahead");
  });

  it("a real but too-thin gap (rounds under 3 clicks/mo) abstains rather than inventing a tiny range", () => {
    // Own CTR just under the band's high end, but with impressions right at the material floor
    // the raw gap rounds to under 3 clicks/month.
    const thinSiblings: SiblingPageStat[] = [
      { page: "/a", position: 6, ctr: 0.011, impressions28d: 500 },
      { page: "/b", position: 6, ctr: 0.011, impressions28d: 500 },
      { page: "/c", position: 6, ctr: 0.0115, impressions28d: 500 },
    ];
    const result = computeSiblingCtrBasis({ ownPage: "/x", ownPosition: 6, ownCtr: 0.0109, ownImpressions28d: 500, siblings: thinSiblings });
    expect(result).toBeNull();
  });
});

describe("qualifyingSiblings - the position band, honesty floors, and self-exclusion", () => {
  it(`excludes anything outside +/-${SIBLING_POSITION_BAND} positions`, () => {
    const s: SiblingPageStat[] = [
      { page: "/near", position: 9, ctr: 0.03, impressions28d: 600 },
      { page: "/far", position: 10, ctr: 0.03, impressions28d: 600 },
    ];
    const q = qualifyingSiblings("/own", 6, s);
    expect(q.map((x) => x.page)).toEqual(["/near"]);
  });

  it(`excludes a sibling below SIBLING_HEALTHY_CTR_FLOOR (${SIBLING_HEALTHY_CTR_FLOOR})`, () => {
    const s: SiblingPageStat[] = [{ page: "/broken", position: 6, ctr: 0.005, impressions28d: 600 }];
    expect(qualifyingSiblings("/own", 6, s)).toHaveLength(0);
  });

  it(`excludes a sibling below SIBLING_MIN_IMPRESSIONS_28D (${SIBLING_MIN_IMPRESSIONS_28D})`, () => {
    const s: SiblingPageStat[] = [{ page: "/thin", position: 6, ctr: 0.03, impressions28d: 499 }];
    expect(qualifyingSiblings("/own", 6, s)).toHaveLength(0);
  });

  it("never includes the target page itself, even if it would otherwise qualify", () => {
    const s: SiblingPageStat[] = [{ page: "/own", position: 6, ctr: 0.03, impressions28d: 600 }];
    expect(qualifyingSiblings("/own", 6, s)).toHaveLength(0);
  });
});

describe("percentile - linear interpolation", () => {
  it("p25/median on the singers CTR set matches the hand-computed values", () => {
    const sorted = [0.02, 0.025, 0.05, 0.055, 0.059];
    expect(percentile(sorted, 0.25)).toBeCloseTo(0.025, 10);
    expect(percentile(sorted, 0.5)).toBeCloseTo(0.05, 10);
  });

  it("single-element array returns that element for any percentile", () => {
    expect(percentile([0.04], 0.25)).toBe(0.04);
    expect(percentile([0.04], 0.9)).toBe(0.04);
  });

  it("empty array returns 0", () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});
