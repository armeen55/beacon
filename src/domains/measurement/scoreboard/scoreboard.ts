/**
 * scoreboard (2026-07-01, FINAL PREMIUM PLAN items 1-3) - PURE math for the Today hero chart:
 * the one picture that answers "am I winning?". Takes the property's daily GSC totals + the
 * shipped-change ledger and produces a render-ready model:
 *   - daily click points + a 7-day rolling average (the honest trend line)
 *   - change markers placed on the chart at each ship date (won = green, measuring = neutral,
 *     no lift = amber) so cause and effect live in one picture
 *   - a one-sentence verdict comparing the last 7 FULL days of data vs the prior 7
 * No I/O, no LLM. GSC reports with a ~3 day lag; the caller passes whatever rows exist and the
 * math uses the latest REPORTED date as "now" so a lag never fakes a decline.
 *
 * The chart explains the click trend and nothing else. The measuring COUNT and the next-read
 * date belong to Today's proof strip (loadLifecycleCounts + the one verdictSchedule); the
 * scoreboard used to derive its own from a second ledger read and print a second, smaller
 * number in the same screen. The marker TONE still reads splitLedgerLifecycle so a marker can
 * never disagree with Results about whether a change won.
 */

import {
  splitLedgerLifecycle,
  type LedgerLifecycleStage,
} from "@/domains/decision/changes/lifecycle-counts";
import { type VerdictScheduleRow } from "@/domains/measurement/proof-gsc/verdict-schedule";

type ScoreboardDay = { date: string; clicks: number; impressions: number };

/**
 * The scoreboard reads the FULL ledger row (with windows + baseline), not a slim
 * verdict-string projection, so it can classify each change through the canonical
 * lifecycle rule instead of re-deriving its own from `verdict`. Structurally satisfied
 * by ShippedChangeRecord.
 */
export type ScoreboardLedgerRow = VerdictScheduleRow;

type ScoreboardMarker = {
  date: string; // yyyy-mm-dd
  /** Count of changes shipped that day. */
  count: number;
  tone: "won" | "measuring" | "flat";
  /** Plain one-liner for the tooltip: "2 changes shipped (measuring)". */
  label: string;
};

export type Scoreboard = {
  days: ScoreboardDay[];
  /** 7-day rolling average of clicks, aligned to `days` (null until 7 days exist). */
  rolling: Array<number | null>;
  markers: ScoreboardMarker[];
  /** Sum of clicks over the last 7 reported days. */
  last7Clicks: number;
  /** Percent change vs the prior 7 reported days (null when prior window is empty). */
  deltaPct: number | null;
  /** Sum of impressions over the last 7 reported days. */
  last7Impressions: number;
  /** Latest date GSC has reported (the chart's honest right edge). */
  reportedThrough: string;
  /** The one-line click-trend sentence, plain language, no jargon, no dashes. */
  verdictLine: string;
};

/** One day of dollars from revenue_facts, pre-aggregated by the loader. */
type ScoreboardRevenueDay = {
  day: string; // yyyy-mm-dd
  revenueUsd: number;
  sources: string[];
};

/**
 * Item 3 (2026-07-01) - the honest money line under the hero chart. PURE.
 * Sums the last 7 days that actually have dollars and names the basis:
 * measured (ad network report) reads as measured; the operator's rate x
 * real traffic reads exactly as that and NEVER as a measured payout.
 * Returns null when there are no dollars, so the scoreboard renders
 * exactly as it did before the revenue pipe existed.
 */
export function buildMoneyLine(revenueDays: ScoreboardRevenueDay[]): string | null {
  const withDollars = revenueDays
    .filter((d) => d.day && Number.isFinite(d.revenueUsd) && d.revenueUsd > 0)
    .sort((a, b) => (a.day < b.day ? -1 : 1));
  if (withDollars.length === 0) return null;

  const last = withDollars.slice(-7);
  const total = last.reduce((s, d) => s + d.revenueUsd, 0);
  if (total <= 0) return null;

  const sources = new Set(last.flatMap((d) => d.sources));
  const hasMeasured = sources.has("ad_network") || sources.has("affiliate");
  const hasEstimated = sources.has("unit_economics") || sources.has("operator_manual");

  const dollars = `$${total.toLocaleString("en-US", {
    minimumFractionDigits: total >= 100 ? 0 : 2,
    maximumFractionDigits: total >= 100 ? 0 : 2,
  })}`;
  const span = last.length === 1 ? "the last tracked day" : `the last ${last.length} tracked days`;

  if (hasMeasured && !hasEstimated) {
    return `Your pages earned ${dollars} over ${span}, measured by your ad network.`;
  }
  if (hasMeasured && hasEstimated) {
    return `Your pages earned about ${dollars} over ${span}. Part is measured and part is your rate x real traffic.`;
  }
  return `Real traffic was worth about ${dollars} over ${span}. That is your rate x real traffic, not a measured payout.`;
}

export function buildScoreboard(
  daysIn: ScoreboardDay[],
  ledger: ScoreboardLedgerRow[],
  now: Date = new Date(),
): Scoreboard | null {
  const days = [...daysIn]
    .filter((d) => d.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (days.length < 14) return null; // not enough history to say anything honest

  const reportedThrough = days[days.length - 1]!.date;

  // 7-day rolling average of clicks.
  const rolling: Array<number | null> = days.map((_, i) => {
    if (i < 6) return null;
    let sum = 0;
    for (let j = i - 6; j <= i; j++) sum += days[j]!.clicks;
    return Math.round((sum / 7) * 10) / 10;
  });

  // Last 7 reported days vs the prior 7.
  const last7 = days.slice(-7);
  const prior7 = days.slice(-14, -7);
  const last7Clicks = last7.reduce((s, d) => s + d.clicks, 0);
  const prior7Clicks = prior7.reduce((s, d) => s + d.clicks, 0);
  const last7Impressions = last7.reduce((s, d) => s + d.impressions, 0);
  const deltaPct = prior7Clicks > 0 ? Math.round(((last7Clicks - prior7Clicks) / prior7Clicks) * 100) : null;

  // Canonical lifecycle classification for the WHOLE ledger, once. Marker tone reads this
  // map, so a marker can never disagree with Results' bands (the FP3 "25 vs 6" class of bug).
  const split = splitLedgerLifecycle(ledger, now);
  const stageById = new Map<string, LedgerLifecycleStage>();
  for (const r of split.won) stageById.set(r.id, "won");
  for (const r of split.learned) stageById.set(r.id, "learned");
  // A promising early improvement is still measuring on every surface: it must
  // never read as a win before its 28-day window closes.
  for (const r of split.promising) stageById.set(r.id, "measuring");
  for (const r of split.measuring) stageById.set(r.id, "measuring");

  // Markers: group ledger rows by ship DAY, only within the charted range.
  const first = days[0]!.date;
  const byDay = new Map<string, ScoreboardLedgerRow[]>();
  for (const r of ledger) {
    const d = (r.shippedAt ?? "").slice(0, 10);
    if (!d || d < first || d > reportedThrough) continue;
    const arr = byDay.get(d) ?? [];
    arr.push(r);
    byDay.set(d, arr);
  }
  const markers: ScoreboardMarker[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, rows]) => {
      const stages = rows.map((r) => stageById.get(r.id) ?? "measuring");
      const won = stages.includes("won");
      const measuring = stages.includes("measuring");
      const tone: ScoreboardMarker["tone"] = won ? "won" : measuring ? "measuring" : "flat";
      const label =
        rows.length === 1
          ? `1 change shipped (${won ? "won" : measuring ? "measuring" : "no clear lift"})`
          : `${rows.length} changes shipped (${won ? "includes a win" : measuring ? "measuring" : "no clear lift"})`;
      return { date, count: rows.length, tone, label };
    });

  // R17a (brand split, v1 265): this sentence counts EVERY search - brand and
  // not - so it says which lens it uses. The non-brand growth lens renders as
  // its own sub-line on the scoreboard (see brand-split.ts). It says nothing about
  // how many changes are measuring: the proof strip owns that count and its date.
  // 2026-08-12: it no longer REPEATS the headline either. The number and its change sit
  // directly above this line, and stating both a third time read as three findings.
  const verdictLine =
    deltaPct == null ? "No full week before this one to compare against yet, counting every search."
      : deltaPct > 2 ? "Climbing against the 7 reported days before, counting every search."
        : deltaPct < -2 ? "Falling against the 7 reported days before, counting every search."
          : "Level with the 7 reported days before, counting every search.";

  return {
    days,
    rolling,
    markers,
    last7Clicks,
    deltaPct,
    last7Impressions,
    reportedThrough,
    verdictLine,
  };
}
