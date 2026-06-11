"use server";

/**
 * 2026-06-10 — operator-only Wix connect / collection-config / url-map
 * sync (§push layer). Only entry points that store the key or hit Wix.
 * Operator-gated; tenant-scoped; mirrors the SEMrush/CallRail actions.
 */

import { revalidatePath } from "next/cache";

import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { currentTenantId } from "@/lib/tenant-context";
import {
  saveConnectorToken,
  updateConnectorToken,
} from "@/lib/connector-store";
import {
  getWixCollectionConfig,
  saveWixCollectionConfig,
  syncWixUrlMap,
} from "@/lib/connectors/wix/url-map";
import type { WixCollectionMapping } from "@/lib/connectors/wix/types";

const ROUTE = "/diagnostics/wix";

export type ConnectWixResult =
  | { ok: true }
  | { ok: false; reason: "not_operator" | "missing_key" | "missing_site" };

export async function connectWix(formData: FormData): Promise<ConnectWixResult> {
  // Audit #11/#12: per-tenant publish authorization, not a global flag.
  if (!(await canPublishForCurrentTenant())) return { ok: false, reason: "not_operator" };
  const apiKey = String(formData.get("api_key") ?? "").trim();
  const siteId = String(formData.get("site_id") ?? "").trim();
  if (apiKey === "") return { ok: false, reason: "missing_key" };
  if (siteId === "") return { ok: false, reason: "missing_site" };
  const tenantId = await currentTenantId();
  await saveConnectorToken(
    { provider: "wix", api_key: apiKey, site_id: siteId, connected_at: new Date().toISOString() },
    tenantId,
  );
  revalidatePath(ROUTE);
  return { ok: true };
}

export type SaveWixMappingResult =
  | { ok: true; collections: number }
  | { ok: false; reason: "not_operator" | "bad_json" };

/** Operator pastes a JSON array of WixCollectionMapping rows. */
export async function saveWixMappings(formData: FormData): Promise<SaveWixMappingResult> {
  if (!(await canPublishForCurrentTenant())) return { ok: false, reason: "not_operator" };
  const raw = String(formData.get("mappings_json") ?? "[]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "bad_json" };
  }
  if (!Array.isArray(parsed)) return { ok: false, reason: "bad_json" };
  const rows: WixCollectionMapping[] = [];
  for (const r of parsed) {
    if (r == null || typeof r !== "object") continue;
    const m = r as Record<string, unknown>;
    if (
      typeof m.dataCollectionId === "string" &&
      typeof m.slugField === "string" &&
      typeof m.urlPrefix === "string"
    ) {
      rows.push({
        dataCollectionId: m.dataCollectionId,
        slugField: m.slugField,
        urlPrefix: m.urlPrefix,
        ...(typeof m.labelField === "string" ? { labelField: m.labelField } : {}),
      });
    }
  }
  await saveWixCollectionConfig(rows);
  revalidatePath(ROUTE);
  return { ok: true, collections: rows.length };
}

export type SyncWixResult =
  | { ok: true; collections: number; itemsMapped: number; errors: string[] }
  | { ok: false; reason: "not_operator" | "no_domain" | "sync_failed"; errors?: string[] };

export async function syncWixMap(): Promise<SyncWixResult> {
  if (!(await canPublishForCurrentTenant())) return { ok: false, reason: "not_operator" };
  const tenantId = await currentTenantId();
  const { getBusinessConfig } = await import("@/lib/business-config");
  const domain = (getBusinessConfig(tenantId).domain ?? "").trim();
  if (domain === "") return { ok: false, reason: "no_domain" };
  const result = await syncWixUrlMap(
    { siteBaseUrl: `https://www.${domain.replace(/^www\./, "")}` },
    { tenantId },
  );
  revalidatePath(ROUTE);
  if (!result.ok) return { ok: false, reason: "sync_failed", errors: result.errors };
  return { ok: true, collections: result.collections, itemsMapped: result.itemsMapped, errors: result.errors };
}

export async function disconnectWix(): Promise<{ ok: boolean }> {
  if (!(await canPublishForCurrentTenant())) return { ok: false };
  const tenantId = await currentTenantId();
  await updateConnectorToken("wix", { disconnected_at: new Date().toISOString() }, tenantId);
  revalidatePath(ROUTE);
  return { ok: true };
}

// ── Void <form action> wrappers ──────────────────────────────────────
export async function connectWixFromForm(formData: FormData): Promise<void> {
  await connectWix(formData);
}
export async function saveWixMappingsFromForm(formData: FormData): Promise<void> {
  await saveWixMappings(formData);
}
export async function syncWixMapFromForm(_formData: FormData): Promise<void> {
  await syncWixMap();
}
export async function disconnectWixFromForm(_formData: FormData): Promise<void> {
  await disconnectWix();
}

/** Page helper (server import) — current mappings for display. */
export async function readWixMappings(): Promise<WixCollectionMapping[]> {
  return getWixCollectionConfig();
}

// ── Approve & Push (per-card, explicit click — Invariant 1) ──────────
export async function approveAndPushFromForm(formData: FormData): Promise<void> {
  const editId = String(formData.get("edit_id") ?? "");
  if (editId === "") return;
  const { approveAndPushRecommendedEdit } = await import(
    "@/app/(shell)/recommendations/actions"
  );
  await approveAndPushRecommendedEdit({ editId });
  revalidatePath(ROUTE);
}
