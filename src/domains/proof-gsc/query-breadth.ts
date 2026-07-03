import "server-only";

/**
 * query-breadth (BEACON_500 P4 R10b, v1 item 151, 2026-07-03) - did this win
 * come from MORE distinct searches ranking (reach) or from the SAME searches
 * clicking more (depth)?
 *
 * The page-level verdict is one clicks total; two very different wins hide
 * inside it. This module counts the distinct queries with at least one
 * impression on the treated page over two EQUAL-LENGTH windows (the basis
 * window's own number of days immediately before the ship vs the basis window
 * after it - never the full 28-day baseline vs a 7-day window, which would
 * bias the count purely by window length) from gsc_daily_rows' page+query
 * grain, and attaches `queryBreadth` with a plain sentence ("This page now
 * shows up for 18 more searches than before; the win is reach, not just
 * rank."). Feeds the PRESENTATION only, never the verdict, and is not an N10
 * input. Computed-only, recomputed on every measure, never persisted
 * (recordToRow omits it).
 *
 * Honest-absence rules: null when the page has no query-grain rows in either
 * window (no data is not "zero searches"), and null when a window's read hits
 * the row cap without finishing (a truncated distinct count is an undercount,
 * not a count). Pure math in computeQueryBreadth (pinned by
 * query-breadth.test.ts); the bounded Supabase read lives in
 * buildQueryBreadth (fail-soft -> null).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { withWwwVariant } from "./target-query-read";

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

const PAGE_SIZE = 1000;
/** Hard cap per (page, window) read. A single page's query rows over a 7-28
 *  day window sit far below this in practice; the cap exists so a pathological
 *  page can never turn into an unbounded scan. Hitting it -> null (an
 *  undercounted distinct set is dishonest, not bounded). */
const MAX_ROWS = 10_000;

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
  // no breadth story to tell (and "the table has no query grain at all"
  // lands here too).
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

type RawRow = { query: string; clicks: number | string | null; impressions: number | string | null };

/**
 * One bounded, paged read over [start, end): the distinct queries with at
 * least one impression on this page (both www host forms) plus their click
 * total. Returns null on any read error OR when the row cap is hit before the
 * read finished (a truncated distinct count would be an undercount).
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
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("query, clicks, impressions")
      .eq("tenant_id", tenantId)
      .in("page", variants)
      .gte("date", start)
      .lt("date", end)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      log.warn("[query-breadth] read failed (fail-soft)", { tenantId, error: error.message });
      return null;
    }
    const rows = (data ?? []) as RawRow[];
    for (const r of rows) {
      if (!r.query) continue;
      if ((Number(r.impressions) || 0) <= 0) continue;
      queries.add(r.query);
      clicks += Number(r.clicks) || 0;
    }
    if (rows.length < PAGE_SIZE) return { distinctQueries: queries.size, clicks };
  }
  // Cap exhausted without a short page: the count is truncated - honest null.
  log.warn("[query-breadth] row cap hit, distinct count would be truncated (honest null)", { tenantId, page });
  return null;
}

/**
 * Read both equal-length windows for one shipped change and run the pure math
 * above. Fail-soft -> null (honest silence), matching every other computed
 * attachment in this ledger.
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
