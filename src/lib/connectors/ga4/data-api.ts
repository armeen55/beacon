/**
 * 2026-05-19 — Slice 9.A2α — Google Analytics 4 Data API client.
 *
 * Operator-substrate only. NO customer-surface imports. NO Data API
 * call on page load — the public function is invoked exclusively
 * from server actions (operator diagnostic `/diagnostics/outcome-
 * attribution`) or a future nightly refresh job. The architecture
 * invariant `ga4-no-page-load-call` (extended in 9.A1β) scans every
 * customer-surface file for imports from `@/lib/connectors/ga4/*`
 * and forbids them; the actions seam is the only allowed entry
 * point.
 *
 * Endpoint:
 *   POST https://analyticsdata.googleapis.com/v1beta/properties/
 *     {propertyId}:runReport
 *
 * Scope (existing, no re-consent):
 *   https://www.googleapis.com/auth/analytics.readonly
 *
 * Why a new module instead of reusing `client.ts`'s `ga4ApiFetch`:
 *   - `ga4ApiFetch` is generic over URL + init. We CONSUME it here
 *     for the actual HTTP call, but the Data API has its own
 *     request body shape (dimensions / metrics / dateRanges) and
 *     response narrowing (string metric values → integers). Keeping
 *     the substrate's `ga4ApiFetch` unchanged + adding a typed
 *     wrapper preserves the 9.A1α substrate lock while letting
 *     this slice land cleanly.
 *
 * Folds in the 9.A1β-deferred logging fix:
 *   - The substrate's `client.ts` non-2xx non-401 silent return
 *     gains a paired `log.warn` line in this slice (separate edit).
 *   - This module emits its OWN `log.warn` at the same code path
 *     so operator triage of Data API failures is symmetric with
 *     the GSC client's pattern.
 *
 * Fail-soft contract:
 *   Returns a structured `Ga4UrlTrafficReportResult` discriminated
 *   union. Never throws on normal not-connected / not-scoped /
 *   disconnected / expired / api_error states. The 4 documented
 *   `Ga4FailReason` values cover every path; callers branch on
 *   the discriminator.
 *
 * Pinned by:
 *   • `tests/architecture/ga4-connector-server-only.test.ts` (auto-
 *     scans this directory)
 *   • `tests/architecture/ga4-connector-tenant-isolation.test.ts`
 *     (extended to cover `runGa4UrlTrafficReport`)
 *   • `tests/architecture/ga4-no-page-load-call.test.ts`
 *   • `tests/architecture/ga4-data-api-tenant-isolation.test.ts`
 *     (new in 9.A2α — pins this module specifically)
 *   • `tests/architecture/ga4-data-api-non-2xx-logging.test.ts`
 *     (new in 9.A2α — pins the non-2xx log line)
 */

import "server-only";

import {
  getGoogleConnectorToken,
  persistRefreshedGoogleToken,
} from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { evaluateExpiry } from "@/lib/connectors/gsc/expiry-handler";
import { log } from "@/lib/logger";

import { AI_SOURCE_FILTER_TERMS } from "./ai-sources";
import type {
  Ga4AiReferralReportResult,
  Ga4AiReferralRow,
  Ga4RevenueReportResult,
  Ga4RevenueRow,
  Ga4RunReportArgs,
  Ga4RunReportResponseBody,
  Ga4SitewideDailyRow,
  Ga4SitewideMonthlyReportResult,
  Ga4SitewideMonthlyRow,
  Ga4SitewideReportResult,
  Ga4UrlTrafficReportResult,
  Ga4UrlTrafficRow,
} from "./types";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DATA_API_HOST = "https://analyticsdata.googleapis.com";

/**
 * 2026-06-16 — expert audit #5/#62 (P0 data correctness).
 *
 * The GA4 Data API `runReport` endpoint caps a single response at
 * `GA4_PAGE_SIZE` rows. Before pagination, a property with more than
 * this many `(date × pagePath)` rows in the requested window SILENTLY
 * undercounted — the response returned the first 10k rows with NO
 * signal, corrupting ranking + proof for high-traffic tenants.
 *
 * `runGa4UrlTrafficReport` now paginates via `offset` until the
 * GA4-reported `rowCount` is exhausted, bounded by `GA4_MAX_PAGES` so a
 * pathological property can never blow up memory / quota. The ceiling
 * is `GA4_PAGE_SIZE * GA4_MAX_PAGES` = 500k rows.
 */
export const GA4_PAGE_SIZE = 10_000;
export const GA4_MAX_PAGES = 50;

/**
 * Build the `runReport` endpoint URL for a given property id.
 * Pure helper, exported for test inspection.
 */
function buildRunReportUrl(propertyId: string): string {
  return `${DATA_API_HOST}/v1beta/properties/${encodeURIComponent(
    propertyId,
  )}:runReport`;
}

/**
 * Build the `runReport` request body. Pure; exported for tests.
 *
 * Dimensions: `date` + `pagePath`.
 * Metrics: `sessions`, `engagedSessions`, `conversions`.
 * Date range: caller-supplied inclusive `[startDate, endDate]`.
 * Limit: `GA4_PAGE_SIZE` (10k) rows per call — the GA4 `runReport`
 *        per-response cap. Paired with `offset`, the caller paginates
 *        across the full result set (expert audit #5/#62).
 * Offset: zero-based row offset into the result set; defaults to 0 so
 *        page-0 bodies are unchanged except for the explicit
 *        `offset: 0`.
 */
function buildRunReportBody(args: {
  startDate: string;
  endDate: string;
  offset?: number;
  limit?: number;
}): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: [{ name: "date" }, { name: "pagePath" }],
    metrics: [
      { name: "sessions" },
      { name: "engagedSessions" },
      { name: "conversions" },
    ],
    // audit-wave7 #5: offset pagination is only exact under a TOTAL deterministic
    // order. Without orderBys GA4 may return rows in an unstable order across
    // pages → a high-traffic tenant silently under/over-counts at page seams.
    orderBys: [
      { dimension: { dimensionName: "date" } },
      { dimension: { dimensionName: "pagePath" } },
    ],
    limit: args.limit ?? GA4_PAGE_SIZE,
    offset: args.offset ?? 0,
  };
}

/**
 * Narrow the GA4 Data API `runReport` response body into the typed
 * `Ga4UrlTrafficRow[]` shape. Defensive: silently drops malformed
 * rows (missing dimensionValues / metricValues / wrong-shaped
 * date). Never throws.
 *
 * Date format from GA4: "YYYYMMDD" (no separators). This helper
 * normalizes to "YYYY-MM-DD" for the read model + migration table.
 *
 * Pure; exported for tests.
 */
export function narrowRunReportRows(
  body: Ga4RunReportResponseBody | null | undefined,
): Ga4UrlTrafficRow[] {
  if (body == null || typeof body !== "object") return [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const out: Ga4UrlTrafficRow[] = [];
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const dims = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
    const mets = Array.isArray(row.metricValues) ? row.metricValues : [];
    const dateRaw = typeof dims[0]?.value === "string" ? dims[0]!.value : null;
    const url = typeof dims[1]?.value === "string" ? dims[1]!.value : null;
    if (dateRaw == null || url == null) continue;
    // GA4 returns "YYYYMMDD"; normalize to ISO date string.
    if (!/^\d{8}$/.test(dateRaw)) continue;
    const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    out.push({
      date,
      url,
      sessions: parseMetricInt(mets[0]?.value),
      engaged_sessions: parseMetricInt(mets[1]?.value),
      conversions: parseMetricInt(mets[2]?.value),
    });
  }
  return out;
}

function parseMetricInt(raw: string | undefined): number {
  if (raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Defensively read GA4's top-level `rowCount` (total matching rows).
 * GA4 sometimes serializes it as a number, sometimes as a stringy
 * value; either way we coerce to a finite non-negative integer.
 * Returns `null` when absent/unparseable so the caller can fall back
 * to "page count is the total" (→ no extra pages). Pure; never throws.
 */
function parseRowCount(raw: unknown): number | null {
  if (raw == null) return null;
  const n =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number.parseInt(raw, 10)
        : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Run the GA4 Data API `runReport` query against the operator's
 * connected `google_ga4` property. Returns narrowed
 * `Ga4UrlTrafficRow[]` on success; structured fail-soft otherwise.
 *
 * Tenant-scoped: `tenantId` is REQUIRED; threaded explicitly. No
 * ambient context reads.
 *
 * Soft-disconnect aware: when the `google_ga4` token has
 * `disconnected_at` set, returns `{ ok: false, reason:
 * "disconnected" }` without making an API call.
 *
 * Expiry-aware via `evaluateExpiry`: `stale_over_7d` returns
 * `token_expired` without refresh; `stale_under_7d` triggers one
 * refresh attempt; on second 401 returns `token_expired`.
 *
 * Non-2xx non-401 response → `log.warn` with bounded body (≤500
 * chars; never logs tokens) + structured `api_error` return.
 *
 * Paginated (2026-06-16 — expert audit #5/#62): GA4 caps a single
 * `runReport` response at `GA4_PAGE_SIZE` (10k) rows. Page 0 keeps the
 * EXACT prior behavior (token/refresh/401-retry/fail-soft returns). On
 * success we read GA4's top-level `rowCount` and loop additional pages
 * at `offset = GA4_PAGE_SIZE, 2*…` (reusing the already-valid access
 * token, no per-page re-refresh) until the total is exhausted or
 * `GA4_MAX_PAGES` is hit. A FAILED subsequent page (offset>0) does NOT
 * fail the whole report — we `log.warn` once, stop, and return the
 * rows gathered so far flagged `truncated: true` (partial > zero). The
 * MAX_PAGES ceiling likewise sets `truncated: true`.
 *
 * NEVER throws on normal not-connected / not-scoped / disconnected
 * / expired / api_error states.
 */
export async function runGa4UrlTrafficReport(
  args: Ga4RunReportArgs,
): Promise<Ga4UrlTrafficReportResult> {
  const { tenantId, propertyId, startDate, endDate } = args;
  if (tenantId == null || tenantId === "") {
    return { ok: false, reason: "no_token", message: "missing tenantId" };
  }
  if (propertyId == null || propertyId === "") {
    return { ok: false, reason: "api_error", message: "missing propertyId" };
  }
  if (startDate == null || startDate === "" || endDate == null || endDate === "") {
    return { ok: false, reason: "api_error", message: "missing date range" };
  }

  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) {
    return { ok: false, reason: "no_token" };
  }
  if (!Array.isArray(token.scopes) || !token.scopes.includes(REQUIRED_SCOPE)) {
    return { ok: false, reason: "no_token", message: "missing scope" };
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return { ok: false, reason: "disconnected" };
  }

  const now = new Date();
  const expiryStatus = evaluateExpiry({ token, now });
  if (expiryStatus === "stale_over_7d") {
    return { ok: false, reason: "token_expired", message: ">7d past expiry" };
  }

  let accessToken = token.access_token;
  if (expiryStatus === "stale_under_7d") {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): persist a rotated refresh token
      // best-effort so GA4 self-heals across rotation.
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
    } catch (e) {
      log.warn("[ga4-data-api] token refresh failed; surfacing token_expired", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, reason: "token_expired" };
    }
  }

  const url = buildRunReportUrl(propertyId);

  /**
   * Fetch a single `runReport` page at `offset` using the supplied
   * (already-valid) access token. Returns the parsed body on success,
   * or `{ error }` describing why the page could not be parsed. Never
   * throws. Used for EVERY page — page 0 wraps the result in the full
   * fail-soft/refresh ladder below; subsequent pages downgrade any
   * `error` to a partial-but-non-fatal stop.
   */
  async function fetchPage(
    pageToken: string,
    offset: number,
  ): Promise<
    | { ok: true; body: Ga4RunReportResponseBody }
    | { ok: false; status?: number; kind: "fetch_threw" | "non_2xx" | "json_parse" | "empty"; errorBody?: string }
  > {
    const pageBody = buildRunReportBody({ startDate, endDate, offset });
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${pageToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pageBody),
      });
    } catch {
      return { ok: false, kind: "fetch_threw" };
    }
    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = (await response.text()).slice(0, 500);
      } catch {
        errorBody = "(body unavailable)";
      }
      return { ok: false, kind: "non_2xx", status: response.status, errorBody };
    }
    let data: Ga4RunReportResponseBody | null;
    try {
      data = (await response.json()) as Ga4RunReportResponseBody;
    } catch {
      return { ok: false, kind: "json_parse" };
    }
    if (data == null) {
      return { ok: false, kind: "empty" };
    }
    return { ok: true, body: data };
  }

  // ── Page 0 ── preserves the EXACT prior behavior: fetch-throw →
  // api_error; 401 → one refresh + retry-once → token_expired on
  // second 401; non-2xx → bounded-body log.warn + api_error;
  // json-parse / empty → api_error.
  let page0 = await fetchPage(accessToken, 0);
  if (!page0.ok && page0.kind === "fetch_threw") {
    log.warn("[ga4-data-api] fetch threw; surfacing api_error", { tenantId });
    return { ok: false, reason: "api_error", message: "fetch threw" };
  }
  if (!page0.ok && page0.kind === "non_2xx" && page0.status === 401) {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): a mid-pull 401 refresh can rotate
      // the refresh token — persist it best-effort.
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
      const retry = await fetchPage(accessToken, 0);
      if (retry.ok) {
        page0 = retry;
      } else if (retry.kind === "non_2xx") {
        return {
          ok: false,
          reason: "token_expired",
          status: retry.status,
          message: "401 after refresh",
        };
      } else if (retry.kind === "json_parse" || retry.kind === "empty") {
        return { ok: false, reason: "api_error", message: "json parse" };
      } else {
        // retry fetch threw
        log.warn("[ga4-data-api] fetch threw; surfacing api_error", { tenantId });
        return { ok: false, reason: "api_error", message: "fetch threw" };
      }
    } catch (e) {
      log.warn("[ga4-data-api] 401 refresh retry failed", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, reason: "token_expired" };
    }
  } else if (!page0.ok && page0.kind === "non_2xx") {
    // 9.A1β-deferred fix: capture Google's error body for operator
    // triage. Bounded to 500 chars; never logs the token.
    log.warn("[ga4-data-api] non-2xx response from GA4 Data API", {
      tenantId,
      status: page0.status,
      body: page0.errorBody ?? "",
    });
    return {
      ok: false,
      reason: "api_error",
      status: page0.status,
      message: "non-2xx response",
    };
  } else if (!page0.ok) {
    // json_parse | empty
    log.warn("[ga4-data-api] response body parse failed", { tenantId });
    return {
      ok: false,
      reason: "api_error",
      message: page0.kind === "empty" ? "empty body" : "json parse",
    };
  }

  // page0.ok === true from here. Accumulate page-0 rows, then paginate.
  const rows: Ga4UrlTrafficRow[] = narrowRunReportRows(page0.body);
  const reportedRowCount = parseRowCount(page0.body.rowCount);
  const totalRowCount = reportedRowCount ?? rows.length;
  // audit-4: RAW page-row count (pre-narrow). narrowRunReportRows drops
  // malformed rows, so its length can be < the API page size even on a FULL
  // page — using it for the fullness check would stop pagination early.
  const rawPageRowCount = (body: Ga4RunReportResponseBody | null | undefined): number =>
    Array.isArray(body?.rows) ? body!.rows.length : 0;

  // audit-4: when GA4 OMITS rowCount we cannot bound the loop by a total, and
  // the old `offset < rows.length` stopped after page 0 — a silent undercount
  // (>10k rows reported as complete) feeding the GA4 page-value weight low.
  // Without a known total, paginate while the PREVIOUS page came back FULL
  // (a short/empty page is the natural end); GA4_MAX_PAGES is the backstop.
  const haveTotal = reportedRowCount != null;
  let lastRawPageFull = rawPageRowCount(page0.body) >= GA4_PAGE_SIZE;

  let truncated = false;
  let pagesFetched = 1;
  for (let offset = GA4_PAGE_SIZE; ; offset += GA4_PAGE_SIZE) {
    const moreExpected = haveTotal ? offset < totalRowCount : lastRawPageFull;
    if (!moreExpected) break;
    if (pagesFetched >= GA4_MAX_PAGES) {
      truncated = true;
      log.warn("[ga4-data-api] hit GA4_MAX_PAGES; result truncated", {
        tenantId,
        pagesFetched,
        rowsGathered: rows.length,
        totalRowCount: haveTotal ? totalRowCount : null,
      });
      break;
    }
    const page = await fetchPage(accessToken, offset);
    pagesFetched += 1;
    if (!page.ok) {
      // Partial data beats zero: stop the loop, flag truncated, keep
      // the rows we already gathered. Single warn for operator triage.
      truncated = true;
      log.warn("[ga4-data-api] subsequent page failed; returning partial", {
        tenantId,
        offset,
        kind: page.kind,
        status: page.kind === "non_2xx" ? page.status : undefined,
        rowsGathered: rows.length,
        totalRowCount: haveTotal ? totalRowCount : null,
      });
      break;
    }
    for (const r of narrowRunReportRows(page.body)) rows.push(r);
    lastRawPageFull = rawPageRowCount(page.body) >= GA4_PAGE_SIZE;
  }

  const result: Ga4UrlTrafficReportResult = { ok: true, rows };
  if (reportedRowCount != null) result.rowCount = reportedRowCount;
  if (truncated) result.truncated = true;
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// GA4 revenue report (2026-06-26, GA4 revenue migration) — SEPARATE from the
// traffic report so a revenue-specific failure NEVER breaks the proven traffic
// sync. Same (date, url) grain + same pagination/auth posture.
// ─────────────────────────────────────────────────────────────────────

/** Revenue metric names requested from GA4 (all standard GA4 metrics). */
const GA4_REVENUE_METRICS = ["totalRevenue", "purchaseRevenue", "transactions"] as const;

/** Build the revenue `runReport` body — date×pagePath dims + revenue metrics.
 *  Pure; exported for tests. */
function buildRevenueReportBody(args: {
  startDate: string;
  endDate: string;
  offset?: number;
  limit?: number;
}): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: [{ name: "date" }, { name: "pagePath" }],
    metrics: GA4_REVENUE_METRICS.map((name) => ({ name })),
    // Total deterministic order for exact offset pagination (mirrors traffic).
    orderBys: [
      { dimension: { dimensionName: "date" } },
      { dimension: { dimensionName: "pagePath" } },
    ],
    limit: args.limit ?? GA4_PAGE_SIZE,
    offset: args.offset ?? 0,
  };
}

function parseMetricFloat(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Narrow a GA4 revenue `runReport` body into `Ga4RevenueRow[]`, mapping metric
 * values BY HEADER NAME (not index) so a reordered/partial metric set never
 * misassigns a value. Drops malformed rows. Pure; exported for tests.
 */
export function narrowRevenueRows(
  body: Ga4RunReportResponseBody | null | undefined,
): Ga4RevenueRow[] {
  if (body == null || typeof body !== "object") return [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = Array.isArray(body.metricHeaders) ? body.metricHeaders : [];
  const idxOf = (name: string): number =>
    headers.findIndex((h) => h?.name === name);
  const iTotal = idxOf("totalRevenue");
  const iPurchase = idxOf("purchaseRevenue");
  const iTxns = idxOf("transactions");
  const out: Ga4RevenueRow[] = [];
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const dims = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
    const mets = Array.isArray(row.metricValues) ? row.metricValues : [];
    const dateRaw = typeof dims[0]?.value === "string" ? dims[0]!.value : null;
    const url = typeof dims[1]?.value === "string" ? dims[1]!.value : null;
    if (dateRaw == null || url == null) continue;
    if (!/^\d{8}$/.test(dateRaw)) continue;
    const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    const txnsRaw = iTxns >= 0 ? mets[iTxns]?.value : undefined;
    out.push({
      date,
      url,
      totalRevenue: iTotal >= 0 ? parseMetricFloat(mets[iTotal]?.value) : null,
      purchaseRevenue: iPurchase >= 0 ? parseMetricFloat(mets[iPurchase]?.value) : null,
      transactions:
        txnsRaw != null && Number.isFinite(Number.parseInt(txnsRaw, 10))
          ? Number.parseInt(txnsRaw, 10)
          : null,
    });
  }
  return out;
}

/** True when a GA4 400 body indicates a revenue metric is unusable for this
 *  property (→ treat as revenue_unavailable, not a generic error). */
function looksLikeRevenueUnavailable(status: number | undefined, body: string): boolean {
  if (status !== 400) return false;
  const b = body.toLowerCase();
  return (
    b.includes("totalrevenue") ||
    b.includes("purchaserevenue") ||
    b.includes("transactions") ||
    b.includes("not a valid metric") ||
    b.includes("incompatib")
  );
}

/**
 * Run the GA4 revenue `runReport`. Fail-soft discriminated union; NEVER throws.
 * Mirrors `runGa4UrlTrafficReport`'s auth/refresh/pagination, but on a 400 that
 * names a revenue metric returns `{ ok: false, reason: "revenue_unavailable" }`
 * so the caller marks revenue UNKNOWN without failing the traffic sync.
 */
export async function runGa4RevenueReport(
  args: Ga4RunReportArgs,
): Promise<Ga4RevenueReportResult> {
  const { tenantId, propertyId, startDate, endDate } = args;
  if (!tenantId) return { ok: false, reason: "no_token", message: "missing tenantId" };
  if (!propertyId) return { ok: false, reason: "api_error", message: "missing propertyId" };
  if (!startDate || !endDate) return { ok: false, reason: "api_error", message: "missing date range" };

  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) return { ok: false, reason: "no_token" };
  if (!Array.isArray(token.scopes) || !token.scopes.includes(REQUIRED_SCOPE)) {
    return { ok: false, reason: "no_token", message: "missing scope" };
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return { ok: false, reason: "disconnected" };
  }

  const expiryStatus = evaluateExpiry({ token, now: new Date() });
  if (expiryStatus === "stale_over_7d") {
    return { ok: false, reason: "token_expired", message: ">7d past expiry" };
  }
  let accessToken = token.access_token;
  if (expiryStatus === "stale_under_7d") {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): persist a rotated refresh token.
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
    } catch {
      return { ok: false, reason: "token_expired" };
    }
  }

  const url = buildRunReportUrl(propertyId);

  async function fetchRevenuePage(
    pageToken: string,
    offset: number,
  ): Promise<
    | { ok: true; body: Ga4RunReportResponseBody }
    | { ok: false; status?: number; kind: "fetch_threw" | "non_2xx" | "json_parse" | "empty"; errorBody?: string }
  > {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildRevenueReportBody({ startDate, endDate, offset })),
      });
    } catch {
      return { ok: false, kind: "fetch_threw" };
    }
    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = (await response.text()).slice(0, 500);
      } catch {
        errorBody = "(body unavailable)";
      }
      return { ok: false, kind: "non_2xx", status: response.status, errorBody };
    }
    try {
      const data = (await response.json()) as Ga4RunReportResponseBody | null;
      return data == null ? { ok: false, kind: "empty" } : { ok: true, body: data };
    } catch {
      return { ok: false, kind: "json_parse" };
    }
  }

  let page0 = await fetchRevenuePage(accessToken, 0);
  if (!page0.ok && page0.kind === "fetch_threw") {
    log.warn("[ga4-revenue] fetch threw; api_error", { tenantId });
    return { ok: false, reason: "api_error", message: "fetch threw" };
  }
  if (!page0.ok && page0.kind === "non_2xx" && page0.status === 401) {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
      const retry = await fetchRevenuePage(accessToken, 0);
      if (retry.ok) page0 = retry;
      // A 401 after refresh means the token is definitively dead → token_expired.
      // Check the STATUS before the body, so a 401 whose error text happens to
      // name a revenue metric is never misclassified as revenue_unavailable
      // (which is a 400-only state — a property legitimately lacking revenue).
      else if (retry.kind === "non_2xx" && retry.status === 401)
        return { ok: false, reason: "token_expired", status: retry.status, message: "401 after refresh" };
      else if (retry.kind === "non_2xx" && looksLikeRevenueUnavailable(retry.status, retry.errorBody ?? ""))
        return { ok: false, reason: "revenue_unavailable", status: retry.status };
      else if (retry.kind === "non_2xx")
        return { ok: false, reason: "api_error", status: retry.status, message: "non-2xx after refresh" };
      else return { ok: false, reason: "api_error", message: retry.kind };
    } catch {
      return { ok: false, reason: "token_expired" };
    }
  } else if (!page0.ok && page0.kind === "non_2xx") {
    if (looksLikeRevenueUnavailable(page0.status, page0.errorBody ?? "")) {
      log.warn("[ga4-revenue] property has no usable revenue metrics; revenue_unavailable", {
        tenantId,
        status: page0.status,
      });
      return { ok: false, reason: "revenue_unavailable", status: page0.status };
    }
    log.warn("[ga4-revenue] non-2xx from GA4 Data API", {
      tenantId,
      status: page0.status,
      body: page0.errorBody ?? "",
    });
    return { ok: false, reason: "api_error", status: page0.status, message: "non-2xx response" };
  } else if (!page0.ok) {
    return { ok: false, reason: "api_error", message: page0.kind };
  }

  const rows: Ga4RevenueRow[] = narrowRevenueRows(page0.body);
  const currency =
    typeof page0.body.metadata?.currencyCode === "string" ? page0.body.metadata.currencyCode : null;
  const reportedRowCount = parseRowCount(page0.body.rowCount);
  const haveTotal = reportedRowCount != null;
  const totalRowCount = reportedRowCount ?? rows.length;
  const rawPageRowCount = (b: Ga4RunReportResponseBody | null | undefined): number =>
    Array.isArray(b?.rows) ? b!.rows.length : 0;
  let lastRawPageFull = rawPageRowCount(page0.body) >= GA4_PAGE_SIZE;

  let truncated = false;
  let pagesFetched = 1;
  for (let offset = GA4_PAGE_SIZE; ; offset += GA4_PAGE_SIZE) {
    const moreExpected = haveTotal ? offset < totalRowCount : lastRawPageFull;
    if (!moreExpected) break;
    if (pagesFetched >= GA4_MAX_PAGES) {
      truncated = true;
      break;
    }
    const page = await fetchRevenuePage(accessToken, offset);
    pagesFetched += 1;
    if (!page.ok) {
      truncated = true;
      log.warn("[ga4-revenue] subsequent page failed; returning partial", { tenantId, offset });
      break;
    }
    for (const r of narrowRevenueRows(page.body)) rows.push(r);
    lastRawPageFull = rawPageRowCount(page.body) >= GA4_PAGE_SIZE;
  }

  const result: Ga4RevenueReportResult = { ok: true, rows, currency };
  if (reportedRowCount != null) result.rowCount = reportedRowCount;
  if (truncated) result.truncated = true;
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// GA4 AI-referral report (2026-07-01, BEACON_500 item 6) - SEPARATE from the
// traffic + revenue reports so an AI-referral failure NEVER breaks the proven
// traffic sync. Grain: (date, pagePath, sessionSource), request-side filtered
// to AI assistant sources. Same pagination/auth posture as the siblings.
// ─────────────────────────────────────────────────────────────────────

/** AI-referral metric names requested from GA4. `keyEvents` replaced the
 *  deprecated `conversions` metric in 2024; narrowing maps by header NAME so
 *  either spelling lands in the same field. */
const GA4_AI_REFERRAL_METRICS = ["sessions", "engagedSessions", "keyEvents"] as const;

/**
 * Build the AI-referral `runReport` body: [date, pagePath, sessionSource]
 * dimensions + session metrics + an orGroup of case-insensitive CONTAINS
 * filters over sessionSource built from AI_SOURCE_FILTER_TERMS. The filter
 * deliberately over-fetches (broad terms); classifyAiSource is the precise
 * gate at persist time. Pure; exported for tests.
 */
export function buildAiReferralReportBody(args: {
  startDate: string;
  endDate: string;
  offset?: number;
  limit?: number;
}): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: [{ name: "date" }, { name: "pagePath" }, { name: "sessionSource" }],
    metrics: GA4_AI_REFERRAL_METRICS.map((name) => ({ name })),
    dimensionFilter: {
      orGroup: {
        expressions: AI_SOURCE_FILTER_TERMS.map((term) => ({
          filter: {
            fieldName: "sessionSource",
            stringFilter: { matchType: "CONTAINS", value: term, caseSensitive: false },
          },
        })),
      },
    },
    // Total deterministic order for exact offset pagination (mirrors traffic).
    orderBys: [
      { dimension: { dimensionName: "date" } },
      { dimension: { dimensionName: "pagePath" } },
      { dimension: { dimensionName: "sessionSource" } },
    ],
    limit: args.limit ?? GA4_PAGE_SIZE,
    offset: args.offset ?? 0,
  };
}

/**
 * Narrow a GA4 AI-referral `runReport` body into `Ga4AiReferralRow[]`.
 * Metric values map BY HEADER NAME (never index) so a reordered/partial
 * metric set can't misassign; `conversions` is accepted as a `keyEvents`
 * alias for older properties. Drops malformed rows. Pure; exported for tests.
 */
function narrowAiReferralRows(
  body: Ga4RunReportResponseBody | null | undefined,
): Ga4AiReferralRow[] {
  if (body == null || typeof body !== "object") return [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = Array.isArray(body.metricHeaders) ? body.metricHeaders : [];
  const idxOf = (name: string): number => headers.findIndex((h) => h?.name === name);
  const iSessions = idxOf("sessions");
  const iEngaged = idxOf("engagedSessions");
  const iKeyEventsNamed = idxOf("keyEvents");
  const iKeyEvents = iKeyEventsNamed >= 0 ? iKeyEventsNamed : idxOf("conversions");
  const out: Ga4AiReferralRow[] = [];
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const dims = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
    const mets = Array.isArray(row.metricValues) ? row.metricValues : [];
    const dateRaw = typeof dims[0]?.value === "string" ? dims[0]!.value : null;
    const pagePath = typeof dims[1]?.value === "string" ? dims[1]!.value : null;
    const sessionSource = typeof dims[2]?.value === "string" ? dims[2]!.value : null;
    if (dateRaw == null || pagePath == null || sessionSource == null) continue;
    if (!/^\d{8}$/.test(dateRaw)) continue;
    const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    out.push({
      date,
      pagePath,
      sessionSource,
      sessions: iSessions >= 0 ? parseMetricInt(mets[iSessions]?.value) : 0,
      engaged_sessions: iEngaged >= 0 ? parseMetricInt(mets[iEngaged]?.value) : 0,
      key_events: iKeyEvents >= 0 ? (parseMetricFloat(mets[iKeyEvents]?.value) ?? 0) : 0,
    });
  }
  return out;
}

/**
 * Run the GA4 AI-referral `runReport`. Fail-soft discriminated union; NEVER
 * throws. Mirrors `runGa4UrlTrafficReport`'s auth ladder exactly: scope check,
 * soft-disconnect, expiry evaluation, 401 refresh-once, non-2xx bounded-body
 * log.warn, and bounded offset pagination with a `truncated` flag.
 */
export async function runGa4AiReferralReport(
  args: Ga4RunReportArgs,
): Promise<Ga4AiReferralReportResult> {
  const { tenantId, propertyId, startDate, endDate } = args;
  if (!tenantId) return { ok: false, reason: "no_token", message: "missing tenantId" };
  if (!propertyId) return { ok: false, reason: "api_error", message: "missing propertyId" };
  if (!startDate || !endDate) return { ok: false, reason: "api_error", message: "missing date range" };

  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) return { ok: false, reason: "no_token" };
  if (!Array.isArray(token.scopes) || !token.scopes.includes(REQUIRED_SCOPE)) {
    return { ok: false, reason: "no_token", message: "missing scope" };
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return { ok: false, reason: "disconnected" };
  }

  const expiryStatus = evaluateExpiry({ token, now: new Date() });
  if (expiryStatus === "stale_over_7d") {
    return { ok: false, reason: "token_expired", message: ">7d past expiry" };
  }
  let accessToken = token.access_token;
  if (expiryStatus === "stale_under_7d") {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): persist a rotated refresh token.
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
    } catch {
      return { ok: false, reason: "token_expired" };
    }
  }

  const url = buildRunReportUrl(propertyId);

  async function fetchReferralPage(
    pageToken: string,
    offset: number,
  ): Promise<
    | { ok: true; body: Ga4RunReportResponseBody }
    | { ok: false; status?: number; kind: "fetch_threw" | "non_2xx" | "json_parse" | "empty"; errorBody?: string }
  > {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildAiReferralReportBody({ startDate, endDate, offset })),
      });
    } catch {
      return { ok: false, kind: "fetch_threw" };
    }
    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = (await response.text()).slice(0, 500);
      } catch {
        errorBody = "(body unavailable)";
      }
      return { ok: false, kind: "non_2xx", status: response.status, errorBody };
    }
    try {
      const data = (await response.json()) as Ga4RunReportResponseBody | null;
      return data == null ? { ok: false, kind: "empty" } : { ok: true, body: data };
    } catch {
      return { ok: false, kind: "json_parse" };
    }
  }

  let page0 = await fetchReferralPage(accessToken, 0);
  if (!page0.ok && page0.kind === "fetch_threw") {
    log.warn("[ga4-ai-referrals] fetch threw; api_error", { tenantId });
    return { ok: false, reason: "api_error", message: "fetch threw" };
  }
  if (!page0.ok && page0.kind === "non_2xx" && page0.status === 401) {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
      const retry = await fetchReferralPage(accessToken, 0);
      if (retry.ok) page0 = retry;
      else if (retry.kind === "non_2xx" && retry.status === 401)
        return { ok: false, reason: "token_expired", status: retry.status, message: "401 after refresh" };
      else if (retry.kind === "non_2xx")
        return { ok: false, reason: "api_error", status: retry.status, message: "non-2xx after refresh" };
      else return { ok: false, reason: "api_error", message: retry.kind };
    } catch {
      return { ok: false, reason: "token_expired" };
    }
  } else if (!page0.ok && page0.kind === "non_2xx") {
    log.warn("[ga4-ai-referrals] non-2xx from GA4 Data API", {
      tenantId,
      status: page0.status,
      body: page0.errorBody ?? "",
    });
    return { ok: false, reason: "api_error", status: page0.status, message: "non-2xx response" };
  } else if (!page0.ok) {
    return { ok: false, reason: "api_error", message: page0.kind };
  }

  const rows: Ga4AiReferralRow[] = narrowAiReferralRows(page0.body);
  const reportedRowCount = parseRowCount(page0.body.rowCount);
  const haveTotal = reportedRowCount != null;
  const totalRowCount = reportedRowCount ?? rows.length;
  const rawPageRowCount = (b: Ga4RunReportResponseBody | null | undefined): number =>
    Array.isArray(b?.rows) ? b!.rows.length : 0;
  let lastRawPageFull = rawPageRowCount(page0.body) >= GA4_PAGE_SIZE;

  let truncated = false;
  let pagesFetched = 1;
  for (let offset = GA4_PAGE_SIZE; ; offset += GA4_PAGE_SIZE) {
    const moreExpected = haveTotal ? offset < totalRowCount : lastRawPageFull;
    if (!moreExpected) break;
    if (pagesFetched >= GA4_MAX_PAGES) {
      truncated = true;
      break;
    }
    const page = await fetchReferralPage(accessToken, offset);
    pagesFetched += 1;
    if (!page.ok) {
      truncated = true;
      log.warn("[ga4-ai-referrals] subsequent page failed; returning partial", { tenantId, offset });
      break;
    }
    for (const r of narrowAiReferralRows(page.body)) rows.push(r);
    lastRawPageFull = rawPageRowCount(page.body) >= GA4_PAGE_SIZE;
  }

  const result: Ga4AiReferralReportResult = { ok: true, rows };
  if (reportedRowCount != null) result.rowCount = reportedRowCount;
  if (truncated) result.truncated = true;
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// GA4 sitewide sessions report (2026-07-10, Wave 2A) - the TRUE sitewide series.
//
// SEPARATE from the (date, pagePath) traffic report on purpose: this report has
// ONLY a `date` dimension, so GA4 returns its OWN sitewide session count per day,
// already aggregated across every page. That is the number Wave 1 could not get
// by summing ga4_url_traffic (GA4 sessions are not additive across page paths).
//
// "visits" == GA4 sessions. We request `sessions` (+ `engagedSessions` for
// context) and store the daily rows at (tenant, property, date) grain, where
// summing across DISTINCT days IS additive-safe. Same auth/refresh/pagination
// posture as the sibling reports so a sitewide failure is isolated and fail-soft.
// ─────────────────────────────────────────────────────────────────────

/** Sitewide daily metrics requested from GA4 (date dimension only). */
const GA4_SITEWIDE_METRICS = ["sessions", "engagedSessions"] as const;

/**
 * Build the sitewide `runReport` body: ONE `date` dimension (NO pagePath) so GA4
 * aggregates sessions across the whole property per day. Total deterministic
 * order for exact offset pagination. Pure; exported for tests.
 */
function buildSitewideSessionsReportBody(args: {
  startDate: string;
  endDate: string;
  offset?: number;
  limit?: number;
}): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: [{ name: "date" }],
    metrics: GA4_SITEWIDE_METRICS.map((name) => ({ name })),
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: args.limit ?? GA4_PAGE_SIZE,
    offset: args.offset ?? 0,
  };
}

/**
 * Narrow a sitewide daily `runReport` body into `Ga4SitewideDailyRow[]`. Metric
 * values map BY HEADER NAME (never index) so a reordered metric set can't
 * misassign. GA4 date "YYYYMMDD" normalizes to "YYYY-MM-DD". Drops malformed
 * rows. Pure; exported for tests.
 */
function narrowSitewideDailyRows(
  body: Ga4RunReportResponseBody | null | undefined,
): Ga4SitewideDailyRow[] {
  if (body == null || typeof body !== "object") return [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = Array.isArray(body.metricHeaders) ? body.metricHeaders : [];
  const idxOf = (name: string): number => headers.findIndex((h) => h?.name === name);
  const iSessions = idxOf("sessions");
  const iEngaged = idxOf("engagedSessions");
  const out: Ga4SitewideDailyRow[] = [];
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const dims = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
    const mets = Array.isArray(row.metricValues) ? row.metricValues : [];
    const dateRaw = typeof dims[0]?.value === "string" ? dims[0]!.value : null;
    if (dateRaw == null || !/^\d{8}$/.test(dateRaw)) continue;
    const date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    out.push({
      date,
      // Header-name mapping; fall back to positional 0/1 only when headers absent.
      sessions: parseMetricInt((iSessions >= 0 ? mets[iSessions] : mets[0])?.value),
      engaged_sessions: parseMetricInt((iEngaged >= 0 ? mets[iEngaged] : mets[1])?.value),
    });
  }
  return out;
}

/** Read GA4's response-metadata timeZone (the property's reporting timezone GA4
 *  bucketed the dates in). GA4 buckets `date`/`yearMonth` in this timezone BY
 *  DEFAULT. Returns null when absent. Pure. */
function parsePropertyTimezone(body: Ga4RunReportResponseBody | null | undefined): string | null {
  const tz = body?.metadata?.timeZone;
  return typeof tz === "string" && tz !== "" ? tz : null;
}

/**
 * Run the GA4 sitewide sessions `runReport` (date dimension only). Fail-soft
 * discriminated union; NEVER throws. Auth/refresh/401-retry/non-2xx-logging/
 * bounded-pagination posture mirrors `runGa4UrlTrafficReport` exactly. On
 * success returns the daily rows plus the property's reporting timezone from
 * response metadata.
 */
export async function runGa4SitewideSessionsReport(
  args: Ga4RunReportArgs,
): Promise<Ga4SitewideReportResult> {
  const { tenantId, propertyId, startDate, endDate } = args;
  if (!tenantId) return { ok: false, reason: "no_token", message: "missing tenantId" };
  if (!propertyId) return { ok: false, reason: "api_error", message: "missing propertyId" };
  if (!startDate || !endDate) return { ok: false, reason: "api_error", message: "missing date range" };

  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) return { ok: false, reason: "no_token" };
  if (!Array.isArray(token.scopes) || !token.scopes.includes(REQUIRED_SCOPE)) {
    return { ok: false, reason: "no_token", message: "missing scope" };
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return { ok: false, reason: "disconnected" };
  }

  const expiryStatus = evaluateExpiry({ token, now: new Date() });
  if (expiryStatus === "stale_over_7d") {
    return { ok: false, reason: "token_expired", message: ">7d past expiry" };
  }
  let accessToken = token.access_token;
  if (expiryStatus === "stale_under_7d") {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
    } catch {
      return { ok: false, reason: "token_expired" };
    }
  }

  const url = buildRunReportUrl(propertyId);

  async function fetchSitewidePage(
    pageToken: string,
    offset: number,
  ): Promise<
    | { ok: true; body: Ga4RunReportResponseBody }
    | { ok: false; status?: number; kind: "fetch_threw" | "non_2xx" | "json_parse" | "empty"; errorBody?: string }
  > {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildSitewideSessionsReportBody({ startDate, endDate, offset })),
      });
    } catch {
      return { ok: false, kind: "fetch_threw" };
    }
    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = (await response.text()).slice(0, 500);
      } catch {
        errorBody = "(body unavailable)";
      }
      return { ok: false, kind: "non_2xx", status: response.status, errorBody };
    }
    try {
      const data = (await response.json()) as Ga4RunReportResponseBody | null;
      return data == null ? { ok: false, kind: "empty" } : { ok: true, body: data };
    } catch {
      return { ok: false, kind: "json_parse" };
    }
  }

  let page0 = await fetchSitewidePage(accessToken, 0);
  if (!page0.ok && page0.kind === "fetch_threw") {
    log.warn("[ga4-sitewide] fetch threw; api_error", { tenantId });
    return { ok: false, reason: "api_error", message: "fetch threw" };
  }
  if (!page0.ok && page0.kind === "non_2xx" && page0.status === 401) {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
      const retry = await fetchSitewidePage(accessToken, 0);
      if (retry.ok) page0 = retry;
      else if (retry.kind === "non_2xx" && retry.status === 401)
        return { ok: false, reason: "token_expired", status: retry.status, message: "401 after refresh" };
      else if (retry.kind === "non_2xx")
        return { ok: false, reason: "api_error", status: retry.status, message: "non-2xx after refresh" };
      else return { ok: false, reason: "api_error", message: retry.kind };
    } catch {
      return { ok: false, reason: "token_expired" };
    }
  } else if (!page0.ok && page0.kind === "non_2xx") {
    log.warn("[ga4-sitewide] non-2xx from GA4 Data API", {
      tenantId,
      status: page0.status,
      body: page0.errorBody ?? "",
    });
    return { ok: false, reason: "api_error", status: page0.status, message: "non-2xx response" };
  } else if (!page0.ok) {
    return { ok: false, reason: "api_error", message: page0.kind };
  }

  const propertyTimezone = parsePropertyTimezone(page0.body);
  const rows: Ga4SitewideDailyRow[] = narrowSitewideDailyRows(page0.body);
  const reportedRowCount = parseRowCount(page0.body.rowCount);
  const haveTotal = reportedRowCount != null;
  const totalRowCount = reportedRowCount ?? rows.length;
  const rawPageRowCount = (b: Ga4RunReportResponseBody | null | undefined): number =>
    Array.isArray(b?.rows) ? b!.rows.length : 0;
  let lastRawPageFull = rawPageRowCount(page0.body) >= GA4_PAGE_SIZE;

  let truncated = false;
  let pagesFetched = 1;
  for (let offset = GA4_PAGE_SIZE; ; offset += GA4_PAGE_SIZE) {
    const moreExpected = haveTotal ? offset < totalRowCount : lastRawPageFull;
    if (!moreExpected) break;
    if (pagesFetched >= GA4_MAX_PAGES) {
      truncated = true;
      break;
    }
    const page = await fetchSitewidePage(accessToken, offset);
    pagesFetched += 1;
    if (!page.ok) {
      truncated = true;
      log.warn("[ga4-sitewide] subsequent page failed; returning partial", { tenantId, offset });
      break;
    }
    for (const r of narrowSitewideDailyRows(page.body)) rows.push(r);
    lastRawPageFull = rawPageRowCount(page.body) >= GA4_PAGE_SIZE;
  }

  const result: Ga4SitewideReportResult = { ok: true, rows, propertyTimezone };
  if (reportedRowCount != null) result.rowCount = reportedRowCount;
  if (truncated) result.truncated = true;
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// GA4 sitewide MONTHLY report (2026-07-10, Wave 2A) - the reconciliation truth.
//
// A DIRECT month-grain report using GA4's `yearMonth` dimension: GA4 returns its
// OWN sitewide session total per calendar month. reconcileGa4MonthlySeries checks
// this against the daily rollup month by month; the daily sum must match this
// direct total within tolerance before the north-star card is allowed to show a
// visits number. Same fail-soft posture; ~14 rows so no real pagination needed.
// ─────────────────────────────────────────────────────────────────────

/** Build the monthly `runReport` body: ONE `yearMonth` dimension + `sessions`.
 *  Pure; exported for tests. */
function buildSitewideMonthlyReportBody(args: {
  startDate: string;
  endDate: string;
  offset?: number;
  limit?: number;
}): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: [{ name: "yearMonth" }],
    metrics: [{ name: "sessions" }],
    orderBys: [{ dimension: { dimensionName: "yearMonth" } }],
    limit: args.limit ?? GA4_PAGE_SIZE,
    offset: args.offset ?? 0,
  };
}

/** Narrow a monthly `runReport` body into `Ga4SitewideMonthlyRow[]`. GA4's
 *  `yearMonth` value is "YYYYMM"; normalizes to "YYYY-MM-01". Drops malformed
 *  rows. Pure; exported for tests. */
function narrowSitewideMonthlyRows(
  body: Ga4RunReportResponseBody | null | undefined,
): Ga4SitewideMonthlyRow[] {
  if (body == null || typeof body !== "object") return [];
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const out: Ga4SitewideMonthlyRow[] = [];
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const dims = Array.isArray(row.dimensionValues) ? row.dimensionValues : [];
    const mets = Array.isArray(row.metricValues) ? row.metricValues : [];
    const ym = typeof dims[0]?.value === "string" ? dims[0]!.value : null;
    if (ym == null || !/^\d{6}$/.test(ym)) continue;
    const month = `${ym.slice(0, 4)}-${ym.slice(4, 6)}-01`;
    out.push({ month, sessions: parseMetricInt(mets[0]?.value) });
  }
  return out;
}

/**
 * Run the GA4 sitewide monthly `runReport` (yearMonth dimension). Fail-soft
 * discriminated union; NEVER throws. Mirrors the daily report's auth ladder.
 * A single page suffices for month-grain data; the same MAX_PAGES bound guards
 * against a pathological response.
 */
export async function runGa4SitewideMonthlyReport(
  args: Ga4RunReportArgs,
): Promise<Ga4SitewideMonthlyReportResult> {
  const { tenantId, propertyId, startDate, endDate } = args;
  if (!tenantId) return { ok: false, reason: "no_token", message: "missing tenantId" };
  if (!propertyId) return { ok: false, reason: "api_error", message: "missing propertyId" };
  if (!startDate || !endDate) return { ok: false, reason: "api_error", message: "missing date range" };

  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) return { ok: false, reason: "no_token" };
  if (!Array.isArray(token.scopes) || !token.scopes.includes(REQUIRED_SCOPE)) {
    return { ok: false, reason: "no_token", message: "missing scope" };
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return { ok: false, reason: "disconnected" };
  }

  const expiryStatus = evaluateExpiry({ token, now: new Date() });
  if (expiryStatus === "stale_over_7d") {
    return { ok: false, reason: "token_expired", message: ">7d past expiry" };
  }
  let accessToken = token.access_token;
  if (expiryStatus === "stale_under_7d") {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
    } catch {
      return { ok: false, reason: "token_expired" };
    }
  }

  const url = buildRunReportUrl(propertyId);

  async function fetchMonthlyPage(
    pageToken: string,
  ): Promise<
    | { ok: true; body: Ga4RunReportResponseBody }
    | { ok: false; status?: number; kind: "fetch_threw" | "non_2xx" | "json_parse" | "empty"; errorBody?: string }
  > {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${pageToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(buildSitewideMonthlyReportBody({ startDate, endDate })),
      });
    } catch {
      return { ok: false, kind: "fetch_threw" };
    }
    if (!response.ok) {
      let errorBody = "";
      try {
        errorBody = (await response.text()).slice(0, 500);
      } catch {
        errorBody = "(body unavailable)";
      }
      return { ok: false, kind: "non_2xx", status: response.status, errorBody };
    }
    try {
      const data = (await response.json()) as Ga4RunReportResponseBody | null;
      return data == null ? { ok: false, kind: "empty" } : { ok: true, body: data };
    } catch {
      return { ok: false, kind: "json_parse" };
    }
  }

  let page0 = await fetchMonthlyPage(accessToken);
  if (!page0.ok && page0.kind === "fetch_threw") {
    log.warn("[ga4-sitewide-monthly] fetch threw; api_error", { tenantId });
    return { ok: false, reason: "api_error", message: "fetch threw" };
  }
  if (!page0.ok && page0.kind === "non_2xx" && page0.status === 401) {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
      const retry = await fetchMonthlyPage(accessToken);
      if (retry.ok) page0 = retry;
      else if (retry.kind === "non_2xx" && retry.status === 401)
        return { ok: false, reason: "token_expired", status: retry.status, message: "401 after refresh" };
      else if (retry.kind === "non_2xx")
        return { ok: false, reason: "api_error", status: retry.status, message: "non-2xx after refresh" };
      else return { ok: false, reason: "api_error", message: retry.kind };
    } catch {
      return { ok: false, reason: "token_expired" };
    }
  } else if (!page0.ok && page0.kind === "non_2xx") {
    log.warn("[ga4-sitewide-monthly] non-2xx from GA4 Data API", {
      tenantId,
      status: page0.status,
      body: page0.errorBody ?? "",
    });
    return { ok: false, reason: "api_error", status: page0.status, message: "non-2xx response" };
  } else if (!page0.ok) {
    return { ok: false, reason: "api_error", message: page0.kind };
  }

  const propertyTimezone = parsePropertyTimezone(page0.body);
  const rows: Ga4SitewideMonthlyRow[] = narrowSitewideMonthlyRows(page0.body);
  const reportedRowCount = parseRowCount(page0.body.rowCount);
  const result: Ga4SitewideMonthlyReportResult = { ok: true, rows, propertyTimezone };
  if (reportedRowCount != null) result.rowCount = reportedRowCount;
  return result;
}

