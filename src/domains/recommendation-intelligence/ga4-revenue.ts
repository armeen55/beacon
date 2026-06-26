/**
 * GA4 revenue normalization (2026-06-26, GA4 revenue migration sprint) — PURE.
 *
 * Converts raw per-page GA4 revenue + traffic aggregates into page-level value
 * metrics with an explicit confidence grade. No I/O, no React, no Supabase —
 * deterministic + fully unit-testable (ga4-revenue.test.ts).
 *
 * THE CORE HONESTY CONTRACT (unknown vs zero):
 *   • Revenue is KNOWN only when GA4 actually reported it for the page in the
 *     window (`revenueObserved` — derived from a non-null `revenue_synced_at`
 *     on at least one row). When revenue was never fetched / the property has
 *     no ecommerce, `revenue` stays `null` ("unknown") — NEVER silently 0.
 *   • An OBSERVED zero (GA4 explicitly reported $0) is `revenue: 0` with
 *     `confidence: "high"` — we are confident the page made nothing.
 *
 * Derived ratios are computed here, never stored, and only when their
 * denominator is valid (no divide-by-zero, no NaN/Infinity ever escapes).
 */

/** Confidence in the revenue value attached to a page. */
export type RevenueConfidence = "high" | "medium" | "low" | "unknown";

/**
 * Raw per-page aggregate (summed across the window's rows by the loader).
 * Revenue numbers are summed ONLY over rows where revenue was observed; the
 * loader sets `revenueObserved` true when ≥1 row had `revenue_synced_at`.
 */
export type RawPageRevenueAggregate = {
  page: string;
  sessions: number;
  engagedSessions: number;
  conversions: number;
  /** Σ total_revenue over observed rows; null when never observed. */
  totalRevenue: number | null;
  /** Σ purchase_revenue over observed rows; null when never observed. */
  purchaseRevenue: number | null;
  /** Σ transactions over observed rows; null when never observed. */
  transactions: number | null;
  /** ISO currency for the revenue figures; null when unknown. */
  revenueCurrency: string | null;
  /** true when GA4 actually reported revenue for this page (≥1 row had
   *  revenue_synced_at). The unknown-vs-zero discriminator. */
  revenueObserved: boolean;
};

/** Normalized, render/score-ready page revenue value. */
export type PageRevenueValue = {
  page: string;
  /** Preferred purchase revenue, else total; `null` when UNKNOWN (never 0 to
   *  mean "no data" — 0 here is an OBSERVED zero). */
  revenue: number | null;
  revenueCurrency: string | null;
  transactions: number | null;
  conversions: number;
  sessions: number;
  /** revenue / sessions — only when revenue is known AND sessions > 0. */
  revenuePerVisit: number | null;
  /** revenue / transactions — only when revenue known AND transactions > 0. */
  averageOrderValue: number | null;
  /** Which GA4 metric the revenue came from, or null when unknown. */
  revenueSource: string | null;
  confidence: RevenueConfidence;
};

function finiteOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Normalize one page's raw aggregate. PURE.
 *
 * Confidence ladder (operator-locked):
 *   • unknown — no GA4 data at all (no sessions / engaged / conversions).
 *   • high    — revenue is KNOWN (observed, may be 0) AND sessions > 0.
 *   • medium  — revenue unknown BUT conversions present (proxy value exists).
 *   • low     — traffic only (sessions present, no conversions, no revenue).
 */
export function normalizePageRevenue(raw: RawPageRevenueAggregate): PageRevenueValue {
  const sessions = Math.max(0, finiteOrNull(raw.sessions) ?? 0);
  const engaged = Math.max(0, finiteOrNull(raw.engagedSessions) ?? 0);
  const conversions = Math.max(0, finiteOrNull(raw.conversions) ?? 0);

  const purchase = finiteOrNull(raw.purchaseRevenue);
  const total = finiteOrNull(raw.totalRevenue);
  const txns = finiteOrNull(raw.transactions);

  // Revenue is KNOWN only when GA4 observed it. Prefer purchaseRevenue (the
  // clean ecommerce signal); fall back to totalRevenue; an observed page with
  // neither metric present is treated as an observed 0 (the persist layer stores
  // 0, not null, when GA4 returns the metric as 0). Never invent revenue from a
  // non-observed page.
  let revenue: number | null = null;
  let revenueSource: string | null = null;
  if (raw.revenueObserved) {
    if (purchase != null) {
      revenue = purchase;
      revenueSource = "ga4_purchase_revenue";
    } else if (total != null) {
      revenue = total;
      revenueSource = "ga4_total_revenue";
    } else {
      revenue = 0;
      revenueSource = "ga4_observed_zero";
    }
  }

  const revenueKnown = revenue != null;

  // Derived ratios — only with a valid (>0) denominator AND known revenue.
  const revenuePerVisit =
    revenueKnown && sessions > 0 ? (revenue as number) / sessions : null;
  const averageOrderValue =
    revenueKnown && txns != null && txns > 0 ? (revenue as number) / txns : null;

  const hasTraffic = sessions > 0 || engaged > 0 || conversions > 0;
  let confidence: RevenueConfidence;
  if (!hasTraffic) confidence = "unknown";
  else if (revenueKnown && sessions > 0) confidence = "high";
  else if (conversions > 0) confidence = "medium";
  else confidence = "low";

  return {
    page: raw.page,
    revenue,
    revenueCurrency: raw.revenueCurrency ?? null,
    transactions: txns,
    conversions,
    sessions,
    revenuePerVisit,
    averageOrderValue,
    revenueSource,
    confidence,
  };
}

/** What drove the score multiplier — for explainability + tests. */
export type RevenueScoreBasis = "revenue" | "conversions" | "none";

export type RevenueScoreInfluence = {
  /** Bounded multiplier ≥ 1.0 (never punishes a page for lacking revenue). */
  multiplier: number;
  basis: RevenueScoreBasis;
  /** Operator-facing one-liner explaining the influence. */
  explain: string;
};

/** Ceilings keep revenue an INFLUENCE, not a dominator, and keep the
 *  conversion fallback strictly weaker than proven revenue. */
const REVENUE_MULT_CEILING = 4.0; // real dollars: ~$10k → 3.0, hard cap 4.0
const CONVERSION_MULT_CEILING = 2.0; // proxy: strictly below the revenue ceiling

/**
 * Turn a normalized page revenue value into a bounded score multiplier + an
 * explanation. PURE. Replaces the bug where a conversion COUNT was fed into a
 * dollar-shaped multiplier (`1 + log10(dollar+1)/2`).
 *
 * Tiers:
 *   • known revenue > 0  → real-dollar curve `1 + log10($+1)/2`, capped at 4.0.
 *     ("Ranked higher because this page has proven revenue")
 *   • known revenue == 0 → 1.0 (observed zero: don't boost, don't punish).
 *     ("High traffic but no revenue observed")
 *   • revenue unknown, conversions > 0 → gentler proxy `1 + log10(conv+1)/3`,
 *     capped at 2.0 — strictly weaker than real revenue so weak evidence can't
 *     dominate. ("Revenue unknown; using conversion/traffic fallback")
 *   • otherwise → 1.0 neutral (informational/traffic-only pages unpenalized).
 *     ("Revenue data unavailable from GA4")
 */
export function revenueScoreMultiplier(v: PageRevenueValue): RevenueScoreInfluence {
  if (v.revenue != null && v.revenue > 0) {
    const mult = Math.min(REVENUE_MULT_CEILING, 1 + Math.log10(v.revenue + 1) / 2);
    return {
      multiplier: mult,
      basis: "revenue",
      explain: "Ranked higher because this page has proven revenue",
    };
  }
  if (v.revenue === 0) {
    return {
      multiplier: 1.0,
      basis: "revenue",
      explain: "High traffic but no revenue observed",
    };
  }
  if (v.conversions > 0) {
    const mult = Math.min(
      CONVERSION_MULT_CEILING,
      1 + Math.log10(v.conversions + 1) / 3,
    );
    return {
      multiplier: mult,
      basis: "conversions",
      explain: "Revenue unknown; using conversion/traffic fallback",
    };
  }
  return {
    multiplier: 1.0,
    basis: "none",
    explain:
      v.confidence === "unknown"
        ? "Revenue data unavailable from GA4"
        : "Revenue signal is weak; not over-weighted",
  };
}

/**
 * Plain-English label for a page's revenue state — used by the UI so "unknown"
 * never renders as "$0". PURE.
 */
export function revenueStateLabel(v: PageRevenueValue): string {
  if (v.confidence === "unknown") return "No GA4 data";
  if (v.revenue == null) {
    return v.conversions > 0
      ? "Revenue unknown — using conversions"
      : "Revenue unknown";
  }
  if (v.revenue === 0) {
    return v.sessions > 0 ? "Traffic but no revenue observed" : "No revenue observed";
  }
  return "Revenue observed";
}
