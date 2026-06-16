import "server-only";

/**
 * 2026-06-16 — durable Wix mappings store (MAX_SEO_AEO audit P0 Phase 1).
 *
 * The Wix url-map + collection config used to live ONLY in the file store
 * (`.data/*.json` via json-store). On Vercel that file store updates an
 * in-process cache that is LOST on lambda recycle — so a connected tenant's
 * collection mappings + derived url-map were ephemeral, which blocks safe
 * Wix publishing (the push service resolves a card's target_url through the
 * url-map before any write; an empty map refuses every field-edit card).
 *
 * This module is the durable, tenant-scoped substrate. It mirrors the
 * `connector-store.ts` posture:
 *   • Reads/writes go through the Supabase service-role admin client
 *     (`getSupabaseAdmin()`), tenant-scoped on EVERY query (`.eq("tenant_id", tid)`).
 *   • `tenant_id` is stamped on EVERY written row — never another tenant's.
 *   • Tenant is ALWAYS the ambient request tenant (`currentTenantId()`), the
 *     same one the file store routes by. There is NO explicit-tenant override:
 *     the file-fallback path is ambient-only, so accepting an explicit tenant
 *     for Supabase but silently using the ambient tenant for the file fallback
 *     would be a cross-tenant foot-gun. Ambient-only keeps both paths in lockstep.
 *
 * FILE FALLBACK (so no-env local dev + pre-migration hosted = today's behavior):
 *   • `getSupabaseAdmin()` throws (Supabase env not configured) → fall back to
 *     the file store (readStore/writeStore) — local dev keeps working unchanged.
 *     Resolved BEFORE the tenant in every function so a no-context call soft-falls
 *     to the file store instead of throwing on tenant resolution.
 *   • PostgREST `42P01` undefined_table → fall back to the file store — the
 *     deploy window where code is live but `migrations/2026-06-16_wix_mappings.sql`
 *     hasn't applied yet keeps working unchanged.
 *
 * DURABLE REPLACE (non-destructive): writes UPSERT the desired rows on the
 * composite PK, THEN delete only the tenant's now-absent keys. A transient
 * write failure therefore NEVER leaves a tenant emptier than before (the prior
 * rows survive until successfully overwritten) — the url-map is sync-derived
 * and not re-pasteable, so an atomic-feeling replace is essential. (Replaces
 * the original delete-then-insert, which could wipe the map on a failed insert.)
 *
 * On a healthy Supabase write we ALSO mirror the desired state to the file
 * store (best-effort, swallowing file errors — a no-op on Vercel's read-only
 * FS) so local parity holds and a later env loss reads the last-known state.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { WixCollectionMapping, WixUrlMapEntry } from "./types";

const CONFIG_TABLE = "wix_collection_config";
const MAP_TABLE = "wix_url_map";

/** File-store names (the pre-migration substrate; still the fallback). */
const CONFIG_STORE = "wix-collection-config";
const MAP_STORE = "wix-url-map";

// ─────────────────────────────────────────────────────────────────────
// Helpers (replicated from connector-store.ts — same posture)
// ─────────────────────────────────────────────────────────────────────

function isUndefinedTableError(error: unknown): boolean {
  // PostgREST surfaces `code: "42P01"` on undefined_table — the table
  // hasn't been migrated to prod yet → fall back to the file store.
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown };
  return typeof e.code === "string" && e.code === "42P01";
}

/** Best-effort file mirror — swallows errors (no-op on Vercel read-only FS). */
async function mirrorToFile<T>(store: string, rows: T[]): Promise<void> {
  try {
    await writeStore(store, rows);
  } catch {
    // File mirror is best-effort local parity only; never block the
    // durable Supabase write on a file error (e.g. Vercel read-only FS).
  }
}

// ─────────────────────────────────────────────────────────────────────
// Row mappers (DB snake_case ⇄ domain camelCase)
// ─────────────────────────────────────────────────────────────────────

type ConfigRow = {
  tenant_id: string;
  data_collection_id: string;
  slug_field: string;
  url_prefix: string;
  label_field: string | null;
  /** Page-role → CMS-field map enabling live content push. jsonb column. */
  content_field_roles: WixCollectionMapping["contentFieldRoles"] | null;
};

type MapRow = {
  tenant_id: string;
  url: string;
  data_collection_id: string;
  data_item_id: string;
  slug_field: string;
  label: string | null;
  synced_at: string;
};

function configRowToMapping(row: ConfigRow): WixCollectionMapping {
  return {
    dataCollectionId: row.data_collection_id,
    slugField: row.slug_field,
    urlPrefix: row.url_prefix,
    ...(row.label_field != null ? { labelField: row.label_field } : {}),
    ...(row.content_field_roles != null
      ? { contentFieldRoles: row.content_field_roles }
      : {}),
  };
}

function mapRowToEntry(row: MapRow): WixUrlMapEntry {
  return {
    url: row.url,
    dataCollectionId: row.data_collection_id,
    dataItemId: row.data_item_id,
    slugField: row.slug_field,
    label: row.label,
    syncedAt: row.synced_at,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Collection config
// ─────────────────────────────────────────────────────────────────────

export async function getWixCollectionConfig(): Promise<WixCollectionMapping[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return await readFileConfig(); // no Supabase env (local dev) → file store
  }
  const tid = await currentTenantId();
  const { data, error } = await admin
    .from(CONFIG_TABLE)
    .select("*")
    .eq("tenant_id", tid);
  if (error != null) {
    if (isUndefinedTableError(error)) return await readFileConfig();
    throw new Error(
      `wix-mappings-store: read collection-config failed: ${error.message ?? String(error)}`,
    );
  }
  return (data ?? []).map((r) => configRowToMapping(r as ConfigRow));
}

export async function saveWixCollectionConfig(
  rows: WixCollectionMapping[],
): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await writeStore(CONFIG_STORE, rows); // no Supabase env → file store only
    return;
  }
  const tid = await currentTenantId();
  // UPSERT first (never loses prior rows on a failed write), then delete the
  // tenant's now-absent keys → durable, non-destructive replace.
  if (rows.length > 0) {
    const insertRows: ConfigRow[] = rows.map((m) => ({
      tenant_id: tid,
      data_collection_id: m.dataCollectionId,
      slug_field: m.slugField,
      url_prefix: m.urlPrefix,
      label_field: m.labelField ?? null,
      content_field_roles: m.contentFieldRoles ?? null,
    }));
    const up = await admin
      .from(CONFIG_TABLE)
      .upsert(insertRows, { onConflict: "tenant_id,data_collection_id" });
    if (up.error != null) {
      if (isUndefinedTableError(up.error)) {
        await writeStore(CONFIG_STORE, rows);
        return;
      }
      throw new Error(
        `wix-mappings-store: upsert collection-config failed: ${up.error.message ?? String(up.error)}`,
      );
    }
  }
  const deleted = await deleteStaleKeys(
    admin,
    CONFIG_TABLE,
    tid,
    "data_collection_id",
    rows.map((m) => m.dataCollectionId),
  );
  if (deleted === "undefined_table") {
    await writeStore(CONFIG_STORE, rows);
    return;
  }
  // Best-effort local parity mirror (no-op on Vercel).
  await mirrorToFile(CONFIG_STORE, rows);
}

// ─────────────────────────────────────────────────────────────────────
// URL map
// ─────────────────────────────────────────────────────────────────────

export async function getWixUrlMap(): Promise<WixUrlMapEntry[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return await readFileMap();
  }
  const tid = await currentTenantId();
  const { data, error } = await admin
    .from(MAP_TABLE)
    .select("*")
    .eq("tenant_id", tid);
  if (error != null) {
    if (isUndefinedTableError(error)) return await readFileMap();
    throw new Error(
      `wix-mappings-store: read url-map failed: ${error.message ?? String(error)}`,
    );
  }
  return (data ?? []).map((r) => mapRowToEntry(r as MapRow));
}

/**
 * Persist the url map. `opts.authoritativeCollectionIds` scopes the
 * stale-delete: ONLY rows whose `data_collection_id` is in that set are
 * candidates for deletion (rows of collections NOT in the set are preserved).
 *
 * WHY: syncWixUrlMap accumulates entries only for collections whose Wix query
 * SUCCEEDED. On a PARTIAL sync (one collection's query transiently 5xx'd /
 * timed out), the desired set is missing that collection's rows — without this
 * scope, the durable delete-stale would wipe that collection's url map, killing
 * push-readiness for its pages until a clean full re-sync (the rows are
 * sync-derived, not re-pasteable). Passing only the SUCCESSFULLY-synced
 * collection ids makes a failed collection a no-op (its rows survive untouched),
 * while a collection that genuinely synced to zero items is still cleared
 * (it IS authoritative). Omit the option (operator-save / full replace) for the
 * original delete-any-stale-url behavior.
 */
export async function writeWixUrlMap(
  entries: WixUrlMapEntry[],
  opts?: { authoritativeCollectionIds?: readonly string[] },
): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await writeStore(MAP_STORE, entries);
    return;
  }
  const tid = await currentTenantId();
  if (entries.length > 0) {
    const insertRows: MapRow[] = entries.map((e) => ({
      tenant_id: tid,
      url: e.url,
      data_collection_id: e.dataCollectionId,
      data_item_id: e.dataItemId,
      slug_field: e.slugField,
      label: e.label,
      synced_at: e.syncedAt,
    }));
    const up = await admin
      .from(MAP_TABLE)
      .upsert(insertRows, { onConflict: "tenant_id,url" });
    if (up.error != null) {
      if (isUndefinedTableError(up.error)) {
        await writeStore(MAP_STORE, entries);
        return;
      }
      throw new Error(
        `wix-mappings-store: upsert url-map failed: ${up.error.message ?? String(up.error)}`,
      );
    }
  }
  const deleted =
    opts?.authoritativeCollectionIds != null
      ? await deleteStaleUrlsScoped(
          admin,
          tid,
          entries.map((e) => e.url),
          opts.authoritativeCollectionIds,
        )
      : await deleteStaleKeys(
          admin,
          MAP_TABLE,
          tid,
          "url",
          entries.map((e) => e.url),
        );
  if (deleted === "undefined_table") {
    await writeStore(MAP_STORE, entries);
    return;
  }
  await mirrorToFile(MAP_STORE, entries);
}

/**
 * Scoped url-map stale-delete: removes only rows whose `data_collection_id` is
 * in `authoritativeCollectionIds` AND whose url is no longer desired. Rows of
 * collections NOT in the authoritative set (e.g. a collection whose sync
 * transiently failed) are left UNTOUCHED — never wiped.
 */
async function deleteStaleUrlsScoped(
  admin: ReturnType<typeof getSupabaseAdmin>,
  tid: string,
  desiredUrls: string[],
  authoritativeCollectionIds: readonly string[],
): Promise<"ok" | "undefined_table"> {
  const authoritative = new Set(authoritativeCollectionIds);
  const keep = new Set(desiredUrls);
  const ex = await admin
    .from(MAP_TABLE)
    .select("url,data_collection_id")
    .eq("tenant_id", tid);
  if (ex.error != null) {
    if (isUndefinedTableError(ex.error)) return "undefined_table";
    throw new Error(
      `wix-mappings-store: read existing url-map failed: ${ex.error.message ?? String(ex.error)}`,
    );
  }
  const stale = (ex.data ?? [])
    .map((r) => r as unknown as { url?: unknown; data_collection_id?: unknown })
    .filter(
      (r): r is { url: string; data_collection_id: string } =>
        typeof r.url === "string" &&
        typeof r.data_collection_id === "string" &&
        authoritative.has(r.data_collection_id) &&
        !keep.has(r.url),
    )
    .map((r) => r.url);
  if (stale.length === 0) return "ok";
  const del = await admin.from(MAP_TABLE).delete().eq("tenant_id", tid).in("url", stale);
  if (del.error != null) {
    if (isUndefinedTableError(del.error)) return "undefined_table";
    throw new Error(
      `wix-mappings-store: scoped delete stale urls failed: ${del.error.message ?? String(del.error)}`,
    );
  }
  return "ok";
}

// ─────────────────────────────────────────────────────────────────────
// Durable replace helper: delete the tenant's rows whose key is NOT in the
// desired set. Reads existing keys first + deletes via `.in(...)` (robust
// for URL keys that contain special chars, unlike a NOT-IN filter string).
// ─────────────────────────────────────────────────────────────────────

async function deleteStaleKeys(
  admin: ReturnType<typeof getSupabaseAdmin>,
  table: string,
  tid: string,
  keyCol: string,
  desiredKeys: string[],
): Promise<"ok" | "undefined_table"> {
  const keep = new Set(desiredKeys);
  const ex = await admin.from(table).select(keyCol).eq("tenant_id", tid);
  if (ex.error != null) {
    if (isUndefinedTableError(ex.error)) return "undefined_table";
    throw new Error(
      `wix-mappings-store: read existing keys failed for ${table}: ${ex.error.message ?? String(ex.error)}`,
    );
  }
  const stale = (ex.data ?? [])
    .map((r) => (r as unknown as Record<string, unknown>)[keyCol])
    .filter((k): k is string => typeof k === "string" && !keep.has(k));
  if (stale.length === 0) return "ok";
  const del = await admin.from(table).delete().eq("tenant_id", tid).in(keyCol, stale);
  if (del.error != null) {
    if (isUndefinedTableError(del.error)) return "undefined_table";
    throw new Error(
      `wix-mappings-store: delete stale keys failed for ${table}: ${del.error.message ?? String(del.error)}`,
    );
  }
  return "ok";
}

// ─────────────────────────────────────────────────────────────────────
// File-store fallback readers (today's behavior — soft-fail to [])
// ─────────────────────────────────────────────────────────────────────

async function readFileConfig(): Promise<WixCollectionMapping[]> {
  try {
    return (await readStore<WixCollectionMapping>(CONFIG_STORE)) ?? [];
  } catch {
    return [];
  }
}

async function readFileMap(): Promise<WixUrlMapEntry[]> {
  try {
    return (await readStore<WixUrlMapEntry>(MAP_STORE)) ?? [];
  } catch {
    return [];
  }
}
