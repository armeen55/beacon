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
 * Hard contract: pure / deterministic / no I/O / no LLM / no network /
 * no Supabase / no mutation. Returns a structured violation list;
 * the caller (operator-only diagnostic surface) decides what to do
 * with it (display only; never auto-rewrite).
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

export type SafetyViolation = {
  kind: SafetyViolationKind;
  field: SafetyViolationField;
  matched_text: string;
  severity: SafetyViolationSeverity;
  context_excerpt: string;
};

export type SafetyAuditResult = {
  rec_id: string;
  target_url: string | null;
  violations: ReadonlyArray<SafetyViolation>;
  scanned_at: string;
};

export type SafetyAuditContext = {
  competitorNames: ReadonlyArray<string>;
  tenantId: string;
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

const UNSUPPORTED_CLAIM_TOKENS: ReadonlyArray<string> = [
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

  // Unsupported claims — case-insensitive whole-word
  for (const tok of UNSUPPORTED_CLAIM_TOKENS) {
    pushViolationsForLiteral(
      text,
      field,
      "unsupported_claim",
      tok,
      true,
      true,
      out,
    );
  }

  // Architect / licensing overclaim — case-insensitive whole-word
  for (const tok of ARCHITECT_OVERCLAIM_TOKENS) {
    pushViolationsForLiteral(
      text,
      field,
      "architect_overclaim",
      tok,
      true,
      true,
      out,
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
