/**
 * 2026-05-14 Phase A.1 Step 7 + Path A enforcement —
 * citation-lifecycle loaders.
 *
 * Server-side wrappers that pull tenant-scoped data through the
 * existing repository pattern and run the pure compute modules
 * (`compute-time-to-citation`, `lifecycle-stage`, `render-copy`).
 * Two entry points:
 *
 *   • `loadLifecycleForEdit({tenantId, recommendedEdit, now})` — used
 *     by the Changes detail page to produce the Act 3 lifecycle
 *     copy for ONE row. Cached per-(tenant, edit_id) via Next.js
 *     `unstable_cache` (60s TTL) — mirrors the recs-queue cache
 *     pattern in `src/domains/recommendations/load-queue.ts`.
 *
 *   • `loadLifecycleSummaryForTenant({tenantId, since, now})` —
 *     used by the Today "Edit lifecycle" tile to produce the
 *     per-stage aggregate counts over a window (default 90 days
 *     since each row's `live_at`). Cached per-tenant.
 *
 * Tenant-isolation contract (architecture invariant scans this
 * file): every prompt-answer / recommended-edit read goes through
 * `getRepository().forTenant(tenantId)`. Loose / global reads here
 * would silently mix tenants.
 *
 * Citation-source contract (Section 2 / Section 2.4 Path A lock):
 *   • Native regime (≥ NATIVE_REGIME_START): citations live on
 *     `prompt_answer_observations.citation_urls`. Tenant-scoped at
 *     the repository layer, so reading them is self-isolating.
 *   • Benchmark regime (< NATIVE_REGIME_START): per-day
 *     `CitationObservation` shards in `.data/citations-by-date/`,
 *     served by the process-global `getCitationsForDate` reader.
 *     `CitationObservation` has NO `tenant_id` column — tenant
 *     safety is preserved by the compute layer's `promptAnswerById`
 *     map, which drops any citation row whose `prompt_answer_id`
 *     is not in the caller's tenant-scoped prompt-answer set
 *     (see `compute-time-to-citation.ts` §5a).
 *
 * The loader only reads benchmark shards when the lifecycle window
 * actually overlaps the pre-cutover regime. For the common case
 * (every active Ritz edit has `live_at >= NATIVE_REGIME_START`), the
 * `readBenchmarkCitationsInWindow` helper returns `[]` without
 * touching the cold-store reader — no perf regression vs. the
 * native-only v1.
 */

import {
  computeTimeToCitation,
  type TimeToCitationResult,
} from "./compute-time-to-citation";
import {
  deriveLifecycleStage,
  type LifecycleStage,
} from "./lifecycle-stage";
import { loadRepeatCitationForEdit } from "./load-repeat-citation";
import type { RepeatCitationBand } from "./compute-repeat-citation";
import { T2C_THRESHOLDS } from "./thresholds";
import {
  renderLifecycleCopy,
  buildTileStrings,
  type LifecycleCopy,
  type LifecycleTileStrings,
  type StuckDiagnosticInput,
} from "./render-copy";
import { loadIndexabilityForUrl } from "@/domains/indexability/load-indexability";
import type { OwnedUrlIndexability } from "@/domains/indexability/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { getRepository } from "@/lib/persistence/repositories";
import { getCitationsForDate } from "@/lib/persistence/cold-store";
import type { CitationObservation } from "@/domains/citation-observations/types";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";
import {
  computeTenantThresholds,
  type ThresholdDecision,
  type TenantLifecycleRecord,
} from "@/domains/recommendations/cross-tenant-brain/compute-tenant-thresholds";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Composite return value for the Changes detail loader. Includes
 * the upstream compute + the derived stage + the rendered copy so
 * the consumer can branch on stage (e.g., suppressed tile vs full
 * lifecycle row) without re-computing.
 *
 * Phase A.2 Step 3c (2026-05-14) — `stage` and `copy` are now BOTH
 * computed against `threshold_decision.thresholds`. When the
 * decision source is `per_tenant`, the bucket boundaries shift to
 * the tenant's observed quantiles and the rendered `copy.primary`
 * picks the per-tenant variant (e.g., "for this site" suffix). On
 * sub-gate / sample-too-thin, the decision falls back to Profound
 * defaults and the output is byte-identical to A.2.3b.
 */
export type LifecycleForEdit = {
  /** True iff the row is eligible AND the compute produced a stage. */
  available: boolean;
  /** Stage when `available`; null otherwise. Bucketed against
   *  `threshold_decision.thresholds` in A.2.3c. */
  stage: LifecycleStage | null;
  /** Pre-rendered copy strings when `available`; null otherwise.
   *  Per-source variants selected by `threshold_decision.source`. */
  copy: LifecycleCopy | null;
  /** Raw compute payload for operator diagnostics. */
  result: TimeToCitationResult;
  /** Per-tenant threshold decision driving both `stage` and `copy`. */
  threshold_decision: ThresholdDecision;
};

/**
 * Per-stage rollup for the Today "Edit lifecycle" tile. Includes a
 * sample size + a freshness anchor (the most recent `live_at` the
 * tenant has) so the tile can render an honest "as of …" line.
 *
 * Phase A.2 Step 3c (2026-05-14) — `per_stage` is now bucketed
 * against `threshold_decision.thresholds` AND `tile_strings`
 * carries the pre-rendered per-source labels/tooltip the tile
 * consumes. Counts + labels move together by construction (single
 * decision drives both), so a tenant flipping from
 * `profound_default` to `per_tenant` cannot produce a row that says
 * "cited fast (within 8 days)" while having been bucketed against
 * the 6-day Profound `fast_days`.
 */
export type LifecycleSummary = {
  /** Total eligible edits considered. */
  total: number;
  /** Counts per stage; non-listed stages default to 0. Bucketed
   *  against `threshold_decision.thresholds` (A.2.3c re-bucket). */
  per_stage: Record<LifecycleStage, number>;
  /** Most-recent `live_at` across the considered set. Null when 0. */
  latest_live_at_iso: string | null;
  /** Per-tenant threshold decision driving both `per_stage` and
   *  `tile_strings`. */
  threshold_decision: ThresholdDecision;
  /** Pre-rendered per-source strings for the Today tile (labels,
   *  tooltip, empty placeholder). The tile component reads these
   *  directly and does NOT import `T2C_THRESHOLDS` or the locked
   *  `BORROWED_BENCHMARK_TOOLTIP` constant — architecture
   *  invariant pins that boundary. */
  tile_strings: LifecycleTileStrings;
  /**
   * Section 5.B Slice 2 (2026-05-21) — repeat-citation band rollup
   * over a 30-day window across the SAME `candidates` set the
   * per_stage loop iterates. `total` mirrors `candidates.length`
   * (independent of time-to-citation eligibility); `total_with_band`
   * counts candidates that the repeat-citation loader was able to
   * classify (eligible AND `band != null`). `per_band` sums to
   * `total_with_band`.
   *
   * The Today `EditLifecycleTile` reads `per_band` directly to
   * render a "Citation stability (past 30 days)" sub-section
   * beneath the per_stage rollup. Customer labels come from a
   * typed map inside the tile component (locked at 5.B.1:
   * `stable → "Consistent"`, `intermittent → "Recurring"`,
   * `one_off → "Early signal"`, `not_repeated → "Not repeated in
   * this window"`, `still_learning → "Still learning"`).
   *
   * Soft-fail contract: catastrophic failure during the per-edit
   * `loadRepeatCitationForEdit` aggregation reduces the field to
   * zero-band counts (`total === 0`, `total_with_band === 0`).
   * The tile suppresses the section in that case — keeping the
   * time-to-citation per_stage rollup visible.
   */
  repeat_citation_30d: {
    per_band: Record<RepeatCitationBand, number>;
    total: number;
    total_with_band: number;
  };
};

const EMPTY_PER_BAND_30D: Record<RepeatCitationBand, number> = {
  stable: 0,
  intermittent: 0,
  one_off: 0,
  not_repeated: 0,
  still_learning: 0,
};

const REPEAT_CITATION_TILE_WINDOW_DAYS = 30;

// ─────────────────────────────────────────────────────────────────────
// Benchmark-regime reader (Path A pre-cutover branch)
// ─────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * UTC date string (YYYY-MM-DD) from a `Date | string | null`. Returns
 * null on unparseable input so callers can short-circuit cleanly.
 */
function toUtcDateString(input: Date | string | null | undefined): string | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Enumerate UTC dates in `[startIso, endIso)` (exclusive at end), in
 * ascending order. Empty array when `startIso >= endIso`. Pure.
 */
function enumerateUtcDatesExclusive(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const startMs = Date.UTC(
    Number(startIso.slice(0, 4)),
    Number(startIso.slice(5, 7)) - 1,
    Number(startIso.slice(8, 10)),
  );
  const endMs = Date.UTC(
    Number(endIso.slice(0, 4)),
    Number(endIso.slice(5, 7)) - 1,
    Number(endIso.slice(8, 10)),
  );
  for (let ms = startMs; ms < endMs; ms += MS_PER_DAY) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Read every benchmark `CitationObservation` shard whose UTC date
 * falls in `[sinceIso, min(nowIso, NATIVE_REGIME_START))`. Returns
 * the concatenated rows. Tenant safety is NOT enforced here —
 * `CitationObservation` carries no `tenant_id`. The caller passes
 * the result into `computeTimeToCitation`, which drops every row
 * whose `prompt_answer_id` is outside the caller-supplied
 * tenant-scoped prompt-answer set (see §5a of that module).
 *
 * Post-cutover windows (`sinceIso >= NATIVE_REGIME_START`) return
 * `[]` without calling `getCitationsForDate` at all — the common
 * case for every Ritz edit shipped since 2026-04-22 is a no-op.
 *
 * Inputs are pre-validated UTC date strings (YYYY-MM-DD). If either
 * is unparseable, the function returns `[]` defensively rather than
 * partially reading.
 */
function readBenchmarkCitationsInWindow(
  sinceIso: string | null,
  nowIso: string,
): CitationObservation[] {
  // Defensive: a missing `since` makes the window unbounded on the
  // left, which would force reading every historical shard. We
  // refuse and return [] — the loader callers always have a
  // `live_at` (the eligibility predicate already guards this).
  if (sinceIso == null) return [];

  // The benchmark regime is strictly `< NATIVE_REGIME_START`. If the
  // window even starts on or after the cutover, there is nothing to
  // read.
  if (sinceIso >= NATIVE_REGIME_START) return [];

  // Clamp the right edge to the cutover. A `nowIso` in the future
  // (clock skew) or on the cutover day produces the same exclusive
  // upper bound.
  const upperExclusive =
    nowIso < NATIVE_REGIME_START ? nowIso : NATIVE_REGIME_START;

  // Bump the upper bound to include `nowIso`-day citations when
  // `nowIso` is strictly before the cutover (enumeration is
  // exclusive at the end).
  const upperExclusiveInclusiveOfNow =
    upperExclusive === nowIso
      ? new Date(new Date(`${upperExclusive}T00:00:00Z`).getTime() + MS_PER_DAY)
          .toISOString()
          .slice(0, 10)
      : upperExclusive;

  const dates = enumerateUtcDatesExclusive(
    sinceIso,
    upperExclusiveInclusiveOfNow,
  );
  if (dates.length === 0) return [];

  const out: CitationObservation[] = [];
  for (const date of dates) {
    const shard = getCitationsForDate(date);
    if (shard.length === 0) continue;
    for (const c of shard) out.push(c);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Tenant lifecycle records + threshold resolver (Phase A.2 Step 3b)
// ─────────────────────────────────────────────────────────────────────

const TODAY_TILE_DEFAULT_WINDOW_DAYS = 90;

function isWithinWindow(
  liveAtIso: string,
  nowMs: number,
  windowDays: number,
): boolean {
  const liveMs = new Date(liveAtIso).getTime();
  if (Number.isNaN(liveMs)) return false;
  return nowMs - liveMs <= windowDays * MS_PER_DAY;
}

/**
 * Brain-seed lifecycle classifier — used ONLY by
 * `buildTenantLifecycleRecords` to populate the placeholder
 * `lifecycle_stage` field on records flowing into
 * `computeTenantThresholds`.
 *
 * The brain checks set membership in `{cited_*}` (any cited stage
 * counts) and treats `live_not_yet_cited` + `stuck` as the
 * excluded subpopulation. Precise band classification is
 * irrelevant for inclusion. We classify structurally here so this
 * helper does not call `deriveLifecycleStage` — the architecture
 * invariant pinning every `deriveLifecycleStage` call to thread
 * the resolved decision's thresholds then applies cleanly to the
 * user-visible consumer sites only.
 *
 * `cited_typical` is the placeholder used for any cited record;
 * the brain compute does not distinguish between cited bands.
 */
function classifyForBrainSeed(
  result: TimeToCitationResult,
): LifecycleStage | null {
  if (!result.eligible || result.days_since_live == null) return null;
  if (
    result.first_citation_date_iso != null &&
    result.days_to_first_citation != null
  ) {
    return "cited_typical";
  }
  return result.days_since_live > T2C_THRESHOLDS.late_days
    ? "stuck"
    : "live_not_yet_cited";
}

/**
 * Maps an edit + its compute result + derived stage into the
 * `TenantLifecycleRecord` shape consumed by
 * `computeTenantThresholds`. Private — callers within this module
 * only.
 *
 * `live_at` is asserted non-null because the candidate filter
 * (`row.live_at == null` → skip) runs before this mapping.
 */
function toTenantLifecycleRecord(
  edit: RecommendedEditRow,
  result: TimeToCitationResult,
  stage: LifecycleStage,
): TenantLifecycleRecord {
  return {
    edit_id: edit.id,
    action_type: edit.action_type ?? null,
    // Candidate filter guarantees live_at is non-null; falling
    // back to "" is defensive (would never trigger in practice).
    live_at: edit.live_at ?? "",
    days_to_first_citation: result.days_to_first_citation,
    first_citation_date_iso: result.first_citation_date_iso,
    lifecycle_stage: stage,
    is_partial_live: result.is_partial_live,
  };
}

/**
 * Build `TenantLifecycleRecord[]` for the tenant's eligible
 * candidate edits within `windowDays`. Pure-ish (depends on
 * tenant-scoped repo reads + the cold-store benchmark reader, but
 * no mutation). Used by both the cached resolver below and the
 * summary loader (which calls this then re-uses the records to
 * compute per_stage counts).
 *
 * Tenant-isolation contract: every read goes through
 * `repo.forTenant(tenantId)`. The Path A pre-cutover branch reads
 * benchmark shards; tenant safety on those rows is preserved by
 * the compute layer's `promptAnswerById` filter (see
 * `compute-time-to-citation.ts` §5a + Phase A.1 §2.4 lock).
 */
async function buildTenantLifecycleRecords(opts: {
  tenantId: string;
  now: Date | string;
  windowDays: number;
}): Promise<TenantLifecycleRecord[]> {
  const { tenantId, now, windowDays } = opts;
  const nowMs =
    now instanceof Date ? now.getTime() : new Date(now).getTime();
  const repo = getRepository().forTenant(tenantId);

  const windowStartIso = new Date(nowMs - windowDays * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  const [recommendedEdits, allObservations] = await Promise.all([
    repo.getRecommendedEdits(),
    repo.getPromptAnswerObservations({ since: windowStartIso }),
  ]);

  const candidates = recommendedEdits.filter((row) => {
    if (row.live_at == null) return false;
    return isWithinWindow(row.live_at, nowMs, windowDays);
  });

  // Path A pre-cutover branch — read benchmark shards once for the
  // union of candidate windows. Skipped entirely when every
  // candidate is post-cutover.
  const nowDateIso = toUtcDateString(now);
  let earliestCandidateLiveAt: string | null = null;
  for (const row of candidates) {
    const iso = toUtcDateString(row.live_at);
    if (iso == null) continue;
    if (earliestCandidateLiveAt == null || iso < earliestCandidateLiveAt) {
      earliestCandidateLiveAt = iso;
    }
  }
  const benchmarkCitations: CitationObservation[] =
    earliestCandidateLiveAt != null &&
    earliestCandidateLiveAt < NATIVE_REGIME_START &&
    nowDateIso != null
      ? readBenchmarkCitationsInWindow(earliestCandidateLiveAt, nowDateIso)
      : [];

  const records: TenantLifecycleRecord[] = [];
  for (const row of candidates) {
    const result = computeTimeToCitation({
      recommendedEdit: row,
      citationObservations: benchmarkCitations,
      promptAnswerObservations: allObservations,
      now,
    });
    if (!result.eligible || result.days_since_live == null) continue;
    // `buildTenantLifecycleRecords` exists ONLY to feed
    // `computeTenantThresholds`. That compute's inclusion rule
    // depends ONLY on cited-vs-uncited (a property stable across
    // threshold sets — a record that is "cited at all" stays in
    // the cited subpopulation regardless of which threshold band
    // we'd assign it to). We therefore classify structurally here,
    // without calling `deriveLifecycleStage`:
    //   • cited_typical for any cited record (placeholder stage —
    //     the brain only checks set membership in cited_*).
    //   • stuck for records past the Profound late threshold with
    //     no citation (so the brain's `excluded_count` accounting
    //     stays honest).
    //   • live_not_yet_cited otherwise.
    // The customer-visible re-bucketing happens at the consumer
    // sites (loader's `loadLifecycleForEdit` + summary inner
    // loop), where `deriveLifecycleStage` is called WITH the
    // resolved per-tenant decision's thresholds. Architecture
    // invariant pins those user-visible call sites; this helper
    // does NOT participate in the wired contract.
    const stage = classifyForBrainSeed(result);
    if (stage == null) continue;
    records.push(toTenantLifecycleRecord(row, result, stage));
  }

  return records;
}

// ─────────────────────────────────────────────────────────────────────
// Stuck-diagnostic builder (Phase A.3 Step 4)
// ─────────────────────────────────────────────────────────────────────

const NEEDS_NEW_PAGE_SENTINEL = "needs_new_page";

/**
 * Map an `OwnedUrlIndexability` result into the
 * `StuckDiagnosticInput` shape consumed by `renderStuckDiagnostic`.
 *
 * `blocked_ai_bots` derives from the per-bot `*_allowed` booleans —
 * each bot whose flag is exactly `false` (not `null` — null = no
 * evidence) maps to its readable name. Googlebot is intentionally
 * OMITTED from this list because it has its own verdict +
 * customer-copy path (`blocked_by_robots_for_googlebot`).
 */
function buildStuckDiagnosticInput(
  indexability: OwnedUrlIndexability,
): StuckDiagnosticInput {
  const robots = indexability.signals.robots_txt;
  const blocked_ai_bots: Array<
    "GPTBot" | "PerplexityBot" | "ClaudeBot" | "Google-Extended"
  > = [];
  if (robots.gptbot_allowed === false) blocked_ai_bots.push("GPTBot");
  if (robots.perplexitybot_allowed === false) {
    blocked_ai_bots.push("PerplexityBot");
  }
  if (robots.claudebot_allowed === false) blocked_ai_bots.push("ClaudeBot");
  if (robots.google_extended_allowed === false) {
    blocked_ai_bots.push("Google-Extended");
  }
  return {
    verdict: indexability.composite_verdict,
    context: {
      http_status: indexability.signals.page_snapshot?.http_status ?? null,
      canonical_url: indexability.signals.page_snapshot?.canonical_url ?? null,
      blocked_ai_bots: blocked_ai_bots.length > 0 ? blocked_ai_bots : null,
    },
  };
}

/**
 * Load the per-URL indexability verdict for a stuck row and shape it
 * into the renderer's input.
 *
 * Returns `null` when:
 *   • `targetUrl` is null or the `needs_new_page` sentinel (nothing
 *     to diagnose), OR
 *   • the indexability loader throws (e.g., tenant-context mismatch)
 *     — the error is logged via `console.warn` and the caller falls
 *     back to the existing bridge phrase. NEVER lets the lifecycle
 *     load fail the whole Changes detail render.
 *
 * This helper is the single seam between citation-lifecycle and
 * indexability; the architecture invariant pins that the loader is
 * called only on stuck rows.
 */
async function buildStuckDiagnostic(opts: {
  tenantId: string;
  targetUrl: string | null;
  now: Date | string;
}): Promise<StuckDiagnosticInput | null> {
  const { tenantId, targetUrl, now } = opts;
  if (targetUrl == null) return null;
  if (targetUrl === NEEDS_NEW_PAGE_SENTINEL) return null;
  try {
    const indexability = await loadIndexabilityForUrl({
      tenantId,
      url: targetUrl,
      now,
    });
    return buildStuckDiagnosticInput(indexability);
  } catch (e) {
    // Graceful degradation: a tenant-context mismatch (or any other
    // throw inside the loader) must NOT break the Changes detail
    // render. Surface to the operator via console; the bridge
    // phrase fallback kicks in downstream.
    console.warn(
      "[citation-lifecycle/load-lifecycle] indexability load failed; falling back to bridge phrase",
      e,
    );
    return null;
  }
}

/**
 * Resolve the tenant's threshold decision and cache it.
 *
 * Phase A.2 Step 3b (2026-05-14). Single source of truth for the
 * per-tenant decision. Both lifecycle loaders consult this helper.
 *
 * Cache key: `["tenant-thresholds:v1", tenantId, dayString(now),
 * String(windowDays ?? 90)]`. Day-keyed because decisions roll
 * forward at UTC day boundaries; tenant-tagged so any
 * `recommended_edits:${tenantId}` mutation invalidates this
 * cache alongside the existing lifecycle caches.
 *
 * TTL 60s. Tag `recommended_edits:${tenantId}`.
 */
export async function resolveTenantThresholdsCached(opts: {
  tenantId: string;
  now?: Date | string;
  windowDays?: number;
}): Promise<ThresholdDecision> {
  const { tenantId } = opts;
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? TODAY_TILE_DEFAULT_WINDOW_DAYS;
  const dayString = toUtcDateString(now) ?? "no-day";

  const { unstable_cache } = await import("next/cache");
  const cacheKey = [
    "tenant-thresholds:v1",
    tenantId,
    dayString,
    String(windowDays),
  ];

  const cached = unstable_cache(
    async () => {
      const records = await buildTenantLifecycleRecords({
        tenantId,
        now,
        windowDays,
      });
      return computeTenantThresholds(records);
    },
    cacheKey,
    {
      revalidate: 60,
      tags: [`recommended_edits:${tenantId}`],
    },
  );

  return cached();
}

// ─────────────────────────────────────────────────────────────────────
// Single-edit loader (Changes detail)
// ─────────────────────────────────────────────────────────────────────

/**
 * Single-edit lifecycle loader.
 *
 * Resolves `recommended_edit.live_at` to a windowed prompt-answer
 * observation read (only obs at-or-after `live_at` matter for the
 * first-citation search) and runs the compute pipeline. Benchmark
 * shards are consulted only when `live_at < NATIVE_REGIME_START`
 * (Path A pre-cutover branch).
 *
 * Cached per-(tenant, edit.id, live_at) with 60s TTL and the
 * `recommended_edits:${tenantId}` tag so the existing
 * persistence-level cache invalidation continues to flow through.
 */
export async function loadLifecycleForEdit(opts: {
  tenantId: string;
  recommendedEdit: RecommendedEditRow;
  now?: Date | string;
}): Promise<LifecycleForEdit> {
  const { tenantId, recommendedEdit } = opts;
  const now = opts.now ?? new Date();

  const { unstable_cache } = await import("next/cache");
  const cacheKey = [
    "citation-lifecycle:v2",
    tenantId,
    recommendedEdit.id,
    // Include live_at in the key so a transition from null → set
    // immediately re-derives (won't wait for the 60s revalidation).
    recommendedEdit.live_at ?? "no-live",
  ];

  const cached = unstable_cache(
    async () => {
      const repo = getRepository().forTenant(tenantId);

      // Windowed read: only observations at-or-after live_at can
      // produce a citation that counts toward first-citation. The
      // `since` filter pushes down to Postgres on the Supabase
      // backend, dropping the row count crossing the wire from
      // ~15k to typically a few hundred.
      const sinceIso = toUtcDateString(recommendedEdit.live_at);
      const promptAnswerObservations =
        await repo.getPromptAnswerObservations(
          sinceIso ? { since: sinceIso } : undefined,
        );

      // Path A pre-cutover branch — only reads cold-store shards
      // when the window actually overlaps pre-NATIVE_REGIME_START
      // dates.  Returns [] cheaply for the common post-cutover
      // case.
      const nowDateIso = toUtcDateString(now);
      const citationObservations =
        nowDateIso != null
          ? readBenchmarkCitationsInWindow(sinceIso, nowDateIso)
          : [];

      const result = computeTimeToCitation({
        recommendedEdit,
        citationObservations,
        promptAnswerObservations,
        now,
      });

      return result;
    },
    cacheKey,
    {
      revalidate: 60,
      tags: [`recommended_edits:${tenantId}`],
    },
  );

  // Phase A.2 Step 3c — resolve the tenant's threshold decision in
  // parallel with the per-edit compute, then thread the decision
  // into BOTH `deriveLifecycleStage` (re-bucket against per-tenant
  // thresholds when source = per_tenant) AND `renderLifecycleCopy`
  // (per-source customer copy variants). Single decision drives
  // bucketing + copy so the two stay coherent.
  const [result, thresholdDecision] = await Promise.all([
    cached(),
    resolveTenantThresholdsCached({ tenantId, now }),
  ]);
  const stage = deriveLifecycleStage(
    {
      first_citation_date_iso: result.first_citation_date_iso,
      days_to_first_citation: result.days_to_first_citation,
      days_since_live: result.days_since_live,
    },
    thresholdDecision.thresholds,
  );

  if (!result.eligible || stage == null || result.days_since_live == null) {
    return {
      available: false,
      stage: null,
      copy: null,
      result,
      threshold_decision: thresholdDecision,
    };
  }

  // Phase A.3 Step 4 — stuck rows get a per-verdict discoverability
  // diagnostic. Gated to `stage === "stuck"` to bound the per-render
  // read surface; cited and live_not_yet_cited stages skip the
  // indexability load entirely. The `needs_new_page` sentinel +
  // null target_url also skip (no URL to diagnose).
  const stuck_diagnostic =
    stage === "stuck"
      ? await buildStuckDiagnostic({
          tenantId,
          targetUrl: recommendedEdit.target_url,
          now,
        })
      : null;

  const copy = renderLifecycleCopy({
    stage,
    days_since_live: result.days_since_live,
    days_to_first_citation: result.days_to_first_citation,
    per_platform_first_citation: result.per_platform_first_citation,
    is_partial_live: result.is_partial_live,
    was_cited_before_live: result.was_cited_before_live,
    threshold_decision: thresholdDecision,
    stuck_diagnostic,
  });

  return {
    available: true,
    stage,
    copy,
    result,
    threshold_decision: thresholdDecision,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Aggregate loader (Today tile)
// ─────────────────────────────────────────────────────────────────────

const EMPTY_PER_STAGE: Record<LifecycleStage, number> = {
  live_not_yet_cited: 0,
  cited_fast: 0,
  cited_typical: 0,
  cited_late: 0,
  cited_very_late: 0,
  stuck: 0,
};

/**
 * Aggregate the per-stage counts for the Today tile.
 *
 * Window default = 90 days (Section 2.11). Considers eligible
 * `recommended_edits` whose `live_at` falls inside the window AND
 * passes the time-to-citation eligibility predicate. Edits without
 * `live_at` are excluded by the predicate.
 *
 * Path A: when any candidate edit has `live_at < NATIVE_REGIME_START`,
 * the benchmark shard reader is consulted (once, for the union of
 * the relevant date windows). For the common case where every
 * candidate is post-cutover, no shards are read.
 *
 * Phase A.2 Step 3b — the summary builds its records via the shared
 * `buildTenantLifecycleRecords` helper, then iterates the records
 * to count per_stage (against Profound-default classifications) AND
 * calls `computeTenantThresholds(records)` inline to populate
 * `threshold_decision`. NO re-bucketing of `per_stage` in this step.
 *
 * Cached per-tenant + per-window for 60s.
 */
export async function loadLifecycleSummaryForTenant(opts: {
  tenantId: string;
  now?: Date | string;
  windowDays?: number;
}): Promise<LifecycleSummary> {
  const { tenantId } = opts;
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? TODAY_TILE_DEFAULT_WINDOW_DAYS;

  // Resolve the tenant's threshold decision OUTSIDE the summary
  // cache so the day-keyed threshold cache (`tenant-thresholds:v1`)
  // can satisfy this read independently of the summary cache. Both
  // caches share the same `recommended_edits:${tenantId}` tag for
  // unified invalidation on edit mutations.
  const thresholdDecision = await resolveTenantThresholdsCached({
    tenantId,
    now,
    windowDays,
  });

  const { unstable_cache } = await import("next/cache");
  const cacheKey = [
    "citation-lifecycle-summary:v4",
    tenantId,
    String(windowDays),
    // Fold the decision source + thresholds into the cache key so a
    // flip from profound_default → per_tenant (or sample-size
    // crossing the gate) immediately re-derives counts + labels
    // rather than waiting for the 60s TTL.
    thresholdDecision.source,
    `${thresholdDecision.thresholds.fast_days}-${thresholdDecision.thresholds.median_days}-${thresholdDecision.thresholds.late_days}`,
  ];

  const cached = unstable_cache(
    async () => {
      // Single full pass: read repo data, compute time-to-citation,
      // derive stage AGAINST `thresholdDecision.thresholds`. Counts
      // and labels move together by construction — single decision
      // drives both, no chance of a `cited fast (within 8 days)`
      // label sitting next to a 6-day-bucketed count.
      const nowMs =
        now instanceof Date ? now.getTime() : new Date(now).getTime();
      const repo = getRepository().forTenant(tenantId);

      const windowStartIso = new Date(nowMs - windowDays * MS_PER_DAY)
        .toISOString()
        .slice(0, 10);
      const [recommendedEdits, allObservations] = await Promise.all([
        repo.getRecommendedEdits(),
        repo.getPromptAnswerObservations({ since: windowStartIso }),
      ]);

      const candidates = recommendedEdits.filter((row) => {
        if (row.live_at == null) return false;
        return isWithinWindow(row.live_at, nowMs, windowDays);
      });

      // Path A pre-cutover benchmark read — once, for the union of
      // candidate windows. Skipped entirely when every candidate is
      // post-cutover (common case).
      const nowDateIso = toUtcDateString(now);
      let earliestCandidateLiveAt: string | null = null;
      for (const row of candidates) {
        const iso = toUtcDateString(row.live_at);
        if (iso == null) continue;
        if (earliestCandidateLiveAt == null || iso < earliestCandidateLiveAt) {
          earliestCandidateLiveAt = iso;
        }
      }
      const benchmarkCitations: CitationObservation[] =
        earliestCandidateLiveAt != null &&
        earliestCandidateLiveAt < NATIVE_REGIME_START &&
        nowDateIso != null
          ? readBenchmarkCitationsInWindow(earliestCandidateLiveAt, nowDateIso)
          : [];

      const perStage: Record<LifecycleStage, number> = { ...EMPTY_PER_STAGE };
      let latest: string | null = null;
      let total = 0;
      for (const row of candidates) {
        const result = computeTimeToCitation({
          recommendedEdit: row,
          citationObservations: benchmarkCitations,
          promptAnswerObservations: allObservations,
          now,
        });
        if (!result.eligible || result.days_since_live == null) continue;
        const stage = deriveLifecycleStage(
          {
            first_citation_date_iso: result.first_citation_date_iso,
            days_to_first_citation: result.days_to_first_citation,
            days_since_live: result.days_since_live,
          },
          thresholdDecision.thresholds,
        );
        if (stage == null) continue;
        perStage[stage]++;
        total++;
        if (row.live_at != null && (latest == null || row.live_at > latest)) {
          latest = row.live_at;
        }
      }

      const tileStrings = buildTileStrings(thresholdDecision);

      // 5.B Slice 2 (2026-05-21) — repeat-citation 30d band aggregation
      // across the same `candidates` set the per_stage loop iterates.
      // Each per-edit call hits its own 60s `unstable_cache` per
      // `(tenant, edit.id, live_at, windowDays)`. Promise.all bounds
      // the cold-cache fan-out cost. Per-edit errors are caught and
      // leave the edit out of `per_band`; catastrophic failure of the
      // entire batch zeros the rollup so the tile suppresses the
      // section cleanly.
      let repeatCitation30dPerBand: Record<RepeatCitationBand, number> = {
        ...EMPTY_PER_BAND_30D,
      };
      let repeatCitation30dWithBand = 0;
      let repeatCitation30dTotal = candidates.length;
      try {
        // wave-4 #3 (2026-06-14): the per-edit loader previously fanned out
        // getPromptAnswerObservations + getProfoundImportRuns PER candidate
        // (2*N Supabase reads on this render path). Inject shared, already-
        // loaded data so each per-edit call does ZERO reads: import-runs is
        // global (fetched ONCE here), and `allObservations` (loaded above,
        // since now-windowDays) is a superset of every per-edit
        // [max(live_at, now-30d), now] window — computeRepeatCitation windows
        // internally. Observations are injected only when the loader window
        // covers the 30d repeat window; a narrower caller lets the loader do
        // its own windowed fetch (correctness over the read-saving).
        // Fetch the global import-runs ONCE. Defensive try/catch (not just
        // .catch) because a repo without the method throws synchronously; on
        // any failure we simply omit the dep and the per-edit loader falls
        // back to its own read (correctness preserved, just no read-saving).
        let sharedImportRuns: Awaited<
          ReturnType<typeof repo.getProfoundImportRuns>
        > = [];
        try {
          sharedImportRuns = await repo.getProfoundImportRuns();
        } catch {
          sharedImportRuns = [];
        }
        const repeatDeps = {
          profoundImportRuns: sharedImportRuns,
          ...(windowDays >= REPEAT_CITATION_TILE_WINDOW_DAYS
            ? { promptAnswerObservations: allObservations }
            : {}),
        };
        const repeatResults = await Promise.all(
          candidates.map((row) =>
            loadRepeatCitationForEdit({
              tenantId,
              recommendedEdit: row,
              windowDays: REPEAT_CITATION_TILE_WINDOW_DAYS,
              now,
              deps: repeatDeps,
            }).catch(() => null),
          ),
        );
        for (const result of repeatResults) {
          if (result && result.band != null) {
            repeatCitation30dPerBand[result.band]++;
            repeatCitation30dWithBand++;
          }
        }
      } catch {
        repeatCitation30dPerBand = { ...EMPTY_PER_BAND_30D };
        repeatCitation30dWithBand = 0;
        repeatCitation30dTotal = 0;
      }

      return {
        total,
        per_stage: perStage,
        latest_live_at_iso: latest,
        threshold_decision: thresholdDecision,
        tile_strings: tileStrings,
        repeat_citation_30d: {
          per_band: repeatCitation30dPerBand,
          total: repeatCitation30dTotal,
          total_with_band: repeatCitation30dWithBand,
        },
      };
    },
    cacheKey,
    {
      revalidate: 60,
      tags: [`recommended_edits:${tenantId}`],
    },
  );

  return cached();
}

// ─────────────────────────────────────────────────────────────────────
// Test-only export
// ─────────────────────────────────────────────────────────────────────

/**
 * Test-only export of the benchmark window reader. The architecture
 * invariant in `tests/architecture/citation-lifecycle-tenant-isolation.test.ts`
 * pins this file as the only allowed importer of
 * `@/lib/persistence/cold-store`; exporting the helper lets the
 * loader test exercise the reader in isolation without re-importing
 * cold-store directly from the test file (which would have to be
 * added to the allowlist).
 */
export const __testing = {
  readBenchmarkCitationsInWindow,
  enumerateUtcDatesExclusive,
};
