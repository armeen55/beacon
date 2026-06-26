import "server-only";

/**
 * 2026-06-09 — CallRail API client (§9.B).
 *
 * Token-header auth (`Authorization: Token token={key}`), JSON response,
 * scoped to the operator's account: GET /v3/a/{account_id}/calls.json.
 * Mirrors the GA4 connector discipline:
 *   • Server-only; key never returned to the client, never logged.
 *   • Tenant-scoped: key + account read for `tenantId` only.
 *   • Fail-soft: no key / disconnected / non-2xx / network → discriminated
 *     `{ ok: false, reason }`, never a throw (a CallRail outage must never
 *     break an outcome render).
 * `deps.fetchImpl` + `deps.token` are test seams — production omits both.
 */

import { getCallRailConnectorToken } from "@/lib/connector-store";
import type { CallRailCall } from "./types";

export const CALLRAIL_BASE_URL = "https://api.callrail.com";

export type CallRailTokenLike = {
  api_key: string;
  account_id: string;
  disconnected_at?: string;
};

export type CallRailFetchDeps = {
  fetchImpl?: typeof fetch;
  /** `undefined` → read connector-store. `null` → simulate no key. */
  token?: CallRailTokenLike | null;
};

export type CallRailRawResult =
  | { ok: true; calls: CallRailCall[] }
  | {
      ok: false;
      reason: "no_key" | "disconnected" | "api_error";
      detail?: string;
    };

function toCall(raw: unknown): CallRailCall {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    landingPageUrl:
      typeof r.landing_page_url === "string" ? r.landing_page_url : null,
    answered: r.answered === true,
    durationSec: typeof r.duration === "number" ? r.duration : 0,
    leadStatus: typeof r.lead_status === "string" ? r.lead_status : null,
    startTimeIso: typeof r.start_time === "string" ? r.start_time : null,
  };
}

/**
 * Fetch calls for the account over a date range. Fail-soft.
 */
export async function callrailFetchCalls(
  args: {
    tenantId: string;
    startDate?: string; // YYYY-MM-DD
    endDate?: string; // YYYY-MM-DD
    perPage?: number;
  },
  deps: CallRailFetchDeps = {},
): Promise<CallRailRawResult> {
  const token =
    deps.token !== undefined
      ? deps.token
      : await getCallRailConnectorToken(args.tenantId);

  if (token == null || token.api_key === "" || token.account_id === "") {
    return { ok: false, reason: "no_key" };
  }
  if (token.disconnected_at != null && token.disconnected_at !== "") {
    return { ok: false, reason: "disconnected" };
  }

  const url = new URL(
    `/v3/a/${encodeURIComponent(token.account_id)}/calls.json`,
    CALLRAIL_BASE_URL,
  );
  url.searchParams.set(
    "fields",
    "landing_page_url,answered,duration,lead_status,start_time",
  );
  url.searchParams.set("per_page", String(args.perPage ?? 250));
  if (args.startDate != null) url.searchParams.set("start_date", args.startDate);
  if (args.endDate != null) url.searchParams.set("end_date", args.endDate);
  if (args.startDate == null && args.endDate == null) {
    url.searchParams.set("date_range", "recent");
  }

  const doFetch = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url.toString(), {
      headers: { Authorization: `Token token=${token.api_key}` },
    });
  } catch (e) {
    return {
      ok: false,
      reason: "api_error",
      detail: e instanceof Error ? e.message : "network error",
    };
  }
  if (!res.ok) {
    return { ok: false, reason: "api_error", detail: `HTTP ${res.status}` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, reason: "api_error", detail: "unparseable JSON" };
  }
  const rawCalls = (body as { calls?: unknown }).calls;
  if (!Array.isArray(rawCalls)) {
    return { ok: false, reason: "api_error", detail: "missing calls array" };
  }
  return { ok: true, calls: rawCalls.map(toCall) };
}
