/**
 * Snapshot series index: per-page daily arrays with prefix sums so any
 * [start, end) window aggregate is O(1). Built once per harness run from the
 * immutable snapshot rows; all classifier and matching math reads windows
 * through this. PURE (callers load the snapshot json themselves).
 */

import { addDays } from "../measure";
import type { PreStats, SnapshotDailyRow, WindowAgg } from "./types";
import { olsSlope, sampleStd } from "./stats";

const DAY_MS = 86_400_000;

function toMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

type PageSeries = {
  /** Daily clicks, index 0 = seriesIndex.startDate. */
  clicks: Float64Array;
  impressions: Float64Array;
  /** position * impressions per day (position weight numerator). */
  posWeighted: Float64Array;
  /** 1 when the snapshot had a row for that day (0 rows = 0 metrics, which is
   *  GSC semantics for "no impressions that day", still counted as covered
   *  when the day is inside the snapshot's finalized range). */
  prefixClicks: Float64Array;
  prefixImpressions: Float64Array;
  prefixPosWeighted: Float64Array;
};

export type SeriesIndex = {
  startDate: string;
  endDate: string; // inclusive last snapshot day
  totalDays: number;
  pages: Map<string, PageSeries>;
};

/**
 * Build the index. Rows for the same (path, date) are summed (defensive
 * against URL-variant collisions after path normalization).
 */
export function buildSeriesIndex(rows: ReadonlyArray<SnapshotDailyRow>, startDate: string, endDate: string): SeriesIndex {
  const totalDays = daysBetween(startDate, endDate) + 1;
  const pages = new Map<string, PageSeries>();
  const ensure = (path: string): PageSeries => {
    let s = pages.get(path);
    if (!s) {
      s = {
        clicks: new Float64Array(totalDays),
        impressions: new Float64Array(totalDays),
        posWeighted: new Float64Array(totalDays),
        prefixClicks: new Float64Array(totalDays + 1),
        prefixImpressions: new Float64Array(totalDays + 1),
        prefixPosWeighted: new Float64Array(totalDays + 1),
      };
      pages.set(path, s);
    }
    return s;
  };
  for (const r of rows) {
    const idx = daysBetween(startDate, r.date);
    if (idx < 0 || idx >= totalDays) continue;
    const s = ensure(r.path);
    s.clicks[idx] += r.clicks;
    s.impressions[idx] += r.impressions;
    s.posWeighted[idx] += r.position * r.impressions;
  }
  for (const s of pages.values()) {
    for (let i = 0; i < totalDays; i++) {
      s.prefixClicks[i + 1] = s.prefixClicks[i]! + s.clicks[i]!;
      s.prefixImpressions[i + 1] = s.prefixImpressions[i]! + s.impressions[i]!;
      s.prefixPosWeighted[i + 1] = s.prefixPosWeighted[i]! + s.posWeighted[i]!;
    }
  }
  return { startDate, endDate, totalDays, pages };
}

/** True when [start, end) lies fully inside the snapshot's finalized range. */
export function windowCovered(index: SeriesIndex, start: string, end: string): boolean {
  const a = daysBetween(index.startDate, start);
  const b = daysBetween(index.startDate, end);
  return a >= 0 && b <= index.totalDays && b > a;
}

/** O(1) window aggregate for one page over [start, end). A page with no rows
 *  reads as zeros (GSC semantics: absent = no impressions), with daysCovered
 *  reporting the intersection with the snapshot range. */
export function windowAgg(index: SeriesIndex, path: string, start: string, end: string): WindowAgg {
  const windowDays = daysBetween(start, end);
  const a = Math.max(0, daysBetween(index.startDate, start));
  const b = Math.min(index.totalDays, daysBetween(index.startDate, end));
  const daysCovered = Math.max(0, b - a);
  const s = index.pages.get(path);
  if (!s || daysCovered <= 0) {
    return { clicks: 0, impressions: 0, ctr: 0, position: 0, daysCovered, windowDays };
  }
  const clicks = s.prefixClicks[b]! - s.prefixClicks[a]!;
  const impressions = s.prefixImpressions[b]! - s.prefixImpressions[a]!;
  const posW = s.prefixPosWeighted[b]! - s.prefixPosWeighted[a]!;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posW / impressions : 0,
    daysCovered,
    windowDays,
  };
}

/** Pre-treatment stats for control matching over [shipDate - preDays, shipDate).
 *  Reads ONLY days strictly before the ship date (protocol L4). */
export function preStatsFor(index: SeriesIndex, path: string, shipDate: string, preDays: number): PreStats {
  const start = addDays(shipDate, -preDays);
  const a = Math.max(0, daysBetween(index.startDate, start));
  const b = Math.min(index.totalDays, daysBetween(index.startDate, shipDate));
  const s = index.pages.get(path);
  const daysCovered = Math.max(0, b - a);
  if (!s || daysCovered <= 0) {
    return { path, clicksPerDay: 0, slope: 0, stdDaily: 0, impressions: 0, daysCovered };
  }
  const daily: number[] = [];
  for (let i = a; i < b; i++) daily.push(s.clicks[i]!);
  const clicksSum = s.prefixClicks[b]! - s.prefixClicks[a]!;
  const impressions = s.prefixImpressions[b]! - s.prefixImpressions[a]!;
  return {
    path,
    clicksPerDay: daysCovered > 0 ? clicksSum / daysCovered : 0,
    slope: olsSlope(daily),
    stdDaily: sampleStd(daily),
    impressions,
    daysCovered,
  };
}

/** Daily clicks and impressions for [start, end) as plain arrays (injection
 *  suite input). Absent days inside the snapshot read as zeros. */
export function dailySlice(index: SeriesIndex, path: string, start: string, end: string): { clicks: number[]; impressions: number[] } {
  const a = daysBetween(index.startDate, start);
  const b = daysBetween(index.startDate, end);
  const s = index.pages.get(path);
  const clicks: number[] = [];
  const impressions: number[] = [];
  for (let i = a; i < b; i++) {
    const inRange = i >= 0 && i < index.totalDays && s != null;
    clicks.push(inRange ? s.clicks[i]! : 0);
    impressions.push(inRange ? s.impressions[i]! : 0);
  }
  return { clicks, impressions };
}

/** Normalize any page URL or path to the snapshot's path key. */
export function normalizePathKey(u: string): string {
  let p = u;
  try {
    p = new URL(u).pathname;
  } catch {
    p = u.replace(/^https?:\/\/[^/]+/, "");
  }
  p = p.replace(/[?#].*$/, "").replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/** Page family stratum: first path segment for multi-segment paths,
 *  "top-level" for single-segment pages, "homepage" for the root. Rare
 *  families are bucketed by the census (placebo-design.ts), not here. */
export function pageFamilyOf(path: string): string {
  const segs = path.split("/").filter((s) => s.length > 0);
  if (segs.length === 0) return "homepage";
  if (segs.length === 1) return "top-level";
  return segs[0]!;
}
