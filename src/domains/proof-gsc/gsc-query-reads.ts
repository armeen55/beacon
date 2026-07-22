import "server-only";

/**
 * gsc-query-reads (Core 100K lane P, 2026-07-21) - the ONE query-grain GSC
 * reader for the measurement surface, consolidating the three modules that
 * each independently read and shaped `gsc_daily_rows` rows:
 *
 *   - target-query-read (master plan item 68): per-target-query diff-in-diff
 *     (CTR + position, treated page vs its own comparison pages).
 *   - query-panel (P4 R10a, v1 item 150): the FIXED frozen-query panel, one
 *     aggregate over the same rows, attached as `panelOutcome` alongside the
 *     page-level outcome (a second lens, never a second verdict).
 *   - query-breadth (P4 R10b, v1 item 151): did the win come from MORE
 *     distinct searches ranking (reach) or the SAME searches clicking more
 *     (depth)?
 *
 * `gsc_daily_rows` is the page+query grain, the only table that names which
 * queries a page ranks for (`gsc_daily_page_totals` / `gsc_page_totals_v1`
 * are page-level only).
 *
 * WWW-VARIANT SAFETY (the "known host trap"): `gsc_daily_rows.page` stores
 * whatever raw host GSC's property used (e.g. `www.iranopedia.com`) while
 * every ShippedChangeRecord page/controlPage arrives canonicalized
 * (www.-stripped), so a plain `page IN (...)` filter can silently match ZERO
 * rows. Same proven fix as auto-record-on-ship.ts: query BOTH host forms
 * (withWwwVariant), then fold rows back onto the canonical page key.
 *
 * Bounded + paged (PAGE_SIZE chunks up to a hard row cap, never a full-table
 * scan), fail-soft everywhere -> [] or null (honest silence), computed-only:
 * recomputed on every measure, never persisted (recordToRow omits all three).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

// ---------------------------------------------------------------------------
// The shared paged read over gsc_daily_rows
// ---------------------------------------------------------------------------

const PAGE_SIZE = 1000;

/** Both the raw host GSC's property used AND its www-swapped counterpart, so
 *  a canonicalized page URL still matches whichever form `gsc_daily_rows`
 *  actually stored. Mirrors auto-record-on-ship.ts's withWwwVariant exactly. */
export function withWwwVariant(url: string): string[] {
  try {
    const u = new URL(url);
    if (u.hostname.startsWith("www.")) {
      const bare = new URL(url);
      bare.hostname = u.hostname.slice(4);
      return [url, bare.toString()];
    }
    const withWww = new URL(url);
    withWww.hostname = `www.${u.hostname}`;
    return [url, withWww.toString()];
  } catch {
    return [url];
  }
}

/** One bounded, paged loop over a freshly built gsc_daily_rows query (the
 *  builder is constructed fresh per page). Each page's rows are folded by the
 *  caller's closure; the outcome names which ending happened ("complete" = a
 *  short page ended the read, "capped" = the row cap ran out first, or a
 *  Supabase error message) so each consumer keeps its own exact fail-soft
 *  policy. Hard rejections propagate to the caller's try/catch, exactly as
 *  the pre-consolidation loops behaved. */
async function pageThroughRows<Row>(
  makeQuery: () => {
    range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  maxRows: number,
  each: (rows: Row[]) => void,
): Promise<"complete" | "capped" | { errorMessage: string }> {
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) return { errorMessage: error.message };
    const rows = (data ?? []) as Row[];
    each(rows);
    if (rows.length < PAGE_SIZE) return "complete";
  }
  return "capped";
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

// ---------------------------------------------------------------------------
// Target-query reads (master plan item 68): per-query diff-in-diff
// ---------------------------------------------------------------------------

/** Hard cap on rows read per (page-set, query-set, window); real inputs never
 *  approach it, it only stops a pathological input becoming an unbounded scan. */
const MAX_TARGET_QUERY_ROWS = 20_000;

/** Below this many impressions in EITHER window, a per-query CTR/position
 *  read is too thin to say anything honest - the spec's "thin-data silence"
 *  gate, scoped to a single query's much smaller natural volume. */
export const MIN_QUERY_IMPRESSIONS = 50;

export type TargetQueryWindowMetrics = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type TargetQueryRead = {
  query: string;
  /** treated CTR delta minus mean control CTR delta (0-1 scale). */
  ctrDelta: number;
  /** treated position IMPROVEMENT minus mean control position improvement
   *  (positive = moved up more than controls). */
  positionDelta: number;
  treatedPre: TargetQueryWindowMetrics;
  treatedPost: TargetQueryWindowMetrics;
  controlsUsed: number;
  /** "On the exact search we aimed at ('persian singers'): click rate up 1.2
   *  points, position 7.9 to 6.1." Null when there's nothing honest to say. */
  sentence: string | null;
};

type TargetRawRow = {
  page: string;
  query: string;
  clicks: number | string | null;
  impressions: number | string | null;
  position: number | string | null;
};
export type TargetQueryAgg = { clicks: number; impressions: number; posWeighted: number };
type Agg = TargetQueryAgg;

/**
 * One bounded, paged `page IN (...) AND query IN (...)` read over [start,
 * end), aggregated to (canonical page, query) - rows fold back onto the
 * CANONICAL page key regardless of which raw host form each row carries.
 * Fail-soft -> whatever already folded (a read error keeps prior pages,
 * exactly like the loop it replaced).
 */
export async function readTargetQueryWindow(
  tenantId: string,
  pages: ReadonlyArray<string>,
  queries: ReadonlyArray<string>,
  start: string,
  end: string,
): Promise<Map<string, Map<string, Agg>>> {
  const out = new Map<string, Map<string, Agg>>();
  if (!tenantId || pages.length === 0 || queries.length === 0) return out;

  const canonByVariant = new Map<string, string>();
  const queryPages: string[] = [];
  for (const p of pages) {
    for (const v of withWwwVariant(p)) {
      canonByVariant.set(v, p);
      queryPages.push(v);
    }
  }

  try {
    const sb = getSupabaseAdmin();
    const status = await pageThroughRows<TargetRawRow>(
      () =>
        sb
          .from("gsc_daily_rows")
          .select("page, query, clicks, impressions, position")
          .eq("tenant_id", tenantId)
          .in("page", queryPages)
          .in("query", queries as string[])
          .gte("date", start)
          .lt("date", end),
      MAX_TARGET_QUERY_ROWS,
      (rows) => {
        for (const r of rows) {
          if (!r.page || !r.query) continue;
          const canonPage = canonByVariant.get(r.page) ?? r.page;
          const impr = Number(r.impressions) || 0;
          let byQuery = out.get(canonPage);
          if (!byQuery) out.set(canonPage, (byQuery = new Map()));
          const a = byQuery.get(r.query) ?? { clicks: 0, impressions: 0, posWeighted: 0 };
          a.clicks += Number(r.clicks) || 0;
          a.impressions += impr;
          a.posWeighted += (Number(r.position) || 0) * impr;
          byQuery.set(r.query, a);
        }
      },
    );
    if (typeof status === "object") {
      log.warn("[target-query-read] read failed (fail-soft)", { tenantId, error: status.errorMessage });
    }
  } catch (e) {
    log.warn("[target-query-read] threw (fail-soft)", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

function metricsFromAgg(a: Agg | undefined): TargetQueryWindowMetrics {
  const clicks = a?.clicks ?? 0;
  const impressions = a?.impressions ?? 0;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? (a?.posWeighted ?? 0) / impressions : 0,
  };
}

/** CTR delta guarded like measure.ts's ctrDelta: both windows need real
 *  impressions or there is no honest rate to compare. */
function ctrDeltaOf(pre: TargetQueryWindowMetrics, post: TargetQueryWindowMetrics): number {
  return pre.impressions > 0 && post.impressions > 0 ? post.ctr - pre.ctr : 0;
}
/** Position improvement (pre - post; positive = moved up), guarded the same way. */
function posImproveOf(pre: TargetQueryWindowMetrics, post: TargetQueryWindowMetrics): number {
  return pre.position > 0 && post.position > 0 ? pre.position - post.position : 0;
}

/**
 * "On the exact search we aimed at ('persian singers'): click rate up 1.2
 * points, position 7.9 to 6.1." First-person plain language, no dashes.
 * Names whichever of CTR/position had a real (guarded) reading; when only
 * one side has data it names that one alone rather than claiming a flat 0.
 */
export function targetQuerySentence(read: {
  query: string;
  ctrDelta: number;
  positionDelta: number;
  treatedPre: TargetQueryWindowMetrics;
  treatedPost: TargetQueryWindowMetrics;
}): string | null {
  const hasCtr = read.treatedPre.impressions > 0 && read.treatedPost.impressions > 0;
  const hasPos = read.treatedPre.position > 0 && read.treatedPost.position > 0;
  if (!hasCtr && !hasPos) return null;

  const parts: string[] = [];
  if (hasCtr) {
    const pp = round1(read.ctrDelta * 100);
    parts.push(`click rate ${pp >= 0 ? "up" : "down"} ${Math.abs(pp)} point${Math.abs(pp) === 1 ? "" : "s"}`);
  }
  if (hasPos) {
    parts.push(
      `position ${round1(read.treatedPre.position)} to ${round1(read.treatedPost.position)}`,
    );
  }
  return `On the exact search we aimed at ("${read.query}"): ${parts.join(", ")}.`;
}

/**
 * Per-target-query diff-in-diff for one shipped change over one [start, end)
 * pre/post pair. Reads the treated page + its comparison pages, filtered to
 * `targetQueries` only (never the page's full query mix - that dilution is
 * exactly what the page-level verdict already has). Silent (empty array) on
 * missing inputs or thin data (< MIN_QUERY_IMPRESSIONS in EITHER window on
 * the treated page); fail-soft end to end -> [] (honest silence).
 */
export async function buildTargetQueryReads(args: {
  tenantId: string;
  page: string; // canonical treated page URL
  controlPages: ReadonlyArray<string>; // canonical comparison page URLs
  targetQueries: ReadonlyArray<string>;
  preStart: string;
  preEnd: string; // == shipDate
  postStart: string; // == shipDate
  postEnd: string;
}): Promise<TargetQueryRead[]> {
  const queries = [...new Set((args.targetQueries ?? []).map((q) => (q ?? "").trim()).filter((q) => q.length > 0))];
  if (!args.tenantId || !args.page || queries.length === 0) return [];

  const pages = [...new Set([args.page, ...args.controlPages])];

  let pre: Map<string, Map<string, Agg>>;
  let post: Map<string, Map<string, Agg>>;
  try {
    [pre, post] = await Promise.all([
      readTargetQueryWindow(args.tenantId, pages, queries, args.preStart, args.preEnd),
      readTargetQueryWindow(args.tenantId, pages, queries, args.postStart, args.postEnd),
    ]);
  } catch (err) {
    log.warn("target-query-read: per-query window read failed; returning no query reads", {
      tenant: args.tenantId,
      store: "gsc_daily_rows",
      page: args.page,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  const out: TargetQueryRead[] = [];
  for (const query of queries) {
    const treatedPre = metricsFromAgg(pre.get(args.page)?.get(query));
    const treatedPost = metricsFromAgg(post.get(args.page)?.get(query));

    // Thin-data silence (spec): < 50 impressions in EITHER window on the
    // treated page means there's nothing honest to say about this query yet.
    if (treatedPre.impressions < MIN_QUERY_IMPRESSIONS || treatedPost.impressions < MIN_QUERY_IMPRESSIONS) {
      continue;
    }

    const controlDeltas = args.controlPages
      .map((cp) => {
        const cPre = metricsFromAgg(pre.get(cp)?.get(query));
        const cPost = metricsFromAgg(post.get(cp)?.get(query));
        if (cPre.impressions <= 0) return null; // no usable baseline for this query on this control
        return { ctr: ctrDeltaOf(cPre, cPost), pos: posImproveOf(cPre, cPost) };
      })
      .filter((x): x is { ctr: number; pos: number } => x != null);

    const meanCtrControl =
      controlDeltas.length > 0 ? controlDeltas.reduce((s, c) => s + c.ctr, 0) / controlDeltas.length : 0;
    const meanPosControl =
      controlDeltas.length > 0 ? controlDeltas.reduce((s, c) => s + c.pos, 0) / controlDeltas.length : 0;

    const treatedCtrDelta = ctrDeltaOf(treatedPre, treatedPost);
    const treatedPosDelta = posImproveOf(treatedPre, treatedPost);

    const read: TargetQueryRead = {
      query,
      ctrDelta: round4(treatedCtrDelta - meanCtrControl),
      positionDelta: round1(treatedPosDelta - meanPosControl),
      treatedPre,
      treatedPost,
      controlsUsed: controlDeltas.length,
      sentence: null,
    };
    read.sentence = targetQuerySentence({
      query,
      // The sentence reports the treated page's OWN raw movement (concrete,
      // verifiable against GSC), while ctrDelta/positionDelta above carry the
      // control-adjusted figures used for any downstream comparison.
      ctrDelta: treatedCtrDelta,
      positionDelta: treatedPosDelta,
      treatedPre,
      treatedPost,
    });
    out.push(read);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The fixed query panel (P4 R10a, v1 item 150)
// ---------------------------------------------------------------------------
// Aggregates the whole frozen target-query set (thin individual queries still
// add up to one honest read) through readTargetQueryWindow above. When the
// panel and the page-level read DISAGREE in direction the sentence says so
// plainly and N10 gets a disagreement input that demotes the read to shaky.
// Panel absent (no query-grain rows, or too thin) = honest null.

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
 *  the per-query reads apply per query, applied here to the aggregate. */
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
  // before to compare against ("no query-grain rows at all" lands here too).
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

function aggregatePanel(byQuery: Map<string, TargetQueryAgg> | undefined): QueryPanelWindow {
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
 * pre/post window pair and run the pure math above. Fail-soft -> null.
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

// ---------------------------------------------------------------------------
// Query breadth (P4 R10b, v1 item 151): reach vs depth
// ---------------------------------------------------------------------------
// Counts distinct queries with at least one impression on the treated page
// over two EQUAL-LENGTH windows (the basis window's own day count before the
// ship vs after it, never 28-day baseline vs a 7-day window, which would bias
// the count purely by length). Feeds the PRESENTATION only, never the verdict
// and not an N10 input. Null when the page has no query-grain rows in either
// window (no data is not "zero searches") and null when a read hits the row
// cap unfinished (a truncated distinct count is an undercount, not a count).

export type QueryBreadthKind = "broader" | "deeper" | "flat";

export type QueryBreadthRead = {
  /** Distinct queries with >= 1 impression in the matched pre window. */
  before: number;
  /** Distinct queries with >= 1 impression in the basis (post) window. */
  after: number;
  /** Length of BOTH windows (equal by construction). */
  windowDays: number;
  /** "broader" = meaningfully more distinct searches ranking; "deeper" =
   *  breadth held flat but the same searches sent meaningfully more clicks;
   *  "flat" = neither moved enough to name. */
  kind: QueryBreadthKind;
  /** The plain reach/depth sentence, non-null only for broader/deeper. */
  sentence: string | null;
  /** Compact always-available line for the "See the math" expander. */
  breadthLine: string;
};

/** Hard cap per (page, window) read; hitting it -> null (an undercounted
 *  distinct set is dishonest, not bounded). */
const MAX_BREADTH_ROWS = 10_000;

/** Breadth must grow by at least this many distinct queries AND this fraction
 *  of the before count to read "broader" - a 2-query wobble is noise. */
export const BROADER_MIN_EXTRA_QUERIES = 3;
const BROADER_MIN_FRACTION = 0.15;
/** With breadth flat, clicks must grow by at least this many AND this
 *  fraction of the before clicks to read "deeper". */
const DEEPER_MIN_EXTRA_CLICKS = 3;
const DEEPER_MIN_CLICKS_FRACTION = 0.1;

const plural = (n: number, word: string): string => `${word}${n === 1 ? "" : "es"}`;

/** PURE breadth math: the broader/deeper/flat call plus both sentences. */
export function computeQueryBreadth(args: {
  beforeQueries: number;
  afterQueries: number;
  beforeClicks: number;
  afterClicks: number;
  windowDays: number;
}): QueryBreadthRead | null {
  if (args.windowDays <= 0) return null;
  // Honest absence: no query-grain presence in EITHER window means there is
  // no breadth story to tell.
  if (args.beforeQueries <= 0 && args.afterQueries <= 0) return null;

  const extraQueries = args.afterQueries - args.beforeQueries;
  const broaderFloor = Math.max(
    BROADER_MIN_EXTRA_QUERIES,
    Math.ceil(BROADER_MIN_FRACTION * args.beforeQueries),
  );
  const extraClicks = args.afterClicks - args.beforeClicks;
  const deeperFloor = Math.max(
    DEEPER_MIN_EXTRA_CLICKS,
    DEEPER_MIN_CLICKS_FRACTION * args.beforeClicks,
  );

  let kind: QueryBreadthKind = "flat";
  if (extraQueries >= broaderFloor) kind = "broader";
  else if (extraClicks >= deeperFloor) kind = "deeper";

  let sentence: string | null = null;
  if (kind === "broader") {
    sentence = `This page now shows up for ${extraQueries} more ${plural(extraQueries, "search")} than before; the win is reach, not just rank.`;
  } else if (kind === "deeper") {
    sentence = `This page shows up for about the same searches as before, but they are sending ${Math.round(extraClicks)} more clicks; the win is depth, not reach.`;
  }

  const breadthLine = `This page showed up for ${args.beforeQueries} different ${plural(args.beforeQueries, "search")} in the ${args.windowDays} days before the change and ${args.afterQueries} in the ${args.windowDays} days after.`;

  return {
    before: args.beforeQueries,
    after: args.afterQueries,
    windowDays: args.windowDays,
    kind,
    sentence,
    breadthLine,
  };
}

type BreadthRawRow = { query: string; clicks: number | string | null; impressions: number | string | null };

/**
 * One bounded, paged read over [start, end): the distinct queries with at
 * least one impression on this page (both www host forms) plus their click
 * total. Null on any read error OR when the row cap is hit before the read
 * finished.
 */
async function readDistinctQueryWindow(
  tenantId: string,
  page: string,
  start: string,
  end: string,
): Promise<{ distinctQueries: number; clicks: number } | null> {
  const variants = withWwwVariant(page);
  const queries = new Set<string>();
  let clicks = 0;
  const sb = getSupabaseAdmin();
  const status = await pageThroughRows<BreadthRawRow>(
    () =>
      sb
        .from("gsc_daily_rows")
        .select("query, clicks, impressions")
        .eq("tenant_id", tenantId)
        .in("page", variants)
        .gte("date", start)
        .lt("date", end),
    MAX_BREADTH_ROWS,
    (rows) => {
      for (const r of rows) {
        if (!r.query) continue;
        if ((Number(r.impressions) || 0) <= 0) continue;
        queries.add(r.query);
        clicks += Number(r.clicks) || 0;
      }
    },
  );
  if (typeof status === "object") {
    log.warn("[query-breadth] read failed (fail-soft)", { tenantId, error: status.errorMessage });
    return null;
  }
  if (status === "capped") {
    // Cap exhausted without a short page: the count is truncated - honest null.
    log.warn("[query-breadth] row cap hit, distinct count would be truncated (honest null)", { tenantId, page });
    return null;
  }
  return { distinctQueries: queries.size, clicks };
}

/**
 * Read both equal-length windows for one shipped change and run the pure math
 * above. Fail-soft -> null (honest silence).
 */
export async function buildQueryBreadth(args: {
  tenantId: string;
  /** Canonical treated page URL. */
  page: string;
  /** Matched-length pre window: [preStart, preEnd). preEnd == shipDate. */
  preStart: string;
  preEnd: string;
  /** Basis window: [postStart, postEnd). postStart == shipDate. */
  postStart: string;
  postEnd: string;
  windowDays: number;
}): Promise<QueryBreadthRead | null> {
  if (!args.tenantId || !args.page || args.windowDays <= 0) return null;
  try {
    const [pre, post] = await Promise.all([
      readDistinctQueryWindow(args.tenantId, args.page, args.preStart, args.preEnd),
      readDistinctQueryWindow(args.tenantId, args.page, args.postStart, args.postEnd),
    ]);
    if (pre == null || post == null) return null;
    return computeQueryBreadth({
      beforeQueries: pre.distinctQueries,
      afterQueries: post.distinctQueries,
      beforeClicks: pre.clicks,
      afterClicks: post.clicks,
      windowDays: args.windowDays,
    });
  } catch (e) {
    log.warn("[query-breadth] threw (fail-soft)", {
      tenantId: args.tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
