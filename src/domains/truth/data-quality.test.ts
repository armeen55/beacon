import { describe, it, expect } from "vitest";
import {
  detectDataQualityFlags,
  buildDataQualityDateSet,
  type RawCitation,
} from "./data-quality";

// ---------------------------------------------------------------------------
// Helpers for terse fixture construction
// ---------------------------------------------------------------------------

function owned(domain: string, flag: boolean, date: string): RawCitation {
  return {
    domain,
    source_category: "owned",
    is_owned: flag,
    observed_at: date,
  };
}

function other(domain: string, date: string): RawCitation {
  return {
    domain,
    source_category: "other",
    is_owned: false,
    observed_at: date,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("detectDataQualityFlags", () => {
  it("flags a day where source_category=owned count > 0 but is_owned=true count = 0 (the Ritz Apr 7–12 bug)", () => {
    const input = {
      ownedDomain: "ritzbuilders.com",
      citationsByDate: {
        "2026-04-08": [
          owned("ritzbuilders.com", false, "2026-04-08"), // broken record
          owned("ritzbuilders.com", false, "2026-04-08"),
          other("competitor.com", "2026-04-08"),
        ],
      },
    };

    const flags = detectDataQualityFlags(input);

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      date: "2026-04-08",
      reason_code: "is_owned_false_but_category_owned",
      domain: "ritzbuilders.com",
    });
    expect(flags[0].narrative).toContain("count=2");
    expect(flags[0].narrative).toContain("count=0");
  });

  it("does NOT flag a healthy day where source_category=owned and is_owned=true agree", () => {
    const input = {
      ownedDomain: "ritzbuilders.com",
      citationsByDate: {
        "2026-04-06": [
          owned("ritzbuilders.com", true, "2026-04-06"),
          owned("ritzbuilders.com", true, "2026-04-06"),
          other("competitor.com", "2026-04-06"),
        ],
      },
    };

    expect(detectDataQualityFlags(input)).toEqual([]);
  });

  it("does NOT flag a day where no owned citations exist at all (nothing to disagree about)", () => {
    const input = {
      ownedDomain: "ritzbuilders.com",
      citationsByDate: {
        "2026-03-01": [other("competitor.com", "2026-03-01")],
      },
    };

    expect(detectDataQualityFlags(input)).toEqual([]);
  });

  it("does NOT flag a day with partial agreement (a > 0 AND b > 0) — conservative gate", () => {
    // source_category=owned: 3, is_owned=true: 1 → NOT flagged.
    // This is a "degraded but usable" day handled by source_category override,
    // not by the data-quality gate.
    const input = {
      ownedDomain: "ritzbuilders.com",
      citationsByDate: {
        "2026-04-01": [
          owned("ritzbuilders.com", true, "2026-04-01"),
          owned("ritzbuilders.com", false, "2026-04-01"),
          owned("ritzbuilders.com", false, "2026-04-01"),
        ],
      },
    };

    expect(detectDataQualityFlags(input)).toEqual([]);
  });

  it("flags multiple consecutive broken days independently, sorted ascending (Apr 7–12 fixture)", () => {
    const input = {
      ownedDomain: "ritzbuilders.com",
      citationsByDate: {
        "2026-04-06": [owned("ritzbuilders.com", true, "2026-04-06")],
        "2026-04-07": [owned("ritzbuilders.com", false, "2026-04-07")],
        "2026-04-08": [owned("ritzbuilders.com", false, "2026-04-08")],
        "2026-04-09": [owned("ritzbuilders.com", false, "2026-04-09")],
        "2026-04-10": [owned("ritzbuilders.com", false, "2026-04-10")],
        "2026-04-11": [owned("ritzbuilders.com", false, "2026-04-11")],
        "2026-04-12": [owned("ritzbuilders.com", false, "2026-04-12")],
        "2026-04-13": [owned("ritzbuilders.com", true, "2026-04-13")],
      },
    };

    const flags = detectDataQualityFlags(input);
    const flaggedDates = flags.map((f) => f.date);

    expect(flaggedDates).toEqual([
      "2026-04-07",
      "2026-04-08",
      "2026-04-09",
      "2026-04-10",
      "2026-04-11",
      "2026-04-12",
    ]);
  });

  it("ignores non-owned domains entirely", () => {
    // Competitor with source_category=owned is nonsensical but shouldn't
    // trigger a flag for our domain.
    const input = {
      ownedDomain: "ritzbuilders.com",
      citationsByDate: {
        "2026-04-08": [
          {
            domain: "competitor.com",
            source_category: "owned",
            is_owned: false,
            observed_at: "2026-04-08",
          },
        ],
      },
    };

    expect(detectDataQualityFlags(input)).toEqual([]);
  });
});

describe("buildDataQualityDateSet", () => {
  it("returns an empty set for no flags", () => {
    expect(buildDataQualityDateSet([]).size).toBe(0);
  });

  it("returns the set of flagged dates for O(1) lookup", () => {
    const set = buildDataQualityDateSet([
      {
        date: "2026-04-07",
        reason_code: "is_owned_false_but_category_owned",
        narrative: "x",
        domain: "ritzbuilders.com",
      },
      {
        date: "2026-04-08",
        reason_code: "is_owned_false_but_category_owned",
        narrative: "x",
        domain: "ritzbuilders.com",
      },
    ]);

    expect(set.has("2026-04-07")).toBe(true);
    expect(set.has("2026-04-08")).toBe(true);
    expect(set.has("2026-04-06")).toBe(false);
  });
});
