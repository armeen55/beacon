/**
 * cumulative-outcome (2026-07-02, FP8 - "total value won is never asserted") - the ONE
 * pure aggregation behind the cumulative outcome strip rendered on BOTH Today and
 * Results. PURE, no I/O; the caller feeds it the already-loaded proof ledger rows.
 *
 * HONESTY CONTRACT (same posture as lifetime-earnings.ts / change-dollar-value.ts):
 *   - Band membership reuses splitLedgerLifecycle (THE ONE-COUNT RULE in
 *     domains/changes/lifecycle-counts.ts), so shipped/decided/won/measuring here can
 *     never disagree with the Results bands or Today's tiles.
 *   - The clicks-per-month figure is the SUM of each won change's own MEASURED basis
 *     window delta (adjustedLift: treated minus comparison-page clicks), rolled to a
 *     monthly rate with the same toMonthlyRate change-dollar-value.ts uses. Never
 *     invented, never projected off a measuring row - a won row without a measured
 *     clicks delta contributes 0.
 *   - Dollars follow THE ONE DOLLAR RULE (won-dollar-rule.ts, R4 2026-07-03): the
 *     SAME strict eligibility Today's lifetime earnings odometer uses (won + mature,
 *     no shock-window overlap, no weak comparison match, a real positive GA4 traffic
 *     rate, a computed dollarValue.usdPerMonth), so the strip and the odometer can
 *     never show two different totals on the same screen. The dollar line renders
 *     only when the shared sum is positive; the sentence names the basis and says
 *     "estimate", never "measured revenue". No rate configured -> no money line, ever.
 *   - Zero final reads -> the honest still-measuring frame with the REAL date the
 *     earliest still-measuring change's 28-day window closes (soonest future close
 *     first; when every close date has already passed, say we are waiting on Google's
 *     data instead of naming a date in the past).
 *   - Read-only. Never mutates rows. No em or en dash anywhere in generated copy.
 *
 * Pinned by tests/domains/proof-gsc/cumulative-outcome.test.ts.
 */

import { splitLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
import { displayProofOutcome, UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE } from "./verdict-calibration";
import { toMonthlyRate } from "./change-dollar-value";
import { addDays } from "./measure";
import { sumWonDollarsPerMonth } from "./won-dollar-rule";
import { verdictSchedule } from "./verdict-schedule";
import type { ShockWindow } from "./algorithm-weather";

/** The minimal ledger-row shape this module needs - structurally satisfied by
 *  ShippedChangeRecord (shipped-change-store.ts), including the re-measured
 *  ledger's computed-only dollarValue attachment. */
export type CumulativeOutcomeRow = {
  id: string;
  path: string;
  shippedAt: string;
  verdict: string;
  /** Bug #14 (2026-07-06): a revert's own ledger row (actionType `revert_*`) is
   *  bookkeeping, not a distinct shipped change. splitLedgerLifecycle drops it, and
   *  `shipped` below is derived from that filtered split (not rows.length) so the
   *  cumulative strip's shipped total agrees with the Results bands. Optional; a legacy
   *  row without actionType counts as a real change. */
  actionType?: string | null;
  /** 2026-07-11 quarantine: the classifier version behind this verdict, or null
   *  (uncalibrated). Read by splitLedgerLifecycle's calibration gate, so an
   *  uncalibrated won/lost never lands in the Wins band or the dollar sum.
   *  Optional; carried straight off ShippedChangeRecord. */
  calibrationVersion?: string | null;
  /** When this row's numbers were last measured (shipped-change-store's own stamp).
   *  Optional; only read by the strip's one-line receipt (R14b), never by the math. */
  measuredAt?: string | null;
  windows: ReadonlyArray<{
    day: number;
    ran: boolean;
    controlsUsed?: number | null;
    /** Basis window's measured clicks delta vs comparison pages (diff-in-diff).
     *  Optional for legacy rows; a missing value contributes 0, never a guess. */
    adjustedLift?: number;
  }>;
  baseline?: { impressions?: number | null } | null;
  /** Computed-only attachment from the re-measured ledger (change-dollar-value.ts).
   *  Null/absent when no GA4 traffic outcome or no revenue model exists. */
  dollarValue?: { usdPerMonth: number | null } | null;
  /** Parallel-trends veto flag (weak comparison match) - THE ONE DOLLAR RULE
   *  excludes flagged rows from the dollar sum. */
  controlMatchWeak?: boolean | null;
  /** GA4 traffic outcome computed at measure time - THE ONE DOLLAR RULE requires
   *  a ran outcome with a positive control-adjusted rate before dollars count. */
  trafficOutcome?: {
    ran: boolean;
    windowDays: number;
    treated: { sessionsPre: number };
    adjustedSessionsPct: number | null;
  } | null;
  /** Behavior lane (N4, behavior-outcome.ts), computed at measure time. Read
   *  ONLY by the dollar breakdown's corroboration note (won-dollar-rule.ts) -
   *  never by any count, click, or dollar math here. */
  behaviorOutcome?: {
    compositeVerdict: "better" | "worse" | "mixed" | "same" | "none";
  } | null;
};

export type CumulativeOutcome = {
  /** All-time shipped changes (every ledger row). */
  shipped: number;
  /** Changes with a final read (mature won + lost) - same rule as Results' bands. */
  decided: number;
  /** Decided changes that won. */
  won: number;
  /** Shipped changes still without a final read. */
  measuring: number;
  /** Sum of the won changes' measured basis-window click deltas, as a monthly rate
   *  (rounded whole). 0 when no won change has a measured clicks delta. */
  winClicksPerMonth: number;
  /** Sum of the won changes' computed dollar rates, or null when none carries one. */
  estimatedUsdPerMonth: number | null;
  /** ISO date (YYYY-MM-DD) the earliest still-measuring 28-day window closes -
   *  soonest future close, falling back to the earliest past close. Null when
   *  nothing is measuring or no ship date parses. */
  firstVerdictOn: string | null;
  /** The wins-value sentence. Null unless won > 0 and the measured monthly clicks
   *  sum is positive (never a fabricated or negative-spun claim). */
  valueLine: string | null;
  /** The honest zero-final-reads frame with the real first-verdict date. Null once
   *  anything has a final read. */
  waitingLine: string | null;
  /** The clearly-labeled estimate line. Null when no won row carries a dollar rate. */
  dollarLine: string | null;
};

const fmtCount = (n: number): string =>
  Math.abs(Math.round(n)).toLocaleString("en-US", { maximumFractionDigits: 0 });

const fmtUsd = (n: number): string =>
  Math.round(Math.abs(n)).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** "Jul 18" style label from an ISO date, UTC so it is deterministic. */
function monthDayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Aggregate the whole proof ledger into the one cumulative outcome the strip
 * renders. Returns null when nothing has shipped (the strip self-hides; an
 * empty ledger has its own empty state). PURE and deterministic for a fixed
 * `now`.
 */
export function computeCumulativeOutcome(
  rows: ReadonlyArray<CumulativeOutcomeRow>,
  now: Date = new Date(),
  /** Known Google shock windows (algorithm weather) - THE ONE DOLLAR RULE excludes
   *  wins whose measurement window overlapped one. Callers without a loaded set
   *  pass [] (dollars then still require the weak-comparison + traffic gates). */
  shockWindows: ReadonlyArray<ShockWindow> = [],
): CumulativeOutcome | null {
  if (rows.length === 0) return null;

  const split = splitLedgerLifecycle(rows, now);
  const won = split.won.length;
  const decided = won + split.learned.length;
  const measuring = split.measuring.length;
  // Bug #14 - the shipped total is the DISTINCT operator changes (every band member),
  // NOT rows.length: a revert's own `revert_*` bookkeeping row was already dropped by
  // splitLedgerLifecycle, so counting the split keeps this in lockstep with the bands.
  const shipped = decided + measuring;

  // Sum each won change's OWN measured basis-window clicks delta as a monthly rate.
  let clicksPerMonth = 0;
  for (const r of split.won) {
    const basis = [...r.windows].filter((w) => w.ran).sort((a, b) => b.day - a.day)[0];
    if (basis && Number.isFinite(basis.adjustedLift)) {
      clicksPerMonth += toMonthlyRate(basis.adjustedLift as number, basis.day);
    }
  }
  const winClicksPerMonth = Math.round(clicksPerMonth);
  // THE ONE DOLLAR RULE (won-dollar-rule.ts): the same strict sum Today's lifetime
  // earnings odometer renders, so the two figures can never disagree.
  const estimatedUsdPerMonth = sumWonDollarsPerMonth(rows, now, shockWindows).usdPerMonth;

  // The real first-verdict date: earliest FUTURE 28-day close among still-measuring
  // ships; when every close date already passed, keep the earliest past one so the
  // waiting sentence can say "waiting on Google's data" instead of a stale date.
  const today = now.toISOString().slice(0, 10);
  let earliestFuture: string | null = null;
  let earliestAny: string | null = null;
  for (const r of split.measuring) {
    const ship = (r.shippedAt ?? "").slice(0, 10);
    if (!ISO_DAY.test(ship)) continue;
    const closes = addDays(ship, 28);
    if (earliestAny == null || closes < earliestAny) earliestAny = closes;
    if (closes >= today && (earliestFuture == null || closes < earliestFuture)) {
      earliestFuture = closes;
    }
  }
  const firstVerdictOn = earliestFuture ?? earliestAny;

  // P2-1 (2026-07-10, visual audit) - the SAME checkpoint date the Today proof strip
  // names (verdictSchedule.firstReadOn: the soonest future 7/14-day read), so this
  // surface and Today read as two stages of ONE schedule instead of two unrelated
  // dates on separate pages. Only prepended when it lands strictly before the
  // settled-read date below (a checkpoint on the same day as the settle would just
  // repeat the date).
  const checkpointOn = verdictSchedule(rows, now).firstReadOn;
  const checkpointClause =
    checkpointOn != null && (firstVerdictOn == null || checkpointOn < firstVerdictOn)
      ? `Next checkpoint ${monthDayLabel(checkpointOn)}. `
      : "";

  const valueLine =
    won > 0 && winClicksPerMonth > 0
      ? won === 1
        ? `Your win is adding about ${fmtCount(winClicksPerMonth)} extra clicks a month, measured against similar pages we did not change.`
        : `Together your ${fmtCount(won)} wins are adding about ${fmtCount(winClicksPerMonth)} extra clicks a month, measured against similar pages we did not change.`
      : null;

  // Fail-closed calibration quarantine, review fix 10 (2026-07-11): a quarantined
  // read (an uncalibrated won/lost sitting in the measuring band) is NOT waiting
  // on Google - the data arrived; the thresholds failed the self-test. Blaming
  // the data would be false, so when any quarantined read exists the waiting
  // sentence is the one approved honest sentence instead.
  const quarantinedReads = split.measuring.filter(
    (r) => displayProofOutcome(r).kind === "no_clear_effect_uncalibrated",
  ).length;
  const waitingLine =
    decided === 0 && measuring > 0
      ? quarantinedReads > 0
        ? `${checkpointClause}${UNCALIBRATED_NO_CLEAR_EFFECT_SENTENCE}`
        : firstVerdictOn == null
        ? `${checkpointClause}No settled reads yet. The first lands when the earliest 28-day window closes. Longer confirmation reads come later.`
        : firstVerdictOn >= today
          ? `${checkpointClause}No settled reads yet. The first lands around ${monthDayLabel(firstVerdictOn)} when the earliest 28-day window closes. Longer confirmation reads come later.`
          : `${checkpointClause}No settled reads yet. The earliest 28-day window has already closed, so the first lands as soon as Google's data catches up. Longer confirmation reads come later.`
      : null;

  const dollarLine =
    estimatedUsdPerMonth != null && estimatedUsdPerMonth > 0
      ? `At your rate, that is about $${fmtUsd(estimatedUsdPerMonth)} a month. This is an estimate, your rate times the extra visits the ${won === 1 ? "win" : "wins"} earned, not measured revenue.`
      : null;

  return {
    shipped,
    decided,
    won,
    measuring,
    winClicksPerMonth,
    estimatedUsdPerMonth,
    firstVerdictOn,
    valueLine,
    waitingLine,
    dollarLine,
  };
}
