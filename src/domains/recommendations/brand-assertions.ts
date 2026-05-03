/**
 * W3 Step 3.7 (2026-05-03) — Brand-Claim Grounding.
 *
 * Operator scope (sample-quality report findings, W3 §3.6):
 *   3 of 4 minor-edit LLM rows shipped an unsupported claim like
 *   "Ritz is **frequently/commonly/often** recommended." The model
 *   has no source for these third-party-recognition claims and
 *   pattern-matches to generic builder-website copy.
 *
 * This module is the operator-curated source of truth for what the
 * LLM may say AS Beacon-generated public copy. Every public-facing
 * brand claim must come from this file or from the evidence packet's
 * own observed data (descriptors, citations, etc).
 *
 * Three concerns live here:
 *   1. ALLOWED brand assertions per tenant — typed list of phrases +
 *      categories the operator has explicitly approved for public
 *      copy. The packet ships these to the LLM; the validator uses
 *      them to unlock category-gated claim patterns.
 *   2. FORBIDDEN claim patterns — regex patterns that, by default,
 *      MAY NOT appear in `proposedText` / `displayLabel`. Each
 *      forbidden pattern declares a `unlockedBy` category; if the
 *      tenant's assertion list contains an assertion of that
 *      category, the pattern is unlocked. (E.g. "award-winning" is
 *      forbidden by default but unlocked when an `"award"` assertion
 *      exists.)
 *   3. Public-copy scope — the validator checks `proposedText` +
 *      `displayLabel` ONLY. `why`, evidence refs, risks, and
 *      measurementPlan are operator-facing and may include any
 *      language. User-prompt copy (e.g. tracked-prompt text or
 *      observed AI answers in evidence) is never scanned because
 *      it isn't Beacon-generated.
 *
 * Pure / deterministic. No I/O. No DB lookups. The tenant → assertion
 * map lives in this file today; future evolution can read from
 * `BeaconTenant` config or DB without changing the contract.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Categories of brand assertion the operator may authorize. Each
 * category gates a set of forbidden-claim patterns:
 *   "award"           → unlocks award-winning / top-rated / leading
 *   "popularity"      → unlocks frequently / commonly / often recommended
 *   "ranking_first"   → unlocks #1 / best / leading
 *   "trust"           → unlocks most trusted
 *   "tenure"          → unlocks "X years in business"
 *   "client_outcome"  → unlocks specific client-satisfaction claims
 *
 * `"positioning"` / `"service_area"` / `"service_offering"` /
 * `"process"` / `"factual"` are always-on positive assertions that
 * the LLM may use freely without unlocking any forbidden pattern.
 */
export type BrandAssertionCategory =
  | "positioning"
  | "service_area"
  | "service_offering"
  | "process"
  | "factual"
  | "award"
  | "popularity"
  | "ranking_first"
  | "trust"
  | "tenure"
  | "client_outcome";

/** One operator-approved brand assertion. */
export type BrandAssertion = {
  /** Stable id for tests + diagnostics. */
  readonly id: string;
  /** The actual phrase the LLM may use in copy. Operator-readable. */
  readonly phrase: string;
  readonly category: BrandAssertionCategory;
  /** Optional pointer to where the assertion is supported (URL, DB
   *  row, etc.). Diagnostic only — the validator doesn't follow it. */
  readonly supportedBy?: string;
};

// ---------------------------------------------------------------------------
// Tenant-curated assertion lists
// ---------------------------------------------------------------------------

/**
 * Ritz Builders — operator-curated brand assertions.
 *
 * Each phrase has been reviewed by the operator (W3 §3.7 scope) for
 * factual accuracy + brand-safety. The LLM is allowed to lean on
 * these in `proposedText` / `displayLabel`. Adding new assertions:
 * append a row here AND verify the `supportedBy` reference still
 * holds.
 *
 * Notable absences (intentional — none of these are supported today):
 *   - "award-winning" / "top-rated" / "leading" → no operator-
 *     supplied award assertion at the time of W3 §3.7 launch.
 *   - "frequently / commonly / often recommended" → no third-party
 *     recognition source the operator has authorized for public copy.
 *   - "X years in business" / "Y projects completed" → no operator-
 *     supplied tenure / count assertion.
 */
const RITZ_ASSERTIONS: ReadonlyArray<BrandAssertion> = [
  {
    id: "ritz_positioning_design_build",
    phrase: "architect-led design-build",
    category: "process",
    supportedBy: "ritzbuilders.com homepage + services pages",
  },
  {
    id: "ritz_geo_silicon_valley",
    phrase: "Silicon Valley luxury custom homes",
    category: "service_area",
    supportedBy: "ritzbuilders.com /locations/* coverage",
  },
  {
    id: "ritz_geo_bay_area",
    phrase: "Bay Area luxury custom homes",
    category: "service_area",
    supportedBy: "ritzbuilders.com homepage",
  },
  {
    id: "ritz_offering_custom_homes",
    phrase: "custom homes",
    category: "service_offering",
    supportedBy: "ritzbuilders.com /services/custom-homes",
  },
  {
    id: "ritz_offering_remodels",
    phrase: "remodels",
    category: "service_offering",
    supportedBy: "ritzbuilders.com /services/whole-home-remodel",
  },
  {
    id: "ritz_offering_whole_home_remodel",
    phrase: "whole-home remodels",
    category: "service_offering",
    supportedBy: "ritzbuilders.com /services/whole-home-remodel",
  },
  {
    id: "ritz_offering_teardown_rebuild",
    phrase: "teardown / rebuild projects",
    category: "service_offering",
    supportedBy: "ritzbuilders.com /services/* and case studies",
  },
  {
    id: "ritz_process_in_house",
    phrase: "in-house architecture and design-build coordination",
    category: "process",
    supportedBy: "ritzbuilders.com /about + /process",
  },
  {
    id: "ritz_process_concept_to_completion",
    phrase: "concept-to-completion (feasibility, permitting, construction)",
    category: "process",
    supportedBy: "ritzbuilders.com /process",
  },
  {
    id: "ritz_positioning_premium",
    phrase: "premium / luxury positioning",
    category: "positioning",
    supportedBy: "ritzbuilders.com homepage tone + project gallery",
  },
];

/**
 * Brand-assertions registry. Add new tenants here as they land. Keys
 * are tenant slugs (matching `BeaconTenant.slug`).
 */
const TENANT_ASSERTIONS: Record<string, ReadonlyArray<BrandAssertion>> = {
  "ritz-builders": RITZ_ASSERTIONS,
};

/**
 * Get the operator-curated brand assertions for a tenant. Returns an
 * empty array for unknown tenants — never throws — so the LLM
 * provider degrades gracefully (no assertions = every forbidden
 * pattern stays locked, which is the safe default).
 *
 * Pure / deterministic. The returned array is the live registry
 * reference; callers MUST treat it as readonly.
 */
export function getBrandAssertions(
  tenantId: string,
): ReadonlyArray<BrandAssertion> {
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return [];
  }
  return TENANT_ASSERTIONS[tenantId] ?? [];
}

// ---------------------------------------------------------------------------
// Forbidden-claim patterns
// ---------------------------------------------------------------------------

/**
 * One forbidden-claim pattern. The validator scans public-copy fields
 * for `pattern`; if it matches AND the tenant's assertion list does
 * NOT contain an assertion of `unlockedBy` category, the edit is
 * rejected with `reason="unsupported_brand_claim"`.
 *
 * `id` is the stable diagnostic code surfaced in validator failures.
 */
export type ForbiddenClaimPattern = {
  readonly id: string;
  readonly pattern: RegExp;
  /** When an assertion of this category exists, the pattern is
   *  unlocked and the public copy is allowed. `null` means
   *  "permanently locked" — no operator assertion can unlock this
   *  pattern (used for guarantees / quantified outcomes). */
  readonly unlockedBy: BrandAssertionCategory | null;
  /** Operator-readable explanation of why this is forbidden by
   *  default. Surfaced in validator failure reasons. */
  readonly description: string;
};

/**
 * The operator-locked forbidden-claim list (W3 §3.7).
 *
 * Order matters for diagnostic clarity — the validator returns the
 * FIRST match. Patterns are case-insensitive and use word-boundary
 * anchors so partial matches inside larger words are avoided.
 */
export const FORBIDDEN_CLAIM_PATTERNS: ReadonlyArray<ForbiddenClaimPattern> = [
  // ── Popularity / social-proof claims ──────────────────────────────
  {
    id: "frequently_recommended",
    pattern: /\b(?:frequently|commonly|often)\s+recommended\b/i,
    unlockedBy: "popularity",
    description:
      "social-proof claim ('frequently / commonly / often recommended') with no operator-supplied source",
  },
  {
    id: "most_trusted",
    pattern: /\bmost\s+trusted\b/i,
    unlockedBy: "trust",
    description:
      "trust-superlative claim ('most trusted') with no operator-supplied source",
  },
  {
    id: "trusted_by",
    pattern: /\btrusted\s+by\s+(?:homeowners|customers|clients|architects)\b/i,
    unlockedBy: "trust",
    description:
      "client-trust claim ('trusted by homeowners / clients / architects') with no operator-supplied source",
  },
  // ── Ranking / superiority claims ──────────────────────────────────
  {
    id: "ranked_number_one",
    pattern: /(?:^|\s)#1(?:\s|[\.,]|$)/,
    unlockedBy: "ranking_first",
    description:
      "ranked-#1 superlative with no operator-supplied source",
  },
  {
    id: "top_rated",
    pattern: /\btop[-\s]?rated\b/i,
    unlockedBy: "ranking_first",
    description:
      "top-rated superlative with no operator-supplied source",
  },
  {
    id: "best_in_market",
    // Anchor on subject + context so this only fires when "best"
    // describes the brand — not when the LLM legitimately writes
    // "best for whole-home remodels" inside a user-voice FAQ
    // question (which shouldn't be banned). Match phrases like:
    //   "Ritz is the best ..."
    //   "the best builder in ..."
    //   "Ritz Builders is the best ..."
    pattern:
      /\bthe\s+best\s+(?:builder|firm|company|contractor|architect|design[-\s]?build|partner)/i,
    unlockedBy: "ranking_first",
    description:
      "subject-of-sentence 'best builder/firm/etc.' superlative with no operator-supplied source",
  },
  {
    id: "leading_brand",
    pattern: /\bleading\s+(?:builder|firm|company|contractor|architect|design[-\s]?build|partner)/i,
    unlockedBy: "ranking_first",
    description:
      "'leading builder/firm/etc.' superlative with no operator-supplied source",
  },
  // ── Awards ───────────────────────────────────────────────────────
  {
    id: "award_winning",
    pattern: /\baward[-\s]?winning\b/i,
    unlockedBy: "award",
    description:
      "'award-winning' claim with no operator-supplied award reference",
  },
  // ── Tenure ───────────────────────────────────────────────────────
  {
    id: "years_in_business",
    pattern: /\b\d+\s*\+?\s+years\s+(?:in\s+business|of\s+experience)\b/i,
    unlockedBy: "tenure",
    description:
      "tenure claim ('X years in business / of experience') with no operator-supplied source",
  },
  {
    id: "since_year",
    pattern: /\bsince\s+(?:19|20)\d{2}\b/i,
    unlockedBy: "tenure",
    description:
      "founding-year claim ('since YYYY') with no operator-supplied source",
  },
  // ── Quantified outcomes / guarantees (permanently locked) ─────────
  {
    id: "guarantee_outcome",
    // Verb forms: guarantee / guarantees / guaranteed; promise /
    // promises / promised; assured. Object: result / outcome /
    // delivery / completion (with optional adjectives in between).
    pattern:
      /\b(?:guarantee[sd]?|promise[sd]?|assured)\b[\w\s,'-]{0,80}?\b(?:result|outcome|delivery|completion)\b/i,
    unlockedBy: null,
    description:
      "outcome guarantee / promise (permanently locked — never allowed in public copy)",
  },
  {
    id: "client_satisfaction_pct",
    pattern: /\b\d{1,3}\s*%\s*(?:client\s+)?satisfaction\b/i,
    unlockedBy: "client_outcome",
    description:
      "quantified client-satisfaction claim with no operator-supplied source",
  },
  {
    id: "project_count",
    pattern:
      /\b\d{1,4}\s*\+?\s+(?:projects?|homes?|builds?|remodels?)\s+(?:completed|delivered|built|finished)\b/i,
    unlockedBy: "client_outcome",
    description:
      "project-count claim with no operator-supplied source",
  },
];

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/**
 * One match returned by `findUnsupportedBrandClaims`. Diagnostic-grade
 * — the validator surfaces `id` + `description` in its rejection
 * message; tests pin against `id`.
 */
export type UnsupportedClaimMatch = {
  readonly patternId: string;
  readonly description: string;
  /** The substring that matched. Useful for telemetry / dev-tools. */
  readonly matchedText: string;
  /** Which category would unlock this pattern (null = permanently
   *  locked). */
  readonly unlockedBy: BrandAssertionCategory | null;
};

/**
 * Scan `text` for forbidden-claim patterns that the tenant's
 * assertion list does NOT unlock.
 *
 * Returns an empty array when:
 *   - text is empty / non-string
 *   - no forbidden pattern matches
 *   - every matching pattern is unlocked by an assertion of the right
 *     category
 *
 * Returns one UnsupportedClaimMatch per pattern that fires AND has
 * no unlocking assertion. Multiple distinct patterns can match the
 * same text (e.g. a sentence with both "award-winning" and "leading
 * builder").
 *
 * Pure / deterministic. Case-insensitive matching is enforced by the
 * pattern regex flags.
 */
export function findUnsupportedBrandClaims(
  text: string | null | undefined,
  assertions: ReadonlyArray<BrandAssertion>,
): UnsupportedClaimMatch[] {
  if (typeof text !== "string" || text.trim().length === 0) {
    return [];
  }
  const allowedCategories = new Set(assertions.map((a) => a.category));
  const matches: UnsupportedClaimMatch[] = [];
  for (const fp of FORBIDDEN_CLAIM_PATTERNS) {
    const match = fp.pattern.exec(text);
    if (!match) continue;
    if (fp.unlockedBy !== null && allowedCategories.has(fp.unlockedBy)) {
      continue;
    }
    matches.push({
      patternId: fp.id,
      description: fp.description,
      matchedText: match[0] ?? "",
      unlockedBy: fp.unlockedBy,
    });
  }
  return matches;
}

/**
 * Render the brand-assertion list as the operator-friendly bullet
 * block the OpenAI SYSTEM_PROMPT injects. Used by the openai
 * provider only — keeps formatting consistent.
 *
 * Returns "(none)" when the list is empty so the prompt always has
 * a deterministic shape.
 */
export function formatBrandAssertionsForPrompt(
  assertions: ReadonlyArray<BrandAssertion>,
): string {
  if (assertions.length === 0) return "(none)";
  return assertions
    .map((a) => `  - [${a.category}] ${a.phrase}`)
    .join("\n");
}

/**
 * Render the forbidden-claim list as a static block the OpenAI
 * SYSTEM_PROMPT injects (one line per pattern with its id + a short
 * description). Operator-friendly so the prompt reads naturally.
 */
export function formatForbiddenClaimsForPrompt(): string {
  return FORBIDDEN_CLAIM_PATTERNS.map((fp) => `  - ${fp.description}`).join(
    "\n",
  );
}
