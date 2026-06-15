/**
 * All-source stat-row reducer (2026-06-15) — the PURE core of the
 * unified Today command center's top stat row.
 *
 * Beacon is NOT an AEO-only tool: AEO ("AI answers") is one source
 * among equals alongside GSC search, GA4 traffic, SEMrush rankings,
 * and Clarity friction. This helper takes the GSC site-totals object,
 * three per-page Maps (GA4 / SEMrush / Clarity), and the AEO KPIs
 * object, and reduces each to its 2–4 headline numbers, returning ONE
 * compact card per source.
 *
 * GATING CONTRACT (the whole point — see plan risk "GATING TRAP"):
 *   Cards gate on DATA PRESENCE, never on connector status. A source
 *   that is OAuth-connected but has synced zero rows (e.g. Iranopedia's
 *   GA4) yields an EMPTY Map → no card. A source with real raw data
 *   must never be hidden by a connect check. Concretely:
 *     - GSC:     emit iff site-totals is non-null AND impressions90d > 0
 *     - GA4:     emit iff Σ sessions28d > 0   (connected-but-empty → no card)
 *     - SEMrush: emit iff the Map is non-empty
 *     - Clarity: emit iff Σ sessions > 0
 *     - AEO:     emit iff the KPIs object is non-null
 *   So a card always shows REAL numbers or doesn't show at all.
 *
 * Pure: no I/O, no Date.now (the loaders pass a stable `now`-free shape
 * — the GSC delta comes from the site-totals' 28d/prior-28d clicks
 * split). Unit-tested in `build-source-stat-cards.test.ts`.
 */

import type { GscSiteTotals } from "@/domains/recommendation-intelligence/gsc-page-signals";
import type { Ga4PageValue } from "@/domains/recommendation-intelligence/ga4-page-values";
import type { ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import type { SemrushPageSignal } from "@/domains/recommendation-intelligence/semrush-page-signals";
import type { TodayDerivedKpis } from "@/domains/daily-metric-snapshots/today-kpis";

/** One headline number on a card (big value + tiny label under it). */
export type SourceStat = {
  /** Plain-English label, e.g. "Clicks". No jargon. */
  label: string;
  /** Pre-formatted display value, e.g. "12,019" or "2.3%". */
  value: string;
};

/** A delta/freshness sub-line under the stats. */
export type SourceSubline = {
  /** Pre-formatted text, e.g. "+8% vs prior 28 days" or "building history". */
  text: string;
  /** Visual tone for the sub-line. */
  tone: "up" | "down" | "neutral";
};

/** One compact stat card — a single source's headline scoreboard. */
export type SourceStatCard = {
  /** Stable key / data-attr value, e.g. "gsc". */
  key: "gsc" | "ga4" | "semrush" | "clarity" | "aeo";
  /** Plain-English source label, e.g. "Search (Google)". */
  source: string;
  /** 2–4 headline numbers. */
  stats: SourceStat[];
  /** Optional single delta/freshness sub-line. */
  subline: SourceSubline | null;
};

export type AllSourceStatInputs = {
  /** Light per-day site-totals read (or null when GSC has no data). */
  gscSiteTotals: GscSiteTotals | null;
  ga4: Map<string, Ga4PageValue>;
  clarity: Map<string, ClarityPageSignal>;
  semrush: Map<string, SemrushPageSignal>;
  aeo: TodayDerivedKpis | null;
};

// ── Formatting helpers (pure) ────────────────────────────────────────

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Compact integer for large counts: 791,710 → "792K", 1,200,000 → "1.2M". */
function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
  }
  if (abs >= 10_000) {
    return `${Math.round(n / 1000)}K`;
  }
  return fmtInt(n);
}

/** Fraction (0–1) → "2.3%". */
function fmtPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

/** Average position → "5.0" (one decimal). */
function fmtPosition(pos: number): string {
  return pos.toFixed(1);
}

/** Signed percent delta for the before/after arrow, e.g. "+8%" / "-12%". */
function fmtSignedPct(fraction: number): string {
  const pct = Math.round(fraction * 100);
  return `${pct >= 0 ? "+" : ""}${pct}%`;
}

// ── Per-source reducers ──────────────────────────────────────────────

/**
 * GSC card: site clicks + impressions (compact), impressions-weighted
 * avg position, and site CTR (Σclicks/Σimpressions, NOT the average of
 * per-page CTRs). Consumes the LIGHT per-day site-totals object (one
 * tiny `gsc_daily_totals` read) instead of summing the ~200-page signal
 * Map, so the card streams instantly. Sub-line is the 28d clicks
 * before/after delta (clicks28d vs clicksPrev28d) — shown only when the
 * prior 28-day window has clicks so we never imply a trend off a single
 * window.
 */
function buildGscCard(totals: GscSiteTotals | null): SourceStatCard | null {
  // Gate on DATA presence: no data / no impressions → no card.
  if (totals == null || totals.impressions90d <= 0) return null;

  // Before/after arrow from the 28d / prior-28d clicks split. Only show
  // the delta when the prior window has clicks (otherwise it's a first-
  // window number with nothing to compare against).
  let subline: SourceSubline | null = null;
  if (totals.clicksPrev28d > 0) {
    const deltaFraction =
      (totals.clicks28d - totals.clicksPrev28d) / totals.clicksPrev28d;
    const tone: SourceSubline["tone"] =
      totals.clicks28d > totals.clicksPrev28d
        ? "up"
        : totals.clicks28d < totals.clicksPrev28d
          ? "down"
          : "neutral";
    subline = {
      text: `Clicks ${fmtSignedPct(deltaFraction)} vs the prior 28 days`,
      tone,
    };
  }

  return {
    key: "gsc",
    source: "Search (Google)",
    stats: [
      { label: "Clicks (90d)", value: fmtCompact(totals.clicks90d) },
      { label: "Impressions", value: fmtCompact(totals.impressions90d) },
      { label: "Avg. position", value: fmtPosition(totals.avgPosition90d) },
      { label: "Click rate", value: fmtPct(totals.ctr90d) },
    ],
    subline,
  };
}

/**
 * GA4 card: sessions + engaged-session rate + conversions over 28d.
 * Gate on Σ sessions > 0 — a connected-but-empty GA4 (Iranopedia: 0
 * rows) returns an empty Map and MUST NOT render a "0 sessions" card.
 */
function buildGa4Card(ga4: Map<string, Ga4PageValue>): SourceStatCard | null {
  let sessions = 0;
  let engaged = 0;
  let conversions = 0;
  for (const v of ga4.values()) {
    sessions += v.sessions28d;
    engaged += v.engaged28d;
    conversions += v.conversions28d;
  }
  if (sessions <= 0) return null;

  const engagedRate = engaged / sessions;
  const stats: SourceStat[] = [
    { label: "Visits (28d)", value: fmtCompact(sessions) },
    { label: "Engaged rate", value: fmtPct(engagedRate) },
  ];
  // Conversions only earns a stat slot when there are any — never "0".
  if (conversions > 0) {
    stats.push({ label: "Conversions", value: fmtInt(conversions) });
  }
  return {
    key: "ga4",
    source: "Website visits",
    stats,
    subline: null,
  };
}

/**
 * SEMrush card: keywords you rank for (distinct), striking-distance
 * quick-wins (positions 4–20), and total tracked search volume.
 * Gate on a non-empty Map (not connected for Iranopedia → empty → hidden).
 */
function buildSemrushCard(
  semrush: Map<string, SemrushPageSignal>,
): SourceStatCard | null {
  if (semrush.size === 0) return null;

  const distinctKeywords = new Set<string>();
  let strikingDistance = 0;
  let trackedVolume = 0;
  for (const s of semrush.values()) {
    for (const k of s.keywords) {
      distinctKeywords.add(k.keyword);
      trackedVolume += k.volume;
    }
    strikingDistance += s.strikingDistance.length;
  }
  // A non-empty Map with zero ranked keywords across all pages has no
  // real headline — gate it out too.
  if (distinctKeywords.size === 0) return null;

  return {
    key: "semrush",
    source: "Keyword rankings",
    stats: [
      { label: "Keywords ranked", value: fmtInt(distinctKeywords.size) },
      { label: "Quick wins", value: fmtInt(strikingDistance) },
      { label: "Search volume", value: fmtCompact(trackedVolume) },
    ],
    subline:
      strikingDistance > 0
        ? {
            text: `${fmtInt(strikingDistance)} keyword${strikingDistance === 1 ? "" : "s"} close to page one`,
            tone: "neutral",
          }
        : null,
  };
}

/**
 * Clarity card: sessions analyzed + rage-click rate + dead-click rate,
 * recomputed from SUMMED counts (Σrage/Σsessions) — never the average of
 * per-page rates. When Clarity is only ~1 day deep we label "building
 * history" and show absolute counts, never a delta (a trend off one day
 * would be dishonest).
 *
 * `claritySpansMultipleDays` lets the loader tell us whether enough days
 * have accumulated; when false we suppress any trend framing.
 */
function buildClarityCard(
  clarity: Map<string, ClarityPageSignal>,
  claritySpansMultipleDays: boolean,
): SourceStatCard | null {
  let sessions = 0;
  let rage = 0;
  let dead = 0;
  for (const s of clarity.values()) {
    sessions += s.sessions;
    rage += s.rageClicks;
    dead += s.deadClicks;
  }
  if (sessions <= 0) return null;

  // Recompute site rates from summed counts (not averaged per-page rates).
  const rageRate = rage / sessions;
  const deadRate = dead / sessions;

  const stats: SourceStat[] = [
    { label: "Visits analyzed", value: fmtCompact(sessions) },
    { label: "Frustrated clicks", value: fmtPct(rageRate) },
    { label: "Dead clicks", value: fmtPct(deadRate) },
  ];

  // Building-history label when only one day is in: be honest, no delta.
  const subline: SourceSubline = claritySpansMultipleDays
    ? { text: `${fmtInt(rage + dead)} friction signals seen`, tone: "neutral" }
    : { text: "Building history — first day of data", tone: "neutral" };

  return {
    key: "clarity",
    source: "Visitor experience",
    stats,
    subline,
  };
}

/**
 * AEO card: times AI recommended you (citations), how often AI mentions
 * you (mentions), and platforms observed. Self-hides when the KPIs are
 * null (raw observations may exist but the derived rollup isn't written
 * when crons are off — the card stays hidden and AEO is represented by
 * the demoted section below). NO vendor name ("Profound" never appears).
 */
function buildAeoCard(aeo: TodayDerivedKpis | null): SourceStatCard | null {
  if (aeo == null) return null;
  // A derived rollup that exists but is entirely empty has no headline —
  // hide rather than show "0 / 0".
  if (aeo.totalCitations <= 0 && aeo.totalMentions <= 0) return null;

  const stats: SourceStat[] = [
    { label: "AI recommended you", value: fmtInt(aeo.totalCitations) },
    { label: "AI mentioned you", value: fmtInt(aeo.totalMentions) },
  ];
  if (aeo.platformRowCount > 0) {
    stats.push({
      label: "AI platforms",
      value: fmtInt(aeo.platformRowCount),
    });
  }
  return {
    key: "aeo",
    source: "AI answers",
    stats,
    subline: aeo.isFallback
      ? { text: "Latest available reading", tone: "neutral" }
      : null,
  };
}

/**
 * Build the all-source stat row. Returns ONLY cards whose source has
 * real data; the order is GSC → GA4 → SEMrush → Clarity → AEO (search-
 * first, AEO as one-among-equals). The caller renders nothing when the
 * array is empty.
 *
 * @param claritySpansMultipleDays whether Clarity has >1 day of data
 *   (drives the "building history" honesty label). Defaults to false
 *   (treat thin data conservatively).
 */
export function buildSourceStatCards(
  inputs: AllSourceStatInputs,
  claritySpansMultipleDays = false,
): SourceStatCard[] {
  const cards: Array<SourceStatCard | null> = [
    buildGscCard(inputs.gscSiteTotals),
    buildGa4Card(inputs.ga4),
    buildSemrushCard(inputs.semrush),
    buildClarityCard(inputs.clarity, claritySpansMultipleDays),
    buildAeoCard(inputs.aeo),
  ];
  return cards.filter((c): c is SourceStatCard => c !== null);
}
