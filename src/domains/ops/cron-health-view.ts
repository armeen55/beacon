import "server-only";

/**
 * cron-health-view (BEACON_500 item 85, 2026-07-03) - loads + composes the
 * cron_runs ledger into the plain-English view the /settings/connectors
 * health panel renders. Pages stay thin; this module does the reading and
 * the copy composition.
 */

import { listRecentCronRuns, type CronRunRow } from "./cron-runs-store";
import { CRON_SCHEDULE_MAP, nextScheduledRun } from "./cron-schedule-map";
import { deriveProviderStreaks, streaksAtOrAboveThreshold } from "./cron-streak";
import { classifyJobPace, summarizeJobReceipts, type CronPace } from "./deadman";

const RUNS_PER_JOB = 14; // ~2 weeks of nightly history is plenty for "every night this week"

const PROVIDER_PLAIN_NAME: Record<string, string> = {
  google_gsc: "Search Console",
  google_ga4: "Google Analytics",
  google_gbp: "Google Business Profile",
  clarity: "Clarity",
  profound: "Profound",
  measure: "Measurement",
};

function plainName(provider: string): string {
  return PROVIDER_PLAIN_NAME[provider] ?? provider;
}

export type JobHealthView = {
  job: string;
  label: string;
  nextScheduledAtIso: string | null;
  /** T0c deadman pace vs the schedule: waiting (first run not due yet),
   *  healthy, late, or stalled. Same classifier + same words as the Today
   *  banner (deadman.ts), so both surfaces always agree. */
  pace: CronPace;
  /** The plain late/stalled sentence (null when healthy/waiting). */
  paceSentence: string | null;
  lastRun: {
    startedAt: string;
    ok: boolean;
    durationMs: number;
  } | null;
  /** "I showed up every night this week. Search Console synced 7 of 7 nights." */
  headline: string;
  perSourceThisWeek: Array<{
    provider: string;
    label: string;
    successNights: number;
    totalNights: number;
  }>;
  failureStreaks: Array<{
    tenantId: string;
    provider: string;
    label: string;
    consecutiveFailures: number;
    lastFailureDetail: string | null;
  }>;
};

function countRecentNights(runs: ReadonlyArray<CronRunRow>): number {
  // How many of the most recent runs actually happened, capped to 7
  // ("this week") for the headline sentence.
  return Math.min(runs.length, 7);
}

function buildHeadline(job: string, runs: ReadonlyArray<CronRunRow>): string {
  const nights = countRecentNights(runs);
  if (nights === 0) return "I have not run yet.";
  const recent = runs.slice(0, nights);
  const successNights = recent.filter((r) => r.ok).length;
  const showedUp = `I showed up ${successNights} of ${nights} night${nights === 1 ? "" : "s"} this week.`;

  // Name the single worst-performing source this week, if any failed.
  const perSourceCounts = new Map<string, { ok: number; total: number }>();
  for (const run of recent) {
    for (const src of run.per_source) {
      const key = src.provider;
      const entry = perSourceCounts.get(key) ?? { ok: 0, total: 0 };
      entry.total += 1;
      if (src.ok) entry.ok += 1;
      perSourceCounts.set(key, entry);
    }
  }
  const worst = Array.from(perSourceCounts.entries())
    .filter(([, v]) => v.ok < v.total)
    .sort((a, b) => a[1].ok / a[1].total - b[1].ok / b[1].total)[0];

  if (!worst) return showedUp;
  const [provider, counts] = worst;
  return `${showedUp} ${plainName(provider)} synced ${counts.ok} of ${counts.total} nights.`;
}

/** Load + compose the health view for every scheduled job. Fail-soft per job. */
export async function loadCronHealthView(): Promise<JobHealthView[]> {
  const now = new Date();
  const out: JobHealthView[] = [];

  // First pass: load every job's runs (fail-soft per job) so the deadman's
  // never-ran grace can anchor at the OLDEST receipt across the whole ledger.
  // A read failure is kept distinct from "no runs" so the honest error
  // headline below still renders.
  const runsByJob = new Map<string, CronRunRow[] | "read_error">();
  let ledgerBeganAt: string | null = null;
  for (const entry of CRON_SCHEDULE_MAP) {
    const runs = await listRecentCronRuns(entry.job, RUNS_PER_JOB).catch(
      () => "read_error" as const,
    );
    runsByJob.set(entry.job, runs);
    if (runs === "read_error") continue;
    const oldest = runs[runs.length - 1]?.started_at;
    if (oldest && (ledgerBeganAt == null || oldest < ledgerBeganAt)) ledgerBeganAt = oldest;
  }

  for (const entry of CRON_SCHEDULE_MAP) {
    const loaded = runsByJob.get(entry.job) ?? [];
    // A failed READ never raises a stalled alarm - "I could not read my run
    // history" is the honest state, not "the job never ran". A "started"
    // receipt is never scored as a run: summarizeJobReceipts splits the newest
    // row into a real last-run vs an abandoned died-mid-run receipt, so the
    // panel's pace agrees with the Today banner even mid-run.
    const summary =
      loaded === "read_error" ? null : summarizeJobReceipts(loaded, now);
    const pace =
      loaded === "read_error" || summary == null
        ? { pace: "waiting" as const, sentence: null }
        : classifyJobPace(
            entry,
            summary.lastRunStartedAt,
            ledgerBeganAt,
            now,
            summary.diedMidRunStartedAt,
          );
    try {
      if (loaded === "read_error") throw new Error("cron_runs read failed");
      // Score only completed runs. An unfinished "started" receipt is neither a
      // success nor a failure, so it must never inflate the "showed up N of M
      // nights" headline or a failure streak.
      const runs = loaded.filter((r) => (r.phase ?? "finished") === "finished");
      const nights = countRecentNights(runs);
      const recent = runs.slice(0, nights);

      const perSourceCounts = new Map<string, { ok: number; total: number }>();
      for (const run of recent) {
        for (const src of run.per_source) {
          const key = src.provider;
          const c = perSourceCounts.get(key) ?? { ok: 0, total: 0 };
          c.total += 1;
          if (src.ok) c.ok += 1;
          perSourceCounts.set(key, c);
        }
      }

      const streaks = streaksAtOrAboveThreshold(deriveProviderStreaks(runs));

      out.push({
        job: entry.job,
        label: entry.label,
        nextScheduledAtIso: nextScheduledRun(entry.schedule, now)?.toISOString() ?? null,
        pace: pace.pace,
        paceSentence: pace.sentence,
        lastRun: runs[0]
          ? { startedAt: runs[0].started_at, ok: runs[0].ok, durationMs: runs[0].duration_ms }
          : null,
        headline: buildHeadline(entry.job, runs),
        perSourceThisWeek: Array.from(perSourceCounts.entries()).map(([provider, c]) => ({
          provider,
          label: plainName(provider),
          successNights: c.ok,
          totalNights: c.total,
        })),
        failureStreaks: streaks.map((s) => ({
          tenantId: s.tenantId,
          provider: s.provider,
          label: plainName(s.provider),
          consecutiveFailures: s.consecutiveFailures,
          lastFailureDetail: s.lastFailureDetail,
        })),
      });
    } catch {
      out.push({
        job: entry.job,
        label: entry.label,
        nextScheduledAtIso: nextScheduledRun(entry.schedule, now)?.toISOString() ?? null,
        pace: pace.pace,
        paceSentence: pace.sentence,
        lastRun: null,
        headline: "I could not read my run history right now.",
        perSourceThisWeek: [],
        failureStreaks: [],
      });
    }
  }
  return out;
}
