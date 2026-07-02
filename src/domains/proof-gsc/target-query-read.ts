import "server-only";

/**
 * Measure the target queries directly (2026-07-02, master plan item 68).
 *
 * ShippedChangeRecord stores targetQueries (the exact search terms a change
 * aimed at), but the GSC verdict in run-measurement.ts is judged on WHOLE-PAGE
 * totals. A title aimed at one striking-distance query gets diluted by the
 * page's entire query mix - a real per-query win can be invisible in the
 * page-level number, and a page-level "won" can be silent on whether the
 * TARGETED query itself actually moved. This module adds a per-target-query
 * diff-in-diff (CTR + position, treated page vs its own comparison pages),
 * reading `gsc_daily_rows` (the page+query grain - the only table that names
 * which queries a page ranks for; `gsc_daily_page_totals` / the
 * `gsc_page_totals_v1` RPC this ledger uses elsewhere are page-level only).
 *
 * WWW-VARIANT SAFETY (the "known host trap"): `gsc_daily_rows.page` stores
 * whatever raw host GSC's own property used (e.g. `www.iranopedia.com`),
 * while every ShippedChangeRecord page/controlPage arrives already
 * canonicalized (www.-stripped) via canonicalizeCitationUrl. A plain
 * `page IN (canonicalUrls)` filter would silently match ZERO rows on a
 * www-property tenant. Mirrors the exact fix auto-record-on-ship.ts already
 * proved for this same table (`withWwwVariant` + canonicalize-on-read):
 * query BOTH host forms, then fold rows back onto the canonical page key.
 *
 * Bounded + paged: one `page IN (...) AND query IN (...)` read per window
 * (pre/post), each paged in PAGE_SIZE chunks up to MAX_ROWS - never a
 * full-table or full-page scan. Fail-soft everywhere -> null (honest
 * silence), matching the computed-only posture of every other attachment in
 * this ledger (trafficOutcome / citationOutcome / rankOutcome / permutationRead).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";

const PAGE_SIZE = 1000;
/** Hard cap on rows read per (page-set, query-set, window) - a handful of
 *  target queries across a handful of pages never approaches this; it exists
 *  purely so a pathological input (many queries x many controls) can't turn
 *  into an unbounded scan. */
const MAX_ROWS = 20_000;

/** Below this many impressions in EITHER window, a per-query CTR/position
 *  read is too thin to say anything honest - the spec's "thin-data silence"
 *  gate. Matches the spirit of measure.ts's MIN_BASELINE_IMPRESSIONS but
 *  scoped to a single query's much smaller natural volume. */
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
   *  points, position 7.9 to 6.1." Null when there's nothing honest to say
   *  (should not happen once a TargetQueryRead is returned - kept for
   *  symmetry with the other computed-only attachments' sentence fields). */
  sentence: string | null;
};

/** Both the raw host GSC's property used AND its www-swapped counterpart, so
 *  a canonicalized (www.-stripped) page URL still matches whichever form
 *  `gsc_daily_rows` actually stored. Mirrors auto-record-on-ship.ts's
 *  withWwwVariant exactly (same table, same trap, proven fix). */
function withWwwVariant(url: string): string[] {
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

type RawRow = { page: string; query: string; clicks: number | string | null; impressions: number | string | null; position: number | string | null };
type Agg = { clicks: number; impressions: number; posWeighted: number };

/**
 * One bounded, paged `page IN (...) AND query IN (...)` read over [start, end),
 * aggregated to (canonical page, query). Rows are folded back onto the
 * CANONICAL page key the caller asked for (see withWwwVariant) regardless of
 * which raw host form the row itself carries. Fail-soft -> empty map.
 */
async function readTargetQueryWindow(
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
    for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("gsc_daily_rows")
        .select("page, query, clicks, impressions, position")
        .eq("tenant_id", tenantId)
        .in("page", queryPages)
        .in("query", queries as string[])
        .gte("date", start)
        .lt("date", end)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        log.warn("[target-query-read] read failed (fail-soft)", { tenantId, error: error.message });
        break;
      }
      const rows = (data ?? []) as RawRow[];
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
      if (rows.length < PAGE_SIZE) break;
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

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * "On the exact search we aimed at ('persian singers'): click rate up 1.2
 * points, position 7.9 to 6.1." First-person plain language, no dashes.
 * Reports whichever of CTR/position had a real (impression/rank-guarded)
 * reading; when only one side has data it names that one alone rather than
 * claiming a flat 0 for the other.
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
 * exactly what the page-level verdict already has). Silent (empty array) when
 * targetQueries is empty, when the tenant/page inputs are missing, or when a
 * given query's data is too thin (< MIN_QUERY_IMPRESSIONS in EITHER window on
 * the treated page) - never fabricates a read off a sliver of data. Fail-soft
 * end to end: any read failure resolves to [] (honest silence), matching the
 * computed-only posture of every other proof-ledger attachment.
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
  } catch {
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
      // The sentence reports the treated page's OWN raw movement (the
      // concrete, verifiable numbers a reader can check against GSC
      // themselves), while ctrDelta/positionDelta above carry the
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
