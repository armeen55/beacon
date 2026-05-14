/**
 * 2026-05-13 Phase A.1 Step 7 — citation-lifecycle loaders.
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
 * file): every external read goes through `getRepository().forTenant(
 * tenantId)`. Loose / global reads here would silently mix tenants.
 *
 * Citation-source choice (Phase A.1 v1):
 *   • Native regime via `prompt_answer_observations.citation_urls`
 *     is the ONLY citation source consulted. Tenant-scoped repo
 *     read makes this self-isolating.
 *   • Benchmark regime (`CitationObservation` shards from Profound)
 *     is NOT read in v1 — reading every date shard for every
 *     Changes detail render is too expensive. Pre-cutover edits
 *     (live_at before 2026-04-22) will produce a `null`
 *     `first_citation_date_iso` and surface the "live N days ago,
 *     not yet cited" copy even when the Profound shards contain a
 *     citation. Documented + acceptable for v1; Phase A.2 can wire
 *     a windowed shard reader if customer feedback demands it.
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
// Single-edit loader (Changes detail)
// ─────────────────────────────────────────────────────────────────────

/**
 * Single-edit lifecycle loader.
 *
 * Resolves `recommended_edit.live_at` to a windowed prompt-answer
 * observation read (only obs at-or-after `live_at` matter for the
 * first-citation search) and runs the compute pipeline.
 *
 * Cached per-(tenant, edit.id) with 60s TTL and the
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
    "citation-lifecycle:v1",
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
      const since = recommendedEdit.live_at ?? undefined;
      const promptAnswerObservations =
        await repo.getPromptAnswerObservations(
          since ? { since } : undefined,
        );

      const result = computeTimeToCitation({
        recommendedEdit,
        // Benchmark-regime shards intentionally not read in v1 —
        // see file header trade-off note.
        citationObservations: [],
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
const MS_PER_DAY = 86_400_000;

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
    "citation-lifecycle-summary:v1",
    tenantId,
    String(windowDays),
  ];

  const cached = unstable_cache(
    async () => {
      const repo = getRepository().forTenant(tenantId);

      // Pull edits once for the window. The Today tile is the only
      // current consumer of this aggregate; volume is small enough
      // that we don't need a windowed projection.
      const [recommendedEdits, allObservations] = await Promise.all([
        repo.getRecommendedEdits(),
        // Windowed observations: anything before the oldest
        // candidate `live_at` in the window can't produce a
        // first-citation for any edit in the window.
        repo.getPromptAnswerObservations({
          since: new Date(nowMs - windowDays * MS_PER_DAY)
            .toISOString()
            .slice(0, 10),
        }),
      ]);

      const candidates = recommendedEdits.filter((row) => {
        if (row.live_at == null) return false;
        return isWithinWindow(row.live_at, nowMs, windowDays);
      });

      let latest: string | null = null;
      const perStage: Record<LifecycleStage, number> = { ...EMPTY_PER_STAGE };
      let total = 0;

      for (const row of candidates) {
        const result = computeTimeToCitation({
          recommendedEdit: row,
          citationObservations: [],
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
