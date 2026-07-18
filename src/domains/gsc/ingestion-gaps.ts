/**
 * ingestion-gaps (BEACON_500 R17a / P2 slice 1, v1 item 266) - honest accounting
 * of which Google days Beacon actually has.
 *
 * The nightly GSC sync (sync-search-analytics.ts) pulls day-sliced data with a
 * 3-day final lag and a 4-day trailing re-pull. That machinery self-heals the
 * recent edge, but a day that failed FURTHER back (quota mid-backfill, a lambda
 * timeout, an upsert error) stays a silent hole forever: every window that
 * crosses it quietly under-counts. This module classifies every missing day:
 *
 *   - final_lag:   inside the last FINAL_LAG days - Google has not published
 *                  final data yet. Expected, not a problem.
 *   - gap:         inside the covered range (first ingested day .. last
 *                  expected day) - a sync hole worth re-pulling.
 *   - pre_history: before the first ingested day - Beacon never claimed to
 *                  have it.
 *
 * NEVER silently interpolate: the fix is a re-pull (the nightly sync consumes
 * `selectGapRepullDates`, capped per night), and the connections card SAYS the
 * days are missing until they heal.
 *
 * PURE, no I/O. The loader edge is load-ingestion-gaps.ts.
 */

/** Search Analytics "final" data settles ~2-3 days behind (see
 *  sync-search-analytics.ts FINAL_LAG_DAYS - kept in lockstep by test). */
export const GSC_FINAL_LAG_DAYS = 3;

/** The most gap days one nightly sync re-pulls (each day is 3 API calls). */
export const GAP_REPULL_CAP_PER_NIGHT = 10;

export type MissingDayKind = "final_lag" | "gap" | "pre_history";

export type IngestionGapReport = {
  /** Earliest / latest ingested dates (YYYY-MM-DD), null when nothing synced. */
  firstIngestedDate: string | null;
  lastIngestedDate: string | null;
  /** The last day Google should have final data for (today minus the lag). */
  lastExpectedDate: string;
  /** Calendar days in [firstIngestedDate .. lastExpectedDate]. 0 pre-sync. */
  expectedDayCount: number;
  /** Distinct ingested days inside that range. */
  presentDayCount: number;
  /** Missing days INSIDE the covered range - real sync holes, ascending. */
  gapDates: string[];
  /** Missing days newer than lastExpectedDate (Google's normal lag), ascending. */
  finalLagDates: string[];
};

/** YYYY-MM-DD for `d` in America/Los_Angeles (Search Console dates are Pacific
 *  Time; en-CA renders ISO order). Same rule sync-search-analytics.ts uses. */
export function pacificTodayString(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function addDays(isoDate: string, days: number): string {
  const t = new Date(isoDate + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/** Classify one missing day against the covered range. Pure boundary logic:
 *  after lastExpectedDate -> final_lag; before firstIngestedDate ->
 *  pre_history; otherwise a real gap. */
export function classifyMissingDay(
  date: string,
  firstIngestedDate: string,
  lastExpectedDate: string,
): MissingDayKind {
  if (date > lastExpectedDate) return "final_lag";
  if (date < firstIngestedDate) return "pre_history";
  return "gap";
}

/**
 * Compare the calendar since the first ingested day against the days actually
 * present. `todayPacific` anchors the expected edge (today minus the final
 * lag). No ingested days at all -> an empty report (nothing to classify; a
 * never-synced tenant has no "gaps", it has no history).
 */
export function buildIngestionGapReport(
  actualDates: Iterable<string>,
  todayPacific: string,
  finalLagDays: number = GSC_FINAL_LAG_DAYS,
): IngestionGapReport {
  const present = new Set<string>();
  for (const raw of actualDates) {
    const d = typeof raw === "string" ? raw.slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) present.add(d);
  }
  const lastExpectedDate = addDays(todayPacific, -finalLagDays);
  if (present.size === 0) {
    return {
      firstIngestedDate: null,
      lastIngestedDate: null,
      lastExpectedDate,
      expectedDayCount: 0,
      presentDayCount: 0,
      gapDates: [],
      finalLagDates: [],
    };
  }
  const sorted = [...present].sort();
  const firstIngestedDate = sorted[0]!;
  const lastIngestedDate = sorted[sorted.length - 1]!;

  const gapDates: string[] = [];
  let expectedDayCount = 0;
  let presentDayCount = 0;
  for (let day = firstIngestedDate; day <= lastExpectedDate; day = addDays(day, 1)) {
    expectedDayCount += 1;
    if (present.has(day)) presentDayCount += 1;
    else gapDates.push(day);
  }
  const finalLagDates: string[] = [];
  for (let day = addDays(lastExpectedDate, 1); day <= todayPacific; day = addDays(day, 1)) {
    if (!present.has(day)) finalLagDates.push(day);
  }
  return {
    firstIngestedDate,
    lastIngestedDate,
    lastExpectedDate,
    expectedDayCount,
    presentDayCount,
    gapDates,
    finalLagDates,
  };
}

/** Which gap days tonight's sync re-pulls: the NEWEST first (recent days feed
 *  live decisions; older holes heal on later nights), capped. */
export function selectGapRepullDates(
  gapDates: readonly string[],
  cap: number = GAP_REPULL_CAP_PER_NIGHT,
): string[] {
  return [...gapDates].sort().reverse().slice(0, Math.max(0, cap));
}

/** "Jun 14" from YYYY-MM-DD; the raw input on a parse failure (never invented). */
function monthDay(isoDate: string): string {
  const ms = Date.parse(isoDate + "T12:00:00Z");
  if (!Number.isFinite(ms)) return isoDate;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The one line the connections GSC card shows when real gaps exist. Null when
 * there are none (the card renders exactly as before). Names the dates, says
 * what happens next, never a dash, never a lab word.
 */
export function ingestionGapLine(
  report: Pick<IngestionGapReport, "gapDates">,
  repullCapPerNight: number = GAP_REPULL_CAP_PER_NIGHT,
): string | null {
  const gaps = report.gapDates;
  if (gaps.length === 0) return null;
  if (gaps.length === 1) {
    return `I am missing 1 day of Google data (${monthDay(gaps[0]!)}). I will re-pull it automatically while you use Beacon.`;
  }
  const first = monthDay(gaps[0]!);
  const last = monthDay(gaps[gaps.length - 1]!);
  if (gaps.length <= repullCapPerNight) {
    return `I am missing ${gaps.length} days of Google data between ${first} and ${last}. I will re-pull them automatically while you use Beacon.`;
  }
  return `I am missing ${gaps.length} days of Google data between ${first} and ${last}. I will recover up to ${repullCapPerNight} missing days each time background upkeep runs.`;
}
