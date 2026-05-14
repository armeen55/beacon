/**
 * 2026-05-13 Phase A.1 Step 6 — citation-lifecycle copy renderer.
 *
 * Pure function that maps the structured output of
 * `compute-time-to-citation.ts` + `lifecycle-stage.ts` into the
 * customer-facing English Beacon shows on the Changes detail brief
 * Act 3 ("What happened after"). All copy variants live HERE; the
 * Changes detail client just renders the strings.
 *
 * Why a separate module:
 *
 *   • Keeps the React surface presentation-only (no string assembly,
 *     no decision logic for stuck-stage bridge phrase, no per-platform
 *     divergence math).
 *   • Pinnable in tests at the string level — every stage variant has
 *     a tightly-scoped unit test (Phase A.1 §2.10).
 *   • Section 2.16 bridge-phrase architecture invariant scans this
 *     file for the literal "next bundle will add automated sitemap +
 *     robots checks" phrase. Removing the phrase trips the build.
 *   • Section 2.17 honesty-callout tooltip is composed alongside so
 *     a future phase swapping the borrowed Profound defaults for
 *     Beacon-owned values only has to update one module.
 *
 * IMPORTANT — D9 stage names (`live_not_yet_cited`, `cited_fast`, …)
 * are operator-side enum values. They MUST NEVER appear in rendered
 * customer copy. This module is the boundary that translates them.
 */

import { T2C_THRESHOLDS } from "./thresholds";
import type { LifecycleStage } from "./lifecycle-stage";
import type { TimeToCitationPerPlatformFirstCitation } from "./compute-time-to-citation";

/**
 * Phase A.2 Step 3a (2026-05-14) — structural alias for the
 * threshold-decision shape consumed by this module's per-source
 * copy variants.
 *
 * Mirrors `ThresholdDecision` from
 * `cross-tenant-brain/compute-tenant-thresholds.ts` but declared
 * locally to avoid a citation-lifecycle → cross-tenant-brain
 * import direction (citation-lifecycle is upstream of the brain in
 * dependency order; the brain consumes lifecycle records, not the
 * other way around).
 *
 * Pure structural compatibility — a caller can pass the brain
 * module's `ThresholdDecision` directly; TypeScript structural
 * typing makes the two interchangeable.
 */
export type ThresholdDecisionLike = {
  source: "profound_default" | "per_tenant";
  thresholds: {
    fast_days: number;
    median_days: number;
    late_days: number;
  };
  sample_size: number;
  excluded_count: number;
  percentile_used: {
    fast: 0.5;
    median: 0.75;
    late: 0.9;
  };
};

/**
 * Default threshold decision used when `LifecycleCopyInput.threshold_decision`
 * is omitted. Backward-compatibility shim: pre-A.2.3 callers that
 * don't yet supply a decision continue to see the locked Phase A.1
 * behavior (Profound defaults, byte-identical copy).
 */
const DEFAULT_PROFOUND_DECISION: ThresholdDecisionLike = {
  source: "profound_default",
  thresholds: T2C_THRESHOLDS,
  sample_size: 0,
  excluded_count: 0,
  percentile_used: { fast: 0.5, median: 0.75, late: 0.9 },
};

/**
 * Structural input. Pulls only the subset of `TimeToCitationResult`
 * the copy decision needs, so the consumer can pass the compute
 * result directly without an adapter.
 *
 * Phase A.2 Step 3a (2026-05-14): `threshold_decision` added as an
 * OPTIONAL field. When omitted, the renderer defaults to
 * `DEFAULT_PROFOUND_DECISION` and produces byte-identical Phase A.1
 * strings — every existing production caller (loader + tests) keeps
 * working without modification. The loader will start supplying a
 * resolved decision in Step 3b.
 */
export type LifecycleCopyInput = {
  stage: LifecycleStage;
  days_since_live: number;
  days_to_first_citation: number | null;
  per_platform_first_citation: TimeToCitationPerPlatformFirstCitation;
  is_partial_live: boolean;
  was_cited_before_live: boolean;
  /** Optional per-tenant threshold decision. Default = Profound. */
  threshold_decision?: ThresholdDecisionLike;
};

export type LifecycleCopy = {
  /**
   * Top-level lifecycle sentence rendered immediately after the
   * result pill in Act 3. One short sentence; never more than two
   * clauses.
   */
  primary: string;
  /**
   * Optional per-platform divergence sub-line. Rendered only when
   * exactly one of (chatgpt, perplexity) has a first-citation date
   * AND the other is still null — the case where customer is well-
   * served by knowing which platform picked them up first. Null
   * otherwise (Google AI Overviews is hardcoded null per D6 and is
   * therefore not part of the divergence math).
   */
  per_platform: string | null;
  /**
   * Stuck-stage discoverability bridge phrase. Rendered ONLY when
   * `stage === "stuck"`. Architecture invariant (Section 2.16)
   * pins the exact substring "next bundle will add automated
   * sitemap + robots checks" so Phase A.3 (indexability) can find
   * and replace it with the verdict-specific copy.
   */
  bridge: string | null;
  /**
   * Optional "was cited before live" note — surfaces the
   * operator-shipped-late edge case from compute-time-to-citation's
   * forward-only `live_at` semantics. Operator-facing copy ONLY;
   * never customer-facing, so always null in v1 (returned for
   * forward-compatibility so a future operator panel can display
   * it without changing the renderer signature).
   */
  before_live_note: string | null;
};

/**
 * The locked tooltip copy from Section 2 Decision Lock D15. Lives
 * here so both the Changes detail Act 3 stage line AND the Today
 * tile tooltip read from one source. Surfaced when threshold source
 * is `profound_default` (Phase A.2 Step 3a + onward).
 */
export const BORROWED_BENCHMARK_TOOLTIP =
  "6, 18, and 37 days are starter benchmarks from a published study " +
  "of marketing pages. Beacon will replace them with its own observed " +
  "benchmarks once there is enough shipped-edit data.";

/**
 * Per-tenant benchmark tooltip (Phase A.2 Step 3a). Rendered when
 * the threshold decision source is `per_tenant` — i.e., the tenant
 * has crossed the ≥ 20-ship gate and Beacon now publishes
 * thresholds observed in their own shipped-edit lifecycle data.
 *
 * The phrase is honest about the cited-edit subpopulation: the
 * thresholds describe pages that GOT cited; uncited/stuck edits are
 * tracked separately in the tile above this tooltip's anchor.
 *
 * The tooltip body is composed via `renderBenchmarkTooltip(decision)`
 * — the template substitutes `{sample_size}` at call time so the
 * single source of truth lives here.
 */
function buildPerTenantBenchmarkTooltip(sampleSize: number): string {
  return (
    `Computed from ${sampleSize} cited shipped edits on this site. ` +
    "Bands describe pages that got cited — still-waiting and stuck " +
    "edits are tracked above."
  );
}

/**
 * Single entry-point for the benchmark tooltip body. Consumers (the
 * Today tile in Step 3c; the Changes detail in Step 3c) should call
 * this rather than reaching for `BORROWED_BENCHMARK_TOOLTIP`
 * directly so source-based variant selection lives in one place.
 *
 * Phase A.2 Step 3a: not wired into the Today tile yet — that's
 * Step 3c. This helper ships now so its contract is testable at the
 * pure-function level.
 */
export function renderBenchmarkTooltip(
  decision?: ThresholdDecisionLike,
): string {
  const d = decision ?? DEFAULT_PROFOUND_DECISION;
  if (d.source === "per_tenant") {
    return buildPerTenantBenchmarkTooltip(d.sample_size);
  }
  return BORROWED_BENCHMARK_TOOLTIP;
}

// ─────────────────────────────────────────────────────────────────────
// Per-stage copy
// ─────────────────────────────────────────────────────────────────────

function formatDays(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

function primaryLine(input: LifecycleCopyInput): string {
  const {
    stage,
    days_since_live,
    days_to_first_citation,
  } = input;

  // Phase A.2 Step 3a — resolve the threshold decision. Missing
  // decision (pre-A.2.3 callers) falls back to Profound defaults so
  // existing output stays byte-identical.
  const decision = input.threshold_decision ?? DEFAULT_PROFOUND_DECISION;
  const isPerTenant = decision.source === "per_tenant";
  const fastDays = decision.thresholds.fast_days;
  // "for this site" is the tenant-observed honesty suffix used in
  // all cited-* per-tenant variants. Single source of truth so a
  // future copy edit ripples to all four bands at once.
  const perTenantSiteSuffix = "for this site";

  switch (stage) {
    case "live_not_yet_cited":
      // Inside Beacon's late-day window with no citation yet. Honest
      // "watching" language; no premature alarm.
      //
      // Per-tenant variant explicitly names the cited subpopulation
      // ("on cited pages from this site, first citations arrived
      // within {fast_days} days") because the sentence makes a
      // forward claim about timing that would otherwise imply ALL
      // pages get cited that fast. The Profound variant retains the
      // paper's broader sample disclosure via the tooltip.
      if (isPerTenant) {
        return (
          `Live ${formatDays(days_since_live)} ago. Beacon is watching; ` +
          `on cited pages from this site, first citations arrived within ` +
          `${fastDays} days.`
        );
      }
      return (
        `Live ${formatDays(days_since_live)} ago. Beacon is watching; ` +
        `first citations typically appear within ${T2C_THRESHOLDS.fast_days} days.`
      );

    case "cited_fast":
      // days_to_first_citation guaranteed non-null when stage is on
      // the first-citation branch (lifecycle-stage.ts derivation).
      // Defensive ?? 0 keeps the renderer total.
      //
      // Causality-safe phrasing (2026-05-14 audit): the subject is
      // explicitly "this page" and the temporal anchor is "after
      // the edit went live" — Beacon does NOT yet claim the edit
      // caused the citation. Time-to-citation is observational
      // timing, not attribution. The plan's Section 2.10 originally
      // locked "Cited N days after going live" which implied edit
      // as subject; refined here.
      //
      // Per-tenant variant appends "for this site" so the
      // observational claim is anchored to tenant data; cited-only
      // subpopulation disclosure lives in the tooltip.
      if (isPerTenant) {
        return (
          `This page was cited ${formatDays(days_to_first_citation ?? 0)} ` +
          `after the edit went live — within Beacon's fast benchmark ` +
          `${perTenantSiteSuffix}.`
        );
      }
      return (
        `This page was cited ${formatDays(days_to_first_citation ?? 0)} ` +
        `after the edit went live — within Beacon's fast benchmark.`
      );

    case "cited_typical":
      if (isPerTenant) {
        return (
          `This page was cited ${formatDays(days_to_first_citation ?? 0)} ` +
          `after the edit went live — within Beacon's typical citation ` +
          `window ${perTenantSiteSuffix}.`
        );
      }
      return (
        `This page was cited ${formatDays(days_to_first_citation ?? 0)} ` +
        `after the edit went live — within Beacon's typical citation window.`
      );

    case "cited_late":
      if (isPerTenant) {
        return (
          `This page was cited ${formatDays(days_to_first_citation ?? 0)} ` +
          `after the edit went live — past Beacon's typical window but ` +
          `within the late threshold ${perTenantSiteSuffix}.`
        );
      }
      return (
        `This page was cited ${formatDays(days_to_first_citation ?? 0)} ` +
        `after the edit went live — past Beacon's typical window but ` +
        `within the late threshold.`
      );

    case "cited_very_late":
      if (isPerTenant) {
        return (
          `This page was cited ${formatDays(days_to_first_citation ?? 0)} ` +
          `after the edit went live — late, but the page is in Beacon's ` +
          `rotation ${perTenantSiteSuffix}.`
        );
      }
      return (
        `This page was cited ${formatDays(days_to_first_citation ?? 0)} ` +
        `after the edit went live — late, but the page is in Beacon's ` +
        `rotation.`
      );

    case "stuck":
      // Discoverability concern. The bridge phrase below adds the
      // forward-looking note about Phase A.3 (indexability). Copy
      // is identical for both threshold sources — a stuck page is a
      // stuck page regardless of which benchmark band defined
      // "past late_days."
      return (
        `Live ${formatDays(days_since_live)} ago, not yet cited. ` +
        `Likely a discoverability issue.`
      );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Per-platform divergence
// ─────────────────────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<"chatgpt" | "perplexity", string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
};

function perPlatformLine(input: LifecycleCopyInput): string | null {
  // Surface divergence only on the cited-* stages — surfacing
  // "first cited on Perplexity, not yet on ChatGPT" on a stage
  // where neither has cited (live_not_yet_cited / stuck) is
  // tautological.
  const isCitedStage =
    input.stage === "cited_fast" ||
    input.stage === "cited_typical" ||
    input.stage === "cited_late" ||
    input.stage === "cited_very_late";
  if (!isCitedStage) return null;

  const { chatgpt, perplexity } = input.per_platform_first_citation;

  // Exactly-one-platform rule: render only when one has a date and
  // the other is still null. Both null is impossible on a cited
  // stage (the aggregate would also be null) but we guard anyway.
  if (chatgpt && !perplexity) {
    return `First cited on ${PLATFORM_LABEL.chatgpt}, not yet on ${PLATFORM_LABEL.perplexity}.`;
  }
  if (perplexity && !chatgpt) {
    return `First cited on ${PLATFORM_LABEL.perplexity}, not yet on ${PLATFORM_LABEL.chatgpt}.`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Stuck-stage bridge phrase (Section 2.16 architecture invariant)
// ─────────────────────────────────────────────────────────────────────

/**
 * Stuck-stage forward-looking phrase. Phase A.3 (indexability +
 * sitemap + robots + GSC) will REPLACE this with per-verdict copy
 * (Section 4.8). The architecture invariant pins the exact substring
 * so a future "cleanup" PR cannot silently drop the promise.
 *
 * The exact substring pinned by `tests/architecture/citation-
 * lifecycle-stuck-bridge-phrase.test.ts` is:
 *
 *   "next bundle will add automated sitemap + robots checks"
 *
 * When Phase A.3 lands, BOTH this module AND the invariant test
 * must be updated together (the invariant should pin the new
 * verdict-specific copy or be retired with a catalog entry in
 * docs/ARCHITECTURE_INVARIANTS_CATALOG.md per Section 12 N1).
 */
const STUCK_BRIDGE_PHRASE =
  "The next bundle will add automated sitemap + robots checks here.";

function bridgeLine(input: LifecycleCopyInput): string | null {
  return input.stage === "stuck" ? STUCK_BRIDGE_PHRASE : null;
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

export function renderLifecycleCopy(
  input: LifecycleCopyInput,
): LifecycleCopy {
  return {
    primary: primaryLine(input),
    per_platform: perPlatformLine(input),
    bridge: bridgeLine(input),
    // Section 2.7 pinned `was_cited_before_live` as operator-side
    // only; customer-facing copy stays silent. Reserved for a
    // future `?debugResolver=1` operator overlay.
    before_live_note: null,
  };
}
