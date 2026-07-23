/**
 * striking-portfolio (BEACON_500 R17a / P2 slice 1, v1 item 267) - the PORTFOLIO
 * view of striking-distance demand.
 *
 * The keywords and Changes surfaces already show INDIVIDUAL striking-distance
 * rows (a query ranking just off the top with real demand). This module adds
 * the one number those rows never add up to: how many such searches exist right
 * now, how many times they were shown, and what reaching the top is usually
 * worth - sized honestly through the tenant's own CTR curve (R9) and the same
 * forecastRange capture band every other Beacon forecast uses. No new formula.
 *
 * ONE-IMPLEMENTATION RULE: `isStrikingDistance` moved here from
 * recommendation-intelligence/gsc-page-queries.ts (which re-exports it), so the
 * per-row badge and this portfolio can never disagree on what "striking
 * distance" means. Brand queries are excluded through the ONE brand classifier
 * (brand-split.ts) - someone searching your name is not a growth push.
 *
 * PURE, no I/O. The loader edge is load-striking-portfolio.ts.
 */

import type { TenantCtrCurve } from "@/domains/evidence/forecast/tenant-ctr-curve";
import { isBrandQuery } from "./brand-split";

// The experiments/pick-expectations module that owned forecastRange was removed. Inlined here
// unchanged (byte-identical formula + capture band) so the portfolio forecast is unaffected.
function friendly(n: number): number {
  if (n >= 100) return Math.round(n / 10) * 10;
  if (n >= 10) return Math.round(n / 5) * 5;
  return Math.round(n);
}
function clampCorrectionFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(1.3, Math.max(0.7, factor));
}
function forecastRange(
  ctrOpportunityClicks90d: number,
  correctionFactor: number = 1,
  captureFractions: { low: number; high: number } = { low: 0.25, high: 0.75 },
): { low: number; high: number } | null {
  if (!Number.isFinite(ctrOpportunityClicks90d) || ctrOpportunityClicks90d <= 0) return null;
  const factor = clampCorrectionFactor(correctionFactor);
  const monthly = (ctrOpportunityClicks90d / 3) * factor;
  const captureLow = Number.isFinite(captureFractions.low) ? captureFractions.low : 0.25;
  const captureHigh = Number.isFinite(captureFractions.high) ? captureFractions.high : 0.75;
  const low = friendly(monthly * captureLow);
  const high = friendly(monthly * captureHigh);
  if (high < 3) return null;
  return { low: Math.max(1, low), high: Math.max(high, Math.max(1, low)) };
}

/** Striking-distance test: ranking on page 1's lower half / page 2 top, with
 *  enough impressions that climbing a few spots is worth real clicks.
 *  (Moved verbatim from gsc-page-queries.ts - one implementation.) */
export function isStrikingDistance(position: number, impressions: number): boolean {
  return position >= 4 && position <= 15 && impressions >= 100;
}

/** The position the sizing aims at: the top 3, where the CTR curve's real
 *  clicks live. Stated in the copy, never implied. */
export const PORTFOLIO_TARGET_POSITION = 3;

/** One query's window aggregate, from any per-query GSC read. */
export type StrikingQueryInput = {
  query: string;
  clicks: number;
  impressions: number;
  /** Impressions-weighted average position over the window (1-based). */
  position: number;
};

export type StrikingPortfolio = {
  /** Distinct striking-distance searches (deduped by query text). */
  queryCount: number;
  /** Times those searches were shown over the window. */
  totalImpressions: number;
  windowDays: number;
  /** Monthly extra-clicks range for reaching the top 3, through forecastRange's
   *  capture band. Null when the honest range rounds under the floor. */
  extraClicksLowPerMonth: number | null;
  extraClicksHighPerMonth: number | null;
  /** "23 searches rank just below the top results ... shown 41,000 times in the
   *  last 90 days." Always present. */
  headline: string;
  /** "Reaching the top 3 is usually worth L to H extra clicks a month, ..."
   *  Null when no honest range exists. Names its sizing basis. */
  sizingLine: string | null;
};

const normQuery = (q: string): string => q.trim().toLowerCase();

/**
 * Aggregate per-query rows (page+query entries collapse across pages), filter
 * to non-brand striking-distance searches, and size the portfolio. Returns
 * null when no query qualifies - the surfaces self-hide, never a bare zero.
 */
export function buildStrikingPortfolio(
  rows: readonly StrikingQueryInput[],
  opts: {
    windowDays?: number;
    brandTokens?: readonly string[];
    curve?: TenantCtrCurve | null;
  } = {},
): StrikingPortfolio | null {
  const windowDays = opts.windowDays ?? 90;
  const tokens = opts.brandTokens ?? [];

  // Collapse duplicate query entries (the same query earning impressions on
  // several pages): sum clicks + impressions, impressions-weight the position.
  const byQuery = new Map<string, { clicks: number; impressions: number; posW: number }>();
  for (const r of rows) {
    if (typeof r.query !== "string" || r.query.trim() === "") continue;
    const impressions = Number(r.impressions) || 0;
    const clicks = Number(r.clicks) || 0;
    const position = Number(r.position) || 0;
    if (impressions <= 0 || position < 1) continue;
    if (isBrandQuery(r.query, tokens)) continue;
    const a = byQuery.get(normQuery(r.query)) ?? { clicks: 0, impressions: 0, posW: 0 };
    a.clicks += Math.max(0, clicks);
    a.impressions += impressions;
    a.posW += position * impressions;
    byQuery.set(normQuery(r.query), a);
  }

  let queryCount = 0;
  let totalImpressions = 0;
  let gapClicksWindow = 0;
  for (const a of byQuery.values()) {
    const position = a.posW / a.impressions;
    if (!isStrikingDistance(position, a.impressions)) continue;
    queryCount += 1;
    totalImpressions += a.impressions;
    if (opts.curve) {
      // Extra clicks if this search reached the top 3: what the curve expects
      // there, minus the clicks it already earns. Never negative.
      const atTop = a.impressions * opts.curve.expectedCtrAt(PORTFOLIO_TARGET_POSITION);
      gapClicksWindow += Math.max(0, atTop - a.clicks);
    }
  }
  if (queryCount === 0) return null;

  // forecastRange expects a 90-day gap; scale when the window differs.
  const gap90 = windowDays === 90 ? gapClicksWindow : gapClicksWindow * (90 / windowDays);
  const range = opts.curve ? forecastRange(gap90) : null;

  const plural = queryCount === 1 ? "search ranks" : "searches rank";
  const headline =
    `${queryCount.toLocaleString("en-US")} ${plural} just below the top results, where a small push wins real clicks. ` +
    `Together they were shown ${totalImpressions.toLocaleString("en-US")} times in the last ${windowDays} days.`;

  const basisClause =
    opts.curve?.source === "tenant"
      ? "based on how your own pages convert position to clicks"
      : "based on typical click rates at each Google position";
  const sizingLine = range
    ? `Reaching the top 3 is usually worth ${range.low.toLocaleString("en-US")} to ${range.high.toLocaleString("en-US")} extra clicks a month, ${basisClause}.`
    : null;

  return {
    queryCount,
    totalImpressions,
    windowDays,
    extraClicksLowPerMonth: range?.low ?? null,
    extraClicksHighPerMonth: range?.high ?? null,
    headline,
    sizingLine,
  };
}
