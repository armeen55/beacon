/**
 * Slice 4.5.G-A (2026-05-21) — recommendation safety audit scanner.
 *
 * Pure read-only function that scans a persisted `RecommendedEditRow`
 * for safety violations across the 9 locked violation kinds:
 *
 *   • placeholder           — TODO / FIXME / lorem ipsum / TBD / [insert ...]
 *   • competitor_name       — any operator-tracked competitor mention
 *   • unsupported_claim     — "best" / "#1" / "leading" / "premier" / "guaranteed"
 *   • architect_overclaim   — "architect-led" / "licensed" / "certified" / etc.
 *   • causal_language       — "drove" / "caused" / "revenue" / "leads"
 *   • em_dash               — literal U+2014
 *   • leading_superlative   — copy STARTS with "Best " / "The best " / "#1 " / "Leading "
 *   • internal_token        — Beacon internal taxonomy ("action_type" / "Mode A" / etc.)
 *   • uuid_leak             — UUID or 32+ hex char hash-like string
 *
 * Defense-in-depth alongside the existing LLM-write-time validator,
 * the Suggested Copy display guard, and the customer-copy vocab
 * architecture invariant. Catches HISTORICAL rows that predate the
 * current validator set + any future regression.
 *
 * Slice 4.5.G-B.4a (2026-05-22) — GENERIC claim-risk classification.
 * `architect_overclaim` + `unsupported_claim` violations are now
 * CLASSIFIED (never suppressed) against tenant-supplied brand
 * assertions passed in via `context.brandAssertions`. Each such
 * violation carries `brand_supported` (true/false), the supporting
 * `brand_assertion_ids`, the `normalized_match`, and the
 * tenant-agnostic `claim_risk_category`. The scanner stays
 * IMPORT-FREE and TENANT-AGNOSTIC: it owns a GLOBAL claim-risk
 * registry (token → risk category) + a GLOBAL unlock map (risk
 * category → assertion categories that unlock it), and classifies
 * via the supplied assertions only. It NEVER imports brand-assertions,
 * never imports getBrandAssertions, never imports business-config,
 * and never branches on a tenant name. The diagnostic page resolves
 * `getBrandAssertions(tenantId)` at the boundary and passes the
 * structural shape in. No assertions supplied → `brand_supported`
 * defaults false (the safe default; preserves pre-B.4a behavior).
 *
 * Hard contract: pure / deterministic / no I/O / no LLM / no network /
 * no Supabase / no mutation. Returns a structured violation list;
 * the caller (operator-only diagnostic surface) decides what to do
 * with it (display only; never auto-rewrite). NO violation is ever
 * suppressed — classification only.
 *
 * Pinned by:
 *   • tests/domains/recommendation-intelligence/safety-audit.test.ts
 *   • tests/architecture/recommendation-safety-audit-read-only.test.ts
 *   • tests/architecture/recommendation-safety-audit-coverage.test.ts
 */

// ---------------------------------------------------------------------------
// Local row-shape interface — keeps the scanner zero-dependency on
// the persistence module (the architecture invariant
// `recommendation-safety-audit-read-only` forbids any reference to
// the persistence module here). Structural typing means a full
// `RecommendedEditRow` (from the persistence module) is assignable
// to `AuditableEditRow` at the call site without explicit cast.
// ---------------------------------------------------------------------------

export type AuditableEditRow = {
  rec_id: string;
  target_url: string | null;
  proposed_text: string | null;
  why: string;
  display_label: string | null;
  expected_impact: string | null;
  measurement_plan: string | null;
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SafetyViolationKind =
  | "placeholder"
  | "competitor_name"
  | "unsupported_claim"
  | "architect_overclaim"
  | "causal_language"
  | "em_dash"
  | "leading_superlative"
  | "internal_token"
  | "uuid_leak";

export type SafetyViolationField =
  | "proposed_text"
  | "customer_copy"
  | "operator_evidence"
  | "topic_cluster_label"
  | "why";

export type SafetyViolationSeverity = "high" | "medium" | "low";

/**
 * GLOBAL, tenant-agnostic claim-risk categories. Every
 * `architect_overclaim` / `unsupported_claim` token maps to exactly
 * one of these (see `CLAIM_RISK_BY_TOKEN`). The scanner owns this
 * taxonomy; it is NOT a brand-assertion category and never references
 * a tenant.
 */
export type ClaimRiskCategory =
  | "professional_credential"
  | "process"
  | "ranking"
  | "award"
  | "guarantee_outcome"
  | "superiority";

export type SafetyViolation = {
  kind: SafetyViolationKind;
  field: SafetyViolationField;
  matched_text: string;
  severity: SafetyViolationSeverity;
  context_excerpt: string;
  /**
   * Slice 4.5.G-B.4a — claim-risk classification. Present ONLY on
   * `architect_overclaim` + `unsupported_claim` violations. All other
   * kinds (uuid_leak / internal_token / competitor_name / placeholder
   * / em_dash / leading_superlative / causal_language) leave these
   * undefined — their behavior is unchanged.
   */
  brand_supported?: boolean;
  brand_assertion_ids?: string[];
  normalized_match?: string;
  claim_risk_category?: ClaimRiskCategory;
};

export type SafetyAuditResult = {
  rec_id: string;
  target_url: string | null;
  violations: ReadonlyArray<SafetyViolation>;
  scanned_at: string;
};

/**
 * Tenant-supplied brand assertion — LOCAL STRUCTURAL shape. The
 * scanner deliberately does NOT import `BrandAssertion` from
 * `@/domains/recommendations/brand-assertions` (that would couple the
 * pure scanner to the brand-assertion module + break the read-only
 * import boundary). The diagnostic page maps `getBrandAssertions(...)`
 * onto this shape and passes it via `context.brandAssertions`.
 */
export type SafetyAuditBrandAssertion = {
  id?: string;
  phrase: string;
  category: string;
};

export type SafetyAuditContext = {
  competitorNames: ReadonlyArray<string>;
  tenantId: string;
  /**
   * Slice 4.5.G-B.4a — optional tenant brand assertions for
   * claim-risk classification. When omitted, every classifiable
   * violation defaults `brand_supported: false` (safe default).
   */
  brandAssertions?: ReadonlyArray<SafetyAuditBrandAssertion>;
  now?: Date;
};

// ---------------------------------------------------------------------------
// Locked token sets (per α₁b₂-B operator decisions K3 + K4)
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\blorem ipsum\b/i,
  /\bplaceholder\b/i,
  /\bTBD\b/i,
  /\{\{[^{}]+\}\}/,
  /\[insert\b[^\]]*\]/i,
  /<placeholder\b[^>]*>/i,
];

export const ARCHITECT_OVERCLAIM_TOKENS: ReadonlyArray<string> = [
  "architect-led",
  "architect-designed",
  "licensed",
  "licensed architect",
  "accredited",
  "certified",
  "endorsed",
  "master craftsman",
  "award-winning",
  "top-rated",
];

export const UNSUPPORTED_CLAIM_TOKENS: ReadonlyArray<string> = [
  "best",
  "#1",
  "number one",
  "leading",
  "premier",
  "guaranteed",
  "proven",
  "guaranteed results",
];

export const CAUSAL_LANGUAGE_TOKENS: ReadonlyArray<string> = [
  "drove",
  "caused",
  "generated",
  "revenue",
  "roi",
  "leads",
  "sales",
  "converted",
  "produced",
];

const INTERNAL_TOKEN_PATTERNS: ReadonlyArray<string> = [
  "action_type",
  "trigger_signal",
  "evidence_tier",
  "Mode A",
  "Mode B",
  "Mode C",
  "aiSearchSignal",
  "primary recommendation",
  "diagnostic_only",
  "customer-queue-ready",
];

const LEADING_SUPERLATIVE_PREFIXES: ReadonlyArray<string> = [
  "Best ",
  "The best ",
  "#1 ",
  "Leading ",
];

const EM_DASH = "—";
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const LONG_HEX_HASH_RE = /\b[0-9a-f]{32,}\b/i;

// ---------------------------------------------------------------------------
// Slice 4.5.G-B.4a — GLOBAL claim-risk registry (tenant-agnostic).
//
// Maps every architect_overclaim + unsupported_claim token to exactly
// one global `ClaimRiskCategory`. This is the GLOBAL risk-pattern half
// of the model — it knows NOTHING about any tenant. Adding a new token
// to either token set REQUIRES a matching entry here (pinned by the
// coverage invariant) so a future term can never ship unclassified.
// ---------------------------------------------------------------------------

const CLAIM_RISK_BY_TOKEN: Readonly<Record<string, ClaimRiskCategory>> = {
  // architect_overclaim tokens
  "architect-led": "process",
  "architect-designed": "process",
  licensed: "professional_credential",
  "licensed architect": "professional_credential",
  accredited: "professional_credential",
  certified: "professional_credential",
  endorsed: "professional_credential",
  "master craftsman": "professional_credential",
  "award-winning": "award",
  "top-rated": "ranking",
  // unsupported_claim tokens
  best: "superiority",
  "#1": "ranking",
  "number one": "ranking",
  leading: "superiority",
  premier: "superiority",
  guaranteed: "guarantee_outcome",
  proven: "guarantee_outcome",
  "guaranteed results": "guarantee_outcome",
};

// ---------------------------------------------------------------------------
// GLOBAL unlock map — which brand-assertion CATEGORY STRINGS unlock each
// claim-risk category. These are plain strings compared against the
// supplied assertions' `category` field; the scanner does NOT import the
// `BrandAssertionCategory` enum. `professional_credential` +
// `guarantee_outcome` have NO category unlock today — they can only be
// supported by an explicit phrase match (e.g. a tenant whose assertion
// phrase literally contains "licensed architects"). A dedicated
// `credentials` assertion category is deferred to Slice 4.5.G-B.4d.
// ---------------------------------------------------------------------------

const EMPTY_UNLOCK: ReadonlySet<string> = new Set<string>();
const CLAIM_RISK_UNLOCK: Readonly<Record<ClaimRiskCategory, ReadonlySet<string>>> = {
  process: new Set(["process"]),
  professional_credential: EMPTY_UNLOCK,
  ranking: new Set(["ranking_first"]),
  award: new Set(["award"]),
  superiority: new Set(["ranking_first"]),
  guarantee_outcome: EMPTY_UNLOCK,
};

/**
 * Per-violation claim-risk classification attached to
 * `architect_overclaim` / `unsupported_claim` violations only.
 */
type ViolationClassification = {
  brand_supported?: boolean;
  brand_assertion_ids?: string[];
  normalized_match?: string;
  claim_risk_category?: ClaimRiskCategory;
};

/**
 * GENERIC brand-support classifier. Given a normalized risky term, its
 * global claim-risk category, and the tenant-supplied assertions,
 * decides `brand_supported` + the supporting assertion ids.
 *
 * `brand_supported` is TRUE when at least one supplied assertion either
 *   (a) has a `phrase` (case-insensitively) CONTAINING the term, OR
 *   (b) has a `category` in the term's claim-risk unlock set.
 * Otherwise FALSE. No assertions supplied → FALSE (safe default).
 *
 * Tenant-agnostic: identical logic for every tenant; the only input
 * that differs is the supplied `brandAssertions`. NEVER suppresses —
 * the caller still emits the violation, now tagged.
 */
function classifyClaim(
  normalizedTerm: string,
  claimRiskCategory: ClaimRiskCategory,
  brandAssertions: ReadonlyArray<SafetyAuditBrandAssertion> | undefined,
): { brand_supported: boolean; brand_assertion_ids: string[] } {
  if (!brandAssertions || brandAssertions.length === 0) {
    return { brand_supported: false, brand_assertion_ids: [] };
  }
  const term = normalizedTerm.toLowerCase();
  const unlock = CLAIM_RISK_UNLOCK[claimRiskCategory] ?? EMPTY_UNLOCK;
  let supported = false;
  const ids: string[] = [];
  for (const a of brandAssertions) {
    const phraseMatch =
      typeof a.phrase === "string" && a.phrase.toLowerCase().includes(term);
    const categoryMatch =
      typeof a.category === "string" && unlock.has(a.category);
    if (phraseMatch || categoryMatch) {
      supported = true;
      if (typeof a.id === "string" && a.id.length > 0) ids.push(a.id);
    }
  }
  return { brand_supported: supported, brand_assertion_ids: ids };
}

/**
 * Build the full `ViolationClassification` for a risky token: resolve
 * its global claim-risk category, normalize the match, and classify
 * brand support against the supplied assertions. Every architect /
 * unsupported token is registered in `CLAIM_RISK_BY_TOKEN` (pinned by
 * the coverage invariant); an unmapped token falls back to
 * `superiority` with phrase-match-only support (defensive — should
 * never happen).
 */
function classificationForToken(
  token: string,
  brandAssertions: ReadonlyArray<SafetyAuditBrandAssertion> | undefined,
): ViolationClassification {
  const normalized = token.toLowerCase();
  const claimRiskCategory: ClaimRiskCategory =
    CLAIM_RISK_BY_TOKEN[token] ?? "superiority";
  const { brand_supported, brand_assertion_ids } = classifyClaim(
    normalized,
    claimRiskCategory,
    brandAssertions,
  );
  return {
    normalized_match: normalized,
    claim_risk_category: claimRiskCategory,
    brand_supported,
    brand_assertion_ids,
  };
}

// Per K4: severity bands
const HIGH_SEVERITY: ReadonlySet<SafetyViolationKind> = new Set([
  "placeholder",
  "competitor_name",
  "uuid_leak",
]);
const MEDIUM_SEVERITY: ReadonlySet<SafetyViolationKind> = new Set([
  "unsupported_claim",
  "architect_overclaim",
  "causal_language",
]);

function severityFor(kind: SafetyViolationKind): SafetyViolationSeverity {
  if (HIGH_SEVERITY.has(kind)) return "high";
  if (MEDIUM_SEVERITY.has(kind)) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Per-field scan helpers (pure)
// ---------------------------------------------------------------------------

function contextOf(text: string, matchIndex: number, matchLen: number): string {
  const half = 30;
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, matchIndex + matchLen + half);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}

function pushViolationsForRegex(
  text: string,
  field: SafetyViolationField,
  kind: SafetyViolationKind,
  re: RegExp,
  out: SafetyViolation[],
): void {
  // Always work on a fresh regex with `g` flag so we collect all matches.
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const scan = new RegExp(re.source, flags);
  let m: RegExpExecArray | null;
  while ((m = scan.exec(text)) !== null) {
    out.push({
      kind,
      field,
      matched_text: m[0],
      severity: severityFor(kind),
      context_excerpt: contextOf(text, m.index, m[0].length),
    });
    if (m[0].length === 0) scan.lastIndex++;
  }
}

const WORD_CHAR_RE = /\w/;

function pushViolationsForLiteral(
  text: string,
  field: SafetyViolationField,
  kind: SafetyViolationKind,
  needle: string,
  caseInsensitive: boolean,
  wholeWord: boolean,
  out: SafetyViolation[],
  // Slice 4.5.G-B.4a — optional classification fields merged onto each
  // emitted violation (used for architect_overclaim / unsupported_claim).
  classification?: ViolationClassification,
): void {
  if (needle.length === 0) return;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `\b` is a word↔non-word boundary; it only fires when one side
  // is `\w` and the other is `\W`. Tokens like `#1` or `architect-
  // led` that begin or end with a non-word character would never
  // match if we naively prefixed/suffixed `\b` on both sides.
  // Apply the boundary only on the side that actually contains a
  // word character; otherwise this side gets no boundary constraint.
  const firstIsWord = WORD_CHAR_RE.test(needle[0]!);
  const lastIsWord = WORD_CHAR_RE.test(needle[needle.length - 1]!);
  const leftBoundary = wholeWord && firstIsWord ? "\\b" : "";
  const rightBoundary = wholeWord && lastIsWord ? "\\b" : "";
  const pattern = `${leftBoundary}${escaped}${rightBoundary}`;
  const flags = caseInsensitive ? "gi" : "g";
  const re = new RegExp(pattern, flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      kind,
      field,
      matched_text: m[0],
      severity: severityFor(kind),
      context_excerpt: contextOf(text, m.index, m[0].length),
      ...(classification ?? {}),
    });
    if (m[0].length === 0) re.lastIndex++;
  }
}

function scanField(
  text: string | null | undefined,
  field: SafetyViolationField,
  context: SafetyAuditContext,
  out: SafetyViolation[],
): void {
  if (text == null || text.length === 0) return;

  // Placeholder (regex set)
  for (const re of PLACEHOLDER_PATTERNS) {
    pushViolationsForRegex(text, field, "placeholder", re, out);
  }

  // Competitor names — case-insensitive whole-word
  for (const name of context.competitorNames) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    pushViolationsForLiteral(
      text,
      field,
      "competitor_name",
      trimmed,
      /* caseInsensitive */ true,
      /* wholeWord */ true,
      out,
    );
  }

  // Unsupported claims — case-insensitive whole-word.
  // B.4a: classify each match against tenant-supplied assertions (tag,
  // never suppress). Classification is computed ONCE per token (it does
  // not vary by occurrence) and merged onto every emitted violation.
  for (const tok of UNSUPPORTED_CLAIM_TOKENS) {
    pushViolationsForLiteral(
      text,
      field,
      "unsupported_claim",
      tok,
      true,
      true,
      out,
      classificationForToken(tok, context.brandAssertions),
    );
  }

  // Architect / licensing overclaim — case-insensitive whole-word.
  // B.4a: same generic classification as unsupported_claim above.
  for (const tok of ARCHITECT_OVERCLAIM_TOKENS) {
    pushViolationsForLiteral(
      text,
      field,
      "architect_overclaim",
      tok,
      true,
      true,
      out,
      classificationForToken(tok, context.brandAssertions),
    );
  }

  // Causal language — case-insensitive whole-word
  for (const tok of CAUSAL_LANGUAGE_TOKENS) {
    pushViolationsForLiteral(
      text,
      field,
      "causal_language",
      tok,
      true,
      true,
      out,
    );
  }

  // Em dash — literal U+2014
  if (text.includes(EM_DASH)) {
    const idx = text.indexOf(EM_DASH);
    out.push({
      kind: "em_dash",
      field,
      matched_text: EM_DASH,
      severity: severityFor("em_dash"),
      context_excerpt: contextOf(text, idx, 1),
    });
  }

  // Leading superlative — prefix match (case-sensitive per locked patterns)
  for (const prefix of LEADING_SUPERLATIVE_PREFIXES) {
    if (text.startsWith(prefix)) {
      out.push({
        kind: "leading_superlative",
        field,
        matched_text: prefix.trimEnd(),
        severity: severityFor("leading_superlative"),
        context_excerpt: contextOf(text, 0, prefix.length),
      });
      break; // one leading-superlative violation per field
    }
  }

  // Internal tokens — case-sensitive substring (some are camelCase)
  for (const tok of INTERNAL_TOKEN_PATTERNS) {
    pushViolationsForLiteral(
      text,
      field,
      "internal_token",
      tok,
      /* caseInsensitive */ false,
      /* wholeWord */ false,
      out,
    );
  }

  // UUID leak
  pushViolationsForRegex(text, field, "uuid_leak", UUID_RE, out);
  // Long hex hash-like leak (32+ contiguous hex chars; conservative)
  pushViolationsForRegex(text, field, "uuid_leak", LONG_HEX_HASH_RE, out);
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export function auditRecommendedEditRow(
  row: AuditableEditRow,
  context: SafetyAuditContext,
): SafetyAuditResult {
  const out: SafetyViolation[] = [];
  // Read row fields we want to audit. `topic_cluster_label` is not
  // present on RecommendedEditRow today; the field name remains in
  // the union for forward-compat (a future column or a derived
  // surface might carry it). For now we only scan the 4 fields that
  // exist on the row schema.
  scanField(row.proposed_text, "proposed_text", context, out);
  scanField(row.why, "why", context, out);
  // `current_text` is the customer's existing copy — not Beacon-
  // generated — so it intentionally is NOT scanned (it represents
  // pre-existing site content the operator may or may not own).
  // `display_label` is the operator-facing label; scan as
  // `operator_evidence` (closest existing field semantic).
  scanField(row.display_label, "operator_evidence", context, out);
  // `expected_impact` + `measurement_plan` could contain customer-
  // facing copy in future surfaces; scan them as `customer_copy`
  // for defense-in-depth.
  scanField(row.expected_impact, "customer_copy", context, out);
  scanField(row.measurement_plan, "customer_copy", context, out);

  const now = context.now ?? new Date();
  return {
    rec_id: row.rec_id,
    target_url: row.target_url ?? null,
    violations: out,
    scanned_at: now.toISOString(),
  };
}
