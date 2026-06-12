/**
 * Insight Graph slice 1 (2026-06-12) — GSC Search Analytics client.
 *
 * Pulls searchanalytics.query rows (page+query grain) for a tenant's
 * property using the EXISTING google_gsc OAuth grant — the
 * `webmasters.readonly` scope explicitly authorizes
 * searchanalytics.query (Google method reference), so no re-consent
 * is needed.
 *
 * API contract (primary docs, cited in the slice commit):
 *   POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query
 *   body: { startDate, endDate (YYYY-MM-DD, PACIFIC TIME), dimensions,
 *           type, rowLimit (max 25000, default 1000), startRow,
 *           dataState ("final" | "all") }
 *   resp: rows[].keys (dimension values in request order), clicks,
 *         impressions, ctr (0–1 fraction), position (1-based avg).
 *
 * Token path mirrors `gscUrlInspect` exactly: explicit google_gsc
 * grant → scope check → soft-disconnect → expiry ladder (fresh /
 * stale_under_7d → refresh / stale_over_7d → fail-soft null).
 * Fail-soft EVERYWHERE: a missing/expired token, quota error, or
 * non-2xx returns null — callers skip, never throw.
 */

import "server-only";

import { getGoogleConnectorToken } from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { log } from "@/lib/logger";

import { evaluateExpiry } from "./expiry-handler";
import { backoffDelayMs } from "./quota-stagger";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Google's documented per-request maximum. */
export const GSC_SA_ROW_LIMIT = 25_000;

export type GscSearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/**
 * Resolve a usable access token for the tenant's GSC grant, or null
 * (fail-soft) when no token / wrong scope / disconnected / stale>7d.
 */
export async function resolveGscAccessToken(
  tenantId: string,
  now: Date = new Date(),
): Promise<string | null> {
  const token = await getGoogleConnectorToken("gsc", tenantId);
  if (token == null) return null;
  if (!Array.isArray(token.scopes) || !token.scopes.includes(REQUIRED_SCOPE)) {
    return null;
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return null;
  }
  const expiryStatus = evaluateExpiry({ token, now });
  if (expiryStatus === "stale_over_7d") return null;
  if (expiryStatus === "stale_under_7d") {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token);
      return refreshed.access_token;
    } catch (err) {
      log.warn("[gsc-search-analytics] token refresh failed", {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  return token.access_token;
}

/**
 * One searchanalytics.query call. Returns rows (possibly []) or null
 * on any failure (auth, quota, network) — never throws.
 */
export async function gscSearchAnalyticsQuery(
  args: {
    accessToken: string;
    siteUrl: string;
    startDate: string;
    endDate: string;
    dimensions: string[];
    dataState?: "final" | "all";
    rowLimit?: number;
    startRow?: number;
  },
  deps: {
    fetchImpl?: typeof fetch;
    /** Test seam — defaults to a real timer sleep. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<GscSearchAnalyticsRow[] | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const endpoint =
    "https://www.googleapis.com/webmasters/v3/sites/" +
    encodeURIComponent(args.siteUrl) +
    "/searchAnalytics/query";
  // Audit hardening #35 (2026-06-12): 429s retry with the connector's
  // own exponential backoff (quota-stagger.backoffDelayMs — 1s/2s/4s,
  // then give up). Other failures stay single-shot fail-soft.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: args.startDate,
          endDate: args.endDate,
          dimensions: args.dimensions,
          type: "web",
          rowLimit: args.rowLimit ?? GSC_SA_ROW_LIMIT,
          startRow: args.startRow ?? 0,
          dataState: args.dataState ?? "final",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        const delay = backoffDelayMs(attempt);
        if (delay > 0) {
          log.warn("[gsc-search-analytics] 429 — backing off", {
            siteUrl: args.siteUrl,
            startDate: args.startDate,
            attempt,
            delayMs: delay,
          });
          await sleep(delay);
          continue;
        }
        log.warn("[gsc-search-analytics] 429 — retries exhausted", {
          siteUrl: args.siteUrl,
          startDate: args.startDate,
          attempt,
        });
        return null;
      }
      if (!res.ok) {
        log.warn("[gsc-search-analytics] non-2xx from searchanalytics.query", {
          status: res.status,
          siteUrl: args.siteUrl,
          startDate: args.startDate,
        });
        return null;
      }
      const body = (await res.json()) as { rows?: GscSearchAnalyticsRow[] };
      return Array.isArray(body.rows) ? body.rows : [];
    } catch (err) {
      log.warn("[gsc-search-analytics] query failed", {
        siteUrl: args.siteUrl,
        startDate: args.startDate,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

/**
 * Pull EVERY row for one day at the given grain, following Google's
 * documented pagination loop: bump startRow by 25,000 until a short
 * or empty page. (Grouped data is hard-capped at 50K rows/day by the
 * API, so this is ≤3 requests in practice.)
 */
export async function pullDayRows(args: {
  accessToken: string;
  siteUrl: string;
  day: string;
  dimensions: string[];
  dataState?: "final" | "all";
}): Promise<GscSearchAnalyticsRow[] | null> {
  const out: GscSearchAnalyticsRow[] = [];
  let startRow = 0;
  for (;;) {
    const page = await gscSearchAnalyticsQuery({
      accessToken: args.accessToken,
      siteUrl: args.siteUrl,
      startDate: args.day,
      endDate: args.day,
      dimensions: args.dimensions,
      dataState: args.dataState,
      startRow,
    });
    if (page == null) return out.length > 0 ? out : null;
    out.push(...page);
    if (page.length < GSC_SA_ROW_LIMIT) break;
    startRow += GSC_SA_ROW_LIMIT;
  }
  return out;
}
