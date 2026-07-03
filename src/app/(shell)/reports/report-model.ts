/**
 * report-model (P23, 2026-07-03) - THE pure shaping behind the internal reports
 * pack. No I/O, deterministic for a fixed `now`; reports-data.ts feeds it the
 * shared /results snapshot rows and this builds two things:
 *
 *   1. Win cards  (buildWinCards)     - one clean "here is a win" card per
 *      measured win, screenshot-ready: the change, the page, the before->after
 *      clicks a month, and the window it was measured over.
 *   2. Monthly report (the model)     - the trailing-month honest summary:
 *      changes shipped, how many won / still measuring / did not move the
 *      needle, total clicks gained across wins, the single biggest win, and the
 *      honest misses.
 *
 * COUNT AGREEMENT CONTRACT
 * -----------------------
 * Every count here comes from the SAME canonical resolvers /results renders:
 *   - band membership + shipped/decided/won/measuring from computeCumulativeOutcome
 *     (which itself calls splitLedgerLifecycle - THE ONE-COUNT RULE), and
 *   - the per-win and total clicks-a-month figure from the SAME
 *     toMonthlyRate(basis.adjustedLift, basis.day) sum computeCumulativeOutcome
 *     uses for winClicksPerMonth.
 * So /reports can never print a count or a clicks total that /results contradicts.
 *
 * Beacon voice: first person, a concrete number, no lab words, wins in one
 * sentence, misses owned plainly, no em or en dashes ever.
 */

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { splitLedgerLifecycle } from "@/domains/changes/lifecycle-counts";
import {
  computeCumulativeOutcome,
  type CumulativeOutcome,
} from "@/domains/proof-gsc/cumulative-outcome";
import { toMonthlyRate } from "@/domains/proof-gsc/change-dollar-value";
import { buildRecapItems, type RecapItem } from "../results/results-recap";
import { plainChangeKind } from "@/lib/plain-language";

/** Trailing-month window length for "changes shipped this month". */
export const REPORT_WINDOW_DAYS = 30;

/** A single measured win, shaped for the export card. */
export type WinCard = {
  id: string;
  /** Host-stripped page path (canonical). */
  path: string;
  /** Plain page name for the headline ("Persian comedians page"). */
  pageName: string;
  /** Plain change name ("title rewrite"). */
  changeKind: string;
  /** Extra clicks a month this win is adding (whole, positive). */
  clicksPerMonth: number;
  /** Days the win was measured over (the basis window: 7 / 14 / 28). */
  windowDays: number;
  /** ISO ship date (YYYY-MM-DD) for "since ...". */
  shippedOn: string;
  /** The one screenshot-ready sentence. */
  headline: string;
};

export type ReportModel = {
  /** ISO timestamp the served snapshot was measured (for the receipt line). */
  computedAt: string;
  /** The shared cumulative outcome (counts + winClicksPerMonth + dollars). Null
   *  only when nothing has ever shipped. */
  outcome: CumulativeOutcome | null;
  /** Total shipped changes all time (every ledger row). */
  shipped: number;
  /** Changes SHIPPED in the trailing 30 days (the report window). */
  shippedThisMonth: number;
  /** Measured wins, biggest first. Empty until a win matures. */
  wins: WinCard[];
  /** The single biggest measured win, or null when there is none yet. */
  biggestWin: WinCard | null;
  /** Total extra clicks a month across ALL wins (the shared winClicksPerMonth). */
  totalClicksPerMonth: number;
  /** The honest misses (retracted calls + proven-neutral changes), newest first. */
  misses: RecapItem[];
};

/** "Persian comedians page" from "/persian-comedians". Never a raw slug. */
export function pageNameFromPath(path: string): string {
  const slug = path.split("/").filter(Boolean).pop();
  const words = (slug ?? "").replace(/[-_]+/g, " ").trim();
  if (!words) return "This page";
  return `${words} page`;
}

/** The win's own measured basis-window clicks delta, rolled to a monthly rate -
 *  the SAME number computeCumulativeOutcome sums into winClicksPerMonth, so a
 *  single card and the total can never disagree. 0 when no measured delta. */
export function winClicksPerMonthOf(rec: ShippedChangeRecord): {
  clicksPerMonth: number;
  windowDays: number;
} {
  const basis = [...(rec.windows ?? [])]
    .filter((w) => w.ran)
    .sort((a, b) => b.day - a.day)[0];
  if (basis && Number.isFinite(basis.adjustedLift)) {
    return {
      clicksPerMonth: Math.round(toMonthlyRate(basis.adjustedLift as number, basis.day)),
      windowDays: basis.day,
    };
  }
  return { clicksPerMonth: 0, windowDays: basis?.day ?? 0 };
}

/**
 * One screenshot-ready win sentence, e.g.
 * "Persian comedians page: +38 clicks a month since we shipped the title
 *  rewrite, measured over 28 days."
 * Plain, first person, a concrete number, no lab words, no dashes.
 */
export function winHeadline(card: Omit<WinCard, "headline">): string {
  const clicks = card.clicksPerMonth.toLocaleString("en-US");
  const window =
    card.windowDays > 0 ? `, measured over ${card.windowDays} days` : "";
  return `${card.pageName}: +${clicks} clicks a month since we shipped the ${card.changeKind}${window}.`;
}

/**
 * The measured wins, shaped for the export card, biggest first. A win is a row
 * in the shared Wins band (splitLedgerLifecycle) that carries a positive
 * measured clicks-a-month figure - a win with no measured clicks delta is
 * honestly left off the export (there is no number to celebrate).
 */
export function buildWinCards(
  ledger: ReadonlyArray<ShippedChangeRecord>,
  now: Date,
): WinCard[] {
  const split = splitLedgerLifecycle(ledger, now);
  const cards: WinCard[] = [];
  for (const rec of split.won) {
    const { clicksPerMonth, windowDays } = winClicksPerMonthOf(rec);
    if (clicksPerMonth <= 0) continue;
    const base = {
      id: rec.id,
      path: rec.path,
      pageName: pageNameFromPath(rec.path),
      changeKind: plainChangeKind(rec.actionType),
      clicksPerMonth,
      windowDays,
      shippedOn: (rec.shippedAt ?? "").slice(0, 10),
    };
    cards.push({ ...base, headline: winHeadline(base) });
  }
  return cards.sort((a, b) => b.clicksPerMonth - a.clicksPerMonth);
}

/** True when a ship date is within the trailing window of `now`. */
function shippedWithinWindow(shippedAt: string, now: Date, windowDays: number): boolean {
  const t = Date.parse(shippedAt.length === 10 ? `${shippedAt}T00:00:00Z` : shippedAt);
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t <= windowDays * 86_400_000 && t <= now.getTime();
}

/**
 * Compose the whole report model from the shared /results snapshot. PURE.
 * Every count routes through computeCumulativeOutcome / splitLedgerLifecycle /
 * buildRecapItems so /reports agrees with /results and its "We got this wrong"
 * section by construction.
 */
export function buildReportModel(input: {
  ledger: ReadonlyArray<ShippedChangeRecord>;
  computedAt: string;
  now?: Date;
}): ReportModel {
  const now = input.now ?? new Date();
  const ledger = input.ledger;
  const outcome = computeCumulativeOutcome(ledger, now);
  const wins = buildWinCards(ledger, now);
  const misses = buildRecapItems(ledger, plainChangeKind);
  const shippedThisMonth = ledger.filter((r) =>
    shippedWithinWindow(r.shippedAt ?? "", now, REPORT_WINDOW_DAYS),
  ).length;
  return {
    computedAt: input.computedAt,
    outcome,
    shipped: outcome?.shipped ?? ledger.length,
    shippedThisMonth,
    wins,
    biggestWin: wins[0] ?? null,
    totalClicksPerMonth: outcome?.winClicksPerMonth ?? 0,
    misses,
  };
}

/**
 * The one honest headline for the monthly report, e.g.
 * "This month I shipped 6 changes. 2 won, 3 are still measuring, and 1 did not
 *  move the needle." First person, real counts, no lab words, no dashes.
 * Null when nothing has shipped at all (the page shows its empty state instead).
 */
export function monthlyHeadline(model: ReportModel): string | null {
  const o = model.outcome;
  if (!o || o.shipped === 0) return null;
  const won = o.won;
  const measuring = o.measuring;
  const didNotMove = o.decided - o.won; // mature results that did not win
  const shippedClause =
    model.shippedThisMonth > 0
      ? `This month I shipped ${model.shippedThisMonth} ${
          model.shippedThisMonth === 1 ? "change" : "changes"
        }.`
      : `I have not shipped a new change in the last ${REPORT_WINDOW_DAYS} days.`;
  const parts: string[] = [];
  if (won > 0) parts.push(`${won} won`);
  if (measuring > 0) parts.push(`${measuring} ${measuring === 1 ? "is" : "are"} still measuring`);
  if (didNotMove > 0)
    parts.push(`${didNotMove} did not move the needle`);
  if (parts.length === 0) return shippedClause;
  // Join with a trailing "and" before the last clause.
  const scoreboard =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  return `${shippedClause} Across everything I am tracking, ${scoreboard}.`;
}

/**
 * The one plainly-owned misses line, e.g.
 * "2 changes did not move the needle. Here is what we learned." Null when there
 * is nothing to own. Beacon voice: misses owned plainly, no hedging.
 */
export function missesOwnedLine(model: ReportModel): string | null {
  if (model.misses.length === 0) return null;
  const n = model.misses.length;
  return `${n} ${n === 1 ? "change" : "changes"} did not move the needle. Here is what we learned.`;
}
