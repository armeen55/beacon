"use server";

/**
 * 2026-06-09 — operator-only CallRail connect / refresh / disconnect
 * server actions (§9.B). The only entry points that store the key or
 * trigger an outbound CallRail HTTP call. NOT invoked on page load —
 * only on explicit operator clicks on `/diagnostics/callrail`.
 *
 * Posture (locked):
 *   • Operator-gated via `isOperatorModeServer()`. Non-operators get
 *     `{ ok: false, reason: "not_operator" }` and the action never
 *     stores a key, never reads the token, never makes an HTTP call.
 *   • Tenant scope explicit via `currentTenantId()`.
 *   • Connect needs BOTH the API key and the account id (CallRail
 *     scopes every call under `/v3/a/{account_id}/`).
 *   • Disconnect is SOFT (sets `disconnected_at`) so cached call
 *     attribution survives a key being rotated.
 *   • Refresh needs no domain — CallRail attributes by landing page URL
 *     across the whole account, so the whole account is pulled.
 *   • All returns are operator-readable discriminated unions.
 *
 * Pinned by tests/app/diagnostics/callrail-actions.test.ts.
 */

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import {
  saveConnectorToken,
  updateConnectorToken,
} from "@/lib/connector-store";
import { refreshCallRailCalls } from "@/lib/connectors/callrail/persist-url-calls";

const ROUTE = "/diagnostics/callrail";

export type ConnectCallRailResult =
  | { ok: true }
  | { ok: false; reason: "not_operator" | "missing_key" | "missing_account" };

export async function connectCallRail(
  formData: FormData,
): Promise<ConnectCallRailResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const accountId = String(formData.get("account_id") ?? "").trim();
  if (apiKey === "") return { ok: false, reason: "missing_key" };
  if (accountId === "") return { ok: false, reason: "missing_account" };

  const tenantId = await currentTenantId();
  await saveConnectorToken(
    {
      provider: "callrail",
      api_key: apiKey,
      account_id: accountId,
      connected_at: new Date().toISOString(),
    },
    tenantId,
  );
  revalidatePath(ROUTE);
  return { ok: true };
}

export type RefreshCallRailActionResult =
  | { ok: true; persisted: boolean; rowsUpserted: number }
  | {
      ok: false;
      reason: "not_operator" | "no_key" | "disconnected" | "api_error" | "empty";
      detail?: string;
    };

export async function refreshCallRailMetrics(): Promise<RefreshCallRailActionResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const tenantId = await currentTenantId();

  const res = await refreshCallRailCalls({ tenantId });
  if (!res.ok) return { ok: false, reason: res.reason, detail: res.detail };
  revalidatePath(ROUTE);
  return { ok: true, persisted: res.persisted, rowsUpserted: res.rowsUpserted };
}

export type DisconnectCallRailResult =
  | { ok: true }
  | { ok: false; reason: "not_operator" };

export async function disconnectCallRail(): Promise<DisconnectCallRailResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const tenantId = await currentTenantId();
  await updateConnectorToken(
    "callrail",
    { disconnected_at: new Date().toISOString() },
    tenantId,
  );
  revalidatePath(ROUTE);
  return { ok: true };
}

// ── Void-returning <form action> wrappers (the page binds these) ──────
export async function connectCallRailFromForm(formData: FormData): Promise<void> {
  await connectCallRail(formData);
}
export async function refreshCallRailFromForm(_formData: FormData): Promise<void> {
  await refreshCallRailMetrics();
}
export async function disconnectCallRailFromForm(_formData: FormData): Promise<void> {
  await disconnectCallRail();
}
