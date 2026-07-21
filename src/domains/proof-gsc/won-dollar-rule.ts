/**
 * won-dollar-rule (2026-07-03, R4 - "one dollar figure everywhere").
 *
 * THE ONE DOLLAR RULE
 * -------------------
 * Before this module, two cumulative dollar figures could disagree on the same
 * screen: the cumulative outcome strip (Today + Results) summed every won-band
 * row's dollarValue.usdPerMonth, while Today's lifetime earnings odometer applied
 * stricter exclusions (algorithm-weather shock overlap, weak comparison pages,
 * a real GA4 traffic outcome). Same ledger, two totals - the exact contradiction
 * class the finished-product campaign exists to kill.
 *
 * This module is now the ONE place that decides which shipped changes may
 * contribute to ANY cumulative dollar figure. The rule is the STRICTER set
 * (honesty over size): a change contributes dollars only when ALL of these hold:
 *
 *   1. WON and MATURE: it sits in the Wins band of the shared lifecycle split
 *      (splitLedgerLifecycle - the same deriveMeasurementMaturity call Results
 *      uses to place a row in "Wins", overlap-aware, 28-day sufficiency).
 *   2. CLEAN ATTRIBUTION: its measurement window overlaps no known Google shock
 *      window, and its comparison pages were not a weak fallback match
 *      (controlMatchWeak).
 *   3. REAL TRAFFIC BASIS: it has a GA4 traffic outcome that actually ran, and
 *      the control-adjusted extra-sessions monthly rate is positive - dollars
 *      are rate x extra visits, so no measured extra visits means no dollars.
 *   4. A COMPUTED RATE: it carries a finite dollarValue.usdPerMonth (the
 *      operator's own revenue model applied at measure time - never re-derived
 *      here).
 *
 * Consumers (both surfaces MUST route their dollar total through this module,
 * pinned by tests/domains/proof-gsc/won-dollar-rule.test.ts):
 *   - domains/proof-gsc/cumulative-outcome.ts (the strip on Today AND Results)
 *   - src/app/(shell)/scoreboard-section.tsx buildLifetimeEarningsRows (Today's
 *     lifetime earnings odometer)
 *
 * PURE. No I/O, no dates read internally, deterministic for a fixed `now`.
 */

import { splitLedgerLifecycle, type LedgerLifecycleRow } from "@/domains/changes/lifecycle-counts";
import { measurementWindowOf } from "./measurement-maturity";
import { overlappingShock, type ShockWindow } from "./algorithm-weather";
import { extraSessionsFromTrafficOutcome, toMonthlyRate } from "./change-dollar-value";

/** The minimal ledger-row shape the dollar rule needs - structurally satisfied by
 *  ShippedChangeRecord (shipped-change-store.ts) including the re-measured ledger's
 *  computed-only trafficOutcome / dollarValue attachments. */
export type WonDollarRow = LedgerLifecycleRow & {
  /** Parallel-trends veto: comparison pages were a fallback match. */
  controlMatchWeak?: boolean | null;
  /** GA4 traffic outcome computed at measure time (traffic-outcome.ts). */
  trafficOutcome?: {
    ran: boolean;
    windowDays: number;
    treated: { sessionsPre: number };
    adjustedSessionsPct: number | null;
  } | null;
  /** The operator's-rate dollar attachment (change-dollar-value.ts). */
  dollarValue?: { usdPerMonth: number | null } | null;
  /** Behavior lane (N4, behavior-outcome.ts): computed at measure time. Read
   *  here ONLY to cite corroboration on a win's breakdown row - it never
   *  changes which rows contribute dollars or how much. */
  behaviorOutcome?: { compositeVerdict: "better" | "worse" | "mixed" | "same" | "none" } | null;
};

/**
 * The row's control-adjusted extra-sessions rate per month, from the SAME
 * traffic-outcome numbers change-dollar-value.ts priced (never re-derived from
 * raw GA4). 0 when the traffic outcome is missing or never ran.
 */
export function monthlyExtraSessionsRate(row: WonDollarRow): number {
  const t = row.trafficOutcome;
  if (!t || t.ran !== true) return 0;
  return toMonthlyRate(extraSessionsFromTrafficOutcome(t), t.windowDays);
}

/** Rule 2: no shock-window overlap, no weak comparison match. Exported so any
 *  per-change dollar surface (e.g. the /reports win cards) can gate its own dollar
 *  line by the SAME trustworthiness test the cumulative figures use, instead of
 *  claiming dollars for a win every cumulative total excludes. */
export function hasCleanAttribution(row: WonDollarRow, shockWindows: ReadonlyArray<ShockWindow>): boolean {
  if (row.controlMatchWeak === true) return false;
  if (shockWindows.length > 0) {
    const window = measurementWindowOf(row.shippedAt, row.windows);
    if (window && overlappingShock(window.start, window.end, shockWindows)) return false;
  }
  return true;
}

/**
 * Every MATURE result (won or lost band) with clean attribution - the shared
 * "settled and trustworthy" cohort. Ledger order preserved. Used by surfaces
 * that aggregate the whole settled cohort (e.g. the portfolio counterfactual),
 * so their eligibility can never drift from the dollar rule's.
 */
export function selectMatureCleanResults<T extends WonDollarRow>(
  rows: ReadonlyArray<T>,
  now: Date,
  shockWindows: ReadonlyArray<ShockWindow>,
): T[] {
  const split = splitLedgerLifecycle(rows, now);
  const mature = new Set<T>([...split.won, ...split.learned]);
  return rows.filter((r) => mature.has(r) && hasCleanAttribution(r, shockWindows));
}

/**
 * THE dollar-eligible set: rules 1-3 above (won + mature, clean attribution,
 * positive measured traffic rate). Rule 4 (a finite usdPerMonth) is applied by
 * the summer below - a clicks-only row (no revenue model) still belongs here so
 * the odometer can honestly report clicks without dollars.
 */
export function selectDollarRuleWins<T extends WonDollarRow>(
  rows: ReadonlyArray<T>,
  now: Date,
  shockWindows: ReadonlyArray<ShockWindow>,
): T[] {
  return splitLedgerLifecycle(rows, now).won.filter(
    (r) => hasCleanAttribution(r, shockWindows) && monthlyExtraSessionsRate(r) > 0,
  );
}

/**
 * THE cumulative dollar figure. Sums dollarValue.usdPerMonth over the
 * dollar-eligible wins that carry one (rule 4), rounded to cents. Null (never a
 * fabricated $0) when no row contributes. Both the cumulative outcome strip and
 * the lifetime earnings odometer render exactly this sum.
 */
export function sumWonDollarsPerMonth(
  rows: ReadonlyArray<WonDollarRow>,
  now: Date,
  shockWindows: ReadonlyArray<ShockWindow>,
): { usdPerMonth: number | null; contributingWins: number } {
  let total = 0;
  let contributingWins = 0;
  for (const row of selectDollarRuleWins(rows, now, shockWindows)) {
    const usd = row.dollarValue?.usdPerMonth;
    if (usd != null && Number.isFinite(usd)) {
      total += usd;
      contributingWins += 1;
    }
  }
  return {
    usdPerMonth: contributingWins > 0 ? Math.round(total * 100) / 100 : null,
    contributingWins,
  };
}

/** One per-win breakdown row behind the strip's dollar figure (R14b see-the-math).
 *  `behaviorNote` (N4) is present ONLY when visitors also behaved better on the
 *  page after the change - one corroboration line, never a selection input. */
export type WonDollarBreakdownRow = { path: string; usdPerMonth: number; behaviorNote?: string };

/** N4 - the one corroboration sentence a win's breakdown row may carry. */
export const BEHAVIOR_CORROBORATION_NOTE =
  "Visitors also behaved better on this page after the change.";

/**
 * R14b (see-the-math completion) - the per-win rows behind THE cumulative
 * dollar figure, selected by the EXACT same rule sumWonDollarsPerMonth sums
 * over (so the breakdown's rows always add up to the figure it explains).
 * Path-bearing rows only; empty when nothing contributes.
 */
export function buildWonDollarBreakdown(
  rows: ReadonlyArray<WonDollarRow>,
  now: Date,
  shockWindows: ReadonlyArray<ShockWindow>,
): WonDollarBreakdownRow[] {
  const out: WonDollarBreakdownRow[] = [];
  for (const row of selectDollarRuleWins(rows, now, shockWindows)) {
    const usd = row.dollarValue?.usdPerMonth;
    if (usd != null && Number.isFinite(usd)) {
      const breakdownRow: WonDollarBreakdownRow = {
        path: row.path,
        usdPerMonth: Math.round(usd * 100) / 100,
      };
      // N4 corroboration - one line, only when behavior actually improved.
      // Never a selection input: the row is already in the dollar set.
      if (row.behaviorOutcome?.compositeVerdict === "better") {
        breakdownRow.behaviorNote = BEHAVIOR_CORROBORATION_NOTE;
      }
      out.push(breakdownRow);
    }
  }
  return out;
}

/**
 * THE ONE DOLLAR RULE in one plain sentence, rendered wherever the cumulative
 * dollar figure opens up. One string constant so every surface says it in the
 * same words. Beacon voice: no lab words, no em or en dashes.
 */
export const WON_DOLLAR_RULE_SENTENCE =
  "Only wins count toward this number: each one finished its full 28 day read, had clean comparison pages, and showed a real measured gain in visits. Anything less adds nothing.";
