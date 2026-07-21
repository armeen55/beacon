/**
 * deadman (BEACON_500 T0c, 2026-07-03) - the PURE operational deadman switch.
 *
 * Given the cron schedule map, the latest cron_runs receipts, the latest site
 * uptime probes, and `now`, classify how each scheduled job is pacing and
 * compose ONE overall verdict plus a plain sentence for the worst case. The
 * operator is a non-technical solo founder: when Beacon's own machinery
 * stalls, the app has to say so loudly, in plain words, on Today.
 *
 * Classification rules (period = the longest gap between two consecutive
 * scheduled fire times, e.g. 24h for a daily job, 72h for Mon/Wed/Fri, 7d
 * for a weekly job):
 *   - healthy: the job last ran within 1.5x its period.
 *   - late:    between 1.5x and 3x its period.
 *   - stalled: beyond 3x its period.
 *   - never ran: honest grace. "waiting" until its first scheduled moment
 *     since the ledger began; then "late" for one full period (receipts may
 *     land minutes after the fire, and the very first unattended night gets
 *     the benefit of the doubt exactly once); then "stalled".
 *
 * The site probe joins the same verdict: two failed probes in a row add a
 * "your site did not answer" sentence to the banner. One failed probe alone
 * stays quiet (a single timeout is weather, two in a row is a fire).
 *
 * NO I/O here. deadman-view.ts loads the receipts/probes and calls in.
 */

import {
  CRON_SCHEDULE_MAP,
  nextScheduledRun,
  type CronScheduleEntry,
} from "./cron-schedule-map";

export type CronPace = "waiting" | "healthy" | "late" | "stalled";

export type JobPace = {
  job: string;
  label: string;
  pace: CronPace;
  /** ISO of the newest receipt, null when the job has never recorded a run. */
  lastRunAt: string | null;
  /** ISO of the most recent scheduled fire time at or before `now`. */
  lastDueAt: string | null;
  periodMs: number;
  /** Plain sentence for a late/stalled job (same words on Today's banner and
   *  the cron health panel). Null when healthy or still waiting. */
  sentence: string | null;
};

export type SiteProbeReading = {
  checkedAt: string;
  ok: boolean;
  status: number | null;
};

export type DeadmanVerdict = {
  /** Worst pace across all jobs (stalled > late > healthy > waiting). */
  overall: CronPace;
  jobs: JobPace[];
  /** True when the latest two site probes both failed. */
  siteDown: boolean;
  siteSentence: string | null;
  /** True when Today should show the alert: a stalled job or a down site. */
  alarm: boolean;
  /**
   * The banner copy, worst first: the site-down sentence (if any), then ONE
   * sentence for the worst stalled job, then a one-line count of any other
   * stalled jobs. Late-but-not-stalled jobs stay off Today (they show on the
   * cron health panel) so the banner never cries wolf over a slow morning.
   */
  sentences: string[];
};

/** The receipts ledger shipped 2026-07-03 (migrations/2026-07-03_cron_runs.sql)
 *  and the FIRST unattended nightly run fires the night of Jul 3 to 4 Pacific,
 *  i.e. the Jul 4 UTC fire times. When the ledger is completely empty, grace
 *  is anchored here: a job whose first scheduled moment since this date has
 *  passed with no receipt is genuinely missing, not merely new. */
export const LEDGER_EPOCH_ISO = "2026-07-04T00:00:00.000Z";

const DAY_MS = 24 * 60 * 60 * 1000;
const HEALTHY_MAX_PERIODS = 1.5;
const LATE_MAX_PERIODS = 3;

/**
 * How long a "started" receipt may sit unfinished before it reads as died
 * mid-run rather than in-flight. 15 minutes is well beyond every cron route's
 * maxDuration (the longest is 300s) plus Vercel scheduling slop, so a running
 * row older than this could only mean the invocation died between its begin
 * receipt and its finish update (a crash, an OOM, a hard kill). A running row
 * younger than this is simply the job executing right now, and counts as a
 * fresh run for pacing (no false alarm).
 */
export const ABANDONED_RUN_GRACE_MS = 15 * 60 * 1000;

/** The minimal receipt shape summarizeJobReceipts folds. `phase` absent -> a
 *  legacy completed row. */
export type ReceiptRow = { started_at: string; phase?: "running" | "finished" | null };

export type JobReceiptSummary = {
  /** started_at of the newest FINISHED run (or an in-flight run counted as
   *  fresh); null when the job has only abandoned/no receipts. Feeds pacing. */
  lastRunStartedAt: string | null;
  /** started_at of an abandoned "started" receipt (the newest row is running
   *  and older than the grace window) - the job fired but never finished.
   *  Null otherwise. */
  diedMidRunStartedAt: string | null;
  /** Oldest started_at in the window, for anchoring never-ran grace. */
  oldestStartedAt: string | null;
};

/**
 * PURE: fold a job's receipts (newest first, as listRecentCronRuns returns
 * them) into the three signals the pace classifier needs. A "started" receipt
 * is NEVER scored as a success or a failure; it either means the job is running
 * right now (recent -> counts as a fresh run) or it died mid-run (stale beyond
 * the grace window -> flagged distinctly so the banner can say a scheduled
 * update did not finish).
 */
export function summarizeJobReceipts(
  runs: ReadonlyArray<ReceiptRow>,
  now: Date,
): JobReceiptSummary {
  if (runs.length === 0) {
    return { lastRunStartedAt: null, diedMidRunStartedAt: null, oldestStartedAt: null };
  }
  const newest = runs[0]!;
  const lastFinished =
    runs.find((r) => (r.phase ?? "finished") === "finished")?.started_at ?? null;
  const oldestStartedAt = runs[runs.length - 1]!.started_at;

  let lastRunStartedAt = lastFinished;
  let diedMidRunStartedAt: string | null = null;
  if ((newest.phase ?? "finished") === "running") {
    const startedMs = Date.parse(newest.started_at);
    const age = Number.isFinite(startedMs) ? now.getTime() - startedMs : 0;
    if (age > ABANDONED_RUN_GRACE_MS) {
      diedMidRunStartedAt = newest.started_at; // fired but never finished
    } else {
      lastRunStartedAt = newest.started_at; // executing right now: a fresh run
    }
  }
  return { lastRunStartedAt, diedMidRunStartedAt, oldestStartedAt };
}

const PACIFIC = "America/Los_Angeles";

/** Plain sentence subjects per job. Fallback: "the <label>". */
const JOB_SUBJECT: Record<string, string> = {
  "publish-canary": "the Wix connection check",
  "sync-connectors": "the connected-source refresh",
  "measure-due": "the results check",
  autopilot: "the autopilot shipping pass",
  "ai-engines": "the AI answer check",
  precompute: "the background draft prep",
  "page-factory": "the weekly new-page batch",
  "strategy-review": "the weekly strategy review",
};

function subjectFor(entry: Pick<CronScheduleEntry, "job" | "label">): string {
  const known = JOB_SUBJECT[entry.job];
  if (known) return known;
  // Strip a trailing parenthetical ("AI answer check (Mon/Wed/Fri)") and
  // lowercase a plain leading word; leave brand/acronym casing alone.
  const bare = entry.label.replace(/\s*\(.*\)\s*$/, "");
  const first = bare.split(" ")[0] ?? "";
  const lowered = /^(?:Nightly|Weekly|Daily|Getting|Overnight)$/.test(first)
    ? bare.charAt(0).toLowerCase() + bare.slice(1)
    : bare;
  return `the ${lowered}`;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Jul 3, 2:00 AM" in the operator's timezone (Pacific). */
export function fmtPacific(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: PACIFIC,
  });
}

function pacificDayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: PACIFIC });
}

function pacificHour(d: Date): number {
  return Number(
    d.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: PACIFIC }),
  );
}

/** "this morning" / "earlier today" / "this evening" / "yesterday" / "on Jul 5". */
export function duePhrase(due: Date, now: Date): string {
  const dueDay = pacificDayKey(due);
  const nowDay = pacificDayKey(now);
  if (dueDay === nowDay) {
    const hour = pacificHour(due);
    if (hour < 12) return "this morning";
    if (hour < 18) return "this afternoon";
    return "this evening";
  }
  const yesterday = pacificDayKey(new Date(now.getTime() - DAY_MS));
  if (dueDay === yesterday) return "yesterday";
  return `on ${due.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: PACIFIC })}`;
}

/** Every scheduled fire time in [from, until]. Bounded walk via
 *  nextScheduledRun; an unparseable schedule yields []. */
function firesBetween(schedule: string, from: Date, until: Date): Date[] {
  const fires: Date[] = [];
  let cursor = new Date(from);
  for (let i = 0; i < 60; i++) {
    const next = nextScheduledRun(schedule, cursor);
    if (next == null) break;
    if (next.getTime() > until.getTime()) break;
    fires.push(next);
    cursor = new Date(next.getTime() + 60_000);
  }
  return fires;
}

/** The job's period: the LONGEST gap between consecutive scheduled fires
 *  (24h daily, 72h for Mon/Wed/Fri across the weekend, 7d weekly). Falls
 *  back to 24h when the schedule cannot be enumerated. */
export function schedulePeriodMs(schedule: string, now: Date): number {
  const fires = firesBetween(
    schedule,
    new Date(now.getTime() - 16 * DAY_MS),
    new Date(now.getTime() + 9 * DAY_MS),
  );
  let max = 0;
  for (let i = 1; i < fires.length; i++) {
    max = Math.max(max, fires[i]!.getTime() - fires[i - 1]!.getTime());
  }
  return max > 0 ? max : DAY_MS;
}

/** The most recent scheduled fire time at or before `now`, or null. */
export function lastDueBefore(schedule: string, now: Date): Date | null {
  const fires = firesBetween(schedule, new Date(now.getTime() - 16 * DAY_MS), now);
  return fires.length > 0 ? fires[fires.length - 1]! : null;
}

/** Classify ONE job's pace and compose its plain sentence. Pure. */
export function classifyJobPace(
  entry: CronScheduleEntry,
  lastRunStartedAt: string | null,
  ledgerBeganAt: string | null,
  now: Date,
  diedMidRunStartedAt: string | null = null,
): JobPace {
  const periodMs = schedulePeriodMs(entry.schedule, now);
  const lastDue = lastDueBefore(entry.schedule, now);
  const subject = subjectFor(entry);
  const base: Omit<JobPace, "pace" | "sentence"> = {
    job: entry.job,
    label: entry.label,
    lastRunAt: lastRunStartedAt,
    lastDueAt: lastDue?.toISOString() ?? null,
    periodMs,
  };

  // Died mid-run: an abandoned "started" receipt older than the grace window.
  // The job DID fire (so it is not "never ran"), it just never finished. Reuse
  // the stalled tier and the "did not finish" vocabulary - no new status word -
  // so it alarms on Today alongside the missed-run cases.
  if (diedMidRunStartedAt != null && Number.isFinite(Date.parse(diedMidRunStartedAt))) {
    return {
      ...base,
      pace: "stalled",
      sentence: capitalize(
        `${subject} started ${fmtPacific(diedMidRunStartedAt)} but did not finish. Check the Connections page.`,
      ),
    };
  }

  if (lastRunStartedAt != null && Number.isFinite(Date.parse(lastRunStartedAt))) {
    const elapsed = now.getTime() - Date.parse(lastRunStartedAt);
    if (elapsed <= HEALTHY_MAX_PERIODS * periodMs) {
      return { ...base, pace: "healthy", sentence: null };
    }
    const lastRanPhrase = fmtPacific(lastRunStartedAt);
    const duePart = lastDue ? ` It was due again ${duePhrase(lastDue, now)}.` : "";
    if (elapsed <= LATE_MAX_PERIODS * periodMs) {
      return {
        ...base,
        pace: "late",
        sentence: capitalize(
          `${subject} is running behind. It last ran ${lastRanPhrase}.${duePart}`,
        ),
      };
    }
    return {
      ...base,
      pace: "stalled",
      sentence: capitalize(
        `${subject} has not run since ${lastRanPhrase}.${duePart} Check the Connections page.`,
      ),
    };
  }

  // Never ran. Grace is anchored at the moment the ledger began: a job whose
  // first scheduled fire since then is still in the future is simply waiting.
  const anchorIso = ledgerBeganAt ?? LEDGER_EPOCH_ISO;
  const anchorMs = Date.parse(anchorIso);
  const anchor = Number.isFinite(anchorMs) ? new Date(anchorMs) : new Date(LEDGER_EPOCH_ISO);
  const firstDue = nextScheduledRun(entry.schedule, anchor);
  if (firstDue == null || now.getTime() < firstDue.getTime()) {
    return { ...base, pace: "waiting", sentence: null };
  }
  const missedBy = now.getTime() - firstDue.getTime();
  if (missedBy <= periodMs) {
    return {
      ...base,
      pace: "late",
      sentence: capitalize(
        `${subject} has not made its first run yet. It was due ${duePhrase(firstDue, now)}.`,
      ),
    };
  }
  return {
    ...base,
    pace: "stalled",
    sentence: capitalize(
      `${subject} has never run. Its first run was due ${duePhrase(firstDue, now)}. Check the Connections page.`,
    ),
  };
}

const PACE_SEVERITY: Record<CronPace, number> = {
  waiting: 0,
  healthy: 1,
  late: 2,
  stalled: 3,
};

export type DeadmanInput = {
  /** Defaults to the live CRON_SCHEDULE_MAP. */
  entries?: ReadonlyArray<CronScheduleEntry>;
  /** Newest FINISHED (or in-flight) receipt's started_at per job (null/absent =
   *  never recorded). A pure "started" receipt is never counted here. */
  latestRunByJob: ReadonlyMap<string, string | null>;
  /** started_at of an abandoned "started" receipt per job (the job fired but
   *  never finished); absent/null when the job's newest row finished or is
   *  still in-flight. */
  diedMidRunByJob?: ReadonlyMap<string, string | null>;
  /** Earliest receipt across ALL jobs; null when the ledger is empty. */
  ledgerBeganAt: string | null;
  /** Site probes, newest first (only the latest two matter). */
  probes?: ReadonlyArray<SiteProbeReading>;
  now: Date;
};

/**
 * Compose the full verdict: per-job paces, the site check, the banner copy.
 *
 * Honesty invariant (2026-07-21, all 8 Vercel cron routes deleted - the
 * product now advances on-use, never on a schedule): a job is only ever
 * classified when it has an entry in `entries` (defaults to the live
 * CRON_SCHEDULE_MAP, which is `[]` today). `latestRunByJob` /
 * `diedMidRunByJob` are looked up PER ENTRY, never iterated on their own, so
 * old cron_runs receipts left over from a job whose schedule entry was
 * removed can never resurrect a "stalled" verdict - there is no entry to
 * score them against. With `entries` empty, `jobs` is always `[]` and
 * `overall` is trivially "healthy" (see the ternary below); only the site
 * probe can still raise `alarm`.
 */
export function assessDeadman(input: DeadmanInput): DeadmanVerdict {
  const entries = input.entries ?? CRON_SCHEDULE_MAP;
  const probes = input.probes ?? [];
  const jobs = entries.map((entry) =>
    classifyJobPace(
      entry,
      input.latestRunByJob.get(entry.job) ?? null,
      input.ledgerBeganAt,
      input.now,
      input.diedMidRunByJob?.get(entry.job) ?? null,
    ),
  );

  let overall: CronPace = jobs.length > 0 ? "waiting" : "healthy";
  for (const j of jobs) {
    if (PACE_SEVERITY[j.pace] > PACE_SEVERITY[overall]) overall = j.pace;
  }

  const siteDown = probes.length >= 2 && !probes[0]!.ok && !probes[1]!.ok;
  const siteSentence = siteDown
    ? `Your site did not answer the last two times I checked. I last tried ${fmtPacific(
        probes[0]!.checkedAt,
      )}. Check that your site is up before anything else.`
    : null;

  const stalled = jobs
    .filter((j) => j.pace === "stalled" && j.sentence != null)
    .sort((a, b) => {
      // Most overdue first: elapsed since last run (or forever) over period.
      const overdue = (j: JobPace) =>
        (input.now.getTime() - (j.lastRunAt ? Date.parse(j.lastRunAt) : 0)) / j.periodMs;
      return overdue(b) - overdue(a);
    });

  const sentences: string[] = [];
  if (siteSentence) sentences.push(siteSentence);
  if (stalled.length > 0) {
    sentences.push(stalled[0]!.sentence!);
    if (stalled.length > 1) {
      sentences.push(
        `${stalled.length - 1} other scheduled job${stalled.length - 1 === 1 ? " is" : "s are"} stalled too.`,
      );
    }
  }

  return {
    overall,
    jobs,
    siteDown,
    siteSentence,
    alarm: overall === "stalled" || siteDown,
    sentences,
  };
}
