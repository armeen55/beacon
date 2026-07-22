/**
 * Customer-copy bans (Core 100K Phase 6 merge).
 *
 * The single behavioral suite for everything Beacon is FORBIDDEN to put in
 * customer-facing copy (static tripwires: tests/architecture/15+16+24):
 *   - UUID / hex-hash / internal-signal / lab-mode leaks (copy-sanitize)
 *   - ungrounded brand claims + em-dash and brand-name-first style gates
 *     (brand-assertions, W3 3.7/3.7s)
 *   - the 8 operator-locked placeholder patterns + FAQ answer floors
 *     (placeholder-detection)
 *   - brand casing normalization (brand-casing)
 *   - opposite-qualifier merge guard (opposite-qualifier-guard)
 *   - instruction-artifact / doubled-verb / duplicate-brand-suffix and
 *     push-ceiling length gates (copy-artifact-guard)
 *
 * Merged from src/domains/recommendations/{copy-sanitize,brand-assertions,
 * placeholder-detection}.test.ts + tests/domains/recommendations/
 * {copy-sanitize,brand-casing,opposite-qualifier-guard,copy-artifact-guard}.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  containsUuid,
  sanitizeOperatorEvidenceText,
  sanitizeOperatorCopyFields,
  scrubInternalLeakagePatterns,
} from "@/domains/recommendations/copy-sanitize";
import {
  sanitizeOperatorCopy,
  sanitizeClusterLabel,
} from "@/domains/recommendations/copy-sanitize";
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
} from "@/domains/recommendations/brand-assertions";
import {
  detectPlaceholder,
  evaluateFaqAnswer,
  looksLikePlaceholder,
  parseFaqProposedText,
  PLACEHOLDER_PATTERNS,
  tokenizeContentWords,
  MIN_FAQ_ANSWER_WORDS,
  MIN_SPECIFIC_CONTENT_WORDS,
} from "@/domains/recommendations/placeholder-detection";
import { applyBrandCasing } from "@/domains/recommendations/recommendation-title-humanizer";
import { hasOppositeQualifiers } from "@/domains/recommendations/opposite-qualifier-guard";
import {
  detectCopyArtifact,
  titleLengthVerdict,
  metaLengthVerdict,
  TITLE_HARD_MAX_CHARS,
  META_HARD_MAX_CHARS,
  exceedsPublishLengthLimit,
  PUSH_TITLE_MAX_CHARS,
  PUSH_META_MAX_CHARS,
} from "@/domains/recommendations/copy-artifact-guard";

// ===== from src/domains/recommendations/copy-sanitize.test.ts =====
/**
 * M2 (operator audit, 2026-05-05) — sanitizer tests for raw prompt
 * UUIDs in operator-visible copy.
 *
 * Operator contract:
 *   • UUID with mapping → "prompt: \"<snippet up to 50 chars>\""
 *   • UUID without mapping → "prompt evidence"
 *   • Non-UUID text → unchanged (idempotent)
 *   • Null / undefined / empty → returned unchanged
 *   • Both Map<string, string> and Record<string, string> are accepted.
 */


const KNOWN_UUID = "7ee3216b-327c-4de9-9efb-3a92f8a2ad11";
const UNKNOWN_UUID = "deadbeef-1234-5678-9abc-deadbeef0001";

describe("containsUuid", () => {
  it("detects a UUID in text", () => {
    expect(containsUuid(`drawn from prompt ${KNOWN_UUID}`)).toBe(true);
  });


  it("returns false for null / undefined / empty", () => {
    expect(containsUuid(null)).toBe(false);
    expect(containsUuid(undefined)).toBe(false);
    expect(containsUuid("")).toBe(false);
  });

});

describe("sanitizeOperatorEvidenceText — Map lookup", () => {
  const map = new Map<string, string>([
    [KNOWN_UUID, "best whole home remodel builders bay area"],
  ]);

  it("replaces UUID with prompt-text snippet when mapping exists", () => {
    const out = sanitizeOperatorEvidenceText(
      `Drawn from actualSearchQueries on prompt ${KNOWN_UUID}: 'foo'`,
      map,
    );
    expect(out).toContain(
      `prompt: "best whole home remodel builders bay area"`,
    );
    expect(out).not.toContain(KNOWN_UUID);
  });

  it("uses 'prompt evidence' fallback for unknown UUID", () => {
    const out = sanitizeOperatorEvidenceText(
      `Inferred from ${UNKNOWN_UUID} signal`,
      map,
    );
    expect(out).toContain("prompt evidence");
    expect(out).not.toContain(UNKNOWN_UUID);
  });



});



describe("sanitizeOperatorCopyFields", () => {
  const map = new Map<string, string>([
    [KNOWN_UUID, "best whole home remodel builders bay area"],
  ]);

  it("sanitizes named string fields and leaves the rest", () => {
    const obj = {
      why: `Drawn from prompt ${KNOWN_UUID}`,
      expectedImpact: "Reach more local searchers",
      measurementPlan: `Watch prompt ${UNKNOWN_UUID}`,
      confidence: 0.8, // non-string — must not be touched
      evidence: [{ type: "prompt", promptId: KNOWN_UUID }], // internal — must not be touched
    };
    const out = sanitizeOperatorCopyFields(
      obj,
      ["why", "expectedImpact", "measurementPlan"] as const,
      map,
    );
    expect(out.why).not.toContain(KNOWN_UUID);
    expect(out.why).toContain("prompt: ");
    expect(out.expectedImpact).toBe("Reach more local searchers");
    expect(out.measurementPlan).toContain("prompt evidence");
    expect(out.confidence).toBe(0.8);
    expect(out.evidence[0].promptId).toBe(KNOWN_UUID); // raw IDs preserved internally
  });


});

// ---------------------------------------------------------------------------
// Slice 4.5.G-B.2 — write-time prevention scrubbers (2026-05-21)
// ---------------------------------------------------------------------------
//
// Mirrors the B.1 render-guard's blocklist exactly: long 32+ hex/hash
// strings + 12 locked internal taxonomy tokens. Does NOT cover
// `unsupported_claim` / `architect_overclaim` — those defer to B.4.
//
// All cases below are pure string-in / string-out — no Supabase, no LLM,
// no production mutation.

describe("scrubInternalLeakagePatterns — long hex hash", () => {
  it("scrubs a 32-char hex (MD5-shape) hash with 'prompt evidence'", () => {
    const text = `evidence ${"a".repeat(32)} drawn from polling`;
    const out = scrubInternalLeakagePatterns(text);
    expect(out).not.toContain("a".repeat(32));
    expect(out).toContain("prompt evidence");
  });



  it("leaves short hex strings (≤31 chars) unchanged", () => {
    const text = "color: abc123def456 used in styling";
    const out = scrubInternalLeakagePatterns(text);
    expect(out).toBe(text);
  });
});

describe("scrubInternalLeakagePatterns — ai/search signal tokens", () => {
  it("scrubs 'aiSearchSignal' with operator-locked neutral wording", () => {
    const out = scrubInternalLeakagePatterns(
      "Reasoning relies on aiSearchSignal data from prior polls.",
    );
    expect(out).not.toContain("aiSearchSignal");
    expect(out).toContain("search-intent signals");
  });


});

describe("scrubInternalLeakagePatterns — taxonomy tokens", () => {
  it("scrubs 'action_type' to plain English", () => {
    const out = scrubInternalLeakagePatterns(
      "The action_type was add_h2_section.",
    );
    expect(out).not.toContain("action_type");
    expect(out).toContain("action type");
  });


});

describe("scrubInternalLeakagePatterns — mode labels", () => {
  it("scrubs 'Mode A' with operator-neutral wording", () => {
    const out = scrubInternalLeakagePatterns("Tested in Mode A first.");
    expect(out).not.toContain("Mode A");
    expect(out).toContain("Beacon's evaluation mode");
  });



  it("does NOT scrub legitimate 'Mode' usages without the locked suffix", () => {
    const out = scrubInternalLeakagePatterns(
      "Use legitimate Mode of operation here.",
    );
    expect(out).toBe("Use legitimate Mode of operation here.");
  });
});

describe("scrubInternalLeakagePatterns — recommendation IDs", () => {
  it("scrubs 'rec_id' to 'recommendation'", () => {
    const out = scrubInternalLeakagePatterns(
      "Linked to rec_id from yesterday.",
    );
    expect(out).not.toContain("rec_id");
    expect(out).toContain("recommendation");
  });

});

describe("scrubInternalLeakagePatterns — bucket labels", () => {
  it("scrubs 'diagnostic_only'", () => {
    const out = scrubInternalLeakagePatterns(
      "Routed to diagnostic_only bucket.",
    );
    expect(out).not.toContain("diagnostic_only");
    expect(out).toContain("diagnostic");
  });

});

describe("scrubInternalLeakagePatterns — pass-through (intentional non-blocking per B.1 scope discipline)", () => {
  it("does NOT scrub 'architect-led' (architect_overclaim deferred to B.4)", () => {
    const text = "Ritz is an architect-led design-build firm.";
    expect(scrubInternalLeakagePatterns(text)).toBe(text);
  });


  it("does NOT scrub 'best' (unsupported_claim deferred to B.4)", () => {
    const text = "Users search for the best builders in Palo Alto.";
    expect(scrubInternalLeakagePatterns(text)).toBe(text);
  });


});

describe("scrubInternalLeakagePatterns — multi-token rows", () => {
  it("scrubs all tokens in one string and leaves none raw", () => {
    const dirty =
      "Drawn from aiSearchSignal + actualSearchQueries; action_type=add_h2; trigger_signal=weak_h1; evidence_tier=high; Mode A + Mode B reviewed; rec_id linked; source_rec_id traced; routed diagnostic_only then promoted customer-queue-ready.";
    const out = scrubInternalLeakagePatterns(dirty);
    expect(out).not.toContain("aiSearchSignal");
    expect(out).not.toContain("actualSearchQueries");
    expect(out).not.toContain("action_type");
    expect(out).not.toContain("trigger_signal");
    expect(out).not.toContain("evidence_tier");
    expect(out).not.toContain("Mode A");
    expect(out).not.toContain("Mode B");
    expect(out).not.toContain("rec_id");
    expect(out).not.toContain("source_rec_id");
    expect(out).not.toContain("diagnostic_only");
    expect(out).not.toContain("customer-queue-ready");
  });

});


describe("sanitizeOperatorCopyFields — B.2 integration on write-time fields", () => {
  it("scrubs new B.2 patterns across why / expectedImpact / measurementPlan", () => {
    const obj = {
      why: "Drawn from aiSearchSignal data.",
      expectedImpact: "Higher action_type coverage.",
      measurementPlan: `Compare ${"a".repeat(40)} hash before / after.`,
    };
    const out = sanitizeOperatorCopyFields(
      obj,
      ["why", "expectedImpact", "measurementPlan"] as const,
      undefined,
    );
    expect(out.why).not.toContain("aiSearchSignal");
    expect(out.expectedImpact).not.toContain("action_type");
    expect(out.measurementPlan).not.toMatch(/[0-9a-f]{32,}/i);
    expect(out.why).toContain("search-intent signals");
    expect(out.expectedImpact).toContain("action type");
    expect(out.measurementPlan).toContain("prompt evidence");
  });
});

// ===== from tests/domains/recommendations/copy-sanitize.test.ts =====
describe("sanitizeOperatorCopy", () => {
  it("strips Shield: prefix (case-insensitive)", () => {
    expect(sanitizeOperatorCopy("Shield: Luxury Home Builder Bay Area")).toBe(
      "Luxury Home Builder Bay Area",
    );
    expect(sanitizeOperatorCopy("shield:  Custom Home Builder Bay Area")).toBe(
      "Custom Home Builder Bay Area",
    );
  });


  it("leaves already-clean strings untouched", () => {
    expect(sanitizeOperatorCopy("Palo Alto")).toBe("Palo Alto");
    expect(sanitizeOperatorCopy("Luxury Home Builder Bay Area")).toBe(
      "Luxury Home Builder Bay Area",
    );
  });


  it("sanitizeClusterLabel returns null when sanitized output is empty", () => {
    expect(sanitizeClusterLabel(null)).toBeNull();
    expect(sanitizeClusterLabel("")).toBeNull();
    expect(sanitizeClusterLabel("Shield:")).toBeNull();
    expect(sanitizeClusterLabel("Shield: Palo Alto")).toBe("Palo Alto");
  });

});

// ===== from src/domains/recommendations/brand-assertions.test.ts =====
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


// Key-alignment fix (2026-05-22): the registries are keyed by
// BeaconTenant.id (the value currentTenantId() returns + every caller
// passes), NOT the slug. Ritz's canonical id from ops/active-tenants.json
// is "tenant-ritz-founder"; its slug is "ritz-builders".
const RITZ_TENANT_ID = "tenant-ritz-founder";
const RITZ_SLUG = "ritz-builders";

// ── getBrandAssertions ───────────────────────────────────────────────────

describe("getBrandAssertions — tenant retrieval", () => {
  it("returns Ritz Builders' curated list for the canonical tenantId", () => {
    const list = getBrandAssertions(RITZ_TENANT_ID);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((a) => a.id === "ritz_positioning_design_build")).toBe(
      true,
    );
    expect(list.some((a) => a.phrase === "architect-led design-build")).toBe(
      true,
    );
  });

  it("REGRESSION (key-alignment): the slug 'ritz-builders' is NOT the canonical key → returns [] (no alias)", () => {
    // Pre-fix this returned the Ritz list; the bug was that production
    // callers pass the tenantId, not the slug. No slug alias is kept —
    // the tenant-key-contract invariant forbids slug keys.
    expect(getBrandAssertions(RITZ_SLUG)).toEqual([]);
  });

  it("returns an empty array for an unknown tenant", () => {
    expect(getBrandAssertions("unknown-tenant-slug")).toEqual([]);
  });


  it("Ritz list does NOT carry an 'award' / 'popularity' / 'tenure' assertion (operator-locked)", () => {
    // W3 §3.7 launch decision — none of these third-party-recognition
    // claims are operator-supplied for Ritz. The forbidden-pattern
    // gate stays armed for award-winning, frequently recommended,
    // X years in business, etc.
    const list = getBrandAssertions(RITZ_TENANT_ID);
    expect(list.some((a) => a.category === "award")).toBe(false);
    expect(list.some((a) => a.category === "popularity")).toBe(false);
    expect(list.some((a) => a.category === "tenure")).toBe(false);
    expect(list.some((a) => a.category === "ranking_first")).toBe(false);
    expect(list.some((a) => a.category === "trust")).toBe(false);
    expect(list.some((a) => a.category === "client_outcome")).toBe(false);
  });

  it("Ritz list includes positioning + service_area + service_offering + process categories", () => {
    const list = getBrandAssertions(RITZ_TENANT_ID);
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



  it("flags 'most trusted'", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz is the most trusted builder in the Bay Area.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("most_trusted");
  });


  it("flags '#1' superlative", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz is #1 in the Bay Area.",
        NO_ASSERTIONS,
      )[0]?.patternId,
    ).toBe("ranked_number_one");
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


  it("flags outcome guarantees (permanently locked)", () => {
    expect(
      findUnsupportedBrandClaims(
        "Ritz guarantees on-time delivery for every project.",
        // Even with EVERY assertion, this stays locked.
        getBrandAssertions(RITZ_TENANT_ID),
      )[0]?.patternId,
    ).toBe("guarantee_outcome");
  });



  it("returns empty for safe operator-grounded copy", () => {
    expect(
      findUnsupportedBrandClaims(
        "Architect-led design-build keeps design, budget, and construction tightly coordinated.",
        NO_ASSERTIONS,
      ),
    ).toEqual([]);
  });

});

// ── findUnsupportedBrandClaims — assertion unlocks pattern ─────────────

describe("findUnsupportedBrandClaims — assertion unlocks the pattern", () => {
  it("'award-winning' is allowed when an 'award' assertion exists", () => {
    const assertionsWithAward: ReadonlyArray<BrandAssertion> = [
      ...getBrandAssertions(RITZ_TENANT_ID),
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
      ...getBrandAssertions(RITZ_TENANT_ID),
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

});

// ── Format helpers ──────────────────────────────────────────────────────

describe("formatBrandAssertionsForPrompt", () => {
  it("renders one bullet per assertion with its category prefix", () => {
    const out = formatBrandAssertionsForPrompt(
      getBrandAssertions(RITZ_TENANT_ID),
    );
    expect(out).toMatch(/architect-led design-build/);
    expect(out).toMatch(/\[process\]/);
    expect(out).toMatch(/\[service_area\]/);
  });

  it("returns '(none)' for an empty list (deterministic prompt shape)", () => {
    expect(formatBrandAssertionsForPrompt([])).toBe("(none)");
  });
});


// ── W3 Step 3.7s — getBrandNameStyle ────────────────────────────────────

describe("W3 §3.7s — getBrandNameStyle", () => {
  it("returns Ritz Builders style for the canonical tenantId", () => {
    const style = getBrandNameStyle(RITZ_TENANT_ID);
    expect(style).not.toBeNull();
    expect(style?.fullName).toBe("Ritz Builders");
    expect(style?.bannedShortForms).toEqual(["Ritz"]);
  });

  it("REGRESSION (key-alignment): the slug 'ritz-builders' returns null (not the canonical key; no alias)", () => {
    expect(getBrandNameStyle(RITZ_SLUG)).toBeNull();
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

});

// ── W3 Step 3.7s — findIncompleteBrandMentions ─────────────────────────

describe("W3 §3.7s — findIncompleteBrandMentions", () => {
  const RITZ_STYLE = getBrandNameStyle(RITZ_TENANT_ID);

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


  it("does NOT match a longer word that contains 'Ritz' as a prefix (word-boundary anchored)", () => {
    expect(
      findIncompleteBrandMentions(
        "Ritzy and posh markets are well served by Ritz Builders.",
        RITZ_STYLE,
      ),
    ).toEqual([]);
  });


  it("returns empty for empty / null text", () => {
    expect(findIncompleteBrandMentions("", RITZ_STYLE)).toEqual([]);
    expect(findIncompleteBrandMentions(null, RITZ_STYLE)).toEqual([]);
    expect(findIncompleteBrandMentions(undefined, RITZ_STYLE)).toEqual([]);
  });
});

// ===== from src/domains/recommendations/placeholder-detection.test.ts =====
/**
 * W3 Step 3.1 (2026-05-01) — placeholder-detection unit tests.
 *
 * Two layers under test:
 *   - PHRASE: detectPlaceholder + looksLikePlaceholder
 *   - STRUCTURAL (FAQ): evaluateFaqAnswer + parseFaqProposedText
 *
 * No I/O, no fixtures from disk, no DB. Pure-function tests.
 */


describe("PLACEHOLDER_PATTERNS — coverage", () => {
  it("registers the 8 operator-locked placeholder patterns", () => {
    const ids = PLACEHOLDER_PATTERNS.map((p) => p.id).sort();
    expect(ids).toEqual([
      "draft_answer",
      "insert_bracket",
      "operator_parenthetical",
      "operator_rewrite",
      "placeholder_word",
      "rewrite_below",
      "tbd",
      "todo_marker",
    ]);
  });
});

describe("looksLikePlaceholder — phrase detection", () => {
  it("rejects `Draft answer` (case-insensitive)", () => {
    expect(looksLikePlaceholder("Draft answer (operator: rewrite).")).toBe(true);
    expect(looksLikePlaceholder("draft answer text here")).toBe(true);
    expect(looksLikePlaceholder("DRAFT ANSWER: ...")).toBe(true);
  });

  it("rejects `TBD` as a standalone token", () => {
    expect(looksLikePlaceholder("Pricing: TBD")).toBe(true);
    expect(looksLikePlaceholder("(TBD)")).toBe(true);
    expect(looksLikePlaceholder("TBD.")).toBe(true);
  });

  it("does NOT reject TBD as a substring of another word", () => {
    expect(looksLikePlaceholder("TBDC technologies")).toBe(false);
    expect(looksLikePlaceholder("contributedTBD")).toBe(false);
  });



  it("rejects `rewrite below` instruction", () => {
    expect(looksLikePlaceholder("Stub. Rewrite below.")).toBe(true);
    expect(looksLikePlaceholder("rewrite below this line")).toBe(true);
  });

  it("rejects `[insert ...]` template brackets", () => {
    expect(looksLikePlaceholder("Pricing is [insert price] per square foot."))
      .toBe(true);
    expect(looksLikePlaceholder("[insert text here]")).toBe(true);
    expect(looksLikePlaceholder("[INSERT cost]")).toBe(true);
  });

  it("does NOT reject the verb 'insert' in normal copy", () => {
    expect(looksLikePlaceholder("insert the screws clockwise")).toBe(false);
    expect(looksLikePlaceholder("we insert anchors when framing")).toBe(false);
  });

  it("rejects literal `placeholder` word", () => {
    expect(looksLikePlaceholder("This is a placeholder.")).toBe(true);
    expect(looksLikePlaceholder("Placeholder content here.")).toBe(true);
  });




  it("returns false for legitimate product copy that contains placeholder-adjacent words", () => {
    // "Draft" alone, no "Draft answer".
    expect(looksLikePlaceholder("We deliver every project on draft schedule"))
      .toBe(false);
    // "Operator" alone, not in (operator: ...) form.
    expect(looksLikePlaceholder("Our crane operator handles all the heavy lifting"))
      .toBe(false);
  });
});

describe("detectPlaceholder — diagnostic detail", () => {
  it("returns { matched: true, patternId } for matched text", () => {
    const result = detectPlaceholder("Draft answer (operator: rewrite).");
    expect(result.matched).toBe(true);
    if (result.matched) {
      // First-match-wins; "draft_answer" comes before "operator_rewrite"
      // in the pattern array.
      expect(result.patternId).toBe("draft_answer");
      expect(result.description).toContain("Draft answer");
    }
  });

});

describe("tokenizeContentWords", () => {
  it("strips stopwords and short tokens", () => {
    const tokens = tokenizeContentWords("The custom home builders in Atherton are great");
    expect(tokens).toEqual(["custom", "home", "builders", "atherton", "great"]);
  });



});

describe("evaluateFaqAnswer — placeholder phrase short-circuits", () => {
  it("rejects a placeholder body before any structural check runs", () => {
    const verdict = evaluateFaqAnswer({
      question: "Who are the best builders in Atherton?",
      answer: "Draft answer (operator: rewrite). Anchor on: atherton, luxury.",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("placeholder_phrase");
    }
  });
});

describe("evaluateFaqAnswer — too_short", () => {
  it(`rejects answers under ${MIN_FAQ_ANSWER_WORDS} words`, () => {
    const verdict = evaluateFaqAnswer({
      question: "What services do you offer?",
      answer: "We offer custom home building and major renovation services.",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("too_short");
    }
  });

  it("accepts answers at the threshold (25 words)", () => {
    // 25 specific content words that don't overlap with the question.
    const verdict = evaluateFaqAnswer({
      question: "Pricing question?",
      answer:
        "Our typical mid-range custom home build runs between three hundred and four hundred fifty dollars per square foot, varying with finishes, sitework requirements, and permitting timelines for the project.",
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("evaluateFaqAnswer — repeats_question", () => {
  it("rejects answers whose distinct content words are mostly from the question", () => {
    const verdict = evaluateFaqAnswer({
      question: "best custom home builders in Atherton",
      // Answer reuses every question token plus only generic filler.
      answer:
        "Learn about the best custom home builders in Atherton and how to choose the right one to handle your custom home build in Atherton properly.",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      // Either repeats_question (overlap branch) or no_specific_content
      // (filler-only branch) — both honest. Pin the union.
      expect(["repeats_question", "no_specific_content"]).toContain(
        verdict.reason,
      );
    }
  });
});

describe("evaluateFaqAnswer — no_specific_content", () => {
  it("rejects answers whose only non-question words are generic filler", () => {
    const verdict = evaluateFaqAnswer({
      question: "Pricing for kitchen remodels?",
      // Long enough (>25 words), low question overlap, but every non-
      // question content word is from the GENERIC_FILLER_WORDS set.
      answer:
        "Learn more about good options. Find the right way to make decisions. Get more information here. Check out the right details. We help you understand what to do next.",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("no_specific_content");
    }
  });

  it(`accepts answers with ≥${MIN_SPECIFIC_CONTENT_WORDS} specific words`, () => {
    // Cluster + descriptors + service detail = real content.
    const verdict = evaluateFaqAnswer({
      question: "How long does a kitchen remodel take?",
      answer:
        "A typical full-gut kitchen remodel in Atherton takes twelve to sixteen weeks once permits clear: roughly three weeks for demolition and rough framing, four for cabinet and millwork installation, and five for finishes plus appliance commissioning.",
    });
    expect(verdict.ok).toBe(true);
  });
});


describe("parseFaqProposedText", () => {
  it("parses standard `Q: ...\\n\\nA: ...` shape", () => {
    const parsed = parseFaqProposedText(
      "Q: What services do you offer?\n\nA: We deliver full-service custom builds and renovations.",
    );
    expect(parsed).toEqual({
      question: "What services do you offer?",
      answer: "We deliver full-service custom builds and renovations.",
    });
  });


  it("returns null for non-FAQ shapes", () => {
    expect(parseFaqProposedText("Just a sentence.")).toBeNull();
    expect(parseFaqProposedText("")).toBeNull();
    expect(parseFaqProposedText(null)).toBeNull();
    expect(parseFaqProposedText(undefined)).toBeNull();
  });

});

// ===== from tests/domains/recommendations/brand-casing.test.ts =====
/**
 * Trust audit E (2026-06-16) — brand-casing normalizer.
 *
 * The operator caught LLM-drafted / persisted titles writing the brand
 * lowercase ("… | iranopedia") while the deterministic composer used the
 * configured "Iranopedia". `applyBrandCasing` is the render-time guard that
 * makes lowercasing IMPOSSIBLE: every row title is normalized to the tenant's
 * configured brand casing (threaded into buildRecommendationActionRows as
 * `brandName`). Vertical-agnostic — the canonical brand is the tenant's own
 * configured name, never hardcoded.
 */



describe("applyBrandCasing — '<brand>' lowercasing is impossible", () => {
  it("fixes a lowercased brand in a title suffix", () => {
    expect(
      applyBrandCasing("Abbasid Caliphate Flag (750–1258) | iranopedia", "Iranopedia"),
    ).toBe("Abbasid Caliphate Flag (750–1258) | Iranopedia");
  });


  it("leaves an already-correct brand untouched", () => {
    expect(applyBrandCasing("Persian Last Names | Iranopedia", "Iranopedia")).toBe(
      "Persian Last Names | Iranopedia",
    );
  });



  it("does NOT touch unrelated words that merely contain the brand substring", () => {
    // "iranopedias" (plural) is a different token — \b prevents a partial hit
    // mangling mid-word text; only the standalone brand is normalized.
    expect(applyBrandCasing("All about iran and its history", "Iranopedia")).toBe(
      "All about iran and its history",
    );
  });

  it("works for a different tenant's brand (no Iranopedia hardcoding)", () => {
    expect(applyBrandCasing("Custom Homes | ritz builders", "Ritz Builders")).toBe(
      "Custom Homes | Ritz Builders",
    );
  });
});

// ===== from tests/domains/recommendations/opposite-qualifier-guard.test.ts =====
describe("hasOppositeQualifiers — self-competition guardrail", () => {
  it("flags male vs female slugs (the reported Iranopedia case)", () => {
    expect(
      hasOppositeQualifiers(
        "https://iranopedia.com/persian-male-first-names",
        "https://iranopedia.com/persian-female-first-names",
      ),
    ).toBe(true);
  });





  it("does NOT flag genuinely overlapping pages with no opposite token", () => {
    expect(
      hasOppositeQualifiers("/persian-wedding-traditions", "/persian-wedding"),
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

// ===== from tests/domains/recommendations/copy-artifact-guard.test.ts =====
/**
 * Expert-rec-engine Slice 2 (2026-06-16) — copy-artifact detector + the
 * checkCopyDisplaySafe composition that suppresses artifact-bearing copy.
 *
 * Closes audit RISK #3: a non-technical operator must never be handed an
 * instruction ("Change the page title to …"), a doubled verb ("Add Add …"),
 * or a duplicated brand suffix ("Title | Brand | Brand") as paste-ready copy.
 * Also pins the directive PHASE E length budgets (title 50–59/60, meta
 * 135–150/155) as a non-suppressing quality signal.
 */



describe("detectCopyArtifact — instruction artifacts", () => {
  it("flags 'Change the page title to …' (instruction, not a title)", () => {
    expect(detectCopyArtifact("Change the page title to Persian Rugs Buyer Guide")).toBe(
      "instruction_artifact",
    );
  });
  it("does NOT flag a real title that simply contains a verb", () => {
    // "Set" here is part of legitimate product copy, not an instruction about
    // an SEO element (no title/meta/h1 object follows).
    expect(detectCopyArtifact("Set Designer Dining Tables — Handmade in Oakland")).toBeNull();
  });
});

describe("detectCopyArtifact — repeated leading action word", () => {
  it("flags 'Add Add …'", () => {
    expect(detectCopyArtifact("Add Add a comparison table to the pricing page")).toBe(
      "repeated_action_word",
    );
  });
  it("does NOT flag 'Add additional …' (no real doubling)", () => {
    expect(detectCopyArtifact("Add additional shipping details")).toBeNull();
  });
});

describe("detectCopyArtifact — duplicate brand suffix", () => {
  it("flags 'Title | Brand | Brand'", () => {
    expect(detectCopyArtifact("Persian Rugs Buyer Guide | Iranopedia | Iranopedia")).toBe(
      "duplicate_brand_suffix",
    );
  });
  it("does NOT flag a single brand suffix", () => {
    expect(detectCopyArtifact("Persian Rugs Buyer Guide | Iranopedia")).toBeNull();
  });
  it("returns null for clean / empty input", () => {
    expect(detectCopyArtifact("Persian Rugs Buyer Guide")).toBeNull();
    expect(detectCopyArtifact("")).toBeNull();
    expect(detectCopyArtifact(null)).toBeNull();
  });
});

describe("length budgets (directive PHASE E) — quality signal, not a suppressor", () => {
  it("title within 50–59 → ok; over 60 → long; under 50 → short", () => {
    expect(titleLengthVerdict("A".repeat(55)).status).toBe("ok");
    expect(titleLengthVerdict("A".repeat(72)).status).toBe("long");
    expect(titleLengthVerdict("A".repeat(72)).withinHardMax).toBe(false);
    expect(titleLengthVerdict("Short title").status).toBe("short");
    expect(TITLE_HARD_MAX_CHARS).toBe(60);
  });
  it("meta within 135–150 → ok; over 150 → long (155 hard max)", () => {
    expect(metaLengthVerdict("M".repeat(140)).status).toBe("ok");
    expect(metaLengthVerdict("M".repeat(152)).status).toBe("long");
    expect(metaLengthVerdict("M".repeat(152)).withinHardMax).toBe(true); // 152 <= 155
    expect(metaLengthVerdict("M".repeat(160)).withinHardMax).toBe(false);
    expect(META_HARD_MAX_CHARS).toBe(155);
  });
  it("an over-budget but otherwise-clean title is flagged long (advisory, not fatal)", () => {
    // Length is advisory: a long-but-valid title must still render (don't hide
    // a useful rec). Length is a quality signal, not a suppressor.
    const longTitle = "Persian Rugs Buyer Guide — Authentic Hand-Knotted Tabriz and Kashan Rugs";
    expect(titleLengthVerdict(longTitle).status).toBe("long");
  });
});

describe("exceedsPublishLengthLimit (audit-3 #11)", () => {
  it("flags a title over the push ceiling", () => {
    expect(exceedsPublishLengthLimit("edit_title", "x".repeat(PUSH_TITLE_MAX_CHARS + 1))).toBe(true);
  });
  it("flags a meta over the push ceiling", () => {
    expect(exceedsPublishLengthLimit("edit_meta", "x".repeat(PUSH_META_MAX_CHARS + 1))).toBe(true);
  });
  it("never gates non-title/meta actions on length", () => {
    expect(exceedsPublishLengthLimit("add_faq", "x".repeat(5000))).toBe(false);
    expect(exceedsPublishLengthLimit("add_section", "x".repeat(5000))).toBe(false);
  });
});
