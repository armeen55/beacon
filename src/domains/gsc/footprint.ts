/**
 * footprint (BEACON_500 R17c / P2, v1 items 491 + 493) - the tenant's TOTAL
 * Google footprint, aggregated read-side from data already synced, plus the
 * Google Discover probe.
 *
 * 491 (footprint registry): a pure roll-up of how much of Google the site
 * actually occupies right now - how many pages Google shows, across how many
 * distinct searches, for how many total appearances over the window. It is the
 * one "how big is my Google presence" number no other surface adds up, built
 * entirely from the per-page GSC signal every other surface already reads ($0,
 * no new sync).
 *
 * 493 (Discover probe): Google Discover is a SEPARATE feed (the phone home-feed
 * cards) with its own Search Console data that most properties never receive.
 * The probe self-hides honestly: if Discover returns no data for the property,
 * NOTHING is fabricated - the line simply does not render. When Discover DOES
 * return data, one honest line reports it.
 *
 * PLAIN WORDS: "appearances" / "times shown" for impressions, "searches" for
 * queries; never impressions / CTR / dimension on a surface.
 *
 * PURE, no I/O. The I/O edges are load-footprint.ts (the registry) and
 * load-footprint.ts's Discover probe.
 */

/** One page's footprint contribution (per-page GSC signal grain). */
export type FootprintPageInput = {
  page: string;
  impressions90d: number;
  clicks90d: number;
  /** The page's distinct query strings Google showed it for (visible grain). */
  queries: readonly string[];
};

export type GscFootprint = {
  /** Distinct owned pages Google has shown over the window. */
  pageCount: number;
  /** Distinct search strings across all pages (deduped, case-insensitive). */
  queryCount: number;
  /** Total appearances (impressions) over the window. */
  totalImpressions: number;
  /** Total clicks over the window. */
  totalClicks: number;
  windowDays: number;
  /** The one honest roll-up line. */
  line: string;
};

/** Footprint floor: under this many total appearances, the roll-up is noise
 *  and the surface stays silent. */
export const FOOTPRINT_MIN_IMPRESSIONS = 100;

const normQuery = (q: string): string => q.trim().toLowerCase();

/**
 * Aggregate the tenant's total Google footprint from per-page signals. Returns
 * null when there is not enough real presence to summarize (empty-safe: no
 * pages, or under the appearance floor -> the surface self-hides, never a bare
 * zero).
 */
export function buildGscFootprint(
  pages: readonly FootprintPageInput[],
  windowDays = 90,
): GscFootprint | null {
  let totalImpressions = 0;
  let totalClicks = 0;
  const pageSet = new Set<string>();
  const querySet = new Set<string>();
  for (const p of pages) {
    if (typeof p.page !== "string" || p.page.trim() === "") continue;
    const impr = Number(p.impressions90d) || 0;
    const clicks = Number(p.clicks90d) || 0;
    if (impr <= 0) continue;
    pageSet.add(p.page.trim());
    totalImpressions += impr;
    totalClicks += Math.max(0, clicks);
    for (const q of p.queries ?? []) {
      if (typeof q === "string" && q.trim() !== "") querySet.add(normQuery(q));
    }
  }
  if (pageSet.size === 0) return null;
  if (totalImpressions < FOOTPRINT_MIN_IMPRESSIONS) return null;

  const pageCount = pageSet.size;
  const queryCount = querySet.size;
  const pageWord = pageCount === 1 ? "page" : "pages";
  const searchWord = queryCount === 1 ? "search" : "searches";
  const line =
    `Google shows ${pageCount.toLocaleString("en-US")} of your ${pageWord} across ` +
    `${queryCount.toLocaleString("en-US")} different ${searchWord}, ` +
    `${totalImpressions.toLocaleString("en-US")} times in the last ${windowDays} days. ` +
    `That is your whole Google footprint right now.`;

  return { pageCount, queryCount, totalImpressions, totalClicks, windowDays, line };
}

// ---------------------------------------------------------------------------
// Discover probe (493)
// ---------------------------------------------------------------------------

/** Discover floor: under this many appearances, do not claim a Discover
 *  presence (a stray handful of Discover impressions is not a story). */
export const DISCOVER_MIN_IMPRESSIONS = 50;

export type DiscoverPresence = {
  impressions: number;
  clicks: number;
  windowDays: number;
  line: string;
};

/**
 * Build the Discover line from the probe's aggregate row totals. Returns null
 * when Discover returned no usable data for the property (empty-safe: the
 * surface self-hides, and we NEVER fabricate a Discover presence the property
 * does not have).
 */
export function buildDiscoverPresence(
  totals: { impressions: number; clicks: number } | null,
  windowDays = 90,
): DiscoverPresence | null {
  if (totals == null) return null;
  const impressions = Number(totals.impressions) || 0;
  const clicks = Math.max(0, Number(totals.clicks) || 0);
  if (impressions < DISCOVER_MIN_IMPRESSIONS) return null;
  const line =
    `Google Discover showed your pages ${impressions.toLocaleString("en-US")} times ` +
    `in the last ${windowDays} days` +
    (clicks > 0
      ? `, bringing in ${clicks.toLocaleString("en-US")} ${clicks === 1 ? "visitor" : "visitors"}. `
      : `. `) +
    `Discover is Google's phone home feed, a separate source from search.`;
  return { impressions, clicks, windowDays, line };
}
