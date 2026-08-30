/**
 * Insight Graph slice 1 (2026-06-12) — GSC Search Analytics client.
 *
 * Pulls searchanalytics.query rows (page+query grain) for a tenant's property using the EXISTING google_gsc OAuth grant — the `webmasters.readonly` scope explicitly authorizes searchanalytics.query (Google method reference), so no re-consent is needed.
 *
 * API contract (primary docs, cited in the slice commit): POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query body: { startDate, endDate (YYYY-MM-DD, PACIFIC TIME), dimensions, type, rowLimit (max 25000, default 1000), startRow, dataState ("final" | "all") } resp: rows[].keys (dimension values in request order), clicks, impressions, ctr (0–1 fraction), position (1-based avg).
 *
 * Token path mirrors `gscUrlInspect` exactly: explicit google_gsc grant → scope check → soft-disconnect → expiry ladder (fresh / stale_under_7d → refresh / stale_over_7d → fail-soft null). Fail-soft EVERYWHERE: a missing/expired token, quota error, or non-2xx returns null — callers skip, never throw.
 */

import "server-only";

import {
  getGoogleConnectorToken,
  persistRefreshedGoogleToken,
} from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { log } from "@/lib/logger";

import { evaluateExpiry } from "./expiry-handler";
import { backoffDelayMs } from "./quota-stagger";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** Google's documented per-request maximum. */
export const GSC_SA_ROW_LIMIT = 25_000;

type GscSearchAnalyticsRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

/** Resolve a usable access token for the tenant's GSC grant, or null (fail-soft) when no token / wrong scope / disconnected / stale>7d. */
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
    return refreshAndPersistGscToken(tenantId, token.refresh_token);
  }
  return token.access_token;
}

/**
 * Refresh the GSC access token via the long-lived refresh token and persist it back to the connector store. Returns the new access token, or null if the refresh ITSELF fails (refresh token dead/revoked → the operator genuinely must reconnect). Best-effort persist (a persist failure does NOT fail the refresh — the in-memory token is valid for this run).
 *
 * wave-9 (2026-06-14): persisting the refreshed token (in the epoch-ms format `evaluateExpiry` reads) stopped every nightly sync re-refreshing the same stale token (~9 wasted OAuth calls/day).
 */
async function refreshAndPersistGscToken(
  tenantId: string,
  refreshToken: string,
): Promise<string | null> {
  try {
    const refreshed = await refreshGoogleAccessToken(refreshToken, {
      provider: "google_gsc",
      tenantId,
    });
    // Persist the refreshed token through the guarded compare-and-swap (RPC mode 'refresh'), NOT updateConnectorToken. Two reasons (review P1-1): (1) the patch path now strips/refuses refresh_token, so a rotated token could never persist through it; (2) a full-row read-merge-write here is exactly the cross-instance race the CAS resolves, and the CAS also guarantees a staler concurrent write no-ops. A rotated refresh_token is passed only when Google returned one, so the stored token is never blanked.
    try {
      await persistRefreshedGoogleToken(
        "google_gsc",
        {
          access_token: refreshed.access_token,
          expires_in: refreshed.expires_in,
          ...(refreshed.refresh_token
            ? { refresh_token: refreshed.refresh_token }
            : {}),
        },
        tenantId,
      );
    } catch (persistErr) {
      log.warn(
        "[gsc-search-analytics] refreshed token persist failed (continuing with in-memory token)",
        {
          tenantId,
          error:
            persistErr instanceof Error
              ? persistErr.message
              : String(persistErr),
        },
      );
    }
    return refreshed.access_token;
  } catch (err) {
    log.warn("[gsc-search-analytics] token refresh failed", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Force a token refresh regardless of the locally-evaluated expiry — used when Google returns a mid-sync 401 on a token we thought was still fresh (server-side revocation, clock skew, or a token that expired DURING a long paginated pull). Mirrors `ga4/data-api.ts`'s one-shot 401 refresh-retry, so an expired-but-recoverable access token self-heals instead of bugging the operator to reconnect. Returns the new access token, or null when there is no usable grant to refresh (→ caller fails LOUD: genuine reconnect needed). */
export async function forceRefreshGscAccessToken(
  tenantId: string,
): Promise<string | null> {
  const token = await getGoogleConnectorToken("gsc", tenantId);
  if (token == null || !token.refresh_token) return null;
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return null;
  }
  return refreshAndPersistGscToken(tenantId, token.refresh_token);
}

/** One searchanalytics.query call. Returns rows (possibly []) or null on any failure (auth, quota, network) — never throws. */
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
    /** Search Console `type`. Defaults to "web" (organic Search) so every existing caller is byte-identical. R17c item 493 passes "discover" to probe the Google Discover surface (a separate feed with its own, often-empty, data). "news" is documented too; unused for now. */
    searchType?: "web" | "discover" | "news";
  },
  deps: {
    fetchImpl?: typeof fetch;
    /** Test seam — defaults to a real timer sleep. */
    sleep?: (ms: number) => Promise<void>;
    /** wave-11 follow-on (2026-06-14): invoked with the HTTP status on an AUTH failure (401/403). Lets the caller (the sync) surface a fail-LOUD `synced:false` instead of swallowing a dead/expired GSC grant as "0 rows" (silent stale GSC — the pivot's core signal). Optional, so the only caller (pullDayRows) opts in; the function still returns null. */
    onAuthFailure?: (status: number) => void;
    /** wave-11 follow-on (2026-06-14): one-shot 401 refresh-retry (mirrors ga4/data-api.ts). On a 401 — a RECOVERABLE access-token expiry — this is invoked to mint a fresh token via the long-lived refresh token; the request is then retried ONCE with the new token. Only if the refresh (or the retry) also fails do we fail LOUD via onAuthFailure. 403 (scope loss) is NOT retried — a refresh can't restore a revoked scope. Optional + at-most-once, so back-compat is preserved (no dep → the prior fail-loud-on-401 behavior). */
    refreshAccessToken?: () => Promise<string | null>;
  } = {},
): Promise<GscSearchAnalyticsRow[] | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const endpoint =
    "https://www.googleapis.com/webmasters/v3/sites/" +
    encodeURIComponent(args.siteUrl) +
    "/searchAnalytics/query";
  // The token can be refreshed once mid-flight on a 401 (see below); use a local so the retry uses the new token.
  let accessToken = args.accessToken;
  let didAuthRefresh = false;
  // Audit hardening #35 (2026-06-12): 429s retry with the connector's own exponential backoff (quota-stagger.backoffDelayMs — 1s/2s/4s, then give up). Other failures stay single-shot fail-soft.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: args.startDate,
          endDate: args.endDate,
          dimensions: args.dimensions,
          type: args.searchType ?? "web",
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
        // wave-11 follow-on (2026-06-14): a 401/403 means the GSC grant expired or lost scope. Pre-fix this was a quiet warn -> null, so the sync recorded "0 rows" and stopped, GREEN, and the operator never learned the token died -> stale GSC demand silently.
        //
        // A 401 is a RECOVERABLE access-token expiry: try ONE refresh-retry (mirrors ga4/data-api.ts) so an expired-but-refreshable token self- heals instead of bugging the operator to reconnect. Only if the refresh OR the retry also fails do we fail LOUD (onAuthFailure -> sync returns synced:false). 403 (scope loss) is NOT retried — a refresh can't restore a revoked scope.
        if (
          res.status === 401 &&
          !didAuthRefresh &&
          deps.refreshAccessToken != null
        ) {
          const refreshed = await deps.refreshAccessToken();
          if (refreshed) {
            log.warn(
              "[gsc-search-analytics] 401 — refreshed token, retrying once",
              { siteUrl: args.siteUrl, startDate: args.startDate },
            );
            accessToken = refreshed;
            didAuthRefresh = true;
            continue;
          }
          // refresh failed (refresh token dead) — fall through to fail-loud.
        }
        if (res.status === 401 || res.status === 403) {
          log.error(
            "[gsc-search-analytics] AUTH FAILURE — GSC token expired or lost scope; reconnect GSC",
            { status: res.status, siteUrl: args.siteUrl, startDate: args.startDate },
          );
          deps.onAuthFailure?.(res.status);
          return null;
        }
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

type GscSiteEntry = { siteUrl: string; permissionLevel: string };

/** List the verified GSC properties this token can access (sites.list). Fail-soft to [] on any error. Lets the sync auto-pick the right property SHAPE — a domain property (`sc-domain:x.com`) vs a URL-prefix property (`https://www.x.com/`) — instead of guessing (the wrong shape → 403). */
export async function gscListSites(
  accessToken: string,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<GscSiteEntry[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("https://www.googleapis.com/webmasters/v3/sites", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      log.warn("[gsc-search-analytics] sites.list non-2xx", { status: res.status });
      return [];
    }
    const body = (await res.json()) as {
      siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
    };
    return (body.siteEntry ?? [])
      .filter((s): s is { siteUrl: string; permissionLevel?: string } => typeof s.siteUrl === "string")
      .map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel ?? "" }));
  } catch (err) {
    log.warn("[gsc-search-analytics] sites.list failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Normalize any GSC property id or domain to a bare host (no protocol, no sc-domain: prefix, no leading www, no trailing slash), lowercased. */
function gscNormHost(s: string): string {
  return s
    .replace(/^sc-domain:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

/** Pick the GSC property id for a tenant `domain` from the token's verified sites. Skips unverified properties (can't read Search Analytics). Returns the EXACT siteUrl GSC owns (e.g. `https://www.iranopedia.com/`), preferring a domain property (broadest), then a `www` URL-prefix, then any match. Returns null when the token can't see a property for this domain. Pure. */
export function pickGscPropertyForDomain(
  sites: GscSiteEntry[],
  domain: string,
): string | null {
  const target = gscNormHost(domain);
  if (target === "") return null;
  const matches = sites.filter(
    (s) => s.permissionLevel !== "siteUnverifiedUser" && gscNormHost(s.siteUrl) === target,
  );
  if (matches.length === 0) return null;
  const scDomain = matches.find((s) => /^sc-domain:/i.test(s.siteUrl));
  if (scDomain) return scDomain.siteUrl;
  const www = matches.find((s) => /^https?:\/\/www\./i.test(s.siteUrl));
  if (www) return www.siteUrl;
  return matches[0]!.siteUrl;
}

/** Pull EVERY row for one day at the given grain, following Google's documented pagination loop: bump startRow by 25,000 until a short or empty page. (Grouped data is hard-capped at 50K rows/day by the API, so this is ≤3 requests in practice.) */
export async function pullDayRows(args: {
  accessToken: string;
  siteUrl: string;
  day: string;
  dimensions: string[];
  dataState?: "final" | "all";
  /** wave-11 follow-on: forwarded to the query so an auth (401/403) failure surfaces to the sync (fail-loud) instead of looking like an empty day. */
  onAuthFailure?: (status: number) => void;
  /** wave-11 follow-on: one-shot 401 refresh-retry. Forwarded to the query; a successful refresh is cached here so later pages of the same day reuse the new token (no per-page re-refresh). */
  refreshAccessToken?: () => Promise<string | null>;
  /** Test seam (audit-3 #6 truncation test) — defaults to the real query. */
  queryImpl?: typeof gscSearchAnalyticsQuery;
}): Promise<GscSearchAnalyticsRow[] | null> {
  const query = args.queryImpl ?? gscSearchAnalyticsQuery;
  const out: GscSearchAnalyticsRow[] = [];
  let startRow = 0;
  // Track the live token so a mid-pagination refresh propagates to later pages.
  let currentToken = args.accessToken;
  const refreshAccessToken = args.refreshAccessToken
    ? async () => {
        const next = await args.refreshAccessToken!();
        if (next) currentToken = next;
        return next;
      }
    : undefined;
  for (;;) {
    const page = await query(
      {
        accessToken: currentToken,
        siteUrl: args.siteUrl,
        startDate: args.day,
        endDate: args.day,
        dimensions: args.dimensions,
        dataState: args.dataState,
        startRow,
      },
      { onAuthFailure: args.onAuthFailure, refreshAccessToken },
    );
    // audit-3 #6 (2026-06-22): a null page is a query failure (network / quota / auth). Pre-fix a failure AFTER the first full page returned the PARTIAL `out`, and the caller persisted those rows with is_final=true — a truncated day frozen as complete, which the re-pull watermark then skips forever. Return null on ANY page failure so the day is treated as incomplete: the caller stops the run, persists nothing for this day, and re-pulls it cleanly next run (UPSERT is idempotent). Returning a partial day is strictly worse than returning none.
    if (page == null) return null;
    out.push(...page);
    if (page.length < GSC_SA_ROW_LIMIT) break;
    startRow += GSC_SA_ROW_LIMIT;
  }
  return out;
}
