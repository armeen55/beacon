/**
 * build-spelling-demand-move-items tests (P20, v1 129).
 *
 * Pins the Move gating: demand floor, "an owned page already captures 2+
 * spellings" suppression, and empty-safety.
 */

import { describe, expect, it } from "vitest";

import {
  buildSpellingDemandMoveItems,
  DEFAULT_MIN_COMBINED_DEMAND,
} from "@/domains/spelling-demand/build-move-items";
import type { ConsolidatedSpellingGroup } from "@/domains/spelling-demand/types";

function group(
  canonical: string,
  combinedDemand: number,
  memberTerms: string[],
): ConsolidatedSpellingGroup {
  const members = memberTerms.map((term, i) => ({
    term,
    demand: combinedDemand / memberTerms.length,
    isCanonical: i === 0,
  }));
  return {
    canonical,
    combinedDemand,
    topSpellingDemand: members[0]!.demand,
    spellingsWithDemand: members.length,
    members,
  };
}

describe("buildSpellingDemandMoveItems", () => {
  it("returns [] with no groups", () => {
    expect(
      buildSpellingDemandMoveItems({ groups: [], ownedCoverageBySpelling: new Map() }),
    ).toEqual([]);
  });

  it("emits a Move when demand clears the floor and no page captures the variants", () => {
    const items = buildSpellingDemandMoveItems({
      groups: [group("saffron", 1400, ["saffron", "safron", "zafran"])],
      ownedCoverageBySpelling: new Map(),
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.canonical).toBe("saffron");
    expect(items[0]!.combinedDemand).toBe(1400);
    expect(items[0]!.spellingCount).toBe(3);
    // The canonical is excluded from "other spellings".
    expect(items[0]!.otherSpellings).toEqual(["safron", "zafran"]);
  });

  it("suppresses a group below the demand floor", () => {
    const items = buildSpellingDemandMoveItems({
      groups: [group("saffron", DEFAULT_MIN_COMBINED_DEMAND - 1, ["saffron", "safron"])],
      ownedCoverageBySpelling: new Map(),
    });
    expect(items).toEqual([]);
  });

  it("respects a custom minCombinedDemand override", () => {
    const g = group("saffron", 150, ["saffron", "safron"]);
    expect(
      buildSpellingDemandMoveItems({
        groups: [g],
        ownedCoverageBySpelling: new Map(),
        minCombinedDemand: 200,
      }),
    ).toEqual([]);
    expect(
      buildSpellingDemandMoveItems({
        groups: [g],
        ownedCoverageBySpelling: new Map(),
        minCombinedDemand: 100,
      }),
    ).toHaveLength(1);
  });

  it("suppresses a group when one owned page already captures 2+ spellings", () => {
    // /spices ranks for BOTH saffron and safron -> that page owns the demand.
    const coverage = new Map<string, Set<string>>([
      ["saffron", new Set(["https://x.com/spices"])],
      ["safron", new Set(["https://x.com/spices"])],
    ]);
    const items = buildSpellingDemandMoveItems({
      groups: [group("saffron", 1400, ["saffron", "safron", "zafran"])],
      ownedCoverageBySpelling: coverage,
    });
    expect(items).toEqual([]);
  });

  it("still emits when spellings are spread across DIFFERENT owned pages", () => {
    // Two spellings, but each on its own page -> no single page owns both, so a
    // consolidated page is still the play.
    const coverage = new Map<string, Set<string>>([
      ["saffron", new Set(["https://x.com/a"])],
      ["safron", new Set(["https://x.com/b"])],
    ]);
    const items = buildSpellingDemandMoveItems({
      groups: [group("saffron", 1400, ["saffron", "safron"])],
      ownedCoverageBySpelling: coverage,
    });
    expect(items).toHaveLength(1);
  });
});
