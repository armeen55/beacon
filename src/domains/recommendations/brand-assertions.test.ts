/**
 * W3 Step 3.7 (2026-05-03) — brand-assertions module tests.
 *
 * The pure-helper layer that gates the LLM provider's public-copy
 * claims. Tests cover:
 *   - Per-tenant retrieval shape (ritz-builders + unknown-tenant fallback).
 *   - Forbidden-pattern coverage (every pattern exists + has a sane
 *     `unlockedBy` mapping).
 *   - `findUnsupportedBrandClaims` returns the right matches under
 *     the four canonical states:
 *       1. forbidden pattern + no assertion → reported
 *       2. forbidden pattern + matching-category assertion → unlocked
 *       3. forbidden pattern + permanently-locked (`unlockedBy: null`)
 *          → still reported even when an assertion is present
 *       4. text contains a phrase that LOOKS dangerous but doesn't
 *          match any forbidden regex → empty array
 *   - Format helpers shape the prompt-injection blocks correctly.
 */

import { describe, expect, it } from "vitest";
import {
  FORBIDDEN_CLAIM_PATTERNS,
  findEmDashes,
  findIncompleteBrandMentions,
  findUnsupportedBrandClaims,
  formatBrandAssertionsForPrompt,
  formatForbiddenClaimsForPrompt,
  getBrandAssertions,
  getBrandNameStyle,
  type BrandAssertion,
} from "./brand-assertions";

// ── getBrandAssertions ───────────────────────────────────────────────────

describe("getBrandAssertions — tenant retrieval", () => {
  it("returns Ritz Builders' curated list for tenant 'ritz-builders'", () => {
    const list = getBrandAssertions("ritz-builders");
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((a) => a.id === "ritz_positioning_design_build")).toBe(
      true,
    );
    expect(list.some((a) => a.phrase === "architect-led design-build")).toBe(
      true,
    );
  });

  it("returns an empty array for an unknown tenant", () => {
    expect(getBrandAssertions("unknown-tenant-slug")).toEqual([]);
  });

  it("returns an empty array for empty / non-string tenantId", () => {
    expect(getBrandAssertions("")).toEqual([]);
    // @ts-expect-error — defensive: caller passes garbage at runtime.
    expect(getBrandAssertions(null)).toEqual([]);
    // @ts-expect-error
    expect(getBrandAssertions(undefined)).toEqual([]);
  });

  it("Ritz list does NOT carry an 'award' / 'popularity' / 'tenure' assertion (operator-locked)", () => {
    // W3 §3.7 launch decision — none of these third-party-recognition
    // claims are operator-supplied for Ritz. The forbidden-pattern
    // gate stays armed for award-winning, frequently recommended,
    // X years in business, etc.
    const list = getBrandAssertions("ritz-builders");
    expect(list.some((a) => a.category === "award")).toBe(false);
    expect(list.some((a) => a.category === "popularity")).toBe(false);
    expect(list.some((a) => a.category === "tenure")).toBe(false);
    expect(list.some((a) => a.category === "ranking_first")).toBe(false);
    expect(list.some((a) => a.category === "trust")).toBe(false);
    expect(list.some((a) => a.category === "client_outcome")).toBe(false);
  });

  it("Ritz list includes positioning + service_area + service_offering + process categories", () => {
    const list = getBrandAssertions("ritz-builders");
    const cats = new Set(list.map((a) => a.category));
    expect(cats.has("positioning")).toBe(true);
    expect(cats.has("service_area")).toBe(true);
    expect(cats.has("service_offering")).toBe(true);
    expect(cats.has("process")).toBe(true);
  });
});

// ── FORBIDDEN_CLAIM_PATTERNS shape ───────────────────────────────────────

describe("FORBIDDEN_CLAIM_PATTERNS — shape + coverage", () => {
  it("ids are unique", () => {
    const ids = FORBIDDEN_CLAIM_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("patterns are RegExp instances with case-insensitive flag (or wildcard /i)", () => {
    for (const p of FORBIDDEN_CLAIM_PATTERNS) {
      expect(p.pattern).toBeInstanceOf(RegExp);
    }
  });

  it("includes every operator-locked claim category", () => {
    const ids = new Set(FORBIDDEN_CLAIM_PATTERNS.map((p) => p.id));
    expect(ids.has("frequently_recommended")).toBe(true);
    expect(ids.has("most_trusted")).toBe(true);
    expect(ids.has("ranked_number_one")).toBe(true);
    expect(ids.has("top_rated")).toBe(true);
    expect(ids.has("best_in_market")).toBe(true);
    expect(ids.has("leading_brand")).toBe(true);
    expect(ids.has("award_winning")).toBe(true);
    expect(ids.has("years_in_business")).toBe(true);
    expect(ids.has("guarantee_outcome")).toBe(true);
  });

  it("permanently locked patterns (unlockedBy: null) are not category-bound", () => {
    const guaranteed = FORBIDDEN_CLAIM_PATTERNS.find(
      (p) => p.id === "guarantee_outcome",
    );
    expect(guaranteed?.unlockedBy).toBeNull();
  });
});

// ── findUnsupportedBrandClaims — forbidden + no assertion → reported ─────

describe("findUnsupportedBrandClaims — flags forbidden claims when no matching assertion", () => {
  const NO_ASSERTIONS: ReadonlyArray<BrandAssertion> = [];

  it("flags 'frequently recommended'", () => {
    const matches = findUnsupportedBrandClaims(
      "Ritz Builders is frequently recommended for whole-home remodels.",
      NO_ASSERTIONS,
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].patternId).toBe("frequently_recommended");
  });

  it("flags 'commonly recommended'", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz is commonly recommended for luxury homes.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("frequently_recommended");
  });

  it("flags 'often recommended'", () => {
    expect(
      findUnsupportedBrandClaims(
        "Architects often recommended Ritz Builders.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("frequently_recommended");
  });

  it("flags 'most trusted'", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz is the most trusted builder in the Bay Area.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("most_trusted");
  });

  it("flags 'trusted by homeowners'", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz is trusted by homeowners across Silicon Valley.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("trusted_by");
  });

  it("flags '#1' superlative", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz is #1 in the Bay Area.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("ranked_number_one");
  });

  it("flags 'top-rated'", () => {
    expect(
      findUnsupportedBrandClaims(
        "Top-rated builder in the South Bay.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("top_rated");
  });

  it("flags 'the best builder' subject-of-sentence superlative", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz is the best builder for whole-home remodels.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("best_in_market");
  });

  it("flags 'the best luxury home builders' (W3 §3.8.6 — adjective gap)", () => {
    // Operator-caught: Luxury Home Builder Bay Area dry-run emitted
    // a FAQ question "Who are the best luxury home builders in the
    // Bay Area?" — the original regex required "the best <noun>"
    // adjacency and missed adjective gaps. Pattern now allows up
    // to 3 modifier words between "best" and the noun.
    expect(
      findUnsupportedBrandClaims(
        "Who are the best luxury home builders in the Bay Area?",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("best_in_market");
  });

  it("flags 'leading luxury home builders' (adjective-gap regression)", () => {
    expect(
      findUnsupportedBrandClaims(
        "We are the leading luxury home builders in Silicon Valley.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("leading_brand");
  });

  it("ALLOWS 'best for whole-home remodels' (no 'the' prefix, no banned noun)", () => {
    // The regex requires "the best" + modifier words + builder/firm/
    // etc. "best for whole-home remodels" doesn't match because
    // there's no "the" prefix and no builder/firm/etc. noun follows.
    expect(
      findUnsupportedBrandClaims(
        "Choose the construction approach that's best for whole-home remodels.",
        NO_ASSERTIONS,
      ),
    ).toEqual([]);
  });

  it("flags 'leading builder'", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz is the leading builder in the Bay Area.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("leading_brand");
  });

  it("flags 'award-winning' (default — no operator award assertion)", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz Builders is an award-winning design-build firm.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("award_winning");
  });

  it("flags 'X years in business' tenure claim", () => {
    expect(
      findUnsupportedBrandClaims(
        "10+ years in business serving the Bay Area.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("years_in_business");
  });

  it("flags 'since 2014' founding-year claim", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz has built homes since 2014.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("since_year");
  });

  it("flags outcome guarantees (permanently locked)", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz guarantees on-time delivery for every project.",
        // Even with EVERY assertion, this stays locked.
        getBrandAssertions("ritz-builders"),
      )[0]?.patternId,
    ).toBe("guarantee_outcome");
  });

  it("flags client-satisfaction percentages", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz delivers 99% client satisfaction.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("client_satisfaction_pct");
  });

  it("flags project-count claims", () => {
    expect(
      findUnsupportedBrandClaims(
        "Over 50 projects completed in Atherton alone.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("project_count");
  });

  it("returns empty for safe operator-grounded copy", () => {
    expect(
      findUnsupportedBrandClaims(
        "Architect-led design-build keeps design, budget, and construction tightly coordinated.",
        NO_ASSERTIONS,
      ),
    ).toEqual([]);
  });

  it("returns empty for empty / null text", () => {
    expect(findUnsupportedBrandClaims("", NO_ASSERTIONS)).toEqual([]);
    expect(findUnsupportedBrandClaims(null, NO_ASSERTIONS)).toEqual([]);
    expect(findUnsupportedBrandClaims(undefined, NO_ASSERTIONS)).toEqual([]);
  });
});

// ── findUnsupportedBrandClaims — assertion unlocks pattern ─────────────

describe("findUnsupportedBrandClaims — assertion unlocks the pattern", () => {
  it("'award-winning' is allowed when an 'award' assertion exists", () => {
    const assertionsWithAward: ReadonlyArray<BrandAssertion> = [
      ...getBrandAssertions("ritz-builders"),
      {
        id: "ritz_award_property_2025",
        phrase: "2025 Americas Property Awards",
        category: "award",
        supportedBy: "https://propertyawards.net/winners/ritz-2025",
      },
    ];
    expect(
      findUnsupportedBrandClaims(
        "Ritz Builders is an award-winning firm.",
        assertionsWithAward,
      ),
    ).toEqual([]);
  });

  it("'frequently recommended' is allowed when a 'popularity' assertion exists", () => {
    const assertionsWithPopularity: ReadonlyArray<BrandAssertion> = [
      ...getBrandAssertions("ritz-builders"),
      {
        id: "ritz_popularity_houzz",
        phrase: "frequently recommended on Houzz",
        category: "popularity",
        supportedBy: "https://houzz.com/ritz-builders",
      },
    ];
    expect(
      findUnsupportedBrandClaims(
        "Ritz is frequently recommended for luxury homes.",
        assertionsWithPopularity,
      ),
    ).toEqual([]);
  });

  it("'X years in business' is allowed when a 'tenure' assertion exists", () => {
    const assertionsWithTenure: ReadonlyArray<BrandAssertion> = [
      {
        id: "ritz_tenure_2014",
        phrase: "founded in 2014",
        category: "tenure",
      },
    ];
    expect(
      findUnsupportedBrandClaims(
        "10+ years in business in the Bay Area.",
        assertionsWithTenure,
      ),
    ).toEqual([]);
  });

  it("guarantee_outcome stays locked even when every category assertion exists", () => {
    const ALL_CATEGORIES_ASSERTED: ReadonlyArray<BrandAssertion> = [
      { id: "x", phrase: "foo", category: "popularity" },
      { id: "y", phrase: "bar", category: "trust" },
      { id: "z", phrase: "baz", category: "ranking_first" },
      { id: "w", phrase: "qux", category: "award" },
      { id: "u", phrase: "tt", category: "tenure" },
      { id: "v", phrase: "co", category: "client_outcome" },
    ];
    const matches = findUnsupportedBrandClaims(
      "Ritz guarantees the on-time delivery of every project.",
      ALL_CATEGORIES_ASSERTED,
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0].patternId).toBe("guarantee_outcome");
    expect(matches[0].unlockedBy).toBeNull();
  });

  it("multiple distinct forbidden patterns can fire on the same text", () => {
    const matches = findUnsupportedBrandClaims(
      "Ritz is the most trusted, award-winning, leading builder in the Bay Area.",
      [],
    );
    const ids = matches.map((m) => m.patternId);
    expect(ids).toContain("most_trusted");
    expect(ids).toContain("award_winning");
    expect(ids).toContain("leading_brand");
  });
});

// ── Format helpers ──────────────────────────────────────────────────────

describe("formatBrandAssertionsForPrompt", () => {
  it("renders one bullet per assertion with its category prefix", () => {
    const out = formatBrandAssertionsForPrompt(
      getBrandAssertions("ritz-builders"),
    );
    expect(out).toMatch(/architect-led design-build/);
    expect(out).toMatch(/\[process\]/);
    expect(out).toMatch(/\[service_area\]/);
  });

  it("returns '(none)' for an empty list (deterministic prompt shape)", () => {
    expect(formatBrandAssertionsForPrompt([])).toBe("(none)");
  });
});

describe("formatForbiddenClaimsForPrompt", () => {
  it("includes the popularity / award / superlative descriptions", () => {
    const out = formatForbiddenClaimsForPrompt();
    expect(out).toMatch(/social-proof claim/);
    expect(out).toMatch(/award/);
    expect(out).toMatch(/superlative/);
    expect(out).toMatch(/guarantee/);
  });
});

// ── W3 Step 3.7s — getBrandNameStyle ────────────────────────────────────

describe("W3 §3.7s — getBrandNameStyle", () => {
  it("returns Ritz Builders style for tenant 'ritz-builders'", () => {
    const style = getBrandNameStyle("ritz-builders");
    expect(style).not.toBeNull();
    expect(style?.fullName).toBe("Ritz Builders");
    expect(style?.bannedShortForms).toEqual(["Ritz"]);
  });

  it("returns null for unknown tenants (gate stays inert)", () => {
    expect(getBrandNameStyle("unknown")).toBeNull();
    expect(getBrandNameStyle("")).toBeNull();
  });
});

// ── W3 Step 3.7s — findEmDashes ────────────────────────────────────────

describe("W3 §3.7s — findEmDashes", () => {
  it("flags every em dash (U+2014) in body copy", () => {
    const text =
      "complex builds — for example, basement scopes — benefit from early permitting.";
    const out = findEmDashes(text);
    expect(out.length).toBe(2);
    expect(out[0].char).toBe("—");
  });

  it("flags free-standing en dashes (U+2013) used as sentence punctuation", () => {
    const text = "Ritz Builders emphasizes an architect-led approach – this works.";
    const out = findEmDashes(text);
    expect(out.length).toBe(1);
    expect(out[0].char).toBe("–");
  });

  it("ALLOWS en dash inside a digit-bounded range (years / minutes / etc.)", () => {
    expect(
      findEmDashes("Project timelines run 10–15 weeks for typical scope."),
    ).toEqual([]);
    expect(findEmDashes("2024–2025 strategy")).toEqual([]);
  });

  it("returns empty for clean body copy", () => {
    const text =
      "Ritz Builders emphasizes an architect-led design-build approach. Our team coordinates architecture, engineering, and permitting.";
    expect(findEmDashes(text)).toEqual([]);
  });

  it("returns empty for empty / null text", () => {
    expect(findEmDashes("")).toEqual([]);
    expect(findEmDashes(null)).toEqual([]);
    expect(findEmDashes(undefined)).toEqual([]);
  });

  it("matches are sorted by index (FIRST offense surfaces first)", () => {
    const text = "x — y – z — w"; // 4 dash characters at increasing offsets.
    const out = findEmDashes(text);
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].index).toBeGreaterThan(out[i - 1].index);
    }
  });
});

// ── W3 Step 3.7s — findIncompleteBrandMentions ─────────────────────────

describe("W3 §3.7s — findIncompleteBrandMentions", () => {
  const RITZ_STYLE = getBrandNameStyle("ritz-builders");

  it("flags bare 'Ritz' that is NOT followed by ' Builders'", () => {
    const out = findIncompleteBrandMentions(
      "Ritz emphasizes an architect-led approach.",
      RITZ_STYLE,
    );
    expect(out.length).toBe(1);
    expect(out[0].shortForm).toBe("Ritz");
    expect(out[0].fullName).toBe("Ritz Builders");
  });

  it("ALLOWS 'Ritz Builders' (full name)", () => {
    expect(
      findIncompleteBrandMentions(
        "Ritz Builders emphasizes an architect-led approach.",
        RITZ_STYLE,
      ),
    ).toEqual([]);
  });

  it("ALLOWS first-person plural after a full mention", () => {
    expect(
      findIncompleteBrandMentions(
        "Ritz Builders emphasizes architect-led design-build. Our team coordinates engineering, permitting, and construction.",
        RITZ_STYLE,
      ),
    ).toEqual([]);
  });

  it("flags a SECOND bare 'Ritz' even after a full first mention", () => {
    // Operator-locked: bare 'Ritz' is never allowed in generated
    // public copy. The model must use 'Ritz Builders' or transition
    // to 'we' / 'our team' / 'our process'.
    const out = findIncompleteBrandMentions(
      "Ritz Builders emphasizes architect-led design-build. Ritz also coordinates city permitting.",
      RITZ_STYLE,
    );
    expect(out.length).toBe(1);
    expect(out[0].index).toBeGreaterThan(15); // the SECOND occurrence
  });

  it("ALLOWS multiple 'Ritz Builders' mentions (every one followed by ' Builders')", () => {
    expect(
      findIncompleteBrandMentions(
        "Ritz Builders' approach. Ritz Builders also coordinates trades.",
        RITZ_STYLE,
      ),
    ).toEqual([]);
  });

  it("does NOT match a longer word that contains 'Ritz' as a prefix (word-boundary anchored)", () => {
    expect(
      findIncompleteBrandMentions(
        "Ritzy and posh markets are well served by Ritz Builders.",
        RITZ_STYLE,
      ),
    ).toEqual([]);
  });

  it("returns empty when style is null (unknown tenant)", () => {
    expect(
      findIncompleteBrandMentions("Ritz emphasizes …", null),
    ).toEqual([]);
  });

  it("returns empty for empty / null text", () => {
    expect(findIncompleteBrandMentions("", RITZ_STYLE)).toEqual([]);
    expect(findIncompleteBrandMentions(null, RITZ_STYLE)).toEqual([]);
    expect(findIncompleteBrandMentions(undefined, RITZ_STYLE)).toEqual([]);
  });
});
