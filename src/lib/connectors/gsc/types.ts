/**
 * 2026-05-16 A.3.b1.alpha — Google Search Console URL Inspection
 * type contracts (pure types; no I/O, no API calls).
 *
 * `GscUrlInspectionResult` is the shape `gscUrlInspect` returns when
 * a fresh call OR a cache hit produces inspection data. The fields
 * mirror Google's URL Inspection API response, narrowed to the subset
 * Beacon's indexability compute will eventually consume (A.3.b1.beta).
 *
 * `GscInspectionCacheEntry` is the on-disk wire format. The cache file
 * `.data/tenants/{slug}/gsc-url-inspections.json` is a map keyed by
 * canonical inspection URL → entry. The `raw` field preserves the
 * verbatim API response for operator triage; downstream consumers
 * MUST NOT depend on its shape (Google may add fields).
 */

import "server-only";

/**
 * Narrowed inspection result Beacon consumes. Field names mirror the
 * `inspectionResult.indexStatusResult` block from the GSC URL
 * Inspection API:
 *
 *   indexing_state ← inspectionResult.indexStatusResult.indexingState
 *     (e.g., "INDEXING_ALLOWED", "BLOCKED_BY_ROBOTS_TXT", ...)
 *   coverage_state ← inspectionResult.indexStatusResult.coverageState
 *     (e.g., "Submitted and indexed", "Discovered - currently not
 *      indexed", "Crawled - currently not indexed", ...)
 *   last_crawl_time ← inspectionResult.indexStatusResult.lastCrawlTime
 *     (ISO 8601 string when present, null otherwise)
 *
 * Customer copy must NOT consume `raw`. Operator diagnostic surfaces
 * (deferred to A.3.b1.beta) may render fields from `raw` behind the
 * operator gate.
 */
export type GscUrlInspectionResult = {
  /** Inspection URL (canonicalized by the caller before lookup). */
  url: string;
  /** Site URL the inspection ran against (`sc-domain:...` or
   *  `https://.../`). Preserved for operator audit trail. */
  site_url: string;
  /** Google's indexing-state token, e.g., "INDEXING_ALLOWED". Null
   *  when the API response omits the field. */
  indexing_state: string | null;
  /** Human-readable coverage state, e.g., "Submitted and indexed".
   *  Null when omitted. */
  coverage_state: string | null;
  /** ISO 8601 timestamp Google last crawled the URL. Null when never
   *  crawled OR the field is absent. */
  last_crawl_time: string | null;
  /** ISO 8601 timestamp Beacon recorded this result. Used for the
   *  24h TTL gate. */
  last_checked_at: string;
  /** Verbatim Google API response — operator triage only. Downstream
   *  consumers MUST NOT depend on the shape. */
  raw: unknown;
};

/**
 * On-disk cache entry. Same shape as `GscUrlInspectionResult`; the
 * separate type lets future fields (e.g., quota-stagger bucket,
 * stale-cache flags) attach to the cache layer without leaking
 * into the consumer-facing result.
 */
export type GscInspectionCacheEntry = GscUrlInspectionResult;

/**
 * Full cache shape — keyed by canonical inspection URL.
 *
 * Stored at `.data/tenants/{slug}/gsc-url-inspections.json`. The
 * outer map's keys are the inspection URLs themselves (canonical
 * form); values are the entries.
 */
export type GscInspectionCacheFile = Record<string, GscInspectionCacheEntry>;

/**
 * Fail-soft reason codes the client uses when it skips an API call.
 * Returned to callers via the structured `null` return path. The
 * codes are operator-side observability only; callers do not
 * surface them to customers.
 */
export type GscInspectionSkipReason =
  | "no_token"
  | "missing_scope"
  | "missing_site_url"
  | "missing_inspection_url"
  | "unresolvable_tenant_slug"
  | "non_2xx_response"
  | "fetch_threw";
