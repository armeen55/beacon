/**
 * 2026-05-17 A.3.b2 — Google Search Console URL Inspection type
 * contracts (pure types; no I/O, no API calls).
 *
 * Cache layer is now Supabase (`public.gsc_url_inspections` table)
 * with composite PK `(tenant_id, inspection_url)`. The prior on-disk
 * `GscInspectionCacheFile` shape — a JSON map keyed by inspection
 * URL — is RETIRED. Per-entry shape (`GscInspectionCacheEntry` /
 * `GscUrlInspectionResult`) remains; rows are now keyed via the
 * composite PK in Supabase instead of being collected in a single
 * JSON file.
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
 * Per-row cache entry shape. Same fields as `GscUrlInspectionResult`;
 * the separate type lets future fields (e.g., quota-stagger bucket,
 * stale-cache flags) attach to the cache layer without leaking into
 * the consumer-facing result.
 *
 * Storage post-A.3.b2: each entry is a row in
 * `public.gsc_url_inspections` keyed by `(tenant_id, inspection_url)`.
 * The legacy on-disk JSON map (`GscInspectionCacheFile`) is RETIRED.
 */
export type GscInspectionCacheEntry = GscUrlInspectionResult;

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
