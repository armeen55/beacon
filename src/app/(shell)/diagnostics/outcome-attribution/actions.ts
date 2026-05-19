"use server";

/**
 * 2026-05-19 — Slice 9.A2γ — operator-only GA4 traffic refresh
 * server action.
 *
 * Single export: `refreshTenantGa4Traffic`. The only entry point
 * that triggers an outbound GA4 Data API HTTP call. NOT invoked on
 * page load — only on explicit operator click of the
 * "Refresh GA4 traffic" button on `/diagnostics/outcome-attribution`.
 *
 * Posture (locked):
 *   • Operator-gated via `isOperatorModeServer()`. Non-operator
 *     callers receive `{ ok: false, reason: "not_operator" }` and
 *     the action never reaches the persist helper, never reads the
 *     GA4 token, never makes any HTTP call.
 *   • Tenant scope explicit: `currentTenantId()` resolved once,
 *     threaded through every downstream call.
 *   • Connector required: `getGoogleConnectorToken("ga4", tenantId)`
 *     must return a token AND the token must have a
 *     `ga4_property_id` selected. Both fail-soft cases return
 *     structured discriminator values.
 *   • Date range computed via the pure
 *     `computeRefreshDateRange(edits, now)` helper (90-day default,
 *     expandable to min(live_at) within a 180-day cap).
 *   • On success: `revalidatePath("/diagnostics/outcome-attribution")`
 *     so the page re-renders with updated counters + cached rows.
 *   • Returns a discriminated `RefreshGa4TrafficActionResult`.
 *
 * Customer-vocab discipline:
 *   • Operator-only file. Customer surfaces NEVER import this.
 *   • Returned messages are operator-readable; none of the K5
 *     forbidden tokens (`drove` / `caused` / `revenue` / `dollars`
 *     / `$` / `generated` / `ROI` / `sales` / `leads`) appear.
 *
 * Pinned by:
 *   • tests/app/diagnostics/outcome-attribution-actions.test.ts
 *   • tests/architecture/outcome-attribution-refresh-operator-only.test.ts
 *   • tests/architecture/outcome-attribution-refresh-no-customer-surface.test.ts
 */

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { getGoogleConnectorToken } from "@/lib/connector-store";
import { getRepository } from "@/lib/persistence/repositories";
import { log } from "@/lib/logger";
import {
  computeRefreshDateRange,
  persistGa4UrlTraffic,
  type PersistGa4UrlTrafficFailReason,
  type PersistGa4UrlTrafficResult,
} from "@/lib/connectors/ga4/persist-url-traffic";

/**
 * Discriminated result for the operator-triggered refresh.
 *
 * Failure reasons:
 *   • not_operator         — guard short-circuit; no HTTP, no DB
 *   • no_token             — no `google_ga4` connector token row
 *   • no_property          — token present but no `ga4_property_id`
 *   • token_expired        — passthrough from persist helper
 *   • disconnected         — passthrough (soft-disconnected token)
 *   • api_error            — passthrough (Data API non-2xx or thrown)
 *   • admin_unavailable    — passthrough (Supabase admin init failed)
 *   • persist_failed       — passthrough (upsert error)
 *   • invalid_args         — passthrough (defensive; should not fire)
 */
export type RefreshGa4TrafficActionResult =
  | {
      ok: true;
      rows_fetched: number;
      rows_upserted: number;
      startDate: string;
      endDate: string;
    }
  | {
      ok: false;
      reason:
        | "not_operator"
        | "no_property"
        | PersistGa4UrlTrafficFailReason;
      status?: number;
      message?: string;
    };

export async function refreshTenantGa4Traffic(): Promise<RefreshGa4TrafficActionResult> {
  const t0 = Date.now();

  if (!isOperatorModeServer()) {
    log.warn("[refresh-ga4-traffic] non-operator caller blocked", {});
    return { ok: false, reason: "not_operator" };
  }

  const tenantId = await currentTenantId();
  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) {
    log.info("[refresh-ga4-traffic] no GA4 connector token", { tenantId });
    return {
      ok: false,
      reason: "no_token",
      message: "GA4 connector not connected for this tenant",
    };
  }
  const propertyId = token.ga4_property_id;
  if (propertyId == null || propertyId === "") {
    log.info("[refresh-ga4-traffic] no GA4 property selected", { tenantId });
    return {
      ok: false,
      reason: "no_property",
      message: "GA4 property not selected — connect via /settings/connectors",
    };
  }

  const repo = getRepository().forTenant(tenantId);
  const edits = await repo.getRecommendedEdits();
  const { startDate, endDate } = computeRefreshDateRange(edits, new Date());

  log.info("[refresh-ga4-traffic] refresh started", {
    tenantId,
    propertyId,
    startDate,
    endDate,
    editsConsidered: edits.length,
  });

  const result: PersistGa4UrlTrafficResult = await persistGa4UrlTraffic({
    tenantId,
    propertyId,
    startDate,
    endDate,
  });

  if (result.ok) {
    log.info("[refresh-ga4-traffic] refresh completed", {
      tenantId,
      rows_fetched: result.rows_fetched,
      rows_upserted: result.rows_upserted,
      durationMs: Date.now() - t0,
    });
    revalidatePath("/diagnostics/outcome-attribution");
    return result;
  }

  log.warn("[refresh-ga4-traffic] refresh failed", {
    tenantId,
    reason: result.reason,
    message: result.message ?? null,
    status: result.status ?? null,
    durationMs: Date.now() - t0,
  });
  return result;
}

/**
 * Thin form-binding wrapper. Used as `<form action={...}>` from the
 * diagnostic page. React's `<form action>` prop expects
 * `(formData: FormData) => void | Promise<void>`; the underlying
 * `refreshTenantGa4Traffic` returns a structured discriminator for
 * direct programmatic + test use, so this wrapper adapts the
 * signature without losing the action's typed return shape.
 *
 * The FormData parameter is unused — the action takes no caller
 * input; tenant + property are derived server-side via
 * `currentTenantId()` + `getGoogleConnectorToken("ga4", ...)`.
 */
export async function refreshTenantGa4TrafficFromForm(
  _formData: FormData,
): Promise<void> {
  await refreshTenantGa4Traffic();
}
