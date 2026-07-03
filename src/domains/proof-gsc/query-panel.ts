import "server-only";

/**
 * query-panel (BEACON_500 P4 R10a, v1 item 150, 2026-07-03) - the FIXED query
 * panel read for a shipped change.
 *
 * At ship time the record freezes `targetQueries` (the exact searches the
 * change aimed at), but the page-level verdict reads whole-page totals. This
 * module measures the SAME frozen query set before and after the change - one
 * aggregate panel over gsc_daily_rows' page+query grain, reusing target-query-
 * read.ts's proven www-variant reader - and attaches the result as
 * `panelOutcome` ALONGSIDE the page-level outcome. It is a second lens on the
 * same window, never a second verdict: when the panel and the page-level read
 * DISAGREE in direction, the sentence says so plainly ("The searches this
 * change targeted grew 12 percent, but the page overall fell 5 percent.") and
 * N10's reliability grade gets an optional disagreement input that demotes
 * the read to shaky. Panel absent (no query-grain rows, or too thin for an
 * honest rate) = honest null, never a fabricated read.
 *
 * Item 68's targetQueryRead stays PER QUERY with its own 50-impression floor
 * per query; this panel deliberately aggregates the whole frozen set so thin
 * individual queries still add up to one honest read. Computed-only, same
 * posture as every attachment on the record: recomputed on every measure,
 * never persisted (recordToRow omits it).
 *
 * Pure math in computeQueryPanelOutcome (pinned by query-panel.test.ts);
 * the Supabase read lives in buildQueryPanelOutcome (fail-soft -> null).
 */

import { readTargetQueryWindow, MIN_QUERY_IMPRESSIONS } from "./target-query-read";

export type QueryPanelWindow = {
  clicks: number;
  impressions: number;
  /** 0-1. */
  ctr: number;
  /** Impressions-weighted average position; 0 = no data. */
  position: number;
};

export type QueryPanelOutcome = {
  /** How many distinct frozen target queries the panel covers. */
  queriesInPanel: number;
  /** The closed basis window this read covers (7/14/28). */
  windowDays: number;
  /** Raw sums over the pre window (NOT pro-rated; windowDays scaling happens
   *  inside the percent math). */
  panelPre: QueryPanelWindow;
  panelPost: QueryPanelWindow;
  /** Panel clicks percent change (post vs the pre window pro-rated to the
   *  post length), as a fraction (0.12 = grew 12 percent). Null when the
   *  pro-rated pre clicks are too thin for an honest rate. */
  panelClicksPct: number | null;
  /** Page-level clicks percent change over the SAME window, same scaling. */
  pageClicksPct: number | null;
  /** True when panel and page-level clicks moved in meaningfully opposite
   *  directions - the N10 demotion input. */
  disagreesWithPage: boolean;
  /** The plain disagreement sentence, non-null ONLY when disagreesWithPage. */
  sentence: string | null;
  /** Compact always-available line for the "See the math" expander. */
  panelLine: string;
};

/** The panel needs real pre-window presence before any read - the SAME floor
 *  target-query-read.ts applies per query, applied here to the aggregate. */
export const MIN_PANEL_PRE_IMPRESSIONS = MIN_QUERY_IMPRESSIONS;
/** Below this many pro-rated pre-window clicks, a percent change is not an
 *  honest rate (matches measure.ts's DEFAULT_MIN_LIFT_CLICKS scale). */
const MIN_PRE_CLICKS_FOR_PCT = 3;
/** Both sides must move at least this much before opposite signs count as a
 *  real disagreement rather than noise. */
const MIN_DIRECTION_PCT = 0.05;

const pctWord = (pct: number): string => `${pct > 0 ? "grew" : "fell"} ${Math.round(Math.abs(pct) * 100)} percent`;

/** PURE panel math: percent pair, disagreement call, and the plain sentences. */
export function computeQueryPanelOutcome(args: {
  queriesInPanel: number;
  windowDays: number;
  preWindowDays: number;
  panelPre: QueryPanelWindow;
  panelPost: QueryPanelWindow;
  /** Treated page's whole-page clicks over the pre window (raw sum). */
  pagePreClicks: number;
  /** Treated page's whole-page clicks over the post window (raw sum). */
  pagePostClicks: number;
}): QueryPanelOutcome | null {
  if (args.queriesInPanel <= 0 || args.windowDays <= 0 || args.preWindowDays <= 0) return null;
  // Honest absence: a panel with no real pre-ship Search presence has no
  // before to compare against (and "no query-grain rows at all" lands here
  // too, as an all-zero pre window).
  if (args.panelPre.impressions < MIN_PANEL_PRE_IMPRESSIONS) return null;

  const scale = args.windowDays / args.preWindowDays;
  const pctOf = (preClicks: number, postClicks: number): number | null => {
    const scaledPre = preClicks * scale;
    if (scaledPre < MIN_PRE_CLICKS_FOR_PCT) return null;
    return (postClicks - scaledPre) / scaledPre;
  };
  const panelClicksPct = pctOf(args.panelPre.clicks, args.panelPost.clicks);
  const pageClicksPct = pctOf(args.pagePreClicks, args.pagePostClicks);

  const disagreesWithPage =
    panelClicksPct != null &&
    pageClicksPct != null &&
    Math.abs(panelClicksPct) >= MIN_DIRECTION_PCT &&
    Math.abs(pageClicksPct) >= MIN_DIRECTION_PCT &&
    Math.sign(panelClicksPct) !== Math.sign(pageClicksPct);

  let sentence: string | null = null;
  if (disagreesWithPage && panelClicksPct != null && pageClicksPct != null) {
    sentence =
      panelClicksPct > 0
        ? `The searches this change targeted ${pctWord(panelClicksPct)}, but the page overall ${pctWord(pageClicksPct)}. Something else on the page lost ground.`
        : `The searches this change targeted ${pctWord(panelClicksPct)}, but the page overall ${pctWord(pageClicksPct)}. The gain is coming from other searches, not the ones we aimed at.`;
  }

  const scaledPreClicks = Math.round(args.panelPre.clicks * scale);
  const panelLine = `The ${args.queriesInPanel} search${args.queriesInPanel === 1 ? "" : "es"} this change targeted went from about ${scaledPreClicks} clicks to ${Math.round(args.panelPost.clicks)} clicks over the ${args.windowDays} day window.`;

  return {
    queriesInPanel: args.queriesInPanel,
    windowDays: args.windowDays,
    panelPre: args.panelPre,
    panelPost: args.panelPost,
    panelClicksPct,
    pageClicksPct,
    disagreesWithPage,
    sentence,
    panelLine,
  };
}

function aggregatePanel(byQuery: Map<string, { clicks: number; impressions: number; posWeighted: number }> | undefined): QueryPanelWindow {
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  for (const a of byQuery?.values() ?? []) {
    clicks += a.clicks;
    impressions += a.impressions;
    posWeighted += a.posWeighted;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeighted / impressions : 0,
  };
}

/**
 * Read the frozen target-query panel for one shipped change over one
 * pre/post window pair and run the pure math above. Fail-soft -> null
 * (honest silence), matching every other computed attachment in this ledger.
 */
export async function buildQueryPanelOutcome(args: {
  tenantId: string;
  /** Canonical treated page URL. */
  page: string;
  targetQueries: ReadonlyArray<string>;
  preStart: string;
  preEnd: string; // == shipDate
  postStart: string; // == shipDate
  postEnd: string;
  windowDays: number;
  preWindowDays: number;
  pagePreClicks: number;
  pagePostClicks: number;
}): Promise<QueryPanelOutcome | null> {
  const queries = [
    ...new Set((args.targetQueries ?? []).map((q) => (q ?? "").trim()).filter((q) => q.length > 0)),
  ];
  if (!args.tenantId || !args.page || queries.length === 0) return null;
  try {
    const [pre, post] = await Promise.all([
      readTargetQueryWindow(args.tenantId, [args.page], queries, args.preStart, args.preEnd),
      readTargetQueryWindow(args.tenantId, [args.page], queries, args.postStart, args.postEnd),
    ]);
    return computeQueryPanelOutcome({
      queriesInPanel: queries.length,
      windowDays: args.windowDays,
      preWindowDays: args.preWindowDays,
      panelPre: aggregatePanel(pre.get(args.page)),
      panelPost: aggregatePanel(post.get(args.page)),
      pagePreClicks: args.pagePreClicks,
      pagePostClicks: args.pagePostClicks,
    });
  } catch {
    return null;
  }
}
