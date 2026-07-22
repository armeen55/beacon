/**
 * investigation/family-collapse (2026-07-02, master plan item 53) - PURE.
 *
 * Groups per-page daily clicks into page families (daily-experiment-planner's
 * pageFamilyOf grouping - first path segment, e.g. /cheetah/x and /cheetah/y
 * both roll up to "cheetah") and runs the existing week-over-week spike engine
 * (spike-detector.ts's detectSpikes, the same engine trend-radar's query-spikes
 * uses) with collapse detection turned on, so a family that lost most of its
 * clicks week over week surfaces the same way a query spike does.
 *
 * Same anchor-aligned-week math as query-spikes.ts: this week = the 7 days
 * ending on the newest day present in the rows, typical week = the trailing
 * fully-covered weekly average. Fail-closed: fewer than MIN_COVERED_TRAILING_
 * WEEKS of history stays silent rather than fabricating a collapse out of
 * missing data.
 */

import { detectSpikes, type WeeklySeries, type SpikeSignal } from "../trend-radar/spike-detector";
/** First path segment groups a page family (inlined; the experiments domain that owned it was removed). */
function pageFamilyOf(url: string): string {
  const path = (url ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[0]! : (segs[0] ?? "root");
}

/** A collapse must be at least this fraction below the typical week (0.4 =
 *  lost 40 percent or more) to register at all. */
export const COLLAPSE_MIN_DROP = 0.4;
/** A drop at/beyond this fraction (0.6 = lost 60 percent or more) counts as
 *  "high" severity - the threshold that triggers an overnight investigation. */
export const COLLAPSE_HIGH_DROP = 0.6;
/** Absolute floor: the typical week must have had at least this many clicks,
 *  so a family that went from 3 clicks to 1 never reads as a "collapse". */
export const COLLAPSE_MIN_TYPICAL_CLICKS = 20;
/** Baseline: up to this many trailing full weeks behind this week. */
export const TRAILING_WEEKS = 4;
/** Fail-closed history gate, same rationale as query-spikes.ts. */
export const MIN_COVERED_TRAILING_WEEKS = 2;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** One per-page per-day clicks row (lean projection). */
export type PageDailyRow = {
  /** YYYY-MM-DD (longer ISO strings are sliced). */
  date: string;
  page: string;
  clicks: number;
};

/** The minimum shape an investigation needs to target a family: which family,
 *  which URLs to live-check, and how big it typically is (for ranking). A
 *  FamilyCollapse is structurally a FamilyTarget with drop details on top. */
export type FamilyTarget = {
  family: string;
  pages: string[];
  typicalWeekClicks: number;
};

export type FamilyCollapse = {
  family: string;
  /** Representative pages that make up the family in this data (for the
   *  evidence collector to know which URLs to live-check). */
  pages: string[];
  thisWeekClicks: number;
  typicalWeekClicks: number;
  /** Negative fraction, e.g. -0.6 = lost 60 percent. Never null for a
   *  collapse (unlike query-spikes' emerging case, a collapse always has a
   *  positive typical baseline by construction - see COLLAPSE_MIN_TYPICAL_CLICKS). */
  dropPct: number;
  severity: "high" | "medium";
  /** The newest day present in the data - the collapse is dated to the START
   *  of "this week" (anchor - 6 days), the first day of the dropped window. */
  collapseDate: string;
};

function dayMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

function addDaysIso(iso: string, days: number): string {
  return new Date(dayMs(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Newest finalized day present in the rows, or null when there is no usable
 *  row. PURE. Mirrors query-spikes.ts's anchorDateOf. */
export function anchorDateOfPages(rows: ReadonlyArray<PageDailyRow>): string | null {
  let best: string | null = null;
  for (const r of rows) {
    if (!r.date) continue;
    const d = r.date.slice(0, 10);
    if (!Number.isFinite(dayMs(d))) continue;
    if (best === null || d > best) best = d;
  }
  return best;
}

type FamilyAgg = {
  thisWeek: number;
  trailing: number;
  pages: Set<string>;
};

/**
 * Ranked week-over-week family collapses. PURE.
 *
 * Groups rows by pageFamilyOf(page), sums clicks per family per week, then
 * hands ONE 2-point series per family to the shared spike engine with
 * includeCollapse turned on. Only "collapse" signals are kept (spike/emerging
 * on the family's total clicks aren't this detector's job - trend-radar's
 * query-spikes already covers rising demand).
 */
export function detectFamilyCollapses(rows: ReadonlyArray<PageDailyRow>): FamilyCollapse[] {
  const clean = rows.filter(
    (r) => r.date && r.page && Number.isFinite(dayMs(r.date)) && Number.isFinite(r.clicks),
  );
  if (clean.length === 0) return [];

  let anchorMs = -Infinity;
  let minMs = Infinity;
  for (const r of clean) {
    const ms = dayMs(r.date);
    if (ms > anchorMs) anchorMs = ms;
    if (ms < minMs) minMs = ms;
  }

  let coveredWeeks = 0;
  for (let w = 1; w <= TRAILING_WEEKS; w += 1) {
    if (anchorMs - (7 * w + 6) * DAY_MS >= minMs) coveredWeeks = w;
    else break;
  }
  if (coveredWeeks < MIN_COVERED_TRAILING_WEEKS) return [];

  const anchorIso = new Date(anchorMs).toISOString().slice(0, 10);
  const byFamily = new Map<string, FamilyAgg>();
  for (const r of clean) {
    const idx = Math.floor((anchorMs - dayMs(r.date)) / WEEK_MS);
    if (idx < 0 || idx > coveredWeeks) continue;
    const family = pageFamilyOf(r.page);
    let a = byFamily.get(family);
    if (!a) {
      a = { thisWeek: 0, trailing: 0, pages: new Set() };
      byFamily.set(family, a);
    }
    a.pages.add(r.page);
    const clicks = Math.max(0, Number(r.clicks) || 0);
    if (idx === 0) a.thisWeek += clicks;
    else a.trailing += clicks;
  }

  const series: WeeklySeries[] = [...byFamily.entries()].map(([family, a]) => ({
    label: family,
    weeks: [a.trailing / coveredWeeks, a.thisWeek],
  }));

  const signals: SpikeSignal[] = detectSpikes(series, {
    spikeThreshold: COLLAPSE_MIN_DROP,
    highThreshold: COLLAPSE_HIGH_DROP,
    minRecent: COLLAPSE_MIN_TYPICAL_CLICKS,
    baselineWeeks: 1,
    includeCollapse: true,
  });

  // Collapse-window start: the first day of "this week" (anchor - 6 days) -
  // the honest date the drop began showing up in the data, not the anchor
  // (last) day.
  const collapseDate = addDaysIso(anchorIso, -6);

  const out: FamilyCollapse[] = [];
  for (const sig of signals) {
    if (sig.kind !== "collapse") continue;
    const a = byFamily.get(sig.label);
    if (!a) continue;
    const typical = a.trailing / coveredWeeks;
    if (typical < COLLAPSE_MIN_TYPICAL_CLICKS) continue; // defensive, detectSpikes already floors this
    out.push({
      family: sig.label,
      pages: [...a.pages],
      thisWeekClicks: Math.round(a.thisWeek),
      typicalWeekClicks: Math.round(typical),
      dropPct: sig.jumpPct ?? (a.thisWeek - typical) / typical,
      severity: sig.severity,
      collapseDate,
    });
  }
  return out;
}

/**
 * The single biggest family by total clicks across ALL loaded rows (not just
 * collapsing ones) - the investigation target when the SITEWIDE changepoint
 * detector fires without any family-level collapse of its own (a sitewide
 * drop hits the biggest family hardest in absolute clicks, so that is where
 * a noindex/robots/canonical regression would show first). PURE. Null when
 * there are no usable rows.
 */
export function biggestFamilyTarget(rows: ReadonlyArray<PageDailyRow>): FamilyTarget | null {
  const byFamily = new Map<string, { pages: Set<string>; clicks: number }>();
  for (const r of rows) {
    if (!r.page || !r.date || !Number.isFinite(dayMs(r.date))) continue;
    const family = pageFamilyOf(r.page);
    let a = byFamily.get(family);
    if (!a) {
      a = { pages: new Set(), clicks: 0 };
      byFamily.set(family, a);
    }
    a.pages.add(r.page);
    a.clicks += Math.max(0, Number(r.clicks) || 0);
  }
  let best: FamilyTarget | null = null;
  let bestClicks = -1;
  for (const [family, a] of byFamily) {
    if (a.clicks > bestClicks) {
      bestClicks = a.clicks;
      // Weekly scale approximation for ranking display: total clicks over the
      // window divided by the window's whole weeks (floored at 1).
      const weeks = Math.max(1, Math.round(rows.length > 0 ? spanDays(rows) / 7 : 1));
      best = { family, pages: [...a.pages], typicalWeekClicks: Math.round(a.clicks / weeks) };
    }
  }
  return best;
}

/** Days between the oldest and newest usable row dates (>= 1). PURE. */
function spanDays(rows: ReadonlyArray<PageDailyRow>): number {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const ms = dayMs(r.date);
    if (!Number.isFinite(ms)) continue;
    if (ms < min) min = ms;
    if (ms > max) max = ms;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 1;
  return Math.max(1, Math.round((max - min) / DAY_MS));
}
