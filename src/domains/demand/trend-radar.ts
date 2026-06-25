/**
 * trend-radar (2026-06-25, Sprint 4D) — the first real Trend Radar layer on top of
 * the demand engine. PURE / deterministic / no I/O.
 *
 * Turns available demand SIGNALS into explainable trend opportunities: rising
 * queries, declining pages that need a refresh, and seasonal peaks. Source order
 * (operator spec): (1) cached DataForSEO 12-month volume series → direction +
 * seasonality; (2) GSC rising/declining query deltas IF supplied (typed hook —
 * real data only); (3) internal snapshots (typed hook). It NEVER fabricates a
 * trend — fewer than 6 months of series, or no signal, yields `unknown` /
 * inconclusive, never a guessed direction.
 *
 * Pinned by trend-radar.test.ts.
 */

import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";
import {
  COMMERCE,
  matchClusterToPage,
  slugify,
  tokens,
  type MatchStrength,
  type OwnedPageLite,
  type TrendDirection,
} from "./keyword-opportunities";

export type TrendEvidenceSource =
  | "dataforseo_volume_trend"
  | "dataforseo_seasonal_pattern"
  | "gsc_query_delta"
  | "internal_snapshot";

export type TrendAction =
  | "create_page"
  | "content_refresh"
  | "add_answer_block"
  | "update_title_meta"
  | "create_product"
  | "monitor";

export type TrendOpportunity = {
  id: string;
  query: string;
  trend: TrendDirection;
  seasonal: boolean;
  /** Calendar months (1-12) the series peaks in — only when seasonal. */
  peakMonths: number[];
  evidenceSource: TrendEvidenceSource;
  estDemand: number | null;
  confidence: "high" | "medium" | "low";
  recommendedAction: TrendAction;
  targetPageUrl: string | null;
  matchStrength: MatchStrength;
  proposedSlug: string | null;
  risk: string | null;
  whyNow: string;
  proofMetrics: string[];
  evidence: string[];
  /** A rising/seasonal-imminent trend with real demand is worth surfacing today. */
  shouldBeTodayMove: boolean;
};

/** Optional real GSC query delta (typed hook — pass ONLY measured data, never mocked). */
export type GscQueryDelta = {
  query: string;
  /** WoW or period-over-period click delta as a fraction, e.g. +0.4 = +40%. */
  clickDeltaPct: number;
  impressions: number;
  matchedPageUrl?: string | null;
};

export type TrendRadarInput = {
  keywords: KeywordDemand[];
  ownedPages: OwnedPageLite[];
  /** The current calendar month (1-12), for seasonal "why now" windows. PURE in. */
  currentMonth: number;
  /** Real GSC query deltas (optional typed hook). Omit when unavailable. */
  gscDeltas?: GscQueryDelta[];
  /** Min total demand to surface a (non-rising) trend. */
  minVolume?: number;
};

const MONTH_NAMES = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
// Seasonality from a SINGLE 12-month series can't be confirmed year-over-year, so
// require a genuinely SHARP, ISOLATED spike before claiming it (avoid calling normal
// month-to-month variance "seasonal" — that's fake certainty). A peak must be ≥2.5×
// the median, dominate the 2nd-highest month by ≥1.3×, and be ≤2 months wide.
const SEASONAL_PEAK_RATIO = 2.5;
const SEASONAL_DOMINANCE = 1.3;
const RISE_THRESHOLD = 0.2;

/** Robust trend read over the 12-month series. Returns direction + magnitude +
 *  seasonality. NEVER guesses: <6 months → unknown. PURE. */
export function analyzeSeries(monthly: KeywordDemand["monthlySearches"]): {
  trend: TrendDirection;
  seasonal: boolean;
  peakMonths: number[];
  confident: boolean;
} {
  if (!monthly || monthly.length < 6) {
    return { trend: "unknown", seasonal: false, peakMonths: [], confident: false };
  }
  const recent = monthly.slice(-3).reduce((s, m) => s + m.volume, 0) / 3;
  const prior = monthly.slice(-6, -3).reduce((s, m) => s + m.volume, 0) / 3;
  let trend: TrendDirection;
  if (prior <= 0) trend = recent > 0 ? "rising" : "unknown";
  else {
    const delta = (recent - prior) / prior;
    trend = delta >= RISE_THRESHOLD ? "rising" : delta <= -RISE_THRESHOLD ? "declining" : "flat";
  }

  // Seasonality: a SHARP, ISOLATED spike (≥2.5× median, dominates the 2nd-highest
  // month, ≤2 months wide). Conservative on purpose — one year of data can't prove
  // recurrence, so we only flag the unmistakable spikes (e.g. a Nowruz-in-March peak).
  let seasonal = false;
  let peakMonths: number[] = [];
  if (monthly.length >= 10) {
    const vols = monthly.map((m) => m.volume).filter((v) => v > 0).sort((a, b) => a - b);
    const median = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
    const sortedDesc = [...monthly].map((m) => m.volume).sort((a, b) => b - a);
    const max = sortedDesc[0] ?? 0;
    const secondMax = sortedDesc[1] ?? 0;
    if (median > 0) {
      peakMonths = [
        ...new Set(monthly.filter((m) => m.volume >= median * SEASONAL_PEAK_RATIO).map((m) => m.month)),
      ].sort((a, b) => a - b);
      seasonal =
        peakMonths.length > 0 &&
        peakMonths.length <= 2 &&
        max >= median * SEASONAL_PEAK_RATIO &&
        (secondMax <= 0 || max >= secondMax * SEASONAL_DOMINANCE);
    }
  }
  return { trend, seasonal, peakMonths, confident: monthly.length >= 6 };
}

/** Months until the next seasonal peak from `currentMonth` (0 = peak is now/this month). */
function monthsToNextPeak(peakMonths: number[], currentMonth: number): number | null {
  if (peakMonths.length === 0) return null;
  const ahead = peakMonths.map((p) => (p - currentMonth + 12) % 12);
  return Math.min(...ahead);
}

/**
 * Build trend opportunities from real signals. PURE. No fabricated trends:
 * weak/short series → `unknown` and a `monitor` action (surfaced honestly, never
 * dressed up as a rising opportunity).
 */
export function buildTrendRadar(input: TrendRadarInput): TrendOpportunity[] {
  const minVolume = input.minVolume ?? 50;
  const out: TrendOpportunity[] = [];
  const gscByQuery = new Map((input.gscDeltas ?? []).map((d) => [d.query.toLowerCase(), d]));

  for (const kw of input.keywords) {
    const t = new Set(tokens(kw.keyword));
    if (t.size === 0) continue;
    const series = analyzeSeries(kw.monthlySearches);
    const gsc = gscByQuery.get(kw.keyword.toLowerCase());
    const estDemand = kw.searchVolume;
    const isCommerce = [...t].some((tok) => COMMERCE.has(tok));
    const match = isCommerce
      ? { url: null as string | null, strength: "none" as MatchStrength, score: 0 }
      : matchClusterToPage(t, input.ownedPages);

    // Resolve direction + evidence source, preferring measured GSC deltas when present.
    let trend: TrendDirection = series.trend;
    let evidenceSource: TrendEvidenceSource = series.seasonal
      ? "dataforseo_seasonal_pattern"
      : "dataforseo_volume_trend";
    const evidence: string[] = [];
    if (gsc) {
      trend = gsc.clickDeltaPct >= RISE_THRESHOLD ? "rising" : gsc.clickDeltaPct <= -RISE_THRESHOLD ? "declining" : "flat";
      evidenceSource = "gsc_query_delta";
      evidence.push(`GSC clicks ${gsc.clickDeltaPct >= 0 ? "+" : ""}${Math.round(gsc.clickDeltaPct * 100)}% (${gsc.impressions.toLocaleString()} impressions)`);
    }
    if (series.confident) {
      evidence.push(`DataForSEO 12-mo series: ${series.trend}${series.seasonal ? ` · peaks ${series.peakMonths.map((m) => MONTH_NAMES[m]).join("/")}` : ""}`);
    }
    if (estDemand != null) evidence.push(`${estDemand.toLocaleString()}/mo search volume`);

    // Honesty gate: nothing to say → skip (don't emit a noise "unknown" row unless
    // there's at least real volume worth monitoring).
    const hasSignal = trend !== "unknown" || gsc != null;
    if (!hasSignal && (estDemand ?? 0) < minVolume) continue;
    // A flat, non-seasonal, fully-known trend with no GSC movement isn't a "trend" — skip.
    if (trend === "flat" && !series.seasonal && !gsc) continue;

    // whyNow + action.
    const toPeak = series.seasonal ? monthsToNextPeak(series.peakMonths, input.currentMonth) : null;
    let whyNow: string;
    let recommendedAction: TrendAction;
    let risk: string | null = null;

    if (series.seasonal && toPeak != null) {
      const peakLabel = series.peakMonths.map((m) => MONTH_NAMES[m]).join("/");
      whyNow =
        toPeak <= 2
          ? `Seasonal peak (${peakLabel}) is ${toPeak === 0 ? "now" : `~${toPeak} month(s) out`} — prepare ahead of it.`
          : `Seasonal demand peaks in ${peakLabel}; build now to be indexed before the window.`;
      recommendedAction = isCommerce ? "create_product" : match.strength === "none" ? "create_page" : "add_answer_block";
      if (toPeak > 4) risk = "Seasonal window is months away — low urgency until closer.";
    } else if (trend === "rising") {
      whyNow = `Demand is rising for "${kw.keyword}"${gsc ? " (measured in GSC)" : ""} — capture it before competitors.`;
      recommendedAction = isCommerce
        ? "create_product"
        : match.strength === "strong"
        ? "update_title_meta"
        : match.strength === "partial"
        ? "add_answer_block"
        : "create_page";
    } else if (trend === "declining") {
      whyNow = match.strength === "none"
        ? `"${kw.keyword}" is declining and you have no page — likely not worth a new build.`
        : `Demand/clicks declining on a page you own — refresh it to recover.`;
      recommendedAction = match.strength === "none" ? "monitor" : "content_refresh";
      if (match.strength === "none") risk = "Declining demand with no owned page — monitor, don't invest yet.";
    } else {
      whyNow = `Real volume but no clear trend yet — monitor "${kw.keyword}".`;
      recommendedAction = "monitor";
    }

    if (isCommerce) {
      risk = risk
        ? `${risk} Concept only — confirm inventory/licensing before listing.`
        : "Concept only — confirm inventory/licensing before listing; no live product created.";
    }

    const confidence: TrendOpportunity["confidence"] =
      gsc || (series.confident && (estDemand ?? 0) >= 500)
        ? "high"
        : series.confident || (estDemand ?? 0) >= minVolume
        ? "medium"
        : "low";

    out.push({
      id: `trend:${slugify(kw.keyword)}`,
      query: kw.keyword,
      trend,
      seasonal: series.seasonal,
      peakMonths: series.peakMonths,
      evidenceSource,
      estDemand,
      confidence,
      recommendedAction,
      targetPageUrl: match.url,
      matchStrength: match.strength,
      proposedSlug: match.strength === "none" && recommendedAction !== "monitor" ? slugify(kw.keyword) : null,
      risk,
      whyNow,
      proofMetrics:
        evidenceSource === "gsc_query_delta"
          ? ["GSC clicks", "GSC impressions", "average position"]
          : ["GSC impressions/clicks after publish", "search-volume trend re-pull"],
      evidence,
      shouldBeTodayMove:
        confidence !== "low" &&
        (trend === "rising" || (series.seasonal && (toPeak ?? 99) <= 2)) &&
        recommendedAction !== "monitor",
    });
  }

  // Rank: rising + imminent-seasonal first, then by demand.
  const rank = (o: TrendOpportunity) =>
    (o.trend === "rising" ? 2 : o.seasonal ? 1 : 0) * 1_000_000 + (o.estDemand ?? 0);
  return out.sort((a, b) => rank(b) - rank(a));
}
