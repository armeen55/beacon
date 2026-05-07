/**
 * Behavioral tests — Gap C.2 scope-validation (2026-05-07).
 *
 * Pure unit tests, no I/O. Pin the scope-step validation contract.
 */

import { describe, expect, it } from "vitest";
import {
  CITIES_MAX_COUNT,
  CITY_NAME_MAX_LENGTH,
  PROJECT_MIX_LABELS,
  PROJECT_MIX_TAGS,
  isProjectMixTag,
  normalizeCityList,
  validateScopeProfile,
} from "./scope-validation";

describe("normalizeCityList — string input", () => {
  it("splits comma-separated input + trims whitespace", () => {
    expect(normalizeCityList("Atherton, Menlo Park,Los Altos")).toEqual([
      "Atherton",
      "Menlo Park",
      "Los Altos",
    ]);
  });

  it("splits newline-separated input", () => {
    expect(normalizeCityList("Atherton\nMenlo Park\nLos Altos")).toEqual([
      "Atherton",
      "Menlo Park",
      "Los Altos",
    ]);
  });

  it("title-cases lowercase + uppercase input", () => {
    expect(normalizeCityList("atherton, MENLO PARK, los altos")).toEqual([
      "Atherton",
      "Menlo Park",
      "Los Altos",
    ]);
  });

  it("preserves and uppercases the state abbreviation when newline-separated", () => {
    expect(normalizeCityList("atherton, ca\nmenlo park, ca")).toEqual([
      "Atherton, CA",
      "Menlo Park, CA",
    ]);
  });

  it('treats commas as separators (so "Atherton, CA, Menlo Park, CA" splits to 4 tokens then dedupes)', () => {
    // Operator note: comma is the separator. To preserve "City, ST",
    // type one city per line ("Atherton, CA\nMenlo Park, CA"); a flat
    // comma list will split each ST into its own token. The form hint
    // documents this.
    expect(normalizeCityList("Atherton, CA, Menlo Park, CA")).toEqual([
      "Atherton",
      "Ca",
      "Menlo Park",
      // second "CA" is dedup-collapsed against "Ca"
    ]);
  });

  it("dedupes case-insensitively (first occurrence wins)", () => {
    expect(normalizeCityList("atherton, ATHERTON, Atherton")).toEqual([
      "Atherton",
    ]);
  });

  it("drops empty tokens + extra whitespace", () => {
    expect(normalizeCityList(",,Atherton, , ,Menlo Park,")).toEqual([
      "Atherton",
      "Menlo Park",
    ]);
  });

  it("rejects a token longer than CITY_NAME_MAX_LENGTH", () => {
    const longCity = "X".repeat(CITY_NAME_MAX_LENGTH + 1);
    expect(normalizeCityList(`Atherton, ${longCity}, Menlo Park`)).toEqual([
      "Atherton",
      "Menlo Park",
    ]);
  });

  it("returns [] on empty / whitespace input", () => {
    expect(normalizeCityList("")).toEqual([]);
    expect(normalizeCityList("   ")).toEqual([]);
    expect(normalizeCityList(" , , , ")).toEqual([]);
  });
});

describe("normalizeCityList — array input", () => {
  it("accepts an array of strings", () => {
    expect(normalizeCityList(["atherton", "MENLO PARK", "Los Altos"])).toEqual([
      "Atherton",
      "Menlo Park",
      "Los Altos",
    ]);
  });

  it("dedupes within the array", () => {
    expect(normalizeCityList(["Atherton", "atherton", "Atherton, CA"])).toEqual([
      "Atherton",
      "Atherton, CA",
    ]);
  });

  it("ignores non-string array elements safely", () => {
    expect(
      normalizeCityList(["Atherton", null, undefined, 42, "Menlo Park"] as unknown[]),
    ).toEqual(["Atherton", "Menlo Park"]);
  });

  it("returns [] on non-array, non-string input", () => {
    expect(normalizeCityList(undefined)).toEqual([]);
    expect(normalizeCityList(null)).toEqual([]);
    expect(normalizeCityList(42 as unknown)).toEqual([]);
    expect(normalizeCityList({ a: 1 } as unknown)).toEqual([]);
  });
});

describe("isProjectMixTag", () => {
  it("accepts every PROJECT_MIX_TAGS value", () => {
    for (const t of PROJECT_MIX_TAGS) {
      expect(isProjectMixTag(t)).toBe(true);
    }
  });

  it("rejects unknown strings", () => {
    expect(isProjectMixTag("foo")).toBe(false);
    expect(isProjectMixTag("")).toBe(false);
    expect(isProjectMixTag("NEW_CONSTRUCTION")).toBe(false); // case-sensitive
  });

  it("rejects non-string input safely", () => {
    expect(isProjectMixTag(undefined)).toBe(false);
    expect(isProjectMixTag(null)).toBe(false);
    expect(isProjectMixTag(42)).toBe(false);
    expect(isProjectMixTag(["new_construction"])).toBe(false);
  });
});

describe("PROJECT_MIX_LABELS", () => {
  it("has a label for every tag (no missing entry)", () => {
    for (const t of PROJECT_MIX_TAGS) {
      expect(PROJECT_MIX_LABELS[t]).toBeTruthy();
      expect(PROJECT_MIX_LABELS[t].length).toBeGreaterThan(0);
    }
  });

  it("labels are operator-friendly (not raw enum)", () => {
    for (const t of PROJECT_MIX_TAGS) {
      const label = PROJECT_MIX_LABELS[t];
      expect(label).not.toContain("_");
      expect(label).not.toBe(t);
    }
  });
});

describe("validateScopeProfile", () => {
  const validInput = {
    cities: "Atherton, Menlo Park",
    projectMix: ["new_construction", "whole_home_remodel"],
  };

  it("accepts a clean form submission", () => {
    const r = validateScopeProfile(validInput);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.cities).toEqual(["Atherton", "Menlo Park"]);
      expect(r.normalized.projectMix).toEqual([
        "new_construction",
        "whole_home_remodel",
      ]);
    }
  });

  it("dedupes + normalizes cities", () => {
    const r = validateScopeProfile({
      cities: "atherton, ATHERTON,  Atherton  ",
      projectMix: ["new_construction"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.cities).toEqual(["Atherton"]);
  });

  it("dedupes project_mix", () => {
    const r = validateScopeProfile({
      cities: "Atherton",
      projectMix: ["new_construction", "new_construction", "kitchen_bath"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.projectMix).toEqual([
        "new_construction",
        "kitchen_bath",
      ]);
    }
  });

  it("silently drops unknown project_mix tags (defense in depth)", () => {
    const r = validateScopeProfile({
      cities: "Atherton",
      projectMix: ["new_construction", "unknown_tag", "kitchen_bath"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.projectMix).toEqual([
        "new_construction",
        "kitchen_bath",
      ]);
    }
  });

  it("rejects empty cities", () => {
    const r = validateScopeProfile({
      cities: "",
      projectMix: ["new_construction"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.cities).toBeTruthy();
      expect(r.errors.projectMix).toBeUndefined();
    }
  });

  it("rejects whitespace-only cities", () => {
    const r = validateScopeProfile({
      cities: " , , ",
      projectMix: ["new_construction"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cities).toBeTruthy();
  });

  it("rejects empty project_mix", () => {
    const r = validateScopeProfile({
      cities: "Atherton",
      projectMix: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.projectMix).toBeTruthy();
      expect(r.errors.cities).toBeUndefined();
    }
  });

  it("rejects project_mix with only unknown tags", () => {
    const r = validateScopeProfile({
      cities: "Atherton",
      projectMix: ["foo", "bar", "baz"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.projectMix).toBeTruthy();
  });

  it("returns BOTH errors when both fields are invalid", () => {
    const r = validateScopeProfile({ cities: "", projectMix: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.cities).toBeTruthy();
      expect(r.errors.projectMix).toBeTruthy();
    }
  });

  it("rejects more than CITIES_MAX_COUNT cities", () => {
    const tooMany = Array.from({ length: CITIES_MAX_COUNT + 1 }, (_, i) => `City${i}`);
    const r = validateScopeProfile({
      cities: tooMany,
      projectMix: ["new_construction"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.cities).toBeTruthy();
  });

  it("accepts exactly CITIES_MAX_COUNT cities", () => {
    const exactly = Array.from({ length: CITIES_MAX_COUNT }, (_, i) => `City${i}`);
    const r = validateScopeProfile({
      cities: exactly,
      projectMix: ["new_construction"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.normalized.cities.length).toBe(CITIES_MAX_COUNT);
  });

  it("handles missing keys safely", () => {
    const r = validateScopeProfile({} as unknown as Parameters<
      typeof validateScopeProfile
    >[0]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.cities).toBeTruthy();
      expect(r.errors.projectMix).toBeTruthy();
    }
  });
});
