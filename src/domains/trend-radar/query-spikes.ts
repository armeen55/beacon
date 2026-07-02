/**
 * trend-radar/query-spikes (2026-07-02, master plan item 14) - PURE.
 *
 * Week-over-week QUERY spike detection over per-query daily GSC rows: the last
 * 7 finalized days (anchored to the newest day PRESENT in the data, because the
 * sync only persists finalized days ~3d behind wall clock) versus the trailing
 * 4-week baseline. Because every window is a full anchor-aligned 7-day week,
 * averaging the trailing weekly sums is mathematically identical to summing the
 * per-weekday 4-week averages, so weekday cyclicity (weekend-heavy queries etc.)
 * can never fake a spike.
 *
 * Classification is delegated to the existing spike-detector engine
 * (detectSpikes) instead of re-deriving the math here: one 2-point series per
 * query (baseline, this week) with the thresholds below.
 *
 * Deterministic, $0, no I/O. Fail-closed: needs at least 2 fully covered
 * trailing weeks of history or it stays silent (a short history would fabricate
 * "new demand" out of missing data).
 */

import { detectSpikes, type WeeklySeries } from "./spike-detector";

/** A spike must be at least this multiple of the typical week (2 = doubled). */
export const SPIKE_MIN_RATIO = 2;
/** Absolute floor: this week must have at least this many impressions, so a
 *  3 -> 9 impressions blip never becomes a headline. */
export const SPIKE_MIN_WEEK_IMPRESSIONS = 30;
/** Baseline: up to this many trailing full weeks behind this week. */
export const TRAILING_WEEKS = 4;
/** Fail-closed history gate: fewer fully covered trailing weeks than this and
 *  we say nothing (short history looks like emergence but is just missing data). */
export const MIN_COVERED_TRAILING_WEEKS = 2;
/** Bound the ranked output (persisted nightly; surfaces slice further). */
export const MAX_SPIKES = 12;

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** One per-query per-day GSC row (lean projection of gsc_daily_rows). */
export type QueryDailyRow = {
  /** YYYY-MM-DD (longer ISO strings are sliced). */
  date: string;
  query: string;
  /** The page the impression landed on (for the "best matching page" pick). */
  page?: string | null;
  clicks: number;
  impressions: number;
};

export type QuerySpike = {
  query: string;
  /** Impressions in the last 7 finalized days. */
  thisWeek: number;
  /** Trailing 4-week same-weekday average (rounded for display honesty). */
  typicalWeek: number;
  /** thisWeek / typical; null when the query had no real prior demand (new). */
  ratio: number | null;
  /** Clicks in the last 7 finalized days (context, not the spike test). */
  thisWeekClicks: number;
  /** The page that took the most impressions for this query this week. */
  topPage: string | null;
  /** Ready-to-show operator sentence (plain first person, no dashes). */
  sentence: string;
};

function dayMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** Newest finalized day present in the rows (the anchor the week counts back
 *  from), or null when there is no usable row. PURE. */
export function anchorDateOf(rows: QueryDailyRow[]): string | null {
  let best: string | null = null;
  for (const r of rows) {
    if (!r.date) continue;
    const d = r.date.slice(0, 10);
    if (!Number.isFinite(dayMs(d))) continue;
    if (best === null || d > best) best = d;
  }
  return best;
}

function formatRatio(r: number): string {
  const rounded = r >= 10 ? Math.round(r) : Math.round(r * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}x`;
}

/** The operator sentence for one spike. Plain business copy, hyphens only. */
export function spikeSentence(query: string, thisWeek: number, typical: number, ratio: number | null): string {
  const shown = thisWeek.toLocaleString();
  if (ratio === null || typical < 1) {
    return `Searches for "${query}" are new this week, about ${shown} times shown on Google where a typical week had almost none.`;
  }
  return `Searches for "${query}" are ${formatRatio(ratio)} their usual this week, about ${shown} times shown on Google versus ${Math.round(typical).toLocaleString()} in a typical week.`;
}

type QueryAgg = {
  thisWeek: number;
  thisWeekClicks: number;
  trailing: number;
  pagesThisWeek: Map<string, number>;
  pagesAll: Map<string, number>;
};

function topPageOf(a: QueryAgg): string | null {
  const source = a.pagesThisWeek.size > 0 ? a.pagesThisWeek : a.pagesAll;
  let best: string | null = null;
  let bestImpr = -1;
  for (const [page, impr] of source) {
    if (impr > bestImpr) {
      best = page;
      bestImpr = impr;
    }
  }
  return best;
}

/**
 * Ranked week-over-week query spikes. PURE.
 *
 * - This week = the 7 days ending on the newest day present in the rows.
 * - Typical week = mean of the trailing fully covered weekly sums (up to 4);
 *   a day with no row counts as zero, which is exactly what GSC means by it.
 * - Spike = thisWeek >= SPIKE_MIN_RATIO x typical AND thisWeek >=
 *   SPIKE_MIN_WEEK_IMPRESSIONS. A query with ~no prior demand that clears the
 *   floor is a "new this week" spike (ratio null, no divide-by-zero guess).
 * - Ranking comes from detectSpikes: biggest/most confident jumps first.
 */
export function computeQuerySpikes(rows: QueryDailyRow[]): QuerySpike[] {
  const clean = rows.filter(
    (r) => r.date && r.query && r.query.trim() && Number.isFinite(dayMs(r.date)) && Number.isFinite(r.impressions),
  );
  if (clean.length === 0) return [];

  let anchorMs = -Infinity;
  let minMs = Infinity;
  for (const r of clean) {
    const ms = dayMs(r.date);
    if (ms > anchorMs) anchorMs = ms;
    if (ms < minMs) minMs = ms;
  }

  // Fail-closed history gate: only trailing weeks whose FULL 7-day window sits
  // inside the data span count as baseline. Fewer than the minimum -> silence.
  let coveredWeeks = 0;
  for (let w = 1; w <= TRAILING_WEEKS; w += 1) {
    if (anchorMs - (7 * w + 6) * DAY_MS >= minMs) coveredWeeks = w;
    else break;
  }
  if (coveredWeeks < MIN_COVERED_TRAILING_WEEKS) return [];

  const byQuery = new Map<string, QueryAgg>();
  for (const r of clean) {
    const idx = Math.floor((anchorMs - dayMs(r.date)) / WEEK_MS);
    if (idx < 0 || idx > coveredWeeks) continue; // beyond the covered baseline
    const query = r.query.trim();
    let a = byQuery.get(query);
    if (!a) {
      a = { thisWeek: 0, thisWeekClicks: 0, trailing: 0, pagesThisWeek: new Map(), pagesAll: new Map() };
      byQuery.set(query, a);
    }
    const impr = Math.max(0, Number(r.impressions) || 0);
    if (r.page) a.pagesAll.set(r.page, (a.pagesAll.get(r.page) ?? 0) + impr);
    if (idx === 0) {
      a.thisWeek += impr;
      a.thisWeekClicks += Math.max(0, Number(r.clicks) || 0);
      if (r.page) a.pagesThisWeek.set(r.page, (a.pagesThisWeek.get(r.page) ?? 0) + impr);
    } else {
      a.trailing += impr;
    }
  }

  // One 2-point series per query -> the shared spike engine does the
  // classification + ranking (spike vs emerging, severity, magnitude order).
  const series: WeeklySeries[] = [...byQuery.entries()].map(([query, a]) => ({
    label: query,
    weeks: [a.trailing / coveredWeeks, a.thisWeek],
  }));
  const signals = detectSpikes(series, {
    spikeThreshold: SPIKE_MIN_RATIO - 1, // jump >= +100% == this week >= 2x typical
    highThreshold: 2 * (SPIKE_MIN_RATIO - 1), // >= 3x ranks as high severity
    minRecent: SPIKE_MIN_WEEK_IMPRESSIONS,
    baselineWeeks: 1,
  });

  const out: QuerySpike[] = [];
  for (const sig of signals) {
    if (sig.kind === "collapse") continue; // not requested; defensive
    const a = byQuery.get(sig.label);
    if (!a) continue;
    const typical = a.trailing / coveredWeeks;
    const ratio = sig.kind === "emerging" || typical <= 0 ? null : Math.round((a.thisWeek / typical) * 10) / 10;
    out.push({
      query: sig.label,
      thisWeek: a.thisWeek,
      typicalWeek: Math.round(typical),
      ratio,
      thisWeekClicks: a.thisWeekClicks,
      topPage: topPageOf(a),
      sentence: spikeSentence(sig.label, a.thisWeek, typical, ratio),
    });
    if (out.length >= MAX_SPIKES) break;
  }
  return out;
}
