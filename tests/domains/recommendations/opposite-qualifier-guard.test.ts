import { describe, it, expect } from "vitest";
import { hasOppositeQualifiers } from "@/domains/recommendations/opposite-qualifier-guard";

describe("hasOppositeQualifiers — self-competition guardrail", () => {
  it("flags male vs female slugs (the reported Iranopedia case)", () => {
    expect(
      hasOppositeQualifiers(
        "https://iranopedia.com/persian-male-first-names",
        "https://iranopedia.com/persian-female-first-names",
      ),
    ).toBe(true);
  });

  it("flags boy vs girl", () => {
    expect(
      hasOppositeQualifiers("/persian-boy-names", "/persian-girl-names"),
    ).toBe(true);
  });

  it("flags men vs women (possessive plural)", () => {
    expect(
      hasOppositeQualifiers("/best-mens-watches", "/best-womens-watches"),
    ).toBe(true);
  });

  it("is symmetric (order does not matter)", () => {
    expect(hasOppositeQualifiers("/girl-names", "/boy-names")).toBe(
      hasOppositeQualifiers("/boy-names", "/girl-names"),
    );
  });

  it("is case-insensitive", () => {
    expect(
      hasOppositeQualifiers("/Persian-MALE-Names", "/persian-Female-names"),
    ).toBe(true);
  });

  it("does NOT flag genuinely overlapping pages with no opposite token", () => {
    expect(
      hasOppositeQualifiers("/persian-wedding-traditions", "/persian-wedding"),
    ).toBe(false);
  });

  it("does NOT flag the same URL against itself", () => {
    expect(
      hasOppositeQualifiers("/persian-female-names", "/persian-female-names"),
    ).toBe(false);
  });

  it("does NOT false-positive on a shared qualifier (both 'female')", () => {
    // two female pages that legitimately compete SHOULD still be mergeable
    expect(
      hasOppositeQualifiers("/female-names", "/female-baby-names"),
    ).toBe(false);
  });

  it("does NOT match a substring inside an unrelated word (e.g. 'mentor' ≠ 'men')", () => {
    expect(
      hasOppositeQualifiers("/mentor-programs", "/woman-mentors"),
    ).toBe(false);
  });
});
