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
 *     - GA4:     NEVER emits (Wave 1 P1, 2026-07-10) - the sessions sum
 *                across per-page rows is a false sitewide total; see
 *                buildGa4Card below. Withheld until Wave 2's true
 *                property-grain rollup exists.
 *     - SEMrush: emit iff the Map is non-empty
 *     - Clarity: emit iff Σ sessions > 0
 *     - AEO:     emit iff the KPIs object is non-null
 *   So a card always shows REAL numbers or doesn't show at all.
 *
 * Pure: no I/O, no Date.now (the loaders pass a stable `now`-free shape
 * — the GSC delta comes from the site-totals' 28d/prior-28d clicks
 * split). Unit-tested in `build-source-stat-cards.test.ts`.
 */

import type {
  GscSiteTotals,
  GscDecaySignal,
} from "@/domains/recommendation-intelligence/gsc-page-signals";
import type { Ga4PageValue } from "@/domains/recommendation-intelligence/ga4-page-values";
import type { ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import type { TodayDerivedKpis } from "@/domains/daily-metric-snapshots/today-kpis";
import { SOURCE_SLA } from "@/domains/ops/source-freshness";

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
  key: "gsc" | "ga4" | "clarity" | "aeo";
  /** Plain-English source label, e.g. "Search (Google)". */
  source: string;
  /** 2–4 headline numbers. */
  stats: SourceStat[];
  /** Optional single delta/freshness sub-line. */
  subline: SourceSubline | null;
  /**
   * Optional tiny momentum series for an axis-free sparkline under the
   * numbers (currently the GSC card's real daily clicks). Only set when
   * there are enough points to draw an honest line (≥
   * MIN_SPARKLINE_POINTS); otherwise omitted so we never render a flat /
   * near-empty line. Other source cards leave this undefined.
   */
  sparkline?: number[];
  /**
   * Optional call-to-action that turns an alarming stat into a doorway to
   * the fix (2026-06-15) — e.g. a GSC click drop or visible Clarity friction
   * links to the recommendations queue where the corresponding fixes live.
   * A pro SEO never leaves "clicks down 38%" sitting as a dead-end number.
   * Null when the source has nothing alarming to act on.
   */
  action?: { label: string; href: string } | null;
  /**
   * Top pages losing clicks (2026-06-15) — the per-page decomposition of a
   * site-level click drop. A sharp SEO never reports "-38%" without naming
   * WHICH pages are bleeding. Set on the GSC card from the lean per-page
   * decay RPC; null/absent when there's nothing meaningfully declining.
   */
  topDeclines?: Array<{ path: string; dropPct: number }> | null;
  /**
   * Top pages by visitor friction (2026-06-15) — the per-page decomposition
   * of a site-level dead/rage-click rate, so the Clarity card names WHICH
   * pages frustrate visitors most instead of only reporting "22% dead
   * clicks". Set on the Clarity card; null/absent when nothing stands out.
   */
  topFriction?: Array<{ path: string; perVisit: number }> | null;
};

/**
 * Minimum daily points before a sparkline is drawn. Below this a line
 * would be too short to read as a trend and would imply precision we
 * don't have — better to omit it than to show a near-flat scribble.
 */
export const MIN_SPARKLINE_POINTS = 14;

export type AllSourceStatInputs = {
  /** Light per-day site-totals read (or null when GSC has no data). */
  gscSiteTotals: GscSiteTotals | null;
  /**
   * Optional per-page 28d-vs-prior-28d decay signals (lean `gsc_decay_v1`
   * RPC — one row per page). Used to decompose a site click drop into the
   * specific pages losing the most clicks. Absent → no per-page breakdown.
   */
  gscDecay?: Map<string, GscDecaySignal>;
  ga4: Map<string, Ga4PageValue>;
  clarity: Map<string, ClarityPageSignal>;
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

// ── Cross-source fusion: "Fix first" ─────────────────────────────────

/**
 * A page that is BOTH losing Google clicks (GSC decline) AND frustrating
 * visitors (Clarity friction) — the highest-urgency fix on the site. No
 * single source surfaces this: GSC alone says "clicks down", Clarity alone
 * says "high friction"; the FUSION says "this page is fading in search AND
 * broken for visitors — fix it before anything else." This is the kind of
 * cross-source insight a human SEO associate almost never connects.
 */
export type FixFirstPage = {
  path: string;
  /** % of clicks lost vs the prior 28 days. */
  dropPct: number;
  /** average (rage + dead) friction clicks per visit (can exceed 1). */
  frictionPerVisit: number;
};

const MAX_FIX_FIRST_ROWS = 3;

/**
 * Pure: intersect the GSC decliners with the Clarity friction pages (matched
 * by URL pathname so a host/query difference never splits the same page),
 * ranked by combined severity (drop% + friction%). Reuses the SAME
 * thresholds as the per-card breakdowns so a page can't appear here without
 * also qualifying on each source individually. Null when no page clears both.
 */
export function buildFixFirstPages(
  decay: Map<string, GscDecaySignal> | undefined,
  clarity: Map<string, ClarityPageSignal>,
): FixFirstPage[] | null {
  if (!decay || decay.size === 0 || clarity.size === 0) return null;

  const dropByPath = new Map<string, number>();
  for (const s of decay.values()) {
    if (s.clicksPrior < MIN_DECLINE_PRIOR_CLICKS || s.clicksNow >= s.clicksPrior)
      continue;
    const dropPct = Math.round(
      (1 - s.clicksNow / Math.max(1, s.clicksPrior)) * 100,
    );
    if (dropPct < MIN_DECLINE_DROP_PCT) continue;
    const p = pathOf(s.page);
    // Keep the worst drop if the same path appears twice.
    if (!dropByPath.has(p) || dropPct > dropByPath.get(p)!)
      dropByPath.set(p, dropPct);
  }

  const rows: FixFirstPage[] = [];
  for (const s of clarity.values()) {
    if (s.sessions < MIN_FRICTION_SESSIONS) continue;
    const rate = (s.rageClicks + s.deadClicks) / Math.max(1, s.sessions);
    if (rate < MIN_FRICTION_RATE) continue;
    const p = pathOf(s.url);
    const dropPct = dropByPath.get(p);
    if (dropPct == null) continue; // not also a decliner → not "fix first"
    rows.push({ path: p, dropPct, frictionPerVisit: Math.round(rate * 10) / 10 });
  }
  if (rows.length === 0) return null;
  // Rank by combined severity. frictionPerVisit is rescaled (×100) so the
  // friction term keeps the same weight in the sort it had as a percentage.
  rows.sort(
    (a, b) =>
      b.dropPct + b.frictionPerVisit * 100 - (a.dropPct + a.frictionPerVisit * 100),
  );
  return rows.slice(0, MAX_FIX_FIRST_ROWS);
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
/** A page needs at least this many clicks in the PRIOR window to be worth
 *  flagging as a decliner — below it the % drop is noise. Mirrors the
 *  gsc_decay trigger's prior-clicks floor intent. */
const MIN_DECLINE_PRIOR_CLICKS = 5;
/** Only surface pages that lost a MEANINGFUL share of clicks. */
const MIN_DECLINE_DROP_PCT = 20;
/** Cap the inline list so the card stays a scoreboard, not a report. */
const MAX_DECLINE_ROWS = 3;

/** Pure: reduce per-page decay signals to the top pages losing clicks. */
function topDecliningPages(
  decay: Map<string, GscDecaySignal> | undefined,
): Array<{ path: string; dropPct: number }> | null {
  if (!decay || decay.size === 0) return null;
  const rows = [...decay.values()]
    .filter(
      (s) =>
        s.clicksPrior >= MIN_DECLINE_PRIOR_CLICKS && s.clicksNow < s.clicksPrior,
    )
    .map((s) => ({
      path: pathOf(s.page),
      clicksLost: s.clicksPrior - s.clicksNow,
      dropPct: Math.round((1 - s.clicksNow / Math.max(1, s.clicksPrior)) * 100),
    }))
    .filter((r) => r.dropPct >= MIN_DECLINE_DROP_PCT)
    .sort((a, b) => b.clicksLost - a.clicksLost)
    .slice(0, MAX_DECLINE_ROWS)
    .map((r) => ({ path: r.path, dropPct: r.dropPct }));
  return rows.length > 0 ? rows : null;
}

/** URL → short display path (pathname, leading slash, no host/query). */
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    // Already a path or unparseable — strip protocol/host best-effort.
    return url.replace(/^https?:\/\/[^/]+/i, "") || url;
  }
}

function buildGscCard(
  totals: GscSiteTotals | null,
  decay?: Map<string, GscDecaySignal>,
): SourceStatCard | null {
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

  // Tiny daily-clicks momentum line — the real per-day series the loader
  // already read (no extra DB work), shown only when there are enough
  // points to be an honest trend (never a flat/near-empty line).
  const dailySeries = totals.dailyClicks.map((d) => d.clicks);
  const sparkline =
    dailySeries.length >= MIN_SPARKLINE_POINTS ? dailySeries : undefined;

  // When clicks are FALLING, don't leave the drop as a dead-end number —
  // point the operator at the recommendations queue where the fade-fighting
  // fixes (refreshed titles / intros / decaying-page reworks) live.
  const action =
    subline?.tone === "down"
      ? { label: "See what to do about this →", href: "/recommendations" }
      : null;

  return {
    key: "gsc",
    source: "Search (Google)",
    stats: [
      { label: "Visits from Google (90 days)", value: fmtCompact(totals.clicks90d) },
      { label: "Times shown on Google", value: fmtCompact(totals.impressions90d) },
      { label: "Average Google rank", value: fmtPosition(totals.avgPosition90d) },
      { label: "Click rate", value: fmtPct(totals.ctr90d) },
    ],
    subline,
    sparkline,
    action,
    topDeclines: topDecliningPages(decay),
  };
}

/**
 * GA4 card - REMOVED (Wave 1 adversarial review P1, 2026-07-10).
 *
 * This used to sum `v.sessions28d` across every per-URL `ga4_url_traffic`
 * row and render the total as a "Visits (28 days)" stat under a "Website
 * visits" card. GA4 sessions are NOT additive across page paths - a single
 * visit that touches several pages appears in several per-page rows, so
 * the sum materially inflates the real sitewide visit count. This is the
 * SAME false-total class the north star's P0-A fix removed (see
 * `src/domains/north-star/monthly-pulse.ts`); it was dormant here only
 * because Iranopedia has zero GA4 rows - any GA4-connected tenant would
 * have rendered an inflated number.
 *
 * We do not invent a replacement inferred number (e.g. rescaling the
 * engaged-rate or conversions stats, which are derived from the same
 * non-additive per-page sum) to stand in for it. Unlike the north star's
 * single hero metric, this card has no other honest number worth a slot
 * in the Today stat-card grid on its own, so it simply self-hides - same
 * "gate on data presence, not connector status" contract as every other
 * card here, just with the presence check now always failing until the
 * true property-grain GA4 rollup exists (Wave 2's job; do not resurrect
 * the summing shape). Per-page `Ga4PageValue` consumers elsewhere are
 * untouched.
 */
function buildGa4Card(_ga4: Map<string, Ga4PageValue>): SourceStatCard | null {
  // Wave 3A: GA4 is a canonical "removed" source (source-freshness.ts SOURCE_SLA.ga4.removed).
  // This card reads the SAME removed flag the data-source health tally reads, so the stat-card
  // grid and the freshness health line can never disagree about GA4's status. While removed it
  // renders no card at all - the cross-page session sum is a false total (Wave 1 P1).
  if (SOURCE_SLA.ga4.removed) return null;
  // If GA4 is ever un-removed, a TRUE property-grain rollup card is wired here - never the
  // per-page session SUM shape that this guard exists to keep off the Today surface.
  return null;
}

/**
 * SEMrush card: keywords you rank for (distinct), striking-distance
 * quick-wins (positions 4–20), and total tracked search volume.
 * Gate on a non-empty Map (not connected for Iranopedia → empty → hidden).
 */
// (buildSemrushCard removed Phase F.1 — SEMrush deleted caller-first.)

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
    { label: "Clicks that did nothing", value: fmtPct(deadRate) },
  ];

  // Building-history label when only one day is in: be honest, no delta.
  const subline: SourceSubline = claritySpansMultipleDays
    ? { text: `${fmtInt(rage + dead)} friction signals seen`, tone: "neutral" }
    : { text: "Building history — first day of data", tone: "neutral" };

  // When visitors are hitting friction (rage / dead clicks), surface the
  // doorway to the fixes rather than leaving the rate as a dead-end number.
  const action =
    rage + dead > 0
      ? { label: "See what to do about this →", href: "/recommendations" }
      : null;

  return {
    key: "clarity",
    source: "Visitor experience",
    stats,
    subline,
    action,
    topFriction: topFrictionPages(clarity),
  };
}

/** A page needs at least this many sessions before its friction RATE is
 *  trustworthy (a 100%-dead page off 2 sessions is noise). */
const MIN_FRICTION_SESSIONS = 10;
/** Only surface pages whose combined friction rate clears this floor. */
const MIN_FRICTION_RATE = 0.1;
const MAX_FRICTION_ROWS = 3;

/** Pure: reduce per-page Clarity signals to the most-frustrating pages,
 *  ranked by combined (rage + dead) click rate. */
function topFrictionPages(
  clarity: Map<string, ClarityPageSignal>,
): Array<{ path: string; perVisit: number }> | null {
  if (clarity.size === 0) return null;
  const rows = [...clarity.values()]
    .filter((s) => s.sessions >= MIN_FRICTION_SESSIONS)
    .map((s) => ({
      path: pathOf(s.url),
      rate: (s.rageClicks + s.deadClicks) / Math.max(1, s.sessions),
    }))
    .filter((r) => r.rate >= MIN_FRICTION_RATE)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, MAX_FRICTION_ROWS)
    .map((r) => ({ path: r.path, perVisit: Math.round(r.rate * 10) / 10 }));
  return rows.length > 0 ? rows : null;
}

/**
 * AEO card: times AI CITED your pages (citations), how often AI mentions
 * you (mentions), and platforms observed. Self-hides when the KPIs are
 * null (raw observations may exist but the derived rollup isn't written
 * when crons are off — the card stays hidden and AEO is represented by
 * the demoted section below). NO vendor name ("Profound" never appears).
 * audit #12 (2026-07-09): "recommended" was an overclaim - a citation is AI
 * linking/quoting your page, NOT a recommendation, referral, or conversion.
 * Label each event honestly by what it actually is.
 */
function buildAeoCard(aeo: TodayDerivedKpis | null): SourceStatCard | null {
  if (aeo == null) return null;
  // A derived rollup that exists but is entirely empty has no headline —
  // hide rather than show "0 / 0".
  if (aeo.totalCitations <= 0 && aeo.totalMentions <= 0) return null;

  const stats: SourceStat[] = [
    { label: "Times AI cited your pages", value: fmtInt(aeo.totalCitations) },
    { label: "Times AI mentioned you", value: fmtInt(aeo.totalMentions) },
  ];
  if (aeo.platformRowCount > 0) {
    stats.push({
      label: "AI tools checked",
      value: fmtInt(aeo.platformRowCount),
    });
  }
  return {
    key: "aeo",
    source: "AI answers",
    stats,
    // audit-wave2 #6: these are a SINGLE day's counts — always name the reading
    // day so they're not read as a cumulative/long-window total.
    subline: aeo.isFallback
      ? { text: "Latest available reading", tone: "neutral" }
      : { text: `AI answers read on ${aeo.date}`, tone: "neutral" },
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
    buildGscCard(inputs.gscSiteTotals, inputs.gscDecay),
    buildGa4Card(inputs.ga4),
    buildClarityCard(inputs.clarity, claritySpansMultipleDays),
    buildAeoCard(inputs.aeo),
  ];
  return cards.filter((c): c is SourceStatCard => c !== null);
}
