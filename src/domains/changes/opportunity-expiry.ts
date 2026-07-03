/**
 * opportunity-expiry (BEACON_500 N46, R6, 2026-07-03) - a change row's evidence carries dates:
 * a live-SERP verdict (14d cache), a competitor teardown (14d TTL), a GSC demand window, a
 * seasonal peak window from the peak calendar, or a keyword-library research read. This module
 * turns those dates into an honest freshness verdict: fresh / aging (21d+) / expired (45d+, or
 * a seasonal window that already passed) - presentation + selection only, NEVER a re-rank and
 * NEVER a delete. An expired row leaves the default render (folded into the existing "N more
 * lower-priority ideas" expander) and gets picked back up automatically the next time its
 * evidence refreshes - nothing here writes anything or forgets anything.
 *
 * PURE. No I/O - the caller (changes-data.ts for presentation, build-today-preview.ts for the
 * nightly planner's own skip) supplies whatever evidence dates it actually has. A caller with NO
 * dates for a row supplies an empty array, which this module treats as "nothing to judge" and
 * classifies fresh - the honest default. This module never fabricates an age; absence of a date
 * is not evidence of staleness.
 */

/** One dated piece of evidence behind a change. `date` is the ISO timestamp the evidence was
 *  fetched/computed (not when the underlying fact happened) - the same "as of" convention every
 *  cache TTL in this codebase already uses (dataforseo-keywords.ts's fetchedAt, prepare-create-
 *  page-verdicts.ts's generatedAt, peak-calendar-store.ts's computed_at). */
export type EvidenceDateKind = "serp_verdict" | "competitor_teardown" | "gsc_window" | "seasonal_window" | "keyword_research" | "plan_batch";
export type EvidenceDate = {
  kind: EvidenceDateKind;
  /** ISO timestamp this piece of evidence was fetched/computed. */
  date: string;
  /** Only meaningful for kind "seasonal_window": the ISO date the peak window itself starts.
   *  When this has already passed (relative to `now`), the row is expired regardless of how
   *  fresh the underlying seasonal computation is - a "prepare for Nowruz" pitch made after
   *  Nowruz already happened is stale no matter how recently Beacon computed it. */
  windowPassedAt?: string;
};

export type FreshnessVerdict = "fresh" | "aging" | "expired";

export type FreshnessResult = {
  verdict: FreshnessVerdict;
  /** Days since the FRESHEST evidence date (the row is only as stale as its best evidence), or
   *  null when no dated evidence was supplied at all (honest "fresh by default", never guessed). */
  daysSinceFreshest: number | null;
  /** Present only for "aging" - a quiet, plain sentence ("evidence from 3 weeks ago"). */
  agingChip: string | null;
  /** Present only for "expired" - the honest reason (age or a passed seasonal window), used to
   *  build the expander sub-line and never shown as a bare status word. */
  expiredReason: string | null;
};

/** A row's evidence counts as aging once its freshest date is at least this old. */
export const AGING_THRESHOLD_DAYS = 21;
/** A row's evidence counts as expired once its freshest date is at least this old. */
export const EXPIRED_THRESHOLD_DAYS = 45;

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/** Plain "N days" / "N weeks" duration (no "ago" suffix - callers word the sentence around it
 *  differently) - rounds to whole weeks once a week or more has passed (the operator does not
 *  need day-level precision on a quiet chip). */
function agingDuration(days: number): string {
  if (days < 7) return days === 1 ? "1 day" : `${days} days`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

/**
 * Classify one change row's freshness from its evidence dates. PURE. An empty (or all-invalid)
 * `dates` array classifies fresh with `daysSinceFreshest: null` - the honest default when a row
 * carries no dated evidence at all (most rows today, until more evidence-date threading lands);
 * this NEVER counts as expired, so a row is only ever demoted when Beacon actually knows its
 * evidence is old.
 */
export function classifyOpportunityFreshness(dates: ReadonlyArray<EvidenceDate>, now: Date = new Date()): FreshnessResult {
  const nowIso = now.toISOString();

  // A passed seasonal window expires the row outright, regardless of the age of the underlying
  // computation - the honest "this pitch's moment already came and went" case the task calls out
  // by name, distinct from ordinary evidence aging.
  const passedSeasonal = dates.find(
    (d) => d.kind === "seasonal_window" && d.windowPassedAt && Date.parse(d.windowPassedAt) <= Date.parse(nowIso),
  );
  if (passedSeasonal) {
    return {
      verdict: "expired",
      daysSinceFreshest: daysBetween(passedSeasonal.date, nowIso),
      agingChip: null,
      expiredReason: "the seasonal window this was timed for has already passed",
    };
  }

  const validDates = dates.map((d) => d.date).filter((d) => Number.isFinite(Date.parse(d)));
  if (validDates.length === 0) {
    return { verdict: "fresh", daysSinceFreshest: null, agingChip: null, expiredReason: null };
  }

  // "The row is only as stale as its best evidence" - the freshest date wins, mirroring how the
  // rest of this codebase always reads the BEST available signal rather than the worst.
  const freshest = validDates.reduce((best, d) => (Date.parse(d) > Date.parse(best) ? d : best));
  const days = daysBetween(freshest, nowIso);

  if (days >= EXPIRED_THRESHOLD_DAYS) {
    return {
      verdict: "expired",
      daysSinceFreshest: days,
      agingChip: null,
      expiredReason: `my evidence for this is ${agingDuration(days)} old`,
    };
  }
  if (days >= AGING_THRESHOLD_DAYS) {
    return { verdict: "aging", daysSinceFreshest: days, agingChip: `evidence from ${agingDuration(days)} ago`, expiredReason: null };
  }
  return { verdict: "fresh", daysSinceFreshest: days, agingChip: null, expiredReason: null };
}

export type ExpiryPresentation = {
  /** Every row unchanged in ORDER (this never re-ranks); expired rows are marked, never removed. */
  rows: number;
  expiredCount: number;
  agingCount: number;
  /** The honest expander sub-line naming how many aged out and what happens next - null when
   *  nothing expired this load. Composes alongside (never replaces) the existing "N more
   *  lower-priority ideas" line. */
  expiredSubline: string | null;
};

/** Build the honest summary sentence for the expander, and the row counts a caller can log/test.
 *  PURE. Never mutates the input rows - a caller pairs this with its own per-row freshness map
 *  (from classifyOpportunityFreshness) to decide what badge/chip each row shows. */
export function summarizeExpiry(verdicts: ReadonlyArray<FreshnessVerdict>): ExpiryPresentation {
  const expiredCount = verdicts.filter((v) => v === "expired").length;
  const agingCount = verdicts.filter((v) => v === "aging").length;
  const expiredSubline =
    expiredCount > 0
      ? `${expiredCount} of these aged out; I will re-check their evidence before pitching them again.`
      : null;
  return { rows: verdicts.length, expiredCount, agingCount, expiredSubline };
}
