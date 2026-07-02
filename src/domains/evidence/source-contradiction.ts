/**
 * source-contradiction (BEACON 500 N9, 2026-07-02) - Quality Constitution law 1:
 * "Contradicting sources pause the claim." This module is the DETECTOR: given the
 * per-page evidence a rec's evidence packet already carries from multiple
 * independently-synced sources (Search Console, GA4, live SERP snapshots, crawled
 * page snapshots), decide whether two sources genuinely CONTRADICT each other
 * about the same page in the same window - not merely differ.
 *
 * PURE. No I/O, no LLM. Every rule has a documented floor so ordinary noise
 * (small samples, partial-window gaps, one stale SERP read) can never fire it.
 * Absence is NOT contradiction: a source with no rows for a page is silence
 * (unknown), and law 1 is explicit that unknown must never be treated as
 * conflicting. Only two sources that BOTH have real, present data, and that data
 * disagrees beyond the tolerance, count.
 *
 * Three rules, in order of how the operator would explain the mismatch:
 *
 *   (a) traffic_mismatch - GSC reports meaningful clicks for a page over the
 *       window while GA4 reports ~zero sessions for the same window (or the
 *       reverse: GA4 shows real sessions while GSC shows ~zero clicks). Real
 *       visitors from a click cannot vanish before GA4's own pageview fires, so
 *       a wide, sustained gap means one connector is stale, misconfigured, or
 *       reading the wrong property - not that the page suddenly stopped
 *       converting search interest into visits.
 *
 *   (b) rank_visibility_mismatch - GSC's own average position for a query
 *       implies the page is showing (top 5, with real impressions) while the
 *       tenant's stored live-SERP history for that SAME query in the SAME
 *       period shows the tenant's domain absent from the top 10 entirely. GSC
 *       position is Google's own accounting of where the page showed; a
 *       same-window SERP read that can't find the domain in the top 10 at all
 *       is not "a little different," it disagrees about whether the page ranks.
 *
 *   (c) page_gone_but_clicked - the latest crawl snapshot for the page records
 *       an error/removed HTTP status (4xx/5xx) while GSC still reports current
 *       clicks for that URL inside the recency floor. A truly-gone page cannot
 *       still be earning clicks Google is crediting it with right now.
 *
 * Each detector returns null when its rule doesn't fire (including when either
 * side is simply absent). `detectSourceContradictions` runs all three and
 * returns whatever fired, so a caller can treat a non-empty array as "pause."
 */

// ─── Input shapes (mirror the already-loaded per-source signals; no new I/O) ──

/** GSC's own per-page rollup for a window (mirrors GscPageSignal fields the
 *  callers already load - deliberately loose so callers don't need to import
 *  the recommendation-intelligence module just to build this literal). */
export type GscTrafficSample = {
  clicks: number;
  impressions: number;
  /** Impressions-weighted average position, when known (rule b needs this per
   *  QUERY, not per page - see GscQueryPositionSample). */
  position?: number | null;
  windowDays: number;
};

/** GA4's per-page rollup for a window (mirrors Ga4PageValue). */
export type Ga4TrafficSample = {
  sessions: number;
  windowDays: number;
};

/** GSC's own reported position for ONE query in the window, plus its
 *  impressions (so a position can only "strongly imply visibility" when
 *  Google actually served the page for real search volume). */
export type GscQueryPositionSample = {
  query: string;
  position: number;
  impressions: number;
};

/** One stored live-SERP read for the same query + period (from the tenant's
 *  own SERP-history snapshots) - the observed top-10 organic domains and
 *  whether the tenant's own domain was found anywhere in them. */
export type SerpSnapshotSample = {
  query: string;
  capturedAt: string;
  /** True when the tenant's own domain appeared anywhere in the captured
   *  top-10 organic results; false when a full top-10 read completed and the
   *  domain was not present. */
  ownDomainInTop10: boolean;
};

/** The latest crawl's recorded HTTP outcome for a page. */
export type PageStatusSample = {
  httpStatus: number;
  fetchedAt: string;
};

/** GSC's recency-scoped click sample used for rule (c): clicks attributed to
 *  the page within `recencyDays` of `now` (so a rec can't be paused forever on
 *  a page that WAS gone six months ago but GSC has long since zeroed out). */
export type GscRecentClicksSample = {
  clicks: number;
  recencyDays: number;
};

export type SourceContradictionKind =
  | "traffic_mismatch"
  | "rank_visibility_mismatch"
  | "page_gone_but_clicked";

export type SourceContradictionSeverity = "hard" | "soft";

export type SourceContradiction = {
  kind: SourceContradictionKind;
  /** The two (or more) sources that disagree, in plain terms. */
  sources: string[];
  /** Plain-English detail WITH the real numbers, never a template. */
  detail: string;
  severity: SourceContradictionSeverity;
};

// ─── Rule (a): GSC clicks vs GA4 sessions ─────────────────────────────────

/** A page must clear this many GSC clicks before "GA4 shows nothing" is even
 *  worth flagging - a 2-click month is noise, not a contradiction. */
const TRAFFIC_MIN_CLICKS_FLOOR = 30;
/** Same floor, mirrored for the GA4-real/GSC-zero direction. */
const TRAFFIC_MIN_SESSIONS_FLOOR = 30;
/** "GA4 shows ~zero" - allow a trickle (direct/referral noise, bot sessions)
 *  without firing; only a near-total absence counts. */
const TRAFFIC_ZERO_TOLERANCE_RATIO = 0.05;

/**
 * Rule (a): GSC shows meaningful clicks while GA4 shows ~zero sessions for the
 * same page + comparable window (or the reverse). Both samples must be
 * present - a missing GA4 connector (null) is absence, not a contradiction.
 */
export function detectTrafficMismatch(
  gsc: GscTrafficSample | null | undefined,
  ga4: Ga4TrafficSample | null | undefined,
  pageLabel: string,
): SourceContradiction | null {
  if (gsc == null || ga4 == null) return null; // absence is not contradiction
  if (gsc.clicks >= TRAFFIC_MIN_CLICKS_FLOOR) {
    const tolerance = Math.max(1, Math.round(gsc.clicks * TRAFFIC_ZERO_TOLERANCE_RATIO));
    if (ga4.sessions <= tolerance) {
      return {
        kind: "traffic_mismatch",
        sources: ["Search Console", "Analytics"],
        detail: `Search Console and Analytics disagree about ${pageLabel} (${fmt(gsc.clicks)} clicks vs ${fmt(ga4.sessions)} visits in the same period).`,
        severity: "hard",
      };
    }
  }
  if (ga4.sessions >= TRAFFIC_MIN_SESSIONS_FLOOR) {
    const tolerance = Math.max(1, Math.round(ga4.sessions * TRAFFIC_ZERO_TOLERANCE_RATIO));
    if (gsc.clicks <= tolerance) {
      return {
        kind: "traffic_mismatch",
        sources: ["Analytics", "Search Console"],
        detail: `Analytics and Search Console disagree about ${pageLabel} (${fmt(ga4.sessions)} visits vs ${fmt(gsc.clicks)} clicks in the same period).`,
        severity: "hard",
      };
    }
  }
  return null;
}

// ─── Rule (b): GSC position implies visibility vs SERP snapshot shows absent ──

/** GSC position must be at least this good before "should be visible" holds -
 *  position 5 or better is a confident, board-page ranking. */
const RANK_VISIBLE_POSITION_FLOOR = 5;
/** ...and the query must have carried real search volume, not one stray
 *  impression, or the "position" itself is too noisy to trust. */
const RANK_VISIBLE_IMPRESSIONS_FLOOR = 20;

/**
 * Rule (b): GSC's own average position for a query says the page should be
 * showing (top 5, with real impressions) while the tenant's stored live-SERP
 * snapshot for that exact query says the tenant's domain is nowhere in the
 * top 10. Requires BOTH a qualifying GSC query sample and a completed SERP
 * snapshot for the SAME query - a missing/never-run SERP read is absence.
 */
export function detectRankVisibilityMismatch(
  gscQuery: GscQueryPositionSample | null | undefined,
  serpSnapshot: SerpSnapshotSample | null | undefined,
  pageLabel: string,
): SourceContradiction | null {
  if (gscQuery == null || serpSnapshot == null) return null; // absence is not contradiction
  if (normalizeQuery(gscQuery.query) !== normalizeQuery(serpSnapshot.query)) return null;
  if (gscQuery.impressions < RANK_VISIBLE_IMPRESSIONS_FLOOR) return null;
  if (gscQuery.position > RANK_VISIBLE_POSITION_FLOOR) return null;
  if (serpSnapshot.ownDomainInTop10) return null;
  return {
    kind: "rank_visibility_mismatch",
    sources: ["Search Console", "live search results"],
    detail: `Search Console says ${pageLabel} ranks around position ${fmt1(gscQuery.position)} for "${gscQuery.query}" (${fmt(gscQuery.impressions)} impressions), but my last check of the actual results page didn't find it in the top 10.`,
    severity: "hard",
  };
}

// ─── Rule (c): page snapshot says gone/error vs GSC still shows current clicks ──

/** 4xx/5xx = the crawler could not load the page as a real page. 3xx is a
 *  redirect, not "gone" - excluded so a routine redirect never fires this. */
function isErrorOrGoneStatus(httpStatus: number): boolean {
  return httpStatus >= 400 && httpStatus < 600;
}

/** GSC clicks must clear this floor within the recency window before "still
 *  earning clicks" is worth flagging against a dead crawl. */
const GONE_MIN_RECENT_CLICKS_FLOOR = 5;
/** The crawl snapshot saying the page is gone must be at least this fresh -
 *  a stale crawl (didn't touch it for months) is not evidence the page is
 *  gone TODAY, it's just an old read (absence of a recent recrawl). */
const GONE_SNAPSHOT_MAX_AGE_DAYS = 30;

/**
 * Rule (c): the latest crawl of the page recorded an error/removed HTTP
 * status, but Search Console still reports real recent clicks for that URL.
 * Requires both a fresh-enough error snapshot AND a recent-clicks sample -
 * either missing is absence, not contradiction.
 */
export function detectPageGoneButClicked(
  pageStatus: PageStatusSample | null | undefined,
  recentClicks: GscRecentClicksSample | null | undefined,
  pageLabel: string,
  now: Date = new Date(),
): SourceContradiction | null {
  if (pageStatus == null || recentClicks == null) return null; // absence is not contradiction
  if (!isErrorOrGoneStatus(pageStatus.httpStatus)) return null;
  const ageDays = daysBetween(pageStatus.fetchedAt, now);
  if (ageDays == null || ageDays > GONE_SNAPSHOT_MAX_AGE_DAYS) return null;
  if (recentClicks.clicks < GONE_MIN_RECENT_CLICKS_FLOOR) return null;
  return {
    kind: "page_gone_but_clicked",
    sources: ["page crawl", "Search Console"],
    detail: `My last crawl of ${pageLabel} (${fmt(ageDays)} day${ageDays === 1 ? "" : "s"} ago) got an error (HTTP ${pageStatus.httpStatus}), but Search Console still shows ${fmt(recentClicks.clicks)} click${recentClicks.clicks === 1 ? "" : "s"} for it in the last ${recentClicks.recencyDays} days.`,
    severity: "hard",
  };
}

// ─── Aggregate entry point ─────────────────────────────────────────────────

export type SourceContradictionInputs = {
  pageLabel: string;
  now?: Date;
  gscTraffic?: GscTrafficSample | null;
  ga4Traffic?: Ga4TrafficSample | null;
  gscQueryPosition?: GscQueryPositionSample | null;
  serpSnapshot?: SerpSnapshotSample | null;
  pageStatus?: PageStatusSample | null;
  gscRecentClicks?: GscRecentClicksSample | null;
};

/**
 * Run every contradiction rule for one page and return whatever fired
 * (usually zero or one; theoretically more if multiple sources disagree in
 * different ways at once). Empty array = no contradiction detected - either
 * the sources agree or one/both sides are simply absent (unknown, not
 * conflicting, per law 1).
 */
export function detectSourceContradictions(input: SourceContradictionInputs): SourceContradiction[] {
  const now = input.now ?? new Date();
  const out: SourceContradiction[] = [];
  const a = detectTrafficMismatch(input.gscTraffic, input.ga4Traffic, input.pageLabel);
  if (a) out.push(a);
  const b = detectRankVisibilityMismatch(input.gscQueryPosition, input.serpSnapshot, input.pageLabel);
  if (b) out.push(b);
  const c = detectPageGoneButClicked(input.pageStatus, input.gscRecentClicks, input.pageLabel, now);
  if (c) out.push(c);
  return out;
}

// ─── Small helpers ──────────────────────────────────────────────────────────

const normalizeQuery = (q: string): string => q.trim().toLowerCase();

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmt1(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("en-US");
}

function daysBetween(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = now.getTime() - t;
  if (ms < 0) return 0;
  return Math.floor(ms / 86_400_000);
}
