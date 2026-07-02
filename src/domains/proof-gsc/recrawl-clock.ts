/**
 * recrawl-clock (MASTER PLAN v2 N11, 2026-07-02; operator correction applied) —
 * the SEARCH measurement clock must not start until Google's index actually
 * holds the changed page. Today the ledger starts counting proof-window days
 * from `shippedAt` even when Google's index still serves the old version — an
 * early "lost"/"won" Search read can be measuring the OLD content's
 * performance, not the change's.
 *
 * SCOPE (operator correction 2026-07-02): this clock gates ONLY Google-search
 * outcomes — the GSC ranking / impressions / clicks / CTR verdict lane. GA4
 * traffic reads, Clarity behavior reads, publishing-integrity checks, and
 * conversion measurements start at `liveAt` as before and are NEVER gated by
 * this module.
 *
 * SEMANTICS: `gsc_url_inspections.last_crawl_time` comes from the URL
 * Inspection API's `indexStatusResult.lastCrawlTime` — the crawl behind
 * Google's INDEXED version of the page, NOT a live fetch of the page right
 * now. basis "inspection" therefore means exactly: Google's index shows a
 * crawl after the change went live. Neither code comments nor operator copy
 * may claim a "live inspection" happened.
 *
 * PURE — no I/O. Given a ship's `liveAt` plus the page's URL-Inspection history
 * (from `public.gsc_url_inspections`, read by src/lib/connectors/gsc/client.ts)
 * and, optionally, SERP-history snapshots for the same page, decides the
 * EARLIEST evidence Google's index saw the new content:
 *
 *   basis "inspection" — Google's index shows a crawl after the change went
 *     live (`lastCrawlTime` strictly AFTER `liveAt`). The strongest signal.
 *   basis "serp_title"  — a cheap fallback: a SERP snapshot captured after
 *     `liveAt` whose displayed title matches the NEW title (not the old one).
 *     Only usable when the caller can cheaply derive "new title showing in
 *     search" (title/meta changes); most other action types have no fallback
 *     and stay "none" until an index crawl confirms.
 *   basis "none"        — no evidence yet that Google's index has the new
 *     version. The search clock has not started; `daysBlind` names how long
 *     the operator has been waiting with no confirmation.
 *
 * Mirrors the algorithm-weather.ts / rank-recheck.ts precedent: a small,
 * dependency-free pure module the read path (measurement-maturity.ts) and the
 * nightly assist (auto-measure.ts) both consume, computed at READ time, never
 * persisted, never mutating shipped_change_proof history.
 */

export type RecrawlBasis = "inspection" | "serp_title" | "none";

export type RecrawlClockResult = {
  /** ISO timestamp of the earliest evidence Google's INDEX holds the NEW
   *  content (an indexed-version crawl after liveAt, never a live-page
   *  fetch), or null when no such evidence exists yet. The SEARCH clock
   *  starts here; the GA4/Clarity/conversion clock stays at liveAt. */
  recrawlConfirmedAt: string | null;
  /** Which signal produced recrawlConfirmedAt ("none" when unconfirmed). */
  basis: RecrawlBasis;
  /** Days between liveAt and now (or liveAt and recrawlConfirmedAt once
   *  confirmed) that the change has gone unconfirmed by Google. 0 once
   *  confirmed same-day; null when liveAt itself is missing/unparseable. */
  daysBlind: number | null;
  /** True when this page has AT LEAST ONE URL-Inspection reading on record
   *  (regardless of whether any of them confirm the new content). False
   *  means Beacon has never inspected this URL yet - a fundamentally
   *  different, weaker state than "inspected and still waiting", and the
   *  read path must NOT treat "never checked" the same as "checked, still
   *  blind": until the inspection sweep actually reaches a page, capping
   *  every verdict on "no data" would freeze the whole ledger the moment
   *  this field is wired in, which is not this guard's job. */
  hasInspectionHistory: boolean;
};

/** One URL-Inspection reading, narrowed to the two fields this module needs.
 *  Mirrors GscInspectionCacheEntry's shape (client.ts) without importing the
 *  server-only module — keeps this file pure/import-light for tests. */
export type InspectionPoint = {
  /** The crawl timestamp behind Google's INDEXED version of this URL
   *  (`indexStatusResult.lastCrawlTime`, ISO) — reports what the index
   *  holds, not a live fetch. Null when the inspection response omitted it
   *  (never crawled / unknown). */
  lastCrawlTime: string | null;
  /** When Beacon recorded this inspection reading (ISO). Used only as a
   *  tie-breaker / freshness display, never to infer a crawl date Google
   *  did not report. */
  checkedAt: string;
};

/** One SERP snapshot reading, narrowed to what a cheap title-derived recrawl
 *  signal needs. Deliberately minimal — a caller with a richer serp-history
 *  row shape maps it down to this before calling. */
export type SerpTitlePoint = {
  /** When this SERP snapshot was captured (ISO). */
  capturedAt: string;
  /** The title Google was displaying for this URL in that snapshot, or null
   *  when the page did not appear / title was not captured. */
  displayedTitle: string | null;
};

export type RecrawlClockInput = {
  /** ISO timestamp the change went live. Required — no liveAt, no clock. */
  liveAt: string | null;
  /** This page's URL-Inspection history, any order. Empty array is a normal
   *  "never inspected yet" state, not an error. */
  inspections?: ReadonlyArray<InspectionPoint>;
  /** Optional SERP snapshots for the same page, any order. Only consulted
   *  when `newTitle` is provided (title/meta changes) — every other action
   *  type has no cheap fallback and stays basis "none" until an inspection
   *  confirms. */
  serpSnapshots?: ReadonlyArray<SerpTitlePoint>;
  /** The NEW title text this change shipped, when the action type is a
   *  title/meta edit. Null/undefined for action types with no derivable
   *  "new content visible in search" signal (the serp_title fallback never
   *  fires without this). */
  newTitle?: string | null;
  /** Clock for daysBlind math. Defaults to now. */
  now?: Date | string;
};

function toMs(iso: string | null | undefined): number | null {
  if (iso == null || iso === "") return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Loose title match for the serp_title fallback: case-insensitive, collapsed
 *  whitespace, substring-tolerant (Google sometimes truncates/rewrites titles
 *  with a trailing " | Brand" it did not get from the page). Deliberately
 *  conservative — a false "confirmed" would understate daysBlind, so this
 *  only matches when a meaningful chunk of the new title is present. */
function titleLooksLikeNew(displayed: string | null, newTitle: string): boolean {
  if (!displayed) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const d = norm(displayed);
  const n = norm(newTitle);
  if (d === "" || n === "") return false;
  // Require at least a substantial prefix of the new title to appear verbatim
  // (Google often truncates the tail, rarely rewrites the head) — a 12-char
  // floor avoids matching on trivially short/generic titles.
  const probe = n.slice(0, Math.max(12, Math.floor(n.length * 0.6)));
  return d.includes(probe) || n.includes(d);
}

function daysBetween(startMs: number, endMs: number): number {
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000));
}

/**
 * Compute the earliest evidence Google's index reflects this page's new
 * content after `liveAt`. Pure, deterministic, no I/O. Returns basis "none"
 * (recrawlConfirmedAt: null) when neither signal clears the bar — the honest
 * "search clock has not started" state.
 */
export function computeRecrawlClock(input: RecrawlClockInput): RecrawlClockResult {
  const hasInspectionHistory = (input.inspections ?? []).length > 0;
  const liveMs = toMs(input.liveAt);
  if (liveMs == null) {
    return { recrawlConfirmedAt: null, basis: "none", daysBlind: null, hasInspectionHistory };
  }
  const nowMs = input.now instanceof Date ? input.now.getTime() : toMs(input.now) ?? Date.now();

  // Strongest signal: any inspection whose INDEXED-version crawl time
  // (lastCrawlTime) is strictly after liveAt - Google's index shows a crawl
  // after the change went live. Pick the EARLIEST such crawl (the first time
  // the index picked up the new version, not the most recent check-in).
  const inspectionHits = (input.inspections ?? [])
    .map((p) => toMs(p.lastCrawlTime))
    .filter((ms): ms is number => ms != null && ms > liveMs)
    .sort((a, b) => a - b);

  if (inspectionHits.length > 0) {
    const confirmedMs = inspectionHits[0]!;
    return {
      recrawlConfirmedAt: new Date(confirmedMs).toISOString(),
      basis: "inspection",
      daysBlind: daysBetween(liveMs, confirmedMs),
      hasInspectionHistory,
    };
  }

  // Cheap fallback: a SERP snapshot captured after liveAt already displaying
  // the NEW title. Only usable for title/meta changes (newTitle provided) —
  // this never fires as a generic "the page moved in rankings" signal.
  if (input.newTitle && input.newTitle.trim() !== "") {
    const serpHits = (input.serpSnapshots ?? [])
      .filter((s) => titleLooksLikeNew(s.displayedTitle, input.newTitle!))
      .map((s) => toMs(s.capturedAt))
      .filter((ms): ms is number => ms != null && ms > liveMs)
      .sort((a, b) => a - b);
    if (serpHits.length > 0) {
      const confirmedMs = serpHits[0]!;
      return {
        recrawlConfirmedAt: new Date(confirmedMs).toISOString(),
        basis: "serp_title",
        daysBlind: daysBetween(liveMs, confirmedMs),
        hasInspectionHistory,
      };
    }
  }

  // No evidence yet — the clock has not started. daysBlind counts from
  // liveAt to now so the operator sees exactly how long Beacon has been
  // waiting on Google, not a silent zero.
  return {
    recrawlConfirmedAt: null,
    basis: "none",
    daysBlind: daysBetween(liveMs, nowMs),
    hasInspectionHistory,
  };
}

/**
 * Plain first-person secondary line for a Results row whose recrawl is
 * unconfirmed. Names the SPLIT clock explicitly (operator correction
 * 2026-07-02): only the SEARCH clock is waiting on Google; visit tracking
 * (GA4/Clarity/conversions) started at live_at and keeps reading. No dashes,
 * no jargon ("recrawl"/"inspection" stay out of operator copy — the caller
 * shows this sentence, never the raw basis enum), and it never claims a live
 * inspection happened (the signal is Google's index, not a live fetch).
 */
export function recrawlBlindSentence(daysBlind: number | null): string {
  const base =
    "Google has not re-read this page yet, so the search clock has not started. Visit tracking started the day the change went live.";
  if (daysBlind == null || daysBlind <= 0) return base;
  return `${base} It has been ${daysBlind} day${daysBlind === 1 ? "" : "s"} since you shipped this.`;
}
