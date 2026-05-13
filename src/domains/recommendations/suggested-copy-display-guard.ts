/**
 * Recommendation Execution Layer v1 — Phase A (2026-05-13).
 *
 * Display-safety guard for already-persisted `proposed_text`. The
 * /recommendations/[id] brief page renders Beacon-drafted copy from
 * `recommended_edits.proposed_text` directly. The save-time validator
 * (`specific-edit-validator.ts`) already rejected unsafe LLM output at
 * write time, AND `mapSpecificEditToRow` strips internal taxonomy
 * prefixes + UUIDs via `sanitizeOperatorEvidenceText`. This guard is
 * defense-in-depth at RENDER time — it covers HISTORICAL rows that
 * predate those guarantees, plus any future regression that lands a
 * row whose `proposed_text` contains internal taxonomy.
 *
 * The guard is binary by design: a string is either safe to render
 * verbatim, or it isn't. Failed strings render as a calm fallback
 * ("Beacon has a draft for this recommendation, but it needs review
 * before showing here.") at the act level. The guard never mutates
 * the input and never edits the database.
 *
 * Pure. Deterministic. No I/O. No imports outside built-in JS.
 */

// ── Hard-blocked tokens ───────────────────────────────────────────────────
//
// Whole-word, case-sensitive matches. These are camelCase / snake_case
// names from the SpecificEditEvidencePacket schema, the recommended_edits
// row schema, and adjacent internal taxonomy. Any time a customer-facing
// string contains one of these, it's an internal leak — render the
// fallback.
//
// Adding more later is cheap: just append. Removing is even cheaper.
const HARD_BLOCKED_TOKENS: ReadonlyArray<string> = [
  // Packet aggregate-signal blocks
  "aiSearchSignal",
  "actualSearchQueries",
  "topSearchQueries",
  "topDescriptors",
  "topCompetitorCoMentions",
  "competitorPageBlueprints",
  "competitorAngles",
  "brandAssertions",
  "affectedPrompts",
  "ownedPageCandidates",
  "descriptorWindows",
  "crossTenantPatterns",
  "citedSourcePages",
  // Recommended-edits row columns
  "rec_id",
  "tenant_id",
  "source_rec_id",
  "evidence_tier",
  "evidence_hash",
  "target_element_key",
  "target_url",
  "action_type",
  "current_text",
  "proposed_text",
  "display_label",
  "measurement_plan",
  "expected_impact",
  "cost_usd",
  "provider_name",
  "evidenceHash",
  "evidenceTier",
  // Lifecycle OS column names
  "live_at",
  "live_match_kind",
  "live_match_confidence",
  "live_snapshot_id",
  "live_element_key",
  "implementation_status",
  "not_found_reason",
  // Resolver / matrix internal terms
  "stableKey",
  "engineConfidence",
  "resolverTier",
  "needsHumanReview",
  "pageBrief",
  "suggestedEdits",
  "cannibalization",
  "matrixDateLabel",
  // Provider internals
  "providerName",
  "fetchImpl",
];

// ── Pattern detectors ─────────────────────────────────────────────────────

/**
 * RFC 4122 UUID (8-4-4-4-12 hex with hyphens). Same shape as the existing
 * sanitizer's pattern in `copy-sanitize.ts`. Case-insensitive.
 */
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/**
 * Multi-segment snake_case identifier — three or more underscore-
 * separated lowercase segments. Examples:
 *   live_match_confidence, target_element_key, page_intent_resolution
 * Body copy almost never contains three-segment snake_case. False
 * positives are vanishingly rare.
 */
const SNAKE_CASE_MULTI_RE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/;

/**
 * Suspicious double-segment snake_case suffixes — common database
 * column suffixes that don't appear in normal prose. Catches things
 * like `rec_id`, `live_at`, `evidence_tier` even though they're only
 * two segments.
 */
const SNAKE_CASE_SUSPICIOUS_RES: ReadonlyArray<RegExp> = [
  /\b[a-z][a-z0-9]+_id\b/,
  /\b[a-z][a-z0-9]+_at\b/,
  /\b[a-z][a-z0-9]+_tier\b/,
  /\b[a-z][a-z0-9]+_url\b/,
  /\b[a-z][a-z0-9]+_hash\b/,
  /\b[a-z][a-z0-9]+_key\b/,
  /\b[a-z][a-z0-9]+_status\b/,
  /\b[a-z][a-z0-9]+_kind\b/,
  /\b[a-z][a-z0-9]+_plan\b/,
  /\b[a-z][a-z0-9]+_label\b/,
];

/**
 * Multi-transition camelCase — an identifier with two or more
 * lowercase→Uppercase transitions. Examples:
 *   topSearchQueries (top + Search + Queries)
 *   aiSearchSignal   (ai + Search + Signal)
 *   actualSearchQueries
 *
 * Deliberately excludes single-transition camelCase (e.g., "iPhone",
 * "eBay", "macOS") because those are commonly legitimate brand /
 * product names that may appear in customer copy. Two+ transitions
 * is the operational tell of a programming identifier.
 */
const CAMEL_CASE_MULTI_TRANSITION_RE =
  /\b[a-z][a-z0-9]*[A-Z][a-z0-9]+[A-Z][a-zA-Z0-9]*\b/;

// ── Public API ────────────────────────────────────────────────────────────

export type DisplayGuardReason =
  | "uuid"
  | "internal_token"
  | "snake_case_identifier"
  | "camel_case_identifier";

export type DisplayGuardResult =
  | { safe: true }
  | {
      safe: false;
      reason: DisplayGuardReason;
      /** The first matched substring — useful for diagnostics and tests. */
      match: string;
    };

/**
 * Check whether a customer-facing string is safe to render verbatim.
 * Returns `{ safe: true }` for null/empty/whitespace-only inputs (the
 * caller decides what to do when there's no copy at all).
 */
export function checkCopyDisplaySafe(
  text: string | null | undefined,
): DisplayGuardResult {
  if (typeof text !== "string" || text.trim().length === 0) {
    return { safe: true };
  }

  const uuidMatch = text.match(UUID_RE);
  if (uuidMatch) {
    return { safe: false, reason: "uuid", match: uuidMatch[0] };
  }

  for (const token of HARD_BLOCKED_TOKENS) {
    const re = new RegExp(
      "\\b" + token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b",
    );
    const m = text.match(re);
    if (m) {
      return { safe: false, reason: "internal_token", match: m[0] };
    }
  }

  const snakeMulti = text.match(SNAKE_CASE_MULTI_RE);
  if (snakeMulti) {
    return {
      safe: false,
      reason: "snake_case_identifier",
      match: snakeMulti[0],
    };
  }

  for (const re of SNAKE_CASE_SUSPICIOUS_RES) {
    const m = text.match(re);
    if (m) {
      return {
        safe: false,
        reason: "snake_case_identifier",
        match: m[0],
      };
    }
  }

  const camelMulti = text.match(CAMEL_CASE_MULTI_TRANSITION_RE);
  if (camelMulti) {
    return {
      safe: false,
      reason: "camel_case_identifier",
      match: camelMulti[0],
    };
  }

  return { safe: true };
}

/**
 * Convenience: run the guard on every supplied string and return true
 * only if ALL pass. Useful for tiles with multiple fields (e.g., a FAQ
 * tile has question + answer; a title_meta tile has title + meta).
 */
export function allCopyDisplaySafe(
  ...texts: ReadonlyArray<string | null | undefined>
): boolean {
  for (const t of texts) {
    if (!checkCopyDisplaySafe(t).safe) return false;
  }
  return true;
}
