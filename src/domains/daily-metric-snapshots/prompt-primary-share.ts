/**
 * Section 6 C5 (2026-05-15) — Prompts detail per-prompt primary share,
 * snapshot-derived (14-day AGGREGATE semantic).
 *
 * Pure helper + injected-dependency loader for the per-platform
 * "primary recommendation" sub-line that renders on the Prompts
 * detail v2 Act 2 cards (`/prompts/[id]?v2=1`).
 *
 * Why aggregate, not latest-row:
 *
 * C2 emits ONE prompt-scope snapshot row per (date × platform × prompt_id)
 * tuple, with `total_possible` = observation count for that
 * (prompt, platform, date). For Ritz the daily-poll cron runs each
 * prompt once per platform per day → `total_possible = 1` on every
 * prompt-scope row. Latest-row semantic + ≥ 7 sample guard would
 * permanently force every card into `still_learning` — the bug the
 * C5 revised pre-flight identified.
 *
 * Correct semantic = aggregate across the caller-supplied window:
 *   - count = SUM(primary_recommendation_count)
 *   - total = SUM(total_possible)
 *   - pct   = Math.round((count / total) × 100)
 *   - sample_status = total >= 7 ? "claimable" : "still_learning"
 *
 * Cumulative ≥ 7 mirrors the Section 5 G5 + Section 6 H3 stability
 * floors. For Ritz's 14-day window with daily polling: every backfilled
 * prompt × platform clears the threshold (14 obs per platform).
 *
 * Tenant isolation: helper accepts a pre-bound `PromptPrimaryShareRepo`
 * (caller-bound `.forTenant()`); never reads tenantId directly, never
 * imports `getRepository`. Architecture invariant
 * `tests/architecture/prompt-primary-share-source.test.ts` pins both
 * sides of the contract.
 *
 * Section 6 contract (per H1–H8 Decision Lock + L1–L6 C5 locks):
 *   - Filters    scope_type='prompt' + source_type='derived' +
 *                scope_id === promptId + platform === arg +
 *                primary_recommendation_count != null +
 *                total_possible > 0.
 *   - Missing    total === 0 returns null → caller hides the sub-line.
 *   - Window     Caller-supplied `since`; default reading is 14-day
 *                trailing UTC (matches the legacy enrichmentV2
 *                sparkline window for parity with Today hero math).
 */

import type { DailyMetricSnapshot } from "./types";

/**
 * Section 6 C5 threshold — minimum cumulative observations across the
 * window before the helper surfaces a percentage. Mirrors Section 5
 * G5 (≥ 7 successful poll days) + Section 6 H3 (≥ 7 cited answers).
 *
 * Exported for test pinning + future re-tuning.
 */
export const SECTION6_PROMPT_PRIMARY_MIN_OBS = 7;

/**
 * The two hero platforms Section 6 covers on customer surfaces.
 * Section 6 D6 locks google_ai_overviews out of customer UI (no
 * polling); adding a third platform requires a new pill + surface
 * review.
 */
export type PromptPrimaryShareHeroPlatform = "ChatGPT" | "Perplexity";

/**
 * Per-platform aggregate result. `null` (not a card with zeroes) is
 * how the helper signals "no eligible data — hide the sub-line."
 *   - `claimable`       → render the full "N of M readings in the
 *                         last 14 days (P%)" line.
 *   - `still_learning`  → render the "still gathering readings"
 *                         fallback.
 */
export type PromptPrimaryShareCard = {
  count: number;
  total: number;
  pct: number;
  sample_status: "claimable" | "still_learning";
};

export type PromptPrimaryShare = {
  chatgpt: PromptPrimaryShareCard | null;
  perplexity: PromptPrimaryShareCard | null;
};

/**
 * Snapshot-row repository surface this loader consumes. Tests inject
 * a minimal in-memory implementation; production callers wire a
 * `getRepository().forTenant(tenantId)` instance.
 *
 * Local to this module by design (not imported from
 * `today-primary-share.ts`) so C5 doesn't reach into a C4a file. The
 * shape is structurally identical to `TodayPrimaryShareRepo`; both
 * collapse to "one tenant-scoped `getDailyMetricSnapshots({ since? })`
 * read".
 */
export type PromptPrimaryShareRepo = {
  getDailyMetricSnapshots(options?: {
    since?: string;
  }): Promise<DailyMetricSnapshot[]>;
};

export type ComputePromptPrimaryShareOptions = {
  /**
   * Inclusive lower-bound date (YYYY-MM-DD UTC). Caller bounds the
   * snapshot read window. Recommended in production: 14-day trailing
   * window (mirrors the legacy sparkline window + matches Section 6
   * C4b's `since` convention so cross-surface comparison stays
   * meaningful).
   */
  since?: string;
};

/**
 * Pure helper — 14-day aggregate. Sums `primary_recommendation_count`
 * and `total_possible` across every eligible prompt-scope row for the
 * `(promptId, platform)` pair within the caller-supplied window.
 *
 * Returns `null` when zero eligible rows exist (caller hides the
 * sub-line). When `total > 0` returns the aggregate card; the
 * threshold check decides `claimable` vs `still_learning`.
 *
 * Snapshot row eligibility (all must hold):
 *   - row.scope_type === "prompt"
 *   - row.source_type === "derived"      (excludes pre-Section-6 benchmark rows)
 *   - row.scope_id === promptId          (exact match; prompt_id is verbatim per C2 builder)
 *   - row.platform === arg               (TitleCase match)
 *   - row.primary_recommendation_count != null
 *   - row.total_possible != null AND row.total_possible > 0
 */
export function computePromptPlatformPrimaryShare(
  snapshots: ReadonlyArray<DailyMetricSnapshot>,
  promptId: string,
  platform: PromptPrimaryShareHeroPlatform,
): PromptPrimaryShareCard | null {
  let count = 0;
  let total = 0;

  for (const row of snapshots) {
    if (row.scope_type !== "prompt") continue;
    if (row.source_type !== "derived") continue;
    if (row.scope_id !== promptId) continue;
    if (row.platform !== platform) continue;
    const rowCount = row.primary_recommendation_count;
    const rowTotal = row.total_possible;
    if (rowCount === null || rowCount === undefined) continue;
    if (rowTotal === null || rowTotal === undefined) continue;
    if (rowTotal <= 0) continue;
    count += rowCount;
    total += rowTotal;
  }

  if (total === 0) return null;

  const pct = Math.round((count / total) * 100);
  const sample_status: PromptPrimaryShareCard["sample_status"] =
    total >= SECTION6_PROMPT_PRIMARY_MIN_OBS ? "claimable" : "still_learning";

  return { count, total, pct, sample_status };
}

/**
 * Async wrapper. Consumes the injected `.forTenant()`-bound
 * repository surface, reads tenant-scoped snapshots for the
 * configured window, and derives both platform cards.
 *
 * Tenant isolation contract: caller passes a `repo` already bound to
 * `.forTenant(tenantId)`. This wrapper never sees the bare repository
 * surface, never reads tenantId from request context, and never
 * calls `getRepository()` directly. A future drive-by edit that adds
 * the import is caught by
 * `tests/architecture/prompt-primary-share-source.test.ts`.
 */
export async function computePromptPrimaryShare(args: {
  repo: PromptPrimaryShareRepo;
  promptId: string;
  options?: ComputePromptPrimaryShareOptions;
}): Promise<PromptPrimaryShare> {
  const snapshots = await args.repo.getDailyMetricSnapshots({
    since: args.options?.since,
  });
  return {
    chatgpt: computePromptPlatformPrimaryShare(
      snapshots,
      args.promptId,
      "ChatGPT",
    ),
    perplexity: computePromptPlatformPrimaryShare(
      snapshots,
      args.promptId,
      "Perplexity",
    ),
  };
}
