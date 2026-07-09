/**
 * difficulty (operator spec 2026-07-09 C-19) - the pure difficulty bucket over
 * estimatedEffortMinutes: <=5 easy, <=20 medium, else hard, and null when there is no honest
 * effort figure.
 */
import { describe, expect, it } from "vitest";
import { difficultyLabel } from "./difficulty";

describe("difficultyLabel (C-19)", () => {
  it("buckets short edits as easy (<= 5 minutes)", () => {
    expect(difficultyLabel(1)).toBe("easy");
    expect(difficultyLabel(2)).toBe("easy");
    expect(difficultyLabel(5)).toBe("easy");
  });

  it("buckets mid-length work as medium (6..20 minutes)", () => {
    expect(difficultyLabel(6)).toBe("medium");
    expect(difficultyLabel(15)).toBe("medium");
    expect(difficultyLabel(20)).toBe("medium");
  });

  it("buckets big work as hard (> 20 minutes)", () => {
    expect(difficultyLabel(21)).toBe("hard");
    expect(difficultyLabel(60)).toBe("hard");
  });

  it("self-hides (null) when there is no honest effort figure", () => {
    expect(difficultyLabel(0)).toBeNull();
    expect(difficultyLabel(-3)).toBeNull();
    expect(difficultyLabel(null)).toBeNull();
    expect(difficultyLabel(undefined)).toBeNull();
    expect(difficultyLabel(Number.NaN)).toBeNull();
  });
});
