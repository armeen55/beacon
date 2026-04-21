import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  foldToken,
  tokenizeForMatch,
  containsConcept,
} from "@/lib/text-normalize";

describe("normalizeForMatch", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(
      normalizeForMatch("What Defines a True Bay Area Luxury Custom Home Builder?"),
    ).toBe("what defines a true bay area luxury custom home builder");
  });

  it("strips curly quotes and em/en dashes", () => {
    expect(normalizeForMatch("\u201CCustom Homes\u201D \u2014 Bay Area")).toBe(
      "custom homes bay area",
    );
  });

  it("returns empty string for empty / whitespace input", () => {
    expect(normalizeForMatch("")).toBe("");
    expect(normalizeForMatch("   ")).toBe("");
  });
});

describe("foldToken", () => {
  it("folds -ies to -y for length >= 5", () => {
    expect(foldToken("cities")).toBe("city");
  });

  it("strips trailing s for length >= 4", () => {
    expect(foldToken("homes")).toBe("home");
    expect(foldToken("builders")).toBe("builder");
    expect(foldToken("contractors")).toBe("contractor");
  });

  it("preserves ss endings (no over-stripping)", () => {
    expect(foldToken("bass")).toBe("bass");
    expect(foldToken("glass")).toBe("glass");
  });

  it("does not strip short tokens (< 4 chars)", () => {
    expect(foldToken("is")).toBe("is");
    expect(foldToken("us")).toBe("us");
  });

  it("leaves non-plural tokens alone", () => {
    expect(foldToken("custom")).toBe("custom");
    expect(foldToken("luxury")).toBe("luxury");
  });
});

describe("containsConcept", () => {
  // ── the concrete bug from Today ────────────────────────────────────────
  it("detects 'Custom Homes' in 'What Defines a True Bay Area Luxury Custom Home Builder?'", () => {
    expect(
      containsConcept(
        "What Defines a True Bay Area Luxury Custom Home Builder?",
        "Custom Homes",
      ),
    ).toBe(true);
  });

  // ── present / absent basics ────────────────────────────────────────────
  it("matches when concept appears verbatim", () => {
    expect(
      containsConcept("We build custom homes in the Bay Area.", "Custom Homes"),
    ).toBe(true);
  });

  it("returns false when concept is genuinely absent", () => {
    expect(
      containsConcept(
        "What Defines a True Bay Area Luxury Custom Home Builder?",
        "Luxury Kitchens",
      ),
    ).toBe(false);
  });

  it("returns false when only one concept token matches", () => {
    expect(
      containsConcept("Our luxury design studio serves you.", "Luxury Kitchens"),
    ).toBe(false);
  });

  // ── singular/plural variants ───────────────────────────────────────────
  it("matches singular concept against plural haystack", () => {
    expect(
      containsConcept("Our custom homes portfolio", "Custom Home"),
    ).toBe(true);
  });

  it("matches plural concept against singular haystack", () => {
    expect(
      containsConcept("Menlo Park home renovation services", "Home Renovations"),
    ).toBe(true);
  });

  it("matches 'cities' variant via ies → y fold", () => {
    expect(containsConcept("Serving Bay Area city pages", "Cities")).toBe(true);
  });

  // ── contiguous-subsequence rule (no semantic stretching) ───────────────
  it("does NOT match non-contiguous tokens", () => {
    // "custom homes" must appear as a phrase — not scattered.
    expect(
      containsConcept(
        "We build custom modern homes in the Bay Area.",
        "Custom Homes",
      ),
    ).toBe(false);
  });

  it("does NOT match unrelated similar wording", () => {
    // "home" and "builder" both appear but as "home builder", not as concept
    // "home renovation".
    expect(
      containsConcept(
        "What Defines a True Bay Area Luxury Custom Home Builder?",
        "Home Renovation",
      ),
    ).toBe(false);
  });

  // ── edge cases ─────────────────────────────────────────────────────────
  it("returns false for empty concept", () => {
    expect(containsConcept("Some heading text", "")).toBe(false);
  });

  it("returns false for empty haystack", () => {
    expect(containsConcept("", "Custom Homes")).toBe(false);
  });

  it("returns false when concept is longer than haystack", () => {
    expect(
      containsConcept("Short", "Custom Home Builder Bay Area Luxury"),
    ).toBe(false);
  });

  it("is punctuation-insensitive", () => {
    expect(
      containsConcept("Custom-home, builder: Bay Area", "Custom Home"),
    ).toBe(true);
  });
});

describe("tokenizeForMatch", () => {
  it("produces folded, normalized tokens", () => {
    expect(tokenizeForMatch("Custom Homes & Luxury Builders")).toEqual([
      "custom",
      "home",
      "&",
      "luxury",
      "builder",
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(tokenizeForMatch("")).toEqual([]);
  });
});
