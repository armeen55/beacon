"use server";

/**
 * 2026-06-09 — operator-only Semrush connect / refresh / disconnect
 * server actions. The only entry points that store the key or trigger
 * an outbound Semrush HTTP call. NOT invoked on page load — only on
 * explicit operator clicks on `/diagnostics/semrush`.
 *
 * Posture (locked, mirrors the GA4 refresh action):
 *   • Operator-gated via `isOperatorModeServer()`. Non-operators get
 *     `{ ok: false, reason: "not_operator" }` and the action never
 *     stores a key, never reads the token, never makes an HTTP call.
 *   • Tenant scope explicit via `currentTenantId()`.
 *   • Disconnect is SOFT (sets `disconnected_at`) so cached metrics
 *     survive a week-limited key expiring.
 *   • All returns are operator-readable discriminated unions.
 *
 * Pinned by tests/app/diagnostics/semrush-actions.test.ts.
 */

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import {
  saveConnectorToken,
  updateConnectorToken,
} from "@/lib/connector-store";
import { getBusinessConfigForCurrentTenant } from "@/lib/business-config";
import { refreshSemrushDomainMetrics } from "@/lib/connectors/semrush/persist-domain-metrics";

const ROUTE = "/diagnostics/semrush";

export type ConnectSemrushResult =
  | { ok: true }
  | { ok: false; reason: "not_operator" | "missing_key" };

export async function connectSemrush(
  formData: FormData,
): Promise<ConnectSemrushResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const database = String(formData.get("database") ?? "us").trim() || "us";
  if (apiKey === "") return { ok: false, reason: "missing_key" };

  const tenantId = await currentTenantId();
  await saveConnectorToken(
    {
      provider: "semrush",
      api_key: apiKey,
      database,
      connected_at: new Date().toISOString(),
    },
    tenantId,
  );
  revalidatePath(ROUTE);
  return { ok: true };
}

export type RefreshSemrushActionResult =
  | { ok: true; persisted: boolean; competitorCount: number }
  | {
      ok: false;
      reason: "not_operator" | "no_domain" | "no_key" | "disconnected" | "api_error" | "empty";
      detail?: string;
    };

export async function refreshSemrushMetrics(): Promise<RefreshSemrushActionResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const tenantId = await currentTenantId();
  const config = await getBusinessConfigForCurrentTenant();
  const domain = (config.domain ?? "").trim();
  if (domain === "") return { ok: false, reason: "no_domain" };

  const res = await refreshSemrushDomainMetrics({ tenantId, domain });
  if (!res.ok) return { ok: false, reason: res.reason, detail: res.detail };
  revalidatePath(ROUTE);
  return {
    ok: true,
    persisted: res.persisted,
    competitorCount: res.snapshot.organic_competitors.length,
  };
}

export type DisconnectSemrushResult =
  | { ok: true }
  | { ok: false; reason: "not_operator" };

export async function disconnectSemrush(): Promise<DisconnectSemrushResult> {
  if (!isOperatorModeServer()) return { ok: false, reason: "not_operator" };
  const tenantId = await currentTenantId();
  await updateConnectorToken(
    "semrush",
    { disconnected_at: new Date().toISOString() },
    tenantId,
  );
  revalidatePath(ROUTE);
  return { ok: true };
}

// ── Void-returning <form action> wrappers (the page binds these) ──────
export async function connectSemrushFromForm(formData: FormData): Promise<void> {
  await connectSemrush(formData);
}
export async function refreshSemrushFromForm(_formData: FormData): Promise<void> {
  await refreshSemrushMetrics();
}
export async function disconnectSemrushFromForm(_formData: FormData): Promise<void> {
  await disconnectSemrush();
}
