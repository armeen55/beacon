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

import { getGoogleConnectorToken } from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { evaluateExpiry } from "@/lib/connectors/gsc/expiry-handler";
import { log } from "@/lib/logger";

import type {
  Ga4RunReportArgs,
  Ga4RunReportResponseBody,
  Ga4UrlTrafficReportResult,
  Ga4UrlTrafficRow,
} from "./types";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DATA_API_HOST = "https://analyticsdata.googleapis.com";

/**
 * Build the `runReport` endpoint URL for a given property id.
 * Pure helper, exported for test inspection.
 */
export function buildRunReportUrl(propertyId: string): string {
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
 * Limit: 10_000 rows per call (GA4 max is higher; 10k is a defensive
 *        cap that keeps response bodies bounded for the operator
 *        diagnostic flow).
 */
export function buildRunReportBody(args: {
  startDate: string;
  endDate: string;
}): Record<string, unknown> {
  return {
    dateRanges: [{ startDate: args.startDate, endDate: args.endDate }],
    dimensions: [{ name: "date" }, { name: "pagePath" }],
    metrics: [
      { name: "sessions" },
      { name: "engagedSessions" },
      { name: "conversions" },
    ],
    limit: 10_000,
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
      const refreshed = await refreshGoogleAccessToken(token.refresh_token);
      accessToken = refreshed.access_token;
    } catch (e) {
      log.warn("[ga4-data-api] token refresh failed; surfacing token_expired", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, reason: "token_expired" };
    }
  }

  const url = buildRunReportUrl(propertyId);
  const body = buildRunReportBody({ startDate, endDate });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    log.warn("[ga4-data-api] fetch threw; surfacing api_error", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: "api_error", message: "fetch threw" };
  }

  if (!response.ok) {
    if (response.status === 401) {
      try {
        const refreshed = await refreshGoogleAccessToken(token.refresh_token);
        const retry = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${refreshed.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (retry.ok) {
          const data = (await retry.json().catch(() => null)) as
            | Ga4RunReportResponseBody
            | null;
          if (data == null) {
            return { ok: false, reason: "api_error", message: "json parse" };
          }
          return { ok: true, rows: narrowRunReportRows(data) };
        }
        return {
          ok: false,
          reason: "token_expired",
          status: retry.status,
          message: "401 after refresh",
        };
      } catch (e) {
        log.warn("[ga4-data-api] 401 refresh retry failed", {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
        return { ok: false, reason: "token_expired" };
      }
    }
    // 9.A1β-deferred fix: capture Google's error body for operator
    // triage. Bounded to 500 chars; never logs the token.
    let errorBody = "";
    try {
      errorBody = (await response.text()).slice(0, 500);
    } catch {
      errorBody = "(body unavailable)";
    }
    log.warn("[ga4-data-api] non-2xx response from GA4 Data API", {
      tenantId,
      status: response.status,
      body: errorBody,
    });
    return {
      ok: false,
      reason: "api_error",
      status: response.status,
      message: "non-2xx response",
    };
  }

  let data: Ga4RunReportResponseBody | null;
  try {
    data = (await response.json()) as Ga4RunReportResponseBody;
  } catch (e) {
    log.warn("[ga4-data-api] response body parse failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: "api_error", message: "json parse" };
  }
  if (data == null) {
    return { ok: false, reason: "api_error", message: "empty body" };
  }
  return { ok: true, rows: narrowRunReportRows(data) };
}

/** Test-only export of internals. */
export const __testing = {
  REQUIRED_SCOPE,
  DATA_API_HOST,
};
