/**
 * Phase 2C — Thin persistence layer over hardened natural-controls outputs.
 *
 * DISCIPLINE:
 *   - No new attribution math.
 *   - No blurring of computed vs weak vs no_controls.
 *   - Stored records preserve the type-level split: if `computed === null`,
 *     there is no field anywhere in the record that exposes `adjusted_lift`.
 *   - Raw-only blocks retain their `caveat` strings verbatim.
 *
 * RESPONSIBILITIES:
 *   - Convert `NaturalControlResult` → `StoredChangeOutcome`, computing
 *     sparkline-ready window slices from the citation history once so the UI
 *     doesn't re-query per render.
 *   - Persist and retrieve per-change outcomes keyed by `source_id`.
 *   - Expose a lightweight summary index for list views.
 *
 * NON-RESPONSIBILITIES:
 *   - Cross-tenant aggregation (Phase 2D — shared-brain).
 *   - Pattern/recommendation copy (Phase 2E — brain-language).
 *   - Bucket-level rollups beyond `by_primary_bucket` already in the engine.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type {
  NaturalControlResult,
  PlatformLift,
  RawPrePost,
  ConfidenceTier,
  ResultStatus,
} from "./natural-controls";
import {
  denseSeries,
  normalizeUrl,
  type UrlCitationHistory,
  type UrlCitationSeries,
} from "../product/url-citation-history";

// ---------------------------------------------------------------------------
// Store constants
// ---------------------------------------------------------------------------

const STORE_NAME = "change-outcomes";

// ---------------------------------------------------------------------------
// Sparkline shapes
// ---------------------------------------------------------------------------

/** One day of treated-URL citation activity, with per-platform breakdown. */
export type TreatedSparklinePoint = {
  date: string;
  count: number;
  by_platform: Record<string, number>;
};

/** One day summarising the control-reference cohort (mean/min/max). Only emitted for `computed` status. */
export type ControlSparklinePoint = {
  date: string;
  mean: number;
  min: number;
  max: number;
  n: number; // number of contributing control URLs
};

export type SparklineData = {
  treated: TreatedSparklinePoint[];
  /** ONLY populated when the outcome's status === "computed". Null otherwise. */
  control_reference: ControlSparklinePoint[] | null;
  /** URLs that contributed to the reference line (empty unless control_reference is populated). */
  control_urls: string[];
  /** Treatment date marker (YYYY-MM-DD). Caller anchors the chart at this day. */
  treatment_date: string;
};

// ---------------------------------------------------------------------------
// Stored outcome shape
// ---------------------------------------------------------------------------

/**
 * `computed` block (full diff-in-diff). Exists ONLY when status === "computed".
 * Contains the `adjusted_lift` field. Carries its own type tag so downstream
 * consumers can narrow.
 */
export type ComputedBlock = {
  kind: "computed";
  overall: PlatformLift;
  per_platform: PlatformLift[];
};

/**
 * `raw` block. Exists ONLY when status ∈ {weak_estimate, no_controls, insufficient_post_data}.
 * Carries raw treated pre/post numbers and a `caveat` string. NO `adjusted_lift`
 * field exists anywhere in this type — impossible to mis-render as causal.
 */
export type RawBlock = {
  kind: "raw";
  overall: RawPrePost;
  per_platform: RawPrePost[];
};

/**
 * The durable, inspectable per-change outcome record.
 *
 * Mutually-exclusive-null invariant:
 *   - status === "computed"           → computed ≠ null, raw === null
 *   - status ∈ {weak_estimate,
 *               no_controls,
 *               insufficient_post_data} → computed === null, raw ≠ null
 *   - all other statuses              → computed === null, raw === null
 *
 * Enforced by `fromNaturalControlResult` and validated by `validateInvariants`.
 */
export type StoredChangeOutcome = {
  // identity
  source_id: string;
  classifier_version: string;
  stored_at: string;

  // taxonomy context
  taxonomy_layer: string;
  primary_bucket: string;
  child_tags: string[];
  paired_with: string[];
  bundle_parent_id: string | null;
  bundle_size: number;

  // target
  url: string | null;
  url_type: string | null;
  treatment_date: string;

  // windows
  pre_window: { start: string; end: string } | null;
  post_window: { start: string; end: string } | null;

  // engine verdict (preserved verbatim from NaturalControlResult)
  status: ResultStatus;
  confidence: ConfidenceTier;
  warnings: string[];
  rationale: string;

  // The only place lift numbers live. One of these is populated, the other is null.
  computed: ComputedBlock | null;
  raw: RawBlock | null;

  // control-set metadata (aggregate + per-platform)
  matched_control_count: number;
  matched_control_urls: string[];
  excluded_control_count: number;
  excluded_reasons: Record<string, number>;
  excluded_reasons_by_platform: Record<string, Record<string, number>>;

  // sparkline-ready series slices, computed once at store time
  sparklines: SparklineData | null;

  // original engine computed_at (when math was run, vs stored_at when this record was persisted)
  computed_at: string;
};

// ---------------------------------------------------------------------------
// Summary index (lightweight projection for list views)
// ---------------------------------------------------------------------------

export type OutcomeSummaryEntry = {
  source_id: string;
  primary_bucket: string;
  url: string | null;
  url_type: string | null;
  treatment_date: string;
  status: ResultStatus;
  confidence: ConfidenceTier;
  /** Populated ONLY when status === "computed". Null otherwise — no leakage. */
  adjusted_lift: number | null;
  /** Populated ONLY when status === "computed". Null otherwise. */
  relative_lift: number | null;
  /** Populated ONLY when status ∈ {weak_estimate, no_controls, insufficient_post_data}. */
  raw_treated_delta: number | null;
  controls_used: number;
  warnings_count: number;
};

export type OutcomeSummaryIndex = {
  built_at: string;
  total: number;
  by_status: Record<string, number>;
  by_confidence: Record<string, number>;
  entries: OutcomeSummaryEntry[];
};

// ---------------------------------------------------------------------------
// Pure converter: NaturalControlResult → StoredChangeOutcome
// ---------------------------------------------------------------------------

/** Which statuses legitimately carry a `computed` block. */
const COMPUTED_STATUSES: ReadonlySet<ResultStatus> = new Set(["computed"]);

/** Which statuses legitimately carry a `raw` block. */
const RAW_STATUSES: ReadonlySet<ResultStatus> = new Set([
  "weak_estimate",
  "no_controls",
  "insufficient_post_data",
]);

export function fromNaturalControlResult(
  result: NaturalControlResult,
  history: UrlCitationHistory,
): StoredChangeOutcome {
  let computed: ComputedBlock | null = null;
  let raw: RawBlock | null = null;

  if (COMPUTED_STATUSES.has(result.status)) {
    if (result.overall === null) {
      throw new Error(
        `invariant violation: status=${result.status} but overall is null on source_id=${result.event_id}`,
      );
    }
    computed = { kind: "computed", overall: result.overall, per_platform: result.per_platform };
  } else if (RAW_STATUSES.has(result.status)) {
    if (result.raw_overall === null) {
      throw new Error(
        `invariant violation: status=${result.status} but raw_overall is null on source_id=${result.event_id}`,
      );
    }
    raw = { kind: "raw", overall: result.raw_overall, per_platform: result.raw_per_platform };
  }
  // Other statuses (ineligible_*, unsupported_scope, insufficient_baseline, zero_signal):
  // both blocks stay null. Nothing to store beyond the verdict + context.

  const sparklines = buildSparklines(result, history);

  return {
    source_id: result.event_id,
    classifier_version: result.classifier_version,
    stored_at: new Date().toISOString(),

    taxonomy_layer: "change", // engine only emits for change-layer anyway; we keep it for filtering
    primary_bucket: result.primary_bucket,
    child_tags: result.child_tags,
    paired_with: result.paired_with,
    bundle_parent_id: result.bundle_parent_id,
    bundle_size: result.bundle_size,

    url: result.url,
    url_type: result.url_type,
    treatment_date: result.treatment_date,
    pre_window: result.pre_window,
    post_window: result.post_window,

    status: result.status,
    confidence: result.confidence,
    warnings: result.warnings,
    rationale: result.rationale,

    computed,
    raw,

    matched_control_count: result.matched_control_count,
    matched_control_urls: result.matched_control_urls,
    excluded_control_count: result.excluded_control_count,
    excluded_reasons: result.excluded_reasons,
    excluded_reasons_by_platform: result.excluded_reasons_by_platform,

    sparklines,

    computed_at: result.computed_at,
  };
}

/** Invariant checker — called internally by persistChangeOutcomes. Throws on violation. */
export function validateInvariants(s: StoredChangeOutcome): void {
  const computedPopulated = s.computed !== null;
  const rawPopulated = s.raw !== null;
  if (computedPopulated && rawPopulated) {
    throw new Error(
      `invariant violation: both computed and raw are populated on source_id=${s.source_id}`,
    );
  }
  if (COMPUTED_STATUSES.has(s.status) && !computedPopulated) {
    throw new Error(
      `invariant violation: status=${s.status} requires computed block on source_id=${s.source_id}`,
    );
  }
  if (RAW_STATUSES.has(s.status) && !rawPopulated) {
    throw new Error(
      `invariant violation: status=${s.status} requires raw block on source_id=${s.source_id}`,
    );
  }
  if (!COMPUTED_STATUSES.has(s.status) && computedPopulated) {
    throw new Error(
      `invariant violation: status=${s.status} has a computed block (only computed status may)`,
    );
  }
  if (!RAW_STATUSES.has(s.status) && rawPopulated) {
    throw new Error(
      `invariant violation: status=${s.status} has a raw block (only weak/no-controls/insufficient-post may)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Sparkline builder
// ---------------------------------------------------------------------------

export function buildSparklines(
  result: NaturalControlResult,
  history: UrlCitationHistory,
): SparklineData | null {
  if (!result.url || !result.pre_window || !result.post_window) return null;
  const normalized = normalizeUrl(result.url);
  if (!normalized) return null;
  const treatedSeries = history.series.find((s) => s.url === normalized);
  if (!treatedSeries) return null;

  const fullWindow = { start: result.pre_window.start, end: result.post_window.end };
  const treated = extractTreatedSparkline(treatedSeries, fullWindow);

  // Control reference only for status === "computed"; otherwise we refuse to show an
  // implied benchmark line the UI might misread as a control cohort.
  let control_reference: ControlSparklinePoint[] | null = null;
  let control_urls: string[] = [];
  if (COMPUTED_STATUSES.has(result.status) && result.matched_control_urls.length > 0) {
    const controlSeries = result.matched_control_urls
      .map((url) => history.series.find((s) => s.url === url))
      .filter((s): s is UrlCitationSeries => !!s);
    if (controlSeries.length > 0) {
      control_reference = extractControlReferenceSparkline(controlSeries, fullWindow);
      control_urls = controlSeries.map((s) => s.url);
    }
  }

  return {
    treated,
    control_reference,
    control_urls,
    treatment_date: result.treatment_date,
  };
}

function extractTreatedSparkline(
  series: UrlCitationSeries,
  range: { start: string; end: string },
): TreatedSparklinePoint[] {
  const dense = denseSeries(series, { first: range.start, last: range.end });
  const byDate = new Map(series.daily.map((d) => [d.date, d.by_platform] as const));
  return dense.map((d) => ({
    date: d.date,
    count: d.count,
    by_platform: byDate.get(d.date) ?? {},
  }));
}

function extractControlReferenceSparkline(
  controls: UrlCitationSeries[],
  range: { start: string; end: string },
): ControlSparklinePoint[] {
  // Build per-control dense series, then per-day aggregate across controls.
  const denseByControl = controls.map((c) => denseSeries(c, { first: range.start, last: range.end }));
  const out: ControlSparklinePoint[] = [];
  if (denseByControl.length === 0) return out;
  const length = denseByControl[0].length;
  for (let i = 0; i < length; i++) {
    const date = denseByControl[0][i].date;
    const counts = denseByControl.map((s) => s[i].count);
    const n = counts.length;
    const meanVal = n === 0 ? 0 : counts.reduce((a, b) => a + b, 0) / n;
    const minVal = n === 0 ? 0 : Math.min(...counts);
    const maxVal = n === 0 ? 0 : Math.max(...counts);
    out.push({ date, mean: round(meanVal), min: minVal, max: maxVal, n });
  }
  return out;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Summary index
// ---------------------------------------------------------------------------

export function buildOutcomeSummaryIndex(outcomes: StoredChangeOutcome[]): OutcomeSummaryIndex {
  const by_status: Record<string, number> = {};
  const by_confidence: Record<string, number> = {};
  const entries: OutcomeSummaryEntry[] = [];

  for (const o of outcomes) {
    by_status[o.status] = (by_status[o.status] ?? 0) + 1;
    by_confidence[o.confidence] = (by_confidence[o.confidence] ?? 0) + 1;
    entries.push({
      source_id: o.source_id,
      primary_bucket: o.primary_bucket,
      url: o.url,
      url_type: o.url_type,
      treatment_date: o.treatment_date,
      status: o.status,
      confidence: o.confidence,
      adjusted_lift: o.computed?.overall.adjusted_lift ?? null,
      relative_lift: o.computed?.overall.relative_lift ?? null,
      raw_treated_delta: o.raw?.overall.treated_delta ?? null,
      controls_used: o.matched_control_count,
      warnings_count: o.warnings.length,
    });
  }

  return {
    built_at: new Date().toISOString(),
    total: outcomes.length,
    by_status,
    by_confidence,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Persistence (server-only)
// ---------------------------------------------------------------------------

export async function persistChangeOutcomes(outcomes: StoredChangeOutcome[]): Promise<void> {
  for (const o of outcomes) validateInvariants(o);
  await writeStore(STORE_NAME, outcomes);
}

export function loadAllChangeOutcomes(): StoredChangeOutcome[] {
  return readStore<StoredChangeOutcome>(STORE_NAME);
}

export function loadChangeOutcomeById(sourceId: string): StoredChangeOutcome | null {
  const all = loadAllChangeOutcomes();
  return all.find((o) => o.source_id === sourceId) ?? null;
}

export function loadSparklineWindowById(sourceId: string): SparklineData | null {
  const o = loadChangeOutcomeById(sourceId);
  return o?.sparklines ?? null;
}

export function loadOutcomeSummaryIndex(): OutcomeSummaryIndex {
  return buildOutcomeSummaryIndex(loadAllChangeOutcomes());
}

// ---------------------------------------------------------------------------
// Operator drilldown — one helper that shapes the data a detail view needs.
// ---------------------------------------------------------------------------

export type OutcomeDrilldownView = {
  outcome: StoredChangeOutcome;
  /** Convenience: { "computed" | "weak_estimate" | ... } → human-readable label. */
  status_label: string;
  /** Convenience: one-line TL;DR derived from rationale + status. */
  tldr: string;
  /** Warnings grouped by family so the UI can collapse noise / info / alert tiers. */
  warnings_grouped: { alert: string[]; info: string[] };
};

export function buildDrilldownView(outcome: StoredChangeOutcome): OutcomeDrilldownView {
  const label: Record<ResultStatus, string> = {
    computed: "Computed (diff-in-diff)",
    weak_estimate: "Weak estimate — raw only, not causal",
    no_controls: "No viable controls — raw only, not causal",
    unsupported_scope: "Unsupported scope (sitewide / infra / offsite)",
    insufficient_baseline: "Not enough pre-period data",
    insufficient_post_data: "Not enough post-period data",
    zero_signal: "No citations observed in either window",
    ineligible_layer: "Not a change-layer event",
    ineligible_event: "Event ineligible (vague / bundle child / no URL)",
  };

  const tldr =
    outcome.status === "computed" && outcome.computed
      ? `${outcome.primary_bucket}: adjusted_lift=${outcome.computed.overall.adjusted_lift} cit/day (${outcome.confidence})`
      : outcome.raw
        ? `${outcome.primary_bucket}: raw treated_delta=${outcome.raw.overall.treated_delta} cit/day — ${outcome.raw.overall.caveat}`
        : `${outcome.primary_bucket}: ${outcome.rationale}`;

  const alert = outcome.warnings.filter((w) =>
    /overlap|insufficient|no_post_data|no_viable_controls|no_diff_in_diff/.test(w),
  );
  const info = outcome.warnings.filter((w) => !alert.includes(w));

  return {
    outcome,
    status_label: label[outcome.status],
    tldr,
    warnings_grouped: { alert, info },
  };
}
