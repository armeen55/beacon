/**
 * 2026-05-14 Phase A.3 Step 1 — indexability verdict types.
 *
 * Pure type-only module. Defines the per-URL composite verdict
 * Beacon publishes when answering "is this page reachable + indexable
 * + AI-crawler-accessible?" and the raw signal shape used to derive it.
 *
 * This module is the structural seam between:
 *   • A.3.3 loader — joins existing `PageSnapshot` + robots-parser +
 *     sitemap reconciliation signals into the input shape and feeds
 *     `computeIndexability`.
 *   • A.3.4 stuck-stage flip — `lifecycle-stage.stuck` rows on
 *     Changes detail Act 3 render per-verdict copy variants
 *     (Section 4.8) instead of the bridge phrase.
 *   • A.3.5 operator-only diagnostic surface — reads the full
 *     `OwnedUrlIndexability.signals` block (raw HTTP status,
 *     canonical, robots_meta, per-bot robots.txt allow/deny) so an
 *     operator can triage the decision tree without re-running a
 *     scan.
 *
 * Maximum-extraction principle (operator-locked, 2026-05-14):
 *   `signals` retains every raw input value used by the verdict
 *   computer — http_status, canonical_url, has_canonical_mismatch,
 *   raw robots_meta string, per-bot robots.txt allow/deny booleans,
 *   sitemap membership boolean + sitemap_url, fetched_at,
 *   extraction_certainty. Customer copy maps only `composite_verdict`
 *   to English; operator diagnostics can drill into `signals` for
 *   the full picture. Do NOT prune fields from `signals` without an
 *   explicit operator-locked decision.
 *
 * Reserved verdicts:
 *   `not_indexed_in_gsc` and `indexed_but_not_cited` are reserved
 *   for the future GSC integration (deferred per the A.3 pre-flight
 *   §3 split). The v1 `computeIndexability` MUST NOT produce these
 *   values; tests pin this contract. They appear in the enum so the
 *   downstream copy + loader contracts can be written once, with
 *   the GSC half filling them in later without an enum change.
 */

// ─────────────────────────────────────────────────────────────────────
// Verdict enum
// ─────────────────────────────────────────────────────────────────────

export type IndexabilityVerdict =
  | "ok"
  | "not_in_sitemap"
  | "blocked_by_robots_for_ai"
  | "blocked_by_robots_for_googlebot"
  | "noindex_meta"
  | "bad_status_code"
  | "canonical_elsewhere"
  /** Reserved — GSC ground truth says the URL is not indexed in
   *  Google. A.3.1 does NOT produce this; A.3.b1 (GSC) fills it. */
  | "not_indexed_in_gsc"
  /** Reserved — page is indexed in Google but AI has not cited it
   *  yet. A.3.1 does NOT produce this; A.3.b1 (GSC) fills it. */
  | "indexed_but_not_cited"
  | "unknown";

// ─────────────────────────────────────────────────────────────────────
// Raw signal sub-shapes (operator-side; maximum-extraction)
// ─────────────────────────────────────────────────────────────────────

/**
 * Sitemap membership signal. `in_sitemap === null` means Beacon has
 * not yet checked the tenant's sitemap (e.g. crawler never ran).
 * `sitemap_url` carries the canonical sitemap URL Beacon checked
 * against, for operator triage.
 */
export type IndexabilitySitemapSignal = {
  in_sitemap: boolean | null;
  sitemap_url: string | null;
};

/**
 * robots.txt allow/deny verdict per crawler. `null` means Beacon
 * never resolved a rule for that bot (most often: no robots.txt
 * fetched yet, or the file 404'd which the parser treats as
 * "no rules", surfaced upstream).
 *
 * Googlebot is intentionally separated from the AI-bot family:
 *   • Googlebot blocking is the discoverability-floor signal
 *     (without Googlebot, AI Overviews + ChatGPT browse can't
 *     reach the page).
 *   • AI bots (GPTBot / PerplexityBot / ClaudeBot / Google-Extended)
 *     are the AEO-specific signal — blocking these is a silent
 *     AEO killer even when classical SEO looks fine.
 */
export type IndexabilityRobotsSignal = {
  googlebot_allowed: boolean | null;
  gptbot_allowed: boolean | null;
  perplexitybot_allowed: boolean | null;
  claudebot_allowed: boolean | null;
  google_extended_allowed: boolean | null;
};

/**
 * Page-fetch signals. Mirrors the relevant subset of
 * `PageSnapshot` (`src/domains/pages/types.ts`). All fields
 * nullable so the upstream loader can pass a partial snapshot
 * (`null` for "not yet fetched") and the verdict computer
 * short-circuits to `unknown`.
 *
 *   • `noindex_detected` is the parsed boolean — the computer
 *     populates it during noindex parsing (the loader passes the
 *     raw `robots_meta` only). Surfaced on the result for operator
 *     diagnostics.
 *   • `extraction_certainty` lets a future copy variant warn
 *     "the snapshot is uncertain — re-scan recommended" when a
 *     verdict was decided on `uncertain` data.
 */
export type IndexabilityPageSnapshotSignal = {
  http_status: number | null;
  canonical_url: string | null;
  has_canonical_mismatch: boolean | null;
  /** Raw `<meta name="robots" content="...">` value, verbatim. */
  robots_meta: string | null;
  /** Parsed boolean — true iff `robots_meta` contains a `noindex`
   *  token (case-insensitive, whitespace-tolerant). Populated by
   *  `computeIndexability` for operator transparency. */
  noindex_detected: boolean | null;
  fetched_at: string | null;
  extraction_certainty: "confirmed" | "uncertain" | null;
};

/**
 * GSC signal placeholder. Always `null` in v1; A.3.b1 fills.
 * Lives here so the loader + diagnostic surface can be written
 * against the final shape today.
 */
export type IndexabilityGscSignal = null;

export type IndexabilitySignals = {
  sitemap_membership: IndexabilitySitemapSignal;
  robots_txt: IndexabilityRobotsSignal;
  page_snapshot: IndexabilityPageSnapshotSignal | null;
  gsc: IndexabilityGscSignal;
};

// ─────────────────────────────────────────────────────────────────────
// Composite result
// ─────────────────────────────────────────────────────────────────────

/**
 * Per-URL indexability composite. Returned by
 * `computeIndexability`. Carries:
 *   • `url` — caller-supplied identifier (canonicalized upstream).
 *   • `composite_verdict` — single-string customer-mappable enum.
 *   • `signals` — every raw input value Beacon used (operator
 *     diagnostic transparency).
 *   • `last_computed_at` — ISO timestamp of when this result was
 *     produced (caller's `now`).
 *   • `evidence_freshness_days` — UTC-day delta between
 *     `page_snapshot.fetched_at` and `now`. Null when fetched_at
 *     is missing or unparseable.
 */
export type OwnedUrlIndexability = {
  url: string;
  composite_verdict: IndexabilityVerdict;
  signals: IndexabilitySignals;
  last_computed_at: string;
  evidence_freshness_days: number | null;
};
