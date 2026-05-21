/**
 * Slice 4.5.G-B.1 (2026-05-21) — render-time guard for the customer-
 * visible `why` field on recommendation surfaces.
 *
 * Defense-in-depth against production audit findings (4.5.G-A.2):
 *   • 10 UUID leaks in `why` (all customer-visible)
 *   • 5 internal-token leaks in `why` (e.g. `aiSearchSignal`)
 *   • 1 active competitor-name leak in `why` (Greenberg Construction)
 *
 * Mirrors the existing `suggested-copy-display-guard.ts` pattern but
 * applied to the `why` string (which today renders unguarded on the
 * detail page header + Act 2, Act 4 "why this copy" hint, the v2
 * card stack, and the legacy list drawer).
 *
 * Pure / deterministic / no I/O / no LLM / no Supabase / no
 * mutation. The guard never modifies stored data; on a blocked
 * input it returns a calm operator-readable fallback string for
 * the customer-facing render. Operator-only diagnostic surfaces
 * (e.g. `/diagnostics/recommendation-safety-audit`) continue to
 * render raw `why` values directly — the diagnostic is the point.
 *
 * Slice 4.5.G-B.1 is intentionally NARROW:
 *   • Blocks uuid_leak / long_hex_hash / internal_token /
 *     competitor_name (the 4 high-severity audit kinds).
 *   • Does NOT block `unsupported_claim` (e.g. "best") — needs
 *     field-aware decision deferred to 4.5.G-B.4.
 *   • Does NOT block `architect_overclaim` (e.g. "architect-led")
 *     — needs per-tenant brand-assertion-aware decision deferred.
 *   • Does NOT block em-dash / leading-superlative — low severity
 *     in audit findings; not in B.1 scope.
 *
 * Pinned by:
 *   • tests/domains/recommendations/why-display-guard.test.ts
 *   • tests/architecture/recommendation-why-render-guard.test.ts
 *   • Existing `recommendation-safety-audit-coverage` invariant
 *     (the audit scanner still flags these kinds in any leftover
 *     historical rows for operator visibility).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WhyDisplayGuardReason =
  | "uuid_leak"
  | "long_hex_hash"
  | "internal_token"
  | "competitor_name";

export type WhyDisplayGuardOk = {
  ok: true;
  text: string;
};

export type WhyDisplayGuardBlocked = {
  ok: false;
  fallback: string;
  reasons: ReadonlyArray<WhyDisplayGuardReason>;
};

export type WhyDisplayGuardResult = WhyDisplayGuardOk | WhyDisplayGuardBlocked;

export type WhyDisplayGuardContext = {
  /** Active competitor names from `tracked_entities`. Optional — if
   *  omitted or empty, competitor-name detection is inactive. */
  competitorNames?: ReadonlyArray<string>;
};

// ---------------------------------------------------------------------------
// Locked detection tokens
// ---------------------------------------------------------------------------

/**
 * The operator-readable fallback rendered when any reason fires.
 * Mirrors the tone of the existing `suggested-copy-display-guard`
 * fallback ("Beacon has a draft for this recommendation, but it
 * needs review before showing here.").
 */
export const WHY_DISPLAY_GUARD_FALLBACK =
  "Beacon has additional context for this recommendation, but it needs review before showing here.";

// Internal taxonomy tokens — case-sensitive whole-substring matches.
// These are field/symbol names from the recommendation pipeline that
// must never reach customer-facing copy on `why`. Kept tight to the
// 4.5.G-A audit findings (the production scan found `aiSearchSignal`
// leakage in 5 rows; the rest are defense-in-depth).
const INTERNAL_TOKENS: ReadonlyArray<string> = [
  "aiSearchSignal",
  "actualSearchQueries",
  "action_type",
  "trigger_signal",
  "evidence_tier",
  "Mode A",
  "Mode B",
  "Mode C",
  "rec_id",
  "source_rec_id",
  "diagnostic_only",
  "customer-queue-ready",
];

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const LONG_HEX_HASH_RE = /\b[0-9a-f]{32,}\b/i;

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export function checkWhyDisplaySafe(
  why: string | null | undefined,
  context: WhyDisplayGuardContext = {},
): WhyDisplayGuardResult {
  // Empty input — pass through as an empty `ok` result. Callers
  // typically guard for null/empty separately (and skip rendering),
  // but the guard handles it defensively for symmetry.
  if (why == null || typeof why !== "string" || why.length === 0) {
    return { ok: true, text: typeof why === "string" ? why : "" };
  }

  const reasons: WhyDisplayGuardReason[] = [];

  if (UUID_RE.test(why)) {
    reasons.push("uuid_leak");
  }

  if (LONG_HEX_HASH_RE.test(why)) {
    // Avoid double-counting if the UUID regex already matched a
    // canonical UUID (which is also a hex string). The audit
    // scanner emits both kinds for the same row; the guard collapses
    // them into one reason set so the fallback fires once.
    if (!reasons.includes("uuid_leak")) {
      reasons.push("long_hex_hash");
    }
  }

  for (const tok of INTERNAL_TOKENS) {
    if (why.includes(tok)) {
      reasons.push("internal_token");
      break;
    }
  }

  if (context.competitorNames && context.competitorNames.length > 0) {
    const lowered = why.toLowerCase();
    for (const raw of context.competitorNames) {
      const name = (raw ?? "").trim().toLowerCase();
      if (name.length === 0) continue;
      // Whole-word boundary match. `\b` anchors against word chars
      // on either side; safe for the brand-name shapes Beacon
      // tracks (e.g. "Greenberg Construction", "De Mattei").
      const re = new RegExp(
        `\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
        "i",
      );
      if (re.test(lowered) || re.test(why)) {
        reasons.push("competitor_name");
        break;
      }
    }
  }

  if (reasons.length === 0) {
    return { ok: true, text: why };
  }

  return {
    ok: false,
    fallback: WHY_DISPLAY_GUARD_FALLBACK,
    reasons,
  };
}
