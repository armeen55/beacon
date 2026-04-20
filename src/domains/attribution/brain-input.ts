/**
 * Phase 2D — Shared-brain input boundary.
 *
 * This file is the ONE PLACE where stored attribution outcomes cross from a
 * tenant-scoped world into the cross-tenant aggregation layer. Nothing else in
 * Beacon's codebase should hand a `StoredChangeOutcome` to the shared-brain
 * aggregator — always go through `sanitizeStoredOutcomeForBrain()`.
 *
 * ====================== ANONYMIZATION CONTRACT ===========================
 *
 * WHAT IS ALLOWED INTO THE BRAIN:
 *   - primary_bucket / child_tags (global taxonomy enums)
 *   - url_type (generic archetype — `location`, `service`, `blog`, ...)
 *   - status, confidence, bundle_size (enums + small ints)
 *   - adjusted_lift_relative (relative lift only; NO absolute citation counts)
 *   - controls_used count
 *   - per-platform breakdown — relative lift + controls count only,
 *     platform names are global (ChatGPT / Perplexity / etc.)
 *   - warning_categories[] — categorized PREFIX only, never the full
 *     warning string (full strings contain URLs)
 *   - tenant_cohort — caller-supplied broad industry label
 *     (e.g. "custom_home_builder"), NOT a tenant ID or brand name
 *   - observation_month — treatment_date coarsened to YYYY-MM; day-level
 *     granularity stripped to defeat timing-correlation re-identification
 *
 * WHAT IS STRIPPED AT THIS BOUNDARY:
 *   - source_id, tenant_id, paired_with[], bundle_parent_id (tenant-linkable)
 *   - url, matched_control_urls, sparklines, per-platform raw counts (traffic-scale identifying)
 *   - warnings[] full strings, rationale (contain URLs in prose)
 *   - raw-block numbers (absolute counts for non-causal outcomes — they
 *     wouldn't contribute to causal claims anyway and they leak traffic scale)
 *   - treatment_date at day granularity
 *   - excluded_reasons per-URL counts (small N may re-identify; we aggregate
 *     warning CATEGORIES at the pattern level instead)
 *
 * INVARIANTS ENFORCED IN CODE:
 *   - `auditBrainObservation()` runs on every sanitized record and throws if
 *     any field contains a URL path, an http(s) URL, or a likely source_id.
 *   - The `BrainObservation` type has no field where a URL, absolute count,
 *     or free-text string can live. Breaking these rules requires a type
 *     change, which requires a PR review.
 *
 * =========================================================================
 */

import type {
  ConfidenceTier,
  PlatformLift,
  ResultStatus,
} from "./natural-controls";
import type { StoredChangeOutcome } from "./change-outcome-store";

// ---------------------------------------------------------------------------
// Sanitized shape — the ONLY shape the brain aggregator consumes
// ---------------------------------------------------------------------------

/** Per-platform relative-lift slice. Absolute counts are deliberately absent. */
export type BrainPerPlatform = {
  platform: string;
  /** Relative lift = adjusted_lift / baseline. Null when computed math did not produce a relative number. */
  adjusted_lift_relative: number | null;
  controls_used: number;
};

/** One sanitized observation. Safe to ship cross-tenant; no raw PII/URL/source_id. */
export type BrainObservation = {
  // taxonomy
  primary_bucket: string;
  child_tags: string[];
  bundle_size: number;

  // target archetype (NOT the URL)
  url_type: string | null;

  // verdict envelope (enums only)
  status: ResultStatus;
  confidence: ConfidenceTier;

  // evidence (only for computed; null for everything else)
  adjusted_lift_relative: number | null;
  controls_used: number | null;
  per_platform: BrainPerPlatform[];

  // warnings — CATEGORIES only, never full strings
  warning_categories: WarningCategory[];

  // cohort + coarse-grained time (both caller-supplied)
  tenant_cohort: string | null;
  observation_month: string; // "YYYY-MM"
};

/** Categorized warning prefix. Keep this list small and stable — it is the
 *  vocabulary for cross-tenant warning prevalence. */
export type WarningCategory =
  | "self_overlap"
  | "post_overlap"
  | "thin_controls"
  | "no_viable_controls"
  | "no_diff_in_diff"
  | "low_baseline"
  | "no_post_data"
  | "weak_estimate"
  | "treated_url_post_overlap"
  | "treated_url_self_overlap"
  | "other";

// ---------------------------------------------------------------------------
// Warning categorization — prefix-only
// ---------------------------------------------------------------------------

const WARNING_PREFIX_TO_CATEGORY: Array<[RegExp, WarningCategory]> = [
  [/^treated_url_self_overlap/i, "treated_url_self_overlap"],
  [/^treated_url_post_overlap/i, "treated_url_post_overlap"],
  [/^self_overlap/i, "self_overlap"],
  [/^post_overlap/i, "post_overlap"],
  [/^thin_control_set/i, "thin_controls"],
  [/^no_viable_controls/i, "no_viable_controls"],
  [/^no_diff_in_diff/i, "no_diff_in_diff"],
  [/^low_baseline/i, "low_baseline"],
  [/^no_post_data/i, "no_post_data"],
  [/^weak_estimate/i, "weak_estimate"],
  [/^no_controls_used/i, "no_viable_controls"],
];

export function categorizeWarning(warning: string): WarningCategory {
  for (const [regex, cat] of WARNING_PREFIX_TO_CATEGORY) {
    if (regex.test(warning)) return cat;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/** Coarsen an ISO date / timestamp to YYYY-MM. Strips day + time. */
function toObservationMonth(iso: string): string {
  return iso.length >= 7 ? iso.slice(0, 7) : iso;
}

/** Build a BrainPerPlatform from a PlatformLift, dropping absolute counts. */
function sanitizePlatform(p: PlatformLift): BrainPerPlatform {
  return {
    platform: p.platform,
    adjusted_lift_relative: p.relative_lift, // relative only
    controls_used: p.controls_used,
  };
}

/** Opaque cohort resolver — tenant-provided, not brand-identifying. */
export type CohortResolver = (outcome: StoredChangeOutcome) => string | null;

/**
 * Convert a `StoredChangeOutcome` into the brain-safe shape.
 *
 * Every field copy-through is deliberate. Every drop is deliberate.
 * Run `auditBrainObservation()` on the result if in doubt — it throws when
 * any URL, http reference, or likely source_id pattern leaks through.
 */
export function sanitizeStoredOutcomeForBrain(
  outcome: StoredChangeOutcome,
  cohortResolver?: CohortResolver,
): BrainObservation {
  // Evidence: computed-only. Raw-block numbers are deliberately dropped —
  // they are absolute counts (traffic-scale identifying) and do not support
  // causal claims anyway.
  const adjusted_lift_relative = outcome.computed?.overall.relative_lift ?? null;
  const controls_used = outcome.computed?.overall.controls_used ?? null;
  const per_platform = (outcome.computed?.per_platform ?? []).map(sanitizePlatform);

  const warning_categories = outcome.warnings.map(categorizeWarning);

  const obs: BrainObservation = {
    primary_bucket: outcome.primary_bucket,
    child_tags: [...outcome.child_tags],
    bundle_size: outcome.bundle_size,
    url_type: outcome.url_type,
    status: outcome.status,
    confidence: outcome.confidence,
    adjusted_lift_relative,
    controls_used,
    per_platform,
    warning_categories,
    tenant_cohort: cohortResolver ? cohortResolver(outcome) ?? null : null,
    observation_month: toObservationMonth(outcome.treatment_date),
  };

  auditBrainObservation(obs);
  return obs;
}

// ---------------------------------------------------------------------------
// Privacy audit — throws on leakage
// ---------------------------------------------------------------------------

const URL_LIKE = /https?:\/\/|\/\w+(\/|$)/;
const SOURCE_ID_LIKE = /^cl-(real|mo)\w*|^[a-z]+_[\w-]+-obs-/i;

/**
 * Deep-walks a BrainObservation and throws if any string field looks like a
 * URL path, http URL, or changelog source id.
 *
 * Run by `sanitizeStoredOutcomeForBrain` automatically. Also exported for
 * tests and for any caller that constructs BrainObservations by a different
 * path (e.g. imported from another tenant's export file).
 */
export function auditBrainObservation(obs: BrainObservation): void {
  const violations: string[] = [];

  const checkString = (path: string, value: string) => {
    if (URL_LIKE.test(value)) violations.push(`${path} contains URL-like content: ${value}`);
    if (SOURCE_ID_LIKE.test(value)) violations.push(`${path} contains source_id-like content: ${value}`);
  };

  // Enum / taxonomy strings — they contain dots + lowercase but URL_LIKE
  // would flag "content.section.add.generic" via the `/\w+(\/|$)/` branch?
  // No — URL_LIKE requires a slash. Dot-separated taxonomy ids are safe.

  checkString("primary_bucket", obs.primary_bucket);
  obs.child_tags.forEach((t, i) => checkString(`child_tags[${i}]`, t));
  if (obs.url_type) checkString("url_type", obs.url_type);
  if (obs.tenant_cohort) checkString("tenant_cohort", obs.tenant_cohort);
  obs.per_platform.forEach((p, i) => checkString(`per_platform[${i}].platform`, p.platform));

  // Observation month must be YYYY-MM — never a full date
  if (!/^\d{4}-\d{2}$/.test(obs.observation_month)) {
    violations.push(`observation_month must be 'YYYY-MM' but got: ${obs.observation_month}`);
  }

  // Allowlist all valid BrainObservation keys. Any other key is a leak.
  const ALLOWED_KEYS = new Set([
    "primary_bucket",
    "child_tags",
    "bundle_size",
    "url_type",
    "status",
    "confidence",
    "adjusted_lift_relative",
    "controls_used",
    "per_platform",
    "warning_categories",
    "tenant_cohort",
    "observation_month",
  ]);
  const surface = obs as unknown as Record<string, unknown>;
  for (const k of Object.keys(surface)) {
    if (!ALLOWED_KEYS.has(k)) {
      violations.push(`unexpected field '${k}' on BrainObservation — possible leak`);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `BrainObservation privacy audit failed:\n  - ${violations.join("\n  - ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Bulk sanitize
// ---------------------------------------------------------------------------

export function sanitizeStoredOutcomes(
  outcomes: StoredChangeOutcome[],
  cohortResolver?: CohortResolver,
): BrainObservation[] {
  return outcomes.map((o) => sanitizeStoredOutcomeForBrain(o, cohortResolver));
}
