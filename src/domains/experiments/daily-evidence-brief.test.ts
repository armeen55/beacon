import { describe, it, expect } from "vitest";
import { buildKeywordBrief, type CachedDemand } from "./daily-evidence-brief";

function demand(entries: Array<[string, CachedDemand]>): Map<string, CachedDemand> {
  return new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
}

describe("buildKeywordBrief", () => {
  it("returns null when no query has cached demand", () => {
    const brief = buildKeywordBrief(["persian rugs", "iranian food"], demand([]));
    expect(brief).toBeNull();
  });

  it("surfaces volume + competition for the page's queries, best-effort", () => {
    const brief = buildKeywordBrief(
      ["persian rugs", "iranian food"],
      demand([
        ["persian rugs", { volume: 2400, competition: "low" }],
        ["iranian food", { volume: 880, competition: "medium" }],
      ]),
    );
    expect(brief).not.toBeNull();
    expect(brief!.keywords).toEqual([
      { term: "persian rugs", volume: 2400, competition: "low" },
      { term: "iranian food", volume: 880, competition: "medium" },
    ]);
    expect(brief!.addressableVolume).toBe(3280);
  });

  it("keeps a query with no cached demand as a null row when at least one other has demand", () => {
    const brief = buildKeywordBrief(
      ["persian rugs", "no data term"],
      demand([["persian rugs", { volume: 1000, competition: "high" }]]),
    );
    expect(brief).not.toBeNull();
    expect(brief!.keywords).toEqual([
      { term: "persian rugs", volume: 1000, competition: "high" },
      { term: "no data term", volume: null, competition: null },
    ]);
    // Only the known volume counts toward addressable volume.
    expect(brief!.addressableVolume).toBe(1000);
  });

  it("is case-insensitive and de-duplicates queries", () => {
    const brief = buildKeywordBrief(
      ["Persian Rugs", "persian rugs", "PERSIAN RUGS"],
      demand([["persian rugs", { volume: 500, competition: "low" }]]),
    );
    expect(brief!.keywords).toHaveLength(1);
    expect(brief!.keywords[0]).toEqual({ term: "Persian Rugs", volume: 500, competition: "low" });
  });

  it("caps the number of rows at max (default 6)", () => {
    const queries = Array.from({ length: 10 }, (_, i) => `term ${i}`);
    const brief = buildKeywordBrief(
      queries,
      demand([["term 0", { volume: 100, competition: "low" }]]),
    );
    expect(brief!.keywords).toHaveLength(6);
  });

  it("returns addressableVolume null when demand exists only as competition (no volume)", () => {
    const brief = buildKeywordBrief(
      ["persian rugs"],
      demand([["persian rugs", { volume: null, competition: "medium" }]]),
    );
    expect(brief).not.toBeNull();
    expect(brief!.addressableVolume).toBeNull();
  });
});
