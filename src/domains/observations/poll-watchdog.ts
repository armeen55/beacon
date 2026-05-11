/**
 * Poll watchdog — Automation Reliability Bundle (2026-05-11).
 *
 * Pure helpers for the `/api/cron/poll-watchdog` route. The route's job
 * is to detect when GitHub Actions' shared scheduler skips the daily
 * native-poll workflow (which it did on 2026-05-11: all 3 redundant
 * scheduled attempts at 07:00 / 08:30 / 10:00 UTC missed) and recover
 * by dispatching the same workflow via the GitHub API.
 *
 * Design contract:
 *   - Watchdog NEVER runs the paid poll itself. It only dispatches the
 *     existing GH Actions workflow, which has the budget guard in
 *     `runNativePoll`'s `defaultHasRecentRun` check. That guard
 *     short-circuits to `skipped_already_ran_today` when a row already
 *     exists today, so double-spend is impossible even if Vercel cron
 *     fires AND GH scheduler fires late.
 *   - Watchdog dispatches only when today is materially missing
 *     observations. If a `running` or `completed` row exists for every
 *     expected platform, no dispatch.
 *   - `failed` rows do NOT count as cover — the watchdog should still
 *     dispatch a retry when only failed rows exist for a platform.
 *
 * Pure / deterministic. No I/O. Easy to test with crafted fixtures.
 */

/**
 * Platforms the watchdog expects to see a successful run for each
 * UTC day. The `daily-native-poll.yml` workflow polls both, in
 * parallel matrix jobs.
 */
export const WATCHDOG_EXPECTED_PLATFORMS = ["chatgpt", "perplexity"] as const;
export type WatchdogPlatform = (typeof WATCHDOG_EXPECTED_PLATFORMS)[number];

/**
 * Subset of the `observation_runs` row shape the watchdog reads. Keep
 * narrow on purpose — the watchdog should not depend on schema fields
 * it doesn't actually use, so future schema additions don't drag this
 * helper into avoidable churn.
 */
export type WatchdogObservationRun = {
  /** `run_type` differentiates poll runs from scan runs etc. Only
   *  rows with `run_type === "citation_sample_import"` are considered
   *  poll runs; everything else is ignored by the watchdog. */
  readonly run_type: string;
  /** Free-text label that includes the platform name. The poll CLI
   *  emits `"Native <platform> poll · …"`. */
  readonly scope_label: string | null;
  /** Operator-locked status enum: "running" / "completed" / "failed". */
  readonly status: string;
};

export type WatchdogDecision =
  | {
      readonly shouldDispatch: false;
      readonly reason: "skipped_already_ran_today";
      readonly coveredPlatforms: ReadonlyArray<WatchdogPlatform>;
    }
  | {
      readonly shouldDispatch: true;
      readonly reason: "missing_platforms";
      readonly missingPlatforms: ReadonlyArray<WatchdogPlatform>;
      readonly coveredPlatforms: ReadonlyArray<WatchdogPlatform>;
    };

/**
 * Decide whether the watchdog should dispatch a recovery
 * `workflow_dispatch` against the daily-native-poll workflow.
 *
 * Rules (locked by `poll-watchdog.test.ts`):
 *   1. Only `run_type === "citation_sample_import"` rows count.
 *   2. Within that subset, a row "covers" a platform when its
 *      `status` is `"completed"` OR `"running"`. A `"failed"` row
 *      does NOT cover — we want a retry.
 *   3. The platform is detected by case-insensitive substring match
 *      against `scope_label` (the CLI writes `"Native chatgpt poll …"`
 *      / `"Native perplexity poll …"`).
 *   4. If every expected platform is covered → no dispatch.
 *   5. Otherwise → dispatch (the workflow's own budget guard handles
 *      idempotency from the runner side).
 *
 * Pure function — does not consult clocks, env vars, or I/O.
 */
export function shouldDispatchPoll(args: {
  readonly todayObservationRuns: ReadonlyArray<WatchdogObservationRun>;
  readonly expectedPlatforms?: ReadonlyArray<WatchdogPlatform>;
}): WatchdogDecision {
  const expected = args.expectedPlatforms ?? WATCHDOG_EXPECTED_PLATFORMS;
  const covered = new Set<WatchdogPlatform>();

  for (const row of args.todayObservationRuns) {
    if (row.run_type !== "citation_sample_import") continue;
    if (row.status !== "completed" && row.status !== "running") continue;
    const label = (row.scope_label ?? "").toLowerCase();
    for (const platform of expected) {
      if (label.includes(`native ${platform} poll`)) {
        covered.add(platform);
      }
    }
  }

  const missing = expected.filter((p) => !covered.has(p));
  if (missing.length === 0) {
    return {
      shouldDispatch: false,
      reason: "skipped_already_ran_today",
      coveredPlatforms: [...covered],
    };
  }
  return {
    shouldDispatch: true,
    reason: "missing_platforms",
    missingPlatforms: missing,
    coveredPlatforms: [...covered],
  };
}
