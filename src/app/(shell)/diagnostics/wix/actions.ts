"use server";

/**
 * 2026-06-10 — operator-only Wix connect / collection-config / url-map
 * sync (§push layer). Only entry points that store the key or hit Wix.
 * Operator-gated; tenant-scoped; mirrors the CallRail actions.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
import {
  wixListDataCollections,
  isProtectedUrlField,
} from "@/lib/connectors/wix/client";
import { suggestCollectionMapping } from "@/lib/connectors/wix/suggest-mapping";
import type {
  WixCollectionMapping,
  WixDiscoveredCollection,
} from "@/lib/connectors/wix/types";

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
      // Content-push slice (2026-06-13): pass through the optional
      // contentFieldRoles map (title/heading/description → CMS field) so
      // live content pushes can be enabled per collection. Only non-empty
      // string fields are kept; an empty/absent map = paste-ready.
      // `description` maps edit_meta → the field the page's meta-desc SEO
      // Variable references (Wix dynamic-page SEO).
      let contentFieldRoles:
        | WixCollectionMapping["contentFieldRoles"]
        | undefined;
      if (m.contentFieldRoles != null && typeof m.contentFieldRoles === "object") {
        const cfr = m.contentFieldRoles as Record<string, unknown>;
        const roles: { title?: string; heading?: string; description?: string } = {};
        if (typeof cfr.title === "string" && cfr.title.trim() !== "") {
          roles.title = cfr.title.trim();
        }
        if (typeof cfr.heading === "string" && cfr.heading.trim() !== "") {
          roles.heading = cfr.heading.trim();
        }
        if (typeof cfr.description === "string" && cfr.description.trim() !== "") {
          roles.description = cfr.description.trim();
        }
        if (roles.title != null || roles.heading != null || roles.description != null) {
          contentFieldRoles = roles;
        }
      }
      rows.push({
        dataCollectionId: m.dataCollectionId,
        slugField: m.slugField,
        urlPrefix: m.urlPrefix,
        ...(typeof m.labelField === "string" ? { labelField: m.labelField } : {}),
        ...(contentFieldRoles != null ? { contentFieldRoles } : {}),
      });
    }
  }
  await saveWixCollectionConfig(rows);
  revalidatePath(ROUTE);
  return { ok: true, collections: rows.length };
}

// ── Guided collection-mapper (Phase 2, MAX_SEO_AEO audit P0 #2) ──────
//
// READ-ONLY discovery: list the connected site's collections + fields,
// pre-fill a suggested mapping for each, and flag whether it's already
// mapped. The operator confirms/overrides per collection, then Save merges
// into the durable config. No Wix writes; no hardcoding — pure heuristics
// over the actual discovered fields, ambient-tenant scoped via the store.

/** One discovered collection paired with its heuristic suggestion + a flag
 *  for whether the durable config already maps it. Drives the guided UI. */
export type GuidedCollectionRow = {
  collection: WixDiscoveredCollection;
  suggestion: WixCollectionMapping;
  /** The operator's CURRENT saved mapping for this collection, if any (so
   *  the form pre-fills the saved values over the fresh suggestion). */
  saved: WixCollectionMapping | null;
  alreadyMapped: boolean;
};

export type DiscoverGuidedResult =
  | { ok: true; rows: GuidedCollectionRow[] }
  | {
      ok: false;
      reason: "not_operator" | "no_key" | "disconnected" | "api_error";
      detail?: string;
    };

/**
 * Page helper (server import): run read-only discovery, compute a suggestion
 * for each collection, and mark which are already mapped in the durable
 * config. Pure-ish: the only I/O is the read-only Wix list + the config read.
 */
export async function discoverGuidedCollections(): Promise<DiscoverGuidedResult> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "not_operator" };
  }
  const listed = await wixListDataCollections();
  if (!listed.ok) {
    // no_key / disconnected / api_error → surface the honest reason.
    const reason =
      listed.reason === "no_key" || listed.reason === "disconnected"
        ? listed.reason
        : "api_error";
    return { ok: false, reason, detail: listed.detail };
  }
  const config = await getWixCollectionConfig().catch(() => []);
  const savedByCollection = new Map(
    config.map((m) => [m.dataCollectionId, m] as const),
  );
  const rows: GuidedCollectionRow[] = listed.value.map((collection) => {
    const saved = savedByCollection.get(collection.id) ?? null;
    return {
      collection,
      suggestion: suggestCollectionMapping(collection),
      saved,
      alreadyMapped: saved != null,
    };
  });
  return { ok: true, rows };
}

/**
 * Operator-triggered discover button. Discovery is idempotent + read-only, so
 * rather than stash a large payload, we redirect to `?discover=1`; the page
 * re-runs `discoverGuidedCollections()` to render the guided forms.
 */
export async function discoverWixCollectionsFromForm(
  _formData: FormData,
): Promise<void> {
  if (!(await canPublishForCurrentTenant())) return;
  redirect(`${ROUTE}?discover=1`);
}

export type SaveGuidedMappingResult =
  | { ok: true; collections: number }
  | { ok: false; reason: "not_operator" | "missing_collection" };

/**
 * Save ONE collection's mapping from the guided form, MERGING into the
 * existing durable config (replace the row for this dataCollectionId, keep
 * every other tenant row). Content-role values that are URL/slug/link fields
 * are dropped here too (the push layer refuses them — never persist a
 * slug-ish field as a content role). Tenant scope is ambient via the store.
 */
export async function saveGuidedMapping(
  formData: FormData,
): Promise<SaveGuidedMappingResult> {
  if (!(await canPublishForCurrentTenant())) {
    return { ok: false, reason: "not_operator" };
  }
  const dataCollectionId = String(formData.get("dataCollectionId") ?? "").trim();
  if (dataCollectionId === "") {
    return { ok: false, reason: "missing_collection" };
  }
  const slugField = String(formData.get("slugField") ?? "").trim();
  const urlPrefix = String(formData.get("urlPrefix") ?? "").trim();
  const labelField = String(formData.get("labelField") ?? "").trim();

  const roleTitle = String(formData.get("roleTitle") ?? "").trim();
  const roleHeading = String(formData.get("roleHeading") ?? "").trim();
  const roleDescription = String(formData.get("roleDescription") ?? "").trim();
  // Never persist a URL/slug/link field as a content role (push refuses it).
  const roles: { title?: string; heading?: string; description?: string } = {};
  if (roleTitle !== "" && !isProtectedUrlField(roleTitle)) roles.title = roleTitle;
  if (roleHeading !== "" && !isProtectedUrlField(roleHeading)) {
    roles.heading = roleHeading;
  }
  if (roleDescription !== "" && !isProtectedUrlField(roleDescription)) {
    roles.description = roleDescription;
  }
  const contentFieldRoles =
    roles.title != null || roles.heading != null || roles.description != null
      ? roles
      : undefined;

  const next: WixCollectionMapping = {
    dataCollectionId,
    // slug/url default to sensible non-empty values so a partially-filled
    // form still produces a well-formed row.
    slugField: slugField === "" ? "slug" : slugField,
    urlPrefix: urlPrefix === "" ? "/" : urlPrefix,
    ...(labelField !== "" ? { labelField } : {}),
    ...(contentFieldRoles != null ? { contentFieldRoles } : {}),
  };

  const existing = await getWixCollectionConfig().catch(() => []);
  const merged = existing.filter((m) => m.dataCollectionId !== dataCollectionId);
  merged.push(next);
  await saveWixCollectionConfig(merged);
  revalidatePath(ROUTE);
  return { ok: true, collections: merged.length };
}

export async function saveGuidedMappingFromForm(
  formData: FormData,
): Promise<void> {
  await saveGuidedMapping(formData);
}

export type SyncWixResult =
  | { ok: true; collections: number; itemsMapped: number; errors: string[] }
  | { ok: false; reason: "not_operator" | "no_domain" | "sync_failed"; errors?: string[] };

export async function syncWixMap(): Promise<SyncWixResult> {
  if (!(await canPublishForCurrentTenant())) return { ok: false, reason: "not_operator" };
  const tenantId = await currentTenantId();
  const { getBusinessConfig, hydrateBusinessConfigFromSupabase } = await import("@/lib/business-config");
  // 2026-06-26: resolve via the Supabase-backed config. This is a SERVER ACTION,
  // so the shell layout's business-config hydrate never ran — the sync
  // getBusinessConfig returns a placeholder (empty domain) for a Supabase-only
  // tenant (e.g. Iranopedia), which would block the Wix mapper with "no_domain"
  // even though the domain is set in the DB. (Same fix class as GA4/Profound.)
  const cfg = (await hydrateBusinessConfigFromSupabase(tenantId)) ?? getBusinessConfig(tenantId);
  const domain = (cfg.domain ?? "").trim();
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

// ── Revert (#82, 2026-06-11) — restore the pre-push field value ──────
// Explicit operator click; ships through the SAME executePush (caps,
// non-destructive guard, ledger all apply). Empty previous values
// refuse (deletion-shaped restores need a human in Wix).
export async function revertPushFromForm(formData: FormData): Promise<void> {
  if (!(await canPublishForCurrentTenant())) return;
  const editId = String(formData.get("edit_id") ?? "");
  if (editId === "") return;
  const tenantId = await currentTenantId();

  const { getRepository } = await import("@/lib/persistence/repositories");
  const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  const original = edits.find((e) => e.id === editId);
  if (!original) return;

  const { findLatestSnapshotForEdit, buildRevertEdit } = await import(
    "@/domains/push/push-snapshots"
  );
  const snapshot = await findLatestSnapshotForEdit(tenantId, editId);
  if (!snapshot) return;
  const revert = buildRevertEdit(snapshot, original, new Date());
  if (!revert.ok) return;

  const { executePush } = await import("@/domains/push/push-service");
  // wave-11 (2026-06-14): surface the revert outcome. Previously the result
  // was discarded, so a REFUSED revert (daily cap / non-destructive guard /
  // freeze) failed SILENTLY — the operator saw nothing. This action returns
  // void (form contract), so log loudly rather than swallow: a refused revert
  // is now visible in the server logs instead of vanishing.
  const pushResult = await executePush({ tenantId, edit: revert.edit });
  if (pushResult.kind === "refused") {
    console.warn(
      `[wix-revert] revert push REFUSED for edit ${editId}: ${pushResult.reason}`,
    );
  } else {
    console.log(`[wix-revert] revert push for edit ${editId}: ${pushResult.kind}`);
  }
  revalidatePath(ROUTE);
}

// ── Batch accept (#84, 2026-06-11) — ACCEPT-ONLY, never pushes ───────
// Flips up to 20 queued (status "recommended") cards to "accepted" in
// one click: for Ritz this is "approve the morning ticket stack"; for
// Wix tenants it stages cards for the per-card Approve & Push below
// (publishing stays strictly one explicit click per card — the
// master-goal invariant is untouched).
export async function acceptAllQueuedFromForm(_formData: FormData): Promise<void> {
  if (!(await canPublishForCurrentTenant())) return;
  const tenantId = await currentTenantId();
  const { getRepository } = await import("@/lib/persistence/repositories");
  const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  const ids = edits
    .filter((e) => (e.implementation_status ?? "recommended") === "recommended")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20)
    .map((e) => e.id);
  if (ids.length === 0) return;
  const { markRecommendedEditsAccepted } = await import(
    "@/domains/recommendations/recommended-edits-persistence"
  );
  await markRecommendedEditsAccepted({ editIds: ids, tenantId });
  revalidatePath(ROUTE);
}
