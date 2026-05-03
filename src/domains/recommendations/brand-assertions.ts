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
    // describes the brand or category — not when the LLM legitimately
    // writes "best for whole-home remodels" inside a user-voice FAQ
    // question. Allows up to 3 modifier words between "the best"
    // and the noun (W3 §3.8.6 — Luxury Home Builder run flagged
    // "the best luxury home builders" slipping through the
    // single-adjective regex).
    //   "Ritz is the best builder ..."
    //   "the best builder in ..."
    //   "the best luxury home builders ..."
    //   "the best architect-led design-build firm ..."
    pattern:
      /\bthe\s+best\s+(?:[\w-]+\s+){0,3}(?:builders?|firms?|companies|company|contractors?|architects?|design[-\s]?build(?:ers?)?|partners?)\b/i,
    unlockedBy: "ranking_first",
    description:
      "subject-of-sentence 'best builder/firm/etc.' superlative with no operator-supplied source",
  },
  {
    id: "leading_brand",
    // Same 0-3 modifier-word gap as best_in_market so phrases like
    // "leading luxury home builders in the Bay Area" still trip.
    pattern:
      /\bleading\s+(?:[\w-]+\s+){0,3}(?:builders?|firms?|companies|company|contractors?|architects?|design[-\s]?build(?:ers?)?|partners?)\b/i,
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

// ---------------------------------------------------------------------------
// W3 Step 3.7s (2026-05-03) — brand-name + style helpers
// ---------------------------------------------------------------------------

/**
 * Operator-locked style rules for one tenant's generated public copy.
 *
 * Drives two validators that sit alongside `findUnsupportedBrandClaims`:
 *   - `findIncompleteBrandMentions` — flags bare short forms ("Ritz")
 *     that don't belong to the full entity ("Ritz Builders").
 *   - `findEmDashes` — flags em / en dash use as sentence punctuation
 *     (digit-bounded ranges like "10–15 minutes" stay allowed).
 *
 * Operator scope (W3 §3.7s):
 *   - First mention of the brand in any generated section MUST be the
 *     full entity name ("Ritz Builders"). Subsequent sentences may
 *     transition to first-person plural ("our team", "we", "our
 *     process") for natural website tone.
 *   - "Ritz" alone is NEVER allowed in generated public copy. The
 *     model must either spell out "Ritz Builders" or use the
 *     first-person plural form.
 *   - Em dashes (— and free-standing –) are banned in body copy and
 *     headings. Periods, commas, colons, parentheses replace them.
 */
export type BrandNameStyle = {
  /** Full operator-locked entity name (e.g., "Ritz Builders"). */
  readonly fullName: string;
  /**
   * Short forms that are NOT allowed in generated public copy unless
   * they appear immediately followed by the rest of `fullName` (so
   * "Ritz" matches "Ritz Builders" and is allowed; "Ritz" alone is
   * rejected).
   */
  readonly bannedShortForms: ReadonlyArray<string>;
};

/** Per-tenant style registry. Adds-only — keys match `BeaconTenant.slug`. */
const TENANT_NAME_STYLES: Record<string, BrandNameStyle> = {
  "ritz-builders": {
    fullName: "Ritz Builders",
    bannedShortForms: ["Ritz"],
  },
};

/**
 * Get the operator-locked brand-name style for a tenant. Returns
 * `null` for unknown tenants — callers MUST treat null as "no style
 * gate active" and skip the brand-name-first check (the safe default
 * for tenants not yet curated).
 */
export function getBrandNameStyle(tenantId: string): BrandNameStyle | null {
  if (typeof tenantId !== "string" || tenantId.length === 0) return null;
  return TENANT_NAME_STYLES[tenantId] ?? null;
}

// ── Em-dash detector ───────────────────────────────────────────────────

/**
 * Em-dash and en-dash usage that the operator-locked style rule bans
 * (W3 §3.7s).
 *
 * Returns one entry per match. Each entry carries the matched
 * substring + the offending character. A digit-bounded en dash
 * ("2024–2025", "10–15 minutes") is NOT a match — those are
 * legitimate ranges. An em dash (`—`) is ALWAYS a match (no
 * legitimate use in generated public copy).
 *
 * Pure / deterministic. Pattern compiled once.
 */
const EM_DASH_REGEX = /—/gu; // U+2014 — always banned in public copy.
const EN_DASH_NON_RANGE_REGEX = /(?<![0-9])–(?![0-9])/gu; // U+2013 unless digit range.

export type EmDashMatch = {
  readonly char: "—" | "–";
  readonly index: number;
  readonly contextText: string;
};

export function findEmDashes(
  text: string | null | undefined,
): EmDashMatch[] {
  if (typeof text !== "string" || text.length === 0) return [];
  const matches: EmDashMatch[] = [];
  for (const m of text.matchAll(EM_DASH_REGEX)) {
    matches.push({
      char: "—",
      index: m.index ?? 0,
      contextText: extractContext(text, m.index ?? 0, 30),
    });
  }
  for (const m of text.matchAll(EN_DASH_NON_RANGE_REGEX)) {
    matches.push({
      char: "–",
      index: m.index ?? 0,
      contextText: extractContext(text, m.index ?? 0, 30),
    });
  }
  // Sort by index so the FIRST offense is reported first (validator
  // convention).
  matches.sort((a, b) => a.index - b.index);
  return matches;
}

function extractContext(text: string, idx: number, halfWidth: number): string {
  const start = Math.max(0, idx - halfWidth);
  const end = Math.min(text.length, idx + halfWidth);
  return text.slice(start, end).trim();
}

// ── Brand-name first-mention detector ──────────────────────────────────

/**
 * One match where a banned short form appears in the text without
 * the rest of the full entity name following.
 *
 * Example: text "Ritz emphasizes design-build" with style
 * `{ fullName: "Ritz Builders", bannedShortForms: ["Ritz"] }`
 * returns one match — "Ritz" without " Builders" after it.
 *
 * Text "Ritz Builders' approach … Ritz Builders also coordinates"
 * returns NO matches — every "Ritz" is followed by " Builders".
 */
export type IncompleteBrandMatch = {
  readonly shortForm: string;
  readonly fullName: string;
  readonly index: number;
  readonly contextText: string;
};

export function findIncompleteBrandMentions(
  text: string | null | undefined,
  style: BrandNameStyle | null,
): IncompleteBrandMatch[] {
  if (
    style === null ||
    typeof text !== "string" ||
    text.length === 0 ||
    style.bannedShortForms.length === 0
  ) {
    return [];
  }
  const matches: IncompleteBrandMatch[] = [];
  for (const shortForm of style.bannedShortForms) {
    if (
      typeof shortForm !== "string" ||
      shortForm.trim().length === 0 ||
      shortForm === style.fullName
    ) {
      continue;
    }
    // The full name must START with the short form to support the
    // "lookahead" — operator scope is "Ritz Builders" extends "Ritz".
    if (!style.fullName.startsWith(shortForm)) continue;
    const tail = style.fullName.slice(shortForm.length); // " Builders"
    if (tail.length === 0) continue;
    // Build a regex that matches the short form NOT followed by the
    // tail. Word-boundary anchored so partial-word matches are
    // ignored ("Ritzy" wouldn't match).
    const escapedShort = escapeRegex(shortForm);
    const escapedTail = escapeRegex(tail);
    const re = new RegExp(`\\b${escapedShort}\\b(?!${escapedTail}\\b)`, "g");
    for (const m of text.matchAll(re)) {
      matches.push({
        shortForm,
        fullName: style.fullName,
        index: m.index ?? 0,
        contextText: extractContext(text, m.index ?? 0, 30),
      });
    }
  }
  matches.sort((a, b) => a.index - b.index);
  return matches;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
