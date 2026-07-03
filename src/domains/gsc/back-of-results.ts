/**
 * back-of-results (BEACON_500 R17b / P2 slice 2, v1 item 428) - the register
 * of searches where the site ranks DEEP (position 30 to 100) yet Google still
 * shows it to real people.
 *
 * These queries are invisible on every existing surface: the striking band
 * stops at 15, the low-CTR rules stop at 5, and nobody scrolls to page 4, so
 * the demand never earns clicks and never surfaces. But real impressions at
 * position 40 are PROVEN demand with an honest verdict attached: the current
 * page cannot compete, a dedicated one could.
 *
 * PURE REGISTER over rows other loaders already read (per-page GSC signals,
 * $0, no new sync). Brand searches are excluded through the ONE brand
 * classifier - someone searching your name at position 40 is a duplicate
 * listing, not a page idea. Feeds two places:
 *   - the keywords page section "Deep in the results but people still see
 *     you" (self-hiding, top BACK_OF_RESULTS_CAP by impressions), and
 *   - the question universe as one more demand source (additive param,
 *     byte-identical when empty - question-universe.test.ts pins it).
 *
 * PURE, no I/O. The loader edge is load-back-of-results.ts.
 */

import { isBrandQuery } from "./brand-split";

/** The deep band: page 3 through page 10. Inside 30 the striking/CTR rules
 *  already own the story; past 100 GSC's own reporting gets unreliable. */
export const BACK_OF_RESULTS_MIN_POSITION = 30;
export const BACK_OF_RESULTS_MAX_POSITION = 100;
/** Real demand floor over the window: under this, the deep rank is noise. */
export const BACK_OF_RESULTS_MIN_IMPRESSIONS = 200;
/** The section shows this many, biggest demand first. */
export const BACK_OF_RESULTS_CAP = 10;

/** One per-query input row (page grain kept for the owner attribution). */
export type BackOfResultsInput = {
  query: string;
  clicks: number;
  impressions: number;
  /** Impressions-weighted average position (1-based). */
  position: number;
  /** The page Google showed for it (per-page signal source). */
  page: string | null;
};

export type BackOfResultsQuery = {
  query: string;
  clicks: number;
  impressions: number;
  /** Rounded aggregate position, for the honest "around 40th" phrasing. */
  position: number;
  /** The page that took the most impressions, or null. Never a guess. */
  ownerPage: string | null;
  /** The rendered line: rank, demand, verdict, next step. */
  line: string;
};

export type BackOfResultsRegister = {
  queries: BackOfResultsQuery[];
  totalImpressions: number;
  windowDays: number;
  /** The section's one-line framing under the title. */
  subLine: string;
};

const normQuery = (q: string): string => q.trim().toLowerCase();

/** "40th" / "31st" / "42nd" / "63rd" - standard English ordinal. */
export function ordinal(n: number): string {
  const abs = Math.abs(Math.round(n));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${abs}th`;
  const mod10 = abs % 10;
  if (mod10 === 1) return `${abs}st`;
  if (mod10 === 2) return `${abs}nd`;
  if (mod10 === 3) return `${abs}rd`;
  return `${abs}th`;
}

function lineFor(q: { query: string; impressions: number; position: number }, windowDays: number): string {
  return (
    `You rank around ${ordinal(q.position)} for "${q.query}", which almost never gets clicks, ` +
    `but Google showed you ${q.impressions.toLocaleString("en-US")} times in the last ${windowDays} days. ` +
    `A dedicated page could compete properly.`
  );
}

/**
 * Aggregate per-query rows (entries collapse across pages), keep the deep
 * band with real demand, exclude brand searches, rank by impressions, cap.
 * Returns null when nothing qualifies - the section self-hides, never a
 * bare zero.
 */
export function buildBackOfResultsRegister(
  rows: readonly BackOfResultsInput[],
  opts: {
    windowDays?: number;
    brandTokens?: readonly string[];
    cap?: number;
  } = {},
): BackOfResultsRegister | null {
  const windowDays = opts.windowDays ?? 90;
  const tokens = opts.brandTokens ?? [];
  const cap = Math.max(1, opts.cap ?? BACK_OF_RESULTS_CAP);

  // Collapse duplicate query entries: sum clicks + impressions, impressions-
  // weight the position, keep the page with the most impressions as owner.
  const byQuery = new Map<
    string,
    { query: string; clicks: number; impressions: number; posW: number; byPage: Map<string, number> }
  >();
  for (const r of rows) {
    if (typeof r.query !== "string" || r.query.trim() === "") continue;
    const impressions = Number(r.impressions) || 0;
    const clicks = Number(r.clicks) || 0;
    const position = Number(r.position) || 0;
    if (impressions <= 0 || position < 1) continue;
    if (isBrandQuery(r.query, tokens)) continue;
    const key = normQuery(r.query);
    const a =
      byQuery.get(key) ??
      { query: r.query.trim(), clicks: 0, impressions: 0, posW: 0, byPage: new Map<string, number>() };
    a.clicks += Math.max(0, clicks);
    a.impressions += impressions;
    a.posW += position * impressions;
    if (r.page) a.byPage.set(r.page, (a.byPage.get(r.page) ?? 0) + impressions);
    byQuery.set(key, a);
  }

  const deep: BackOfResultsQuery[] = [];
  for (const a of byQuery.values()) {
    const position = a.posW / a.impressions;
    if (position < BACK_OF_RESULTS_MIN_POSITION || position > BACK_OF_RESULTS_MAX_POSITION) continue;
    if (a.impressions < BACK_OF_RESULTS_MIN_IMPRESSIONS) continue;
    let ownerPage: string | null = null;
    let best = -1;
    for (const [page, impr] of a.byPage) {
      if (impr > best) {
        best = impr;
        ownerPage = page;
      }
    }
    const rounded = Math.round(position);
    deep.push({
      query: a.query,
      clicks: a.clicks,
      impressions: a.impressions,
      position: rounded,
      ownerPage,
      line: lineFor({ query: a.query, impressions: a.impressions, position: rounded }, windowDays),
    });
  }
  if (deep.length === 0) return null;

  deep.sort(
    (a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query),
  );
  const kept = deep.slice(0, cap);
  const totalImpressions = kept.reduce((s, q) => s + q.impressions, 0);

  const plural = kept.length === 1 ? "search" : "searches";
  const subLine =
    `Google showed you ${totalImpressions.toLocaleString("en-US")} times in the last ${windowDays} days ` +
    `for ${kept.length} ${plural} where you sit around 30th or lower. Almost nobody clicks that deep, ` +
    `so each one is a page worth building properly.`;

  return { queries: kept, totalImpressions, windowDays, subLine };
}
