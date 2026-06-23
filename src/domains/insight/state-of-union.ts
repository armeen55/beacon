/**
 * Insight layer — State of the Union (operator-OS rebuild, slice 1).
 *
 * The executive briefing object the Briefing dashboard renders. Pure
 * composition over the Opportunity Map + GSC site totals + connector health +
 * a page_snapshots schema-coverage read. The pure verdict logic lives here
 * (testable without I/O); `compute-state-of-union.ts` does the data access.
 *
 * Every figure traces to a real source — no fabricated numbers, ever.
 */

import type { OpportunityItem } from "./opportunity";
import type { SerpStatus } from "./serp-guard";

export type StateOfUnionVerdict =
  | "ranking_better_losing_clicks"
  | "growing"
  | "declining"
  | "healthy"
  | "no_data";

export type StateOfUnionSource = {
  /** Connector key. */
  key: string;
  /** Plain-English label (never a raw vendor name where white-labelled). */
  label: string;
  connected: boolean;
  lastSyncedAt: string | null;
  daysStale: number | null;
  /** Short status line: "fresh", "5 days stale", "not connected". */
  note: string;
  /** What this source unlocks for the operator. */
  unlocks: string;
};

export type StateOfUnionHeadline = {
  verdict: StateOfUnionVerdict;
  headline: string;
  subline: string;
  clicks28d: number;
  clicksPrev28d: number;
  clicksDeltaPct: number;
  impressions90d: number;
  avgPosition90d: number;
};

export type StateOfUnion = {
  hasData: boolean;
  headline: StateOfUnionHeadline | null;
  /** Pages ranking-but-not-clicked + sliding pages (CTR leaks + decay). */
  bleedingPages: OpportunityItem[];
  /** Page-2 demand + momentum (striking distance + rising). */
  risingOpportunities: OpportunityItem[];
  /** Clarity dead/rage-click pages (sliced to the few shown). */
  frictionPages: OpportunityItem[];
  /** TRUE count of friction pages (not capped at the shown slice). */
  frictionPageCount: number;
  /** Top pages by clicks (the engine). */
  winningClusters: { label: string; path: string; clicks90d: number }[];
  schemaAeoGap: { faqCovered: number; faqTotal: number; thinPages: number } | null;
  sources: StateOfUnionSource[];
  nextBestActions: {
    /** Pack primary when a Change Pack exists; else the diagnosis lever. */
    headline: string;
    path: string;
    kind: string;
    hasChangePack: boolean;
    estClicksAtStake: number;
    estWindow: "90d" | "28d";
    estConfidence: "high" | "medium" | "low";
    serpStatus: SerpStatus;
    /** Non-null ⇒ verify the SERP before treating this as a title fix. */
    serpGuardLabel: string | null;
  }[];
  opportunityCount: number;
  /** Ranked opportunities held OUT of the plan because their page has a change
   *  inside its measurement window (changing it again would corrupt the
   *  experiment). Surfaced as an honest "N held, measuring" note on the plan. */
  heldForMeasurement: number;
};

export type SiteTotalsLite = {
  clicks28d: number;
  clicksPrev28d: number;
  impressions90d: number;
  avgPosition90d: number;
};

/**
 * Pure: derive the executive headline verdict + sentence from site totals and
 * the count of detected CTR-leak pages. The signature "impressions/rank up but
 * clicks down + many CTR leaks" → the operator's "ranking better, losing
 * clicks" verdict.
 */
export function deriveHeadline(
  t: SiteTotalsLite,
  ctrLeakCount: number,
): StateOfUnionHeadline {
  const prev = t.clicksPrev28d;
  const deltaPct = prev > 0 ? Math.round(((t.clicks28d - prev) / prev) * 100) : 0;
  const down = prev > 0 && t.clicks28d < prev * 0.97;
  const up = prev > 0 && t.clicks28d > prev * 1.03;
  const trend = down
    ? `Clicks are down ${Math.abs(deltaPct)}%`
    : up
      ? `Clicks are up ${deltaPct}%`
      : "Traffic is steady";

  let verdict: StateOfUnionVerdict;
  let headline: string;
  let subline: string;

  // A large CTR-leak count is the single biggest lever — surface it as the
  // headline REGARDLESS of the overall click trend (page-1 pages that barely
  // get clicked are recoverable clicks at the rank you already hold).
  if (ctrLeakCount >= 5) {
    verdict = "ranking_better_losing_clicks";
    headline = `${ctrLeakCount} pages already rank on Google's first page but barely get clicked. Fixing them is your biggest opportunity.`;
    subline = `${trend} vs the previous 28 days. These pages rank well but few people click. Better titles and descriptions win back visits at the rank you already have.`;
  } else if (down && ctrLeakCount >= 1) {
    verdict = "ranking_better_losing_clicks";
    headline = "You rank well on Google but are losing clicks. The fix is your titles and descriptions, not your ranking.";
    subline = `${ctrLeakCount} ${ctrLeakCount === 1 ? "page ranks" : "pages rank"} on Google's first page yet barely ${ctrLeakCount === 1 ? "gets" : "get"} clicked. Better titles and descriptions win back visits at the rank you already have.`;
  } else if (down) {
    verdict = "declining";
    headline = `Visits from Google are down ${Math.abs(deltaPct)}% vs the previous 28 days.`;
    subline = "Refresh the slipping pages below before they fall further.";
  } else if (up) {
    verdict = "growing";
    headline = `Visits from Google are up ${deltaPct}% vs the previous 28 days.`;
    subline = "You have momentum. Build on the rising pages below.";
  } else {
    verdict = "healthy";
    headline = "Visits from Google are holding steady.";
    subline = "Work the biggest opportunities below to push them up.";
  }

  return {
    verdict,
    headline,
    subline,
    clicks28d: t.clicks28d,
    clicksPrev28d: prev,
    clicksDeltaPct: deltaPct,
    impressions90d: t.impressions90d,
    avgPosition90d: t.avgPosition90d,
  };
}
