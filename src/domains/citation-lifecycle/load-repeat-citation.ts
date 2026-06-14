/**
 * 2026-05-16 Section 5.A — repeat-citation tenant-scoped loader.
 *
 * Server-side wrapper that pulls tenant-scoped data through the
 * repository and runs the pure `computeRepeatCitation`. Mirrors the
 * caller-bound `.forTenant(tenantId)` discipline of
 * `load-lifecycle.ts` and `load-change-primary-evidence.ts` —
 * tenant scope lives at THIS boundary; the pure compute module
 * receives already-tenant-scoped inputs.
 *
 * Section 5 G2 denominator source — locked: the new repository
 * method `repo.forTenant(tenantId).getProfoundImportRuns()` (added
 * by commit `4ddb908`). This is the SOLE acceptable source for
 * `ProfoundImportRun[]`. The legacy reader
 * `canonical-store.getObservationRuns` is forbidden here via the
 * `section5-no-canonical-store-observation-runs-bridge` invariant;
 * the website-crawl `repo.getObservationRuns` returns the wrong
 * type and would never be a valid source.
 *
 * Path A cold-store branch: when `live_at < NATIVE_REGIME_START`,
 * the loader reads benchmark `CitationObservation` shards via
 * `getAllCitationDates` + `getCitationsForDate`. The cold-store
 * import is allowlisted in
 * `tests/architecture/citation-lifecycle-tenant-isolation.test.ts`.
 * Tenant safety is preserved by the compute layer's
 * `promptAnswerById` filter (drops citations whose
 * `prompt_answer_id` is outside the caller's tenant scope).
 *
 * Cache:
 *   • Key: `["repeat-citation:v1", tenantId, recommendedEdit.id,
 *     recommendedEdit.live_at ?? "no-live", String(windowDays)]`
 *   • TTL: 60s.
 *   • Tag: `recommended_edits:${tenantId}` (mirrors load-lifecycle
 *     so existing edit-mutation invalidation flows through).
 */

import {
  computeRepeatCitation,
  type RepeatCitationResult,
} from "./compute-repeat-citation";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { getRepository } from "@/lib/persistence/repositories";
import {
  getAllCitationDates,
  getCitationsForDate,
} from "@/lib/persistence/cold-store";
import type { CitationObservation } from "@/domains/citation-observations/types";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";

const MS_PER_DAY = 86_400_000;
const DEFAULT_WINDOW_DAYS = 30;

function toUtcDateString(input: Date | string | null | undefined): string | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return null;
  return d.toISOString().slice(0, 10);
}

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
 * Read benchmark `CitationObservation` shards whose UTC date falls
 * in `[sinceIso, min(nowIso, NATIVE_REGIME_START))`. Returns `[]`
 * cheaply when the window doesn't overlap pre-cutover dates — the
 * common case for every Ritz edit shipped ≥ 2026-04-22.
 *
 * Tenant safety is NOT enforced here; the compute layer's
 * `promptAnswerById` filter drops every citation whose
 * `prompt_answer_id` isn't in the caller's tenant scope. Pinned
 * by `citation-lifecycle-tenant-isolation` invariant — the
 * regime-gate cross-reference to `NATIVE_REGIME_START` is the
 * structural proof that the read is bounded.
 */
function readBenchmarkCitationsInWindow(
  sinceIso: string | null,
  nowIso: string,
): CitationObservation[] {
  if (sinceIso == null) return [];
  if (sinceIso >= NATIVE_REGIME_START) return [];
  const upperExclusive =
    nowIso < NATIVE_REGIME_START ? nowIso : NATIVE_REGIME_START;
  const upperExclusiveInclusiveOfNow =
    upperExclusive === nowIso
      ? new Date(new Date(`${upperExclusive}T00:00:00Z`).getTime() + MS_PER_DAY)
          .toISOString()
          .slice(0, 10)
      : upperExclusive;
  const dates = enumerateUtcDatesExclusive(sinceIso, upperExclusiveInclusiveOfNow);
  if (dates.length === 0) return [];
  // `getAllCitationDates` is referenced for forward-compat (in case
  // a future shard layout requires intersecting available dates with
  // the requested range); v1 enumerates directly.
  getAllCitationDates;
  const out: CitationObservation[] = [];
  for (const date of dates) {
    const shard = getCitationsForDate(date);
    if (shard.length === 0) continue;
    for (const c of shard) out.push(c);
  }
  return out;
}

export type LoadRepeatCitationForEditOptions = {
  tenantId: string;
  recommendedEdit: RecommendedEditRow;
  now?: Date | string;
  windowDays?: number;
  /**
   * wave-4 #3 (2026-06-14) — optional pre-loaded inputs. When a batch caller
   * (e.g. the Today edit-lifecycle tile) has ALREADY read these once, it
   * passes them here so this per-edit call does ZERO Supabase reads instead
   * of re-fetching per edit (the N+1 the tile fanned out). `profoundImportRuns`
   * is global; `promptAnswerObservations` may be a SUPERSET of this edit's
   * window — computeRepeatCitation windows internally, so the caller must only
   * inject observations that cover [max(live_at, now-windowDays), now].
   */
  deps?: {
    promptAnswerObservations?: Parameters<
      typeof computeRepeatCitation
    >[0]["promptAnswerObservations"];
    profoundImportRuns?: Parameters<
      typeof computeRepeatCitation
    >[0]["profoundImportRuns"];
  };
};

/**
 * Load + compute the repeat-citation result for a single edit.
 * Cached per `(tenant, edit.id, live_at, windowDays)` with 60s TTL
 * and the `recommended_edits:${tenantId}` invalidation tag.
 *
 * Returns a valid result even for ineligible rows (e.g., no
 * `live_at`, `needs_new_page` sentinel, unparseable URL) — the
 * caller branches on `result.eligible` / `result.band`. Section
 * 5.B will consume this loader directly.
 */
export async function loadRepeatCitationForEdit(
  options: LoadRepeatCitationForEditOptions,
): Promise<RepeatCitationResult> {
  const { tenantId, recommendedEdit } = options;
  const now = options.now ?? new Date();
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;

  const { unstable_cache } = await import("next/cache");
  const cacheKey = [
    "repeat-citation:v1",
    tenantId,
    recommendedEdit.id,
    recommendedEdit.live_at ?? "no-live",
    String(windowDays),
  ];

  const cached = unstable_cache(
    async () => {
      const repo = getRepository().forTenant(tenantId);

      const liveDateIso = toUtcDateString(recommendedEdit.live_at);
      // Windowed read: only observations at-or-after live_at can
      // contribute to the in-window citation count. The `since`
      // filter pushes down to Postgres on the supabase backend.
      // wave-4 #3 (2026-06-14): use caller-injected pre-loaded data when
      // provided (batch callers read once + pass it in), else read per-edit.
      const [promptAnswerObservations, profoundImportRuns] = await Promise.all([
        options.deps?.promptAnswerObservations ??
          repo.getPromptAnswerObservations(
            liveDateIso ? { since: liveDateIso } : undefined,
          ),
        options.deps?.profoundImportRuns ?? repo.getProfoundImportRuns(),
      ]);

      // Path A pre-cutover branch — only reads cold-store shards
      // when the window actually overlaps pre-NATIVE_REGIME_START
      // dates. No-op for every Ritz edit shipped ≥ 2026-04-22.
      const nowDateIso = toUtcDateString(now);
      const citationObservations: CitationObservation[] =
        nowDateIso != null
          ? readBenchmarkCitationsInWindow(liveDateIso, nowDateIso)
          : [];

      return computeRepeatCitation({
        recommendedEdit,
        citationObservations,
        promptAnswerObservations,
        profoundImportRuns,
        windowDays,
        now,
      });
    },
    cacheKey,
    {
      revalidate: 60,
      tags: [`recommended_edits:${tenantId}`],
    },
  );

  return cached();
}
