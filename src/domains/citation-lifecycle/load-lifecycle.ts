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
import {
  renderLifecycleCopy,
  type LifecycleCopy,
} from "./render-copy";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { getRepository } from "@/lib/persistence/repositories";
import { getCitationsForDate } from "@/lib/persistence/cold-store";
import type { CitationObservation } from "@/domains/citation-observations/types";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Composite return value for the Changes detail loader. Includes
 * the upstream compute + the derived stage + the rendered copy so
 * the consumer can branch on stage (e.g., suppressed tile vs full
 * lifecycle row) without re-computing.
 */
export type LifecycleForEdit = {
  /** True iff the row is eligible AND the compute produced a stage. */
  available: boolean;
  /** Stage when `available`; null otherwise. */
  stage: LifecycleStage | null;
  /** Pre-rendered copy strings when `available`; null otherwise. */
  copy: LifecycleCopy | null;
  /** Raw compute payload for operator diagnostics. */
  result: TimeToCitationResult;
};

/**
 * Per-stage rollup for the Today "Edit lifecycle" tile. Includes a
 * sample size + a freshness anchor (the most recent `live_at` the
 * tenant has) so the tile can render an honest "as of …" line.
 */
export type LifecycleSummary = {
  /** Total eligible edits considered. */
  total: number;
  /** Counts per stage; non-listed stages default to 0. */
  per_stage: Record<LifecycleStage, number>;
  /** Most-recent `live_at` across the considered set. Null when 0. */
  latest_live_at_iso: string | null;
};

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

  const result = await cached();
  const stage = deriveLifecycleStage({
    first_citation_date_iso: result.first_citation_date_iso,
    days_to_first_citation: result.days_to_first_citation,
    days_since_live: result.days_since_live,
  });

  if (!result.eligible || stage == null || result.days_since_live == null) {
    return {
      available: false,
      stage: null,
      copy: null,
      result,
    };
  }

  const copy = renderLifecycleCopy({
    stage,
    days_since_live: result.days_since_live,
    days_to_first_citation: result.days_to_first_citation,
    per_platform_first_citation: result.per_platform_first_citation,
    is_partial_live: result.is_partial_live,
    was_cited_before_live: result.was_cited_before_live,
  });

  return {
    available: true,
    stage,
    copy,
    result,
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
  const nowMs =
    now instanceof Date ? now.getTime() : new Date(now).getTime();

  const { unstable_cache } = await import("next/cache");
  const cacheKey = [
    "citation-lifecycle-summary:v2",
    tenantId,
    String(windowDays),
  ];

  const cached = unstable_cache(
    async () => {
      const repo = getRepository().forTenant(tenantId);

      // Pull edits once for the window. The Today tile is the only
      // current consumer of this aggregate; volume is small enough
      // that we don't need a windowed projection.
      const windowStartIso = new Date(nowMs - windowDays * MS_PER_DAY)
        .toISOString()
        .slice(0, 10);
      const [recommendedEdits, allObservations] = await Promise.all([
        repo.getRecommendedEdits(),
        // Windowed observations: anything before the oldest
        // candidate `live_at` in the window can't produce a
        // first-citation for any edit in the window.
        repo.getPromptAnswerObservations({ since: windowStartIso }),
      ]);

      const candidates = recommendedEdits.filter((row) => {
        if (row.live_at == null) return false;
        return isWithinWindow(row.live_at, nowMs, windowDays);
      });

      // Path A pre-cutover branch — read benchmark shards exactly
      // once for the union of candidate windows. The earliest
      // candidate `live_at` is the lower bound; the cutover (or
      // `nowIso`, whichever is smaller) is the upper bound. Skipped
      // entirely when no candidate has `live_at < NATIVE_REGIME_START`.
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

      let latest: string | null = null;
      const perStage: Record<LifecycleStage, number> = { ...EMPTY_PER_STAGE };
      let total = 0;

      for (const row of candidates) {
        const result = computeTimeToCitation({
          recommendedEdit: row,
          citationObservations: benchmarkCitations,
          promptAnswerObservations: allObservations,
          now,
        });
        if (!result.eligible || result.days_since_live == null) continue;

        const stage = deriveLifecycleStage({
          first_citation_date_iso: result.first_citation_date_iso,
          days_to_first_citation: result.days_to_first_citation,
          days_since_live: result.days_since_live,
        });
        if (stage == null) continue;

        perStage[stage]++;
        total++;

        // Track latest live_at for the "as of …" freshness line.
        // row.live_at is non-null by candidate filter.
        if (latest == null || (row.live_at as string) > latest) {
          latest = row.live_at as string;
        }
      }

      return {
        total,
        per_stage: perStage,
        latest_live_at_iso: latest,
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
