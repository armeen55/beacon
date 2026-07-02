import "server-only";

/**
 * Permutation null (2026-07-02, master plan item 37) - expands the treated
 * change's diff-in-diff comparison from a handful of hand-picked control pages
 * to EVERY untreated page with enough traffic, so the "how unusual is this
 * lift" read has a real distribution behind it instead of a 3-point sample.
 *
 * SHAPE (reuses two things that already exist rather than inventing new math):
 *   1. aa-calibration.ts's placebo page PICKER (pickPlaceboPages /
 *      ledgerExclusionPaths) - the same deterministic, traffic-floored,
 *      ledger-safe candidate list the A/A harness already trusts.
 *   2. The SAME window the treated verdict was judged on (same shipDate, same
 *      day length) via readWindowForPages/readCumulativeSince - NOT a random
 *      or re-seeded pseudo date. The null must share the treated window's
 *      market weather (the same days of the week, the same algorithm
 *      conditions, the same seasonality) or it is not a fair comparison.
 *
 * For each untreated candidate page, compute its own pseudo-lift the same
 * leave-one-out way placebo-inference.ts does for the citation engine: that
 * page's clicks delta minus the mean of every OTHER untreated candidate's
 * delta over the identical window. The treated lift's position in that
 * distribution (percentileOf) is the plain-English "out of N untouched pages,
 * only M moved this much" read.
 *
 * Deterministic, $0, no LLM. Bounded to MAX_NULL_PAGES so a tenant with
 * thousands of pages never turns this into an unbounded read; reads happen
 * through readCumulativeSince, which is already a single bounded RPC call
 * per date (not a per-page paged scan).
 */

import {
  loadPageSurgeonContext,
  type PageSurgeonContext,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import { loadShippedChanges } from "./shipped-change-store";
import { readWindowForPages } from "./gsc-window";
import { ledgerExclusionPaths, pickPlaceboPages, type PlaceboCandidate } from "./aa-calibration";
import { addDays, type GscWindowMetrics, type ProofWindowDay } from "./measure";

/** Bounded nightly/on-demand cost: at most this many untreated pages anchor
 *  one treated change's null distribution. Mirrors aa-calibration's own cap;
 *  a single readWindowForPages call reads all of them at once (two RPC calls
 *  total, not one per page), so this bound is about honesty of the
 *  distribution size, not about read cost. */
export const MAX_NULL_PAGES = 60;

/** Below this many untreated pages, a percentile read is too thin to call
 *  "strong evidence" either way - the caller should skip the permutation
 *  read entirely and say so honestly rather than report a percentile off a
 *  handful of comparison points. */
export const MIN_NULL_PAGES = 20;

const NULL_METRICS: GscWindowMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

export type NullPageLift = {
  page: string;
  /** This page's own clicks delta (post - pro-rated pre) over the shared window. */
  delta: number;
  /** Leave-one-out pseudo-lift: this page's delta minus the mean of every
   *  OTHER untreated candidate's delta over the same window. */
  pseudoLift: number;
};

export type PermutationNull = {
  /** Every untreated page's pseudo-lift, in the SAME clicks unit the treated
   *  adjusted lift is judged in. */
  pages: NullPageLift[];
  /** shipDate the null shares with the treated window (for display/debugging). */
  shipDate: string;
  windowDays: ProofWindowDay | number;
};

/**
 * Build the permutation null: every untreated, adequate-traffic page's
 * pseudo-lift over the SAME [shipDate, shipDate+window) post window (and the
 * same 28-day pre window) the treated change was judged on. Pure I/O shell -
 * candidate selection and the leave-one-out math are pure; only the GSC reads
 * touch Supabase. Fail-soft: any read failure or an empty candidate pool
 * returns an empty `pages` array (never throws), so the caller's fail-soft
 * gate (< MIN_NULL_PAGES) naturally covers it.
 *
 * Injectable I/O for tests (loadContext/loadLedger/readWindow default to the
 * real modules).
 */
export async function buildPermutationNull(
  args: {
    tenantId: string;
    shipDate: string; // YYYY-MM-DD, the treated change's ship date
    windowDays: ProofWindowDay | number; // the post-window length the treated verdict used
    preWindowDays?: number; // default 28, mirrors PROOF_BASELINE_WINDOW_DAYS
    /** Paths to exclude beyond the ledger set (typically the treated page
     *  itself and its own control pages, so the null never includes the
     *  experiment it is qualifying). */
    excludePaths?: ReadonlySet<string>;
    maxPages?: number;
  },
  deps: {
    loadContext?: (tenantId: string) => Promise<PageSurgeonContext>;
    loadLedger?: () => Promise<Array<{ path: string; controlPages: string[] }>>;
    readWindow?: typeof readWindowForPages;
  } = {},
): Promise<PermutationNull> {
  const preWindowDays = args.preWindowDays ?? 28;
  const empty: PermutationNull = { pages: [], shipDate: args.shipDate, windowDays: args.windowDays };
  if (!args.tenantId || !args.shipDate) return empty;

  const loadContext = deps.loadContext ?? loadPageSurgeonContext;
  const loadLedger = deps.loadLedger ?? loadShippedChanges;
  const readWindow = deps.readWindow ?? readWindowForPages;

  let ctx: PageSurgeonContext;
  let ledger: Array<{ path: string; controlPages: string[] }>;
  try {
    [ctx, ledger] = await Promise.all([loadContext(args.tenantId), loadLedger().catch(() => [])]);
  } catch {
    return empty;
  }

  const candidates: PlaceboCandidate[] = [];
  for (const [url, sig] of ctx.gscByUrl) {
    if (!ctx.snapshotByCanon.has(url)) continue;
    candidates.push({ page: url, baselineImpressions: sig.impressions90d });
  }
  if (candidates.length === 0) return empty;

  const exclude = new Set<string>(ledgerExclusionPaths(ledger));
  if (args.excludePaths) for (const p of args.excludePaths) exclude.add(normPath(p));

  const nullPages = pickPlaceboPages(candidates, exclude, args.maxPages ?? MAX_NULL_PAGES);
  if (nullPages.length === 0) return empty;

  const preStart = addDays(args.shipDate, -preWindowDays);
  const postEnd = addDays(args.shipDate, args.windowDays);
  const pageUrls = nullPages.map((c) => c.page);

  let pre: Map<string, GscWindowMetrics>;
  let post: Map<string, GscWindowMetrics>;
  try {
    [pre, post] = await Promise.all([
      readWindow({ tenantId: args.tenantId, pages: pageUrls, start: preStart, end: args.shipDate }),
      readWindow({ tenantId: args.tenantId, pages: pageUrls, start: args.shipDate, end: postEnd }),
    ]);
  } catch {
    return empty;
  }

  const clicksScale = preWindowDays > 0 ? Number(args.windowDays) / preWindowDays : 1;
  const usable = pageUrls
    .map((page) => {
      const preM = pre.get(page) ?? NULL_METRICS;
      const postM = post.get(page) ?? NULL_METRICS;
      if (preM.impressions <= 0) return null; // no real pre-window presence, can't form a fair delta
      const delta = postM.clicks - preM.clicks * clicksScale;
      return { page, delta };
    })
    .filter((x): x is { page: string; delta: number } => x != null);

  if (usable.length === 0) return empty;

  const total = usable.reduce((sum, u) => sum + u.delta, 0);
  const n = usable.length;
  const pages: NullPageLift[] = usable.map((u) => {
    const meanOthers = n > 1 ? (total - u.delta) / (n - 1) : 0;
    return { page: u.page, delta: u.delta, pseudoLift: u.delta - meanOthers };
  });

  return { pages, shipDate: args.shipDate, windowDays: args.windowDays };
}

function normPath(u: string): string {
  try {
    return (new URL(u).pathname || "/").replace(/\/+$/, "") || "/";
  } catch {
    return (u.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  }
}

export type PermutationPercentile = {
  /** Share (0-1) of the null distribution whose |pseudoLift| is >= the treated
   *  lift's magnitude (an empirical, two-sided permutation p-value). */
  percentile: number;
  /** How many untreated pages moved AS MUCH OR MORE than the treated page. */
  nGreater: number;
  /** Total untreated pages in the null distribution. */
  nTotal: number;
};

/** The computed-only permutation read attached to a measured ShippedChangeRecord
 *  (run-measurement.ts). Same shape as PermutationPercentile - named separately
 *  so the ledger-facing field has its own stable contract independent of this
 *  module's internal percentileOf signature. Never persisted (recordToRow omits
 *  it), recomputed on every measure like trafficOutcome/citationOutcome. */
export type PermutationRead = PermutationPercentile;

/**
 * Where the treated lift sits in the null distribution: what fraction of
 * untreated pages moved at least as much (in either direction) as the
 * treated page did. Pure. A LOW percentile (few untreated pages moved this
 * much) is the strong-evidence case; a HIGH one means plenty of untouched
 * pages swing this hard on their own, so the lift is unremarkable. Returns
 * percentile 1 (no evidence either way) on an empty null.
 */
export function percentileOf(lift: number, nullDist: PermutationNull): PermutationPercentile {
  const nTotal = nullDist.pages.length;
  if (nTotal === 0) return { percentile: 1, nGreater: 0, nTotal: 0 };
  const target = Math.abs(lift);
  const nGreater = nullDist.pages.filter((p) => Math.abs(p.pseudoLift) >= target).length;
  return { percentile: nGreater / nTotal, nGreater, nTotal };
}

/** Gate the caller uses instead of hand-rolling the MIN_NULL_PAGES check
 *  everywhere: is this null distribution big enough to report a percentile
 *  read at all? */
export function hasEnoughNullPages(nullDist: PermutationNull): boolean {
  return nullDist.pages.length >= MIN_NULL_PAGES;
}

/** Plain-English, first-person, no-jargon sentence from an already-computed
 *  percentile read ({nGreater, nTotal} - the shape attached to a measured
 *  ShippedChangeRecord as `permutationRead`). Never says "placebo" /
 *  "permutation" / "p-value" - "untouched pages" only. Returns null when
 *  nTotal is 0 (no honest comparison pool - caller should render nothing,
 *  never a thin-sample claim). This is the function presentation surfaces
 *  should call: it takes the SAME counts already attached at measure time,
 *  so the Results row can never disagree with what was computed. */
export function permutationSentenceFromCounts(nGreater: number, nTotal: number): string | null {
  if (nTotal <= 0) return null;
  if (nGreater === 0) {
    return `Out of ${nTotal} untouched pages, none moved as much as this one did. That is strong evidence the change caused it.`;
  }
  if (nGreater === 1) {
    return `Out of ${nTotal} untouched pages, only 1 moved as much as this one did. That is strong evidence the change caused it.`;
  }
  const strong = nGreater / nTotal <= 0.05;
  if (strong) {
    return `Out of ${nTotal} untouched pages, only ${nGreater} moved as much as this one did. That is strong evidence the change caused it.`;
  }
  return `Out of ${nTotal} untouched pages, ${nGreater} moved as much as this one did. Untouched pages swing this much on their own, so I would not call this strong evidence yet.`;
}

/** Plain-English, first-person, no-jargon sentence for the Results row,
 *  computed directly from a lift + null distribution. Returns null when
 *  there isn't enough of a comparison pool to say anything honest (caller
 *  should render nothing, not a thin-sample claim). Convenience wrapper
 *  around percentileOf + permutationSentenceFromCounts for callers that
 *  hold the full distribution rather than just the summary counts. */
export function permutationSentence(lift: number, nullDist: PermutationNull): string | null {
  if (!hasEnoughNullPages(nullDist)) return null;
  const { nGreater, nTotal } = percentileOf(lift, nullDist);
  return permutationSentenceFromCounts(nGreater, nTotal);
}
