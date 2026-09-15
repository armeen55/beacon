/**
 * 2026-05-18 — Slice 9.A1 — Google Analytics 4 authenticated-fetch
 * helper.
 *
 * Operator-substrate only. NO customer surface imports. NO Data API
 * endpoints in this slice — `ga4ApiFetch` is the seam the
 * property-selection module uses to hit the Analytics Admin API
 * (`accountSummaries.list`). The Data API call sites land in Slice
 * 9.A2 alongside the Mode A outcome attribution read model.
 *
 * Posture (locked):
 *   • Server-only. Cannot be bundled into client components.
 *   • Tenant-scoped via the EXPLICIT `tenantId` parameter (mirrors
 *     the GSC client posture). No ambient `currentTenantId()` reads.
 *   • Fail-soft: returns `{ ok: false, reason: ... }` for every
 *     documented skip path. Never throws on normal not-connected /
 *     not-scoped / disconnected / expired states.
 *   • Soft-disconnect aware: when the `google_ga4` token has
 *     `disconnected_at` set, returns `{ ok: false, reason:
 *     "disconnected" }` without making an API call.
 *   • Expiry-aware: uses the shared `evaluateExpiry` helper. A fresh
 *     token is used directly; a stale one is refreshed through the
 *     stored refresh token however long it sat idle.
 *   • Every call carries a 30 second timeout so a hung Google
 *     response can never pin a sync open.
 *   • No page-load calls: the public function is only invoked from
 *     server actions on `/settings/connectors`.
 */

import "server-only";

import {
  getGoogleConnectorToken,
  persistRefreshedGoogleToken,
} from "@/lib/connector-store";
import { refreshGoogleAccessToken } from "@/lib/connectors/google-auth";
import { evaluateExpiry } from "@/lib/connectors/gsc/expiry-handler";
import { log } from "@/lib/logger";

import type { Ga4ApiFetchResult } from "./types";

const REQUIRED_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
/** Same ceiling the GSC client uses; a hung Google response fails the call instead of the whole sync. */
const GA4_FETCH_TIMEOUT_MS = 30_000;

type Ga4ApiFetchArgs = {
  /** Tenant id explicitly threaded by the caller. No ambient reads. */
  tenantId: string;
  /** Fully-qualified URL of the GA4 / Admin API endpoint. Slice 9.A1
   *  uses ONLY `https://analyticsadmin.googleapis.com/v1beta/accountSummaries`. */
  url: string;
  /** Optional fetch init. Slice 9.A1 issues a GET with no body so
   *  the default suffices for the property picker. */
  init?: RequestInit;
  /** Optional clock injection for tests. Defaults to current time. */
  now?: Date;
};

/**
 * Authenticated fetch against the GA4 / Analytics Admin API. Returns
 * a structured result; never throws on normal not-connected /
 * not-scoped / disconnected / expired / API-error states.
 *
 * Generic over the response payload shape — callers narrow `data` to
 * the API-specific type. Slice 9.A1 callers narrow to the Admin API
 * `accountSummaries.list` response.
 */
export async function ga4ApiFetch<T = unknown>(
  args: Ga4ApiFetchArgs,
): Promise<Ga4ApiFetchResult<T>> {
  const { tenantId, url, init } = args;
  if (tenantId == null || tenantId === "") {
    return { ok: false, reason: "no_token", message: "missing tenantId" };
  }
  if (url == null || url === "") {
    return { ok: false, reason: "api_error", message: "missing url" };
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

  let accessToken = token.access_token;
  if (evaluateExpiry({ token, now: args.now ?? new Date() }) === "stale") {
    try {
      const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
        provider: "google_ga4",
        tenantId,
        connectedAt: token.connected_at,
      });
      accessToken = refreshed.access_token;
      // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): persist a rotated refresh token
      // best-effort so GA4 self-heals across rotation (fail-soft, changed
      // fields only).
      await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
    } catch (e) {
      log.warn("[ga4-client] token refresh failed; surfacing token_expired", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
      return { ok: false, reason: "token_expired" };
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${accessToken}`,
      },
      signal: AbortSignal.timeout(GA4_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    log.warn("[ga4-client] fetch threw; surfacing api_error", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: "api_error", message: "fetch threw" };
  }

  if (!response.ok) {
    if (response.status === 401) {
      // Single retry path mirrors the GSC client: attempt one fresh
      // refresh before giving up. Reuses the same refresh helper.
      try {
        const refreshed = await refreshGoogleAccessToken(token.refresh_token, {
          provider: "google_ga4",
          tenantId,
          connectedAt: token.connected_at,
        });
        // FIX 3 (OAUTH_ROOT_CAUSE_2026-07-09): a mid-request 401 refresh can
        // also carry a rotated refresh token — persist it best-effort.
        await persistRefreshedGoogleToken("google_ga4", refreshed, tenantId);
        const retry = await fetch(url, {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
            Authorization: `Bearer ${refreshed.access_token}`,
          },
          signal: AbortSignal.timeout(GA4_FETCH_TIMEOUT_MS),
        });
        if (retry.ok) {
          const data = (await retry.json().catch(() => null)) as T | null;
          if (data == null) {
            return { ok: false, reason: "api_error", message: "json parse" };
          }
          return { ok: true, data };
        }
        return {
          ok: false,
          reason: "token_expired",
          status: retry.status,
          message: "401 after refresh",
        };
      } catch (e) {
        log.warn("[ga4-client] 401 refresh retry failed", {
          tenantId,
          error: e instanceof Error ? e.message : String(e),
        });
        return { ok: false, reason: "token_expired" };
      }
    }
    // Slice 9.A2α (2026-05-19) — folds in the 9.A1β-deferred logging
    // fix. Mirrors the GSC client's non-2xx log line so the GA4
    // Admin API failure shape (e.g. Analytics Admin API not enabled
    // → 403 PERMISSION_DENIED) is no longer opaque. Bounded body
    // capture; tokens never logged.
    let errorBody = "";
    try {
      errorBody = (await response.text()).slice(0, 500);
    } catch {
      errorBody = "(body unavailable)";
    }
    log.warn("[ga4-client] non-2xx response from GA4 Admin API", {
      tenantId,
      status: response.status,
      body: errorBody,
    });
    return {
      ok: false,
      reason: "api_error",
      status: response.status,
      message: `non-2xx response`,
    };
  }

  let data: T | null;
  try {
    data = (await response.json()) as T;
  } catch (e) {
    log.warn("[ga4-client] response body parse failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, reason: "api_error", message: "json parse" };
  }
  if (data == null) {
    return { ok: false, reason: "api_error", message: "empty body" };
  }
  return { ok: true, data };
}

