/**
 * cron-schedule-map (BEACON_500 item 85, 2026-07-03) - a hardcoded mirror of
 * `vercel.json`'s `crons` array so the health panel can compute "next
 * scheduled run" without parsing vercel.json at runtime (Vercel's build
 * output doesn't ship the repo's vercel.json into the serverless function
 * bundle, so a runtime `readFileSync` would break in production; a static
 * map keeps this cheap and dependency-free).
 *
 * THIS FILE MUST STAY IN SYNC WITH vercel.json. Pinned by
 * cron-schedule-map.test.ts, which reads the real vercel.json at test time
 * and asserts every entry here matches it exactly (path + schedule string).
 * If you change a cron's schedule in vercel.json, update the matching entry
 * here in the SAME change - the test will fail otherwise.
 */

export type CronScheduleEntry = {
  /** Stable job identifier used as the cron_runs.job value. */
  job: string;
  /** The route path, exactly as it appears in vercel.json (for the pin test). */
  path: string;
  /** The cron schedule string, exactly as it appears in vercel.json. */
  schedule: string;
  /** Plain-English label for the health panel. */
  label: string;
};

// Mirror of vercel.json's `crons` array. Keep job identifiers aligned with
// the string cron-sync.ts / measure-due's route.ts pass to recordCronRun.
export const CRON_SCHEDULE_MAP: readonly CronScheduleEntry[] = [
  {
    job: "publish-canary",
    path: "/api/cron/publish-canary",
    schedule: "51 8 * * *",
    label: "Wix connection check",
  },
  {
    job: "sync-connectors",
    path: "/api/cron/sync-connectors",
    schedule: "0 9 * * *",
    label: "Nightly data sync",
  },
  {
    job: "measure-due",
    path: "/api/cron/measure-due",
    schedule: "30 9 * * *",
    label: "Nightly results check",
  },
  {
    job: "autopilot",
    path: "/api/cron/autopilot",
    schedule: "7 10 * * *",
    label: "Autopilot auto-ship",
  },
  {
    job: "ai-engines",
    path: "/api/cron/ai-engines",
    schedule: "17 10 * * 1,3,5",
    label: "AI answer check (Mon/Wed/Fri)",
  },
  {
    job: "precompute",
    path: "/api/cron/precompute",
    schedule: "3 12 * * *",
    label: "Getting drafts ready",
  },
  {
    job: "page-factory",
    path: "/api/cron/page-factory",
    schedule: "47 13 * * 1",
    label: "Weekly new-page batch (Monday)",
  },
  {
    job: "strategy-review",
    path: "/api/cron/strategy-review",
    schedule: "33 13 * * 0",
    label: "Weekly strategy review (Sunday)",
  },
];

/**
 * Parse a 5-field cron expression's next UTC fire time after `from`. Supports
 * the subset actually used in vercel.json: exact minute/hour, `*`, and a
 * comma list of weekdays (e.g. "1,3,5"). Day-of-month and month fields are
 * always `*` in this codebase's schedules, so they are treated as wildcards
 * only - this is NOT a general cron parser.
 */
export function nextScheduledRun(schedule: string, from: Date = new Date()): Date | null {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteStr, hourStr, , , weekdayStr] = parts;
  const minute = Number(minuteStr);
  const hour = Number(hourStr);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;

  const allowedWeekdays =
    weekdayStr === "*"
      ? null
      : new Set(
          weekdayStr!
            .split(",")
            .map((w) => Number(w))
            .filter((w) => Number.isFinite(w)),
        );

  const candidate = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute, 0, 0),
  );
  // Walk forward day by day (bounded to 8 days: a week plus one day of
  // margin) until we find a day matching the weekday filter, at or after `from`.
  for (let i = 0; i < 8; i++) {
    const day = new Date(candidate.getTime() + i * 24 * 60 * 60 * 1000);
    if (day.getTime() < from.getTime()) continue;
    if (allowedWeekdays == null || allowedWeekdays.has(day.getUTCDay())) {
      return day;
    }
  }
  return null;
}

export function findScheduleForJob(job: string): CronScheduleEntry | null {
  return CRON_SCHEDULE_MAP.find((e) => e.job === job) ?? null;
}
