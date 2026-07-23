import "server-only";

/**
 * Shipped-change ledger store (CORE 100K) - durable store for manually-shipped
 * changes. Preserves ALL historical records: the Supabase table
 * `shipped_change_proof` is read as-is (extra legacy columns are simply ignored,
 * never dropped), and the file fallback keeps local dev + the pre-migration
 * hosted window working. Fail-soft: reads return [] on any error.
 *
 * The record shape here is the SMALL persisted core the measurement kernel needs.
 * The kernel (kernel.ts) recomputes every directional read from the stored
 * windows; nothing statistical is persisted.
 */

import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import { getDataDir } from "@/lib/tenant";
import { getTenant } from "@/domains/account/tenants/store";
import type {
  GscProofConfidence,
  GscProofVerdict,
  ProofBaseline,
  ProofWindowResult,
} from "./types";

const TABLE = "shipped_change_proof";
const STORE = "proof-gsc-ledger";

export type ShippedChangeRecord = {
  /** Stable per (page, ship-date). */
  id: string;
  page: string;
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  /** ISO timestamp the operator confirmed it shipped live. */
  shippedAt: string;
  /** GSC metrics over the pre-ship window (display snapshot). */
  baseline: ProofBaseline;
  targetQueries: string[];
  /** Canonical comparison-page URLs for the diff in diff. */
  controlPages: string[];
  windows: ProofWindowResult[];
  /** Stored verdict (kernel recomputes the live directional read on read). */
  verdict: GscProofVerdict;
  confidence: GscProofConfidence;
  measuredAt: string | null;
  notes: string | null;
  verifiedLive: boolean;
  liveSourceUrl: string | null;
  recrawlRequestedAt: string | null;
  /** Operator override pinning the learning verdict to inconclusive. */
  operatorVerdictOverride: "inconclusive" | null;
  createdAt: string;
  updatedAt: string;
};

type LedgerRow = {
  tenant_id: string;
  id: string;
  page: string;
  path: string;
  action_type: string;
  before_text: string | null;
  after_text: string | null;
  shipped_at: string;
  baseline: ProofBaseline;
  target_queries: string[];
  control_pages: string[];
  windows: ProofWindowResult[];
  verdict: string;
  confidence: string;
  measured_at: string | null;
  notes: string | null;
  verified_live: boolean;
  live_source_url: string | null;
  recrawl_requested_at: string | null;
  operator_verdict_override?: "inconclusive" | null;
  created_at: string;
  updated_at: string;
};

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204")) {
    return true;
  }
  return typeof e.message === "string" && /schema cache|could not find the (table|.*column)/i.test(e.message);
}

const VALID_VERDICTS: ReadonlySet<string> = new Set(["measuring", "won", "lost", "inconclusive", "insufficient_data"]);
const VALID_CONFIDENCES: ReadonlySet<string> = new Set(["high", "medium", "low"]);
const ZERO_BASELINE: ProofBaseline = { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 };

export function recordToRow(tid: string, r: ShippedChangeRecord): LedgerRow {
  return {
    tenant_id: tid,
    id: r.id,
    page: r.page,
    path: r.path,
    action_type: r.actionType,
    before_text: r.before,
    after_text: r.after,
    shipped_at: r.shippedAt,
    baseline: r.baseline,
    target_queries: r.targetQueries,
    control_pages: r.controlPages,
    windows: r.windows,
    verdict: r.verdict,
    confidence: r.confidence,
    measured_at: r.measuredAt,
    notes: r.notes,
    verified_live: r.verifiedLive,
    live_source_url: r.liveSourceUrl,
    recrawl_requested_at: r.recrawlRequestedAt,
    operator_verdict_override: r.operatorVerdictOverride,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

export function rowToRecord(row: LedgerRow): ShippedChangeRecord {
  return {
    id: row.id,
    page: row.page,
    path: row.path,
    actionType: row.action_type,
    before: row.before_text ?? null,
    after: row.after_text ?? null,
    shippedAt: row.shipped_at,
    baseline: row.baseline ?? ZERO_BASELINE,
    targetQueries: row.target_queries ?? [],
    controlPages: row.control_pages ?? [],
    windows: row.windows ?? [],
    verdict: (VALID_VERDICTS.has(row.verdict) ? row.verdict : "inconclusive") as GscProofVerdict,
    confidence: (VALID_CONFIDENCES.has(row.confidence) ? row.confidence : "low") as GscProofConfidence,
    measuredAt: row.measured_at ?? null,
    notes: row.notes ?? null,
    verifiedLive: row.verified_live ?? false,
    liveSourceUrl: row.live_source_url ?? null,
    recrawlRequestedAt: row.recrawl_requested_at ?? null,
    operatorVerdictOverride: row.operator_verdict_override === "inconclusive" ? "inconclusive" : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readFile(): Promise<ShippedChangeRecord[]> {
  try {
    return (await readStore<ShippedChangeRecord>(STORE)) ?? [];
  } catch (err) {
    log.warn("shipped-change-store: file ledger read failed; treating as empty", {
      store: STORE,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

async function writeFile(records: ShippedChangeRecord[]): Promise<void> {
  await writeStore<ShippedChangeRecord>(STORE, records);
}

async function resolveSlugForTenant(tenantId: string): Promise<string | null> {
  const tenant = await getTenant(tenantId);
  if (tenant) return tenant.slug;
  const envId = process.env.BEACON_TENANT_ID;
  const envSlug = process.env.BEACON_TENANT_SLUG;
  if (envId && envSlug && envId === tenantId) return envSlug;
  return null;
}

async function readShippedChangesFileForTenant(tenantId: string): Promise<ShippedChangeRecord[]> {
  const slug = await resolveSlugForTenant(tenantId);
  if (slug == null) return [];
  const filePath = join(getDataDir(slug), `${STORE}.json`);
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed) ? (parsed as ShippedChangeRecord[]) : [];
  } catch (err) {
    log.warn("shipped-change-store: tenant ledger file unreadable/corrupt; treating as empty", {
      tenant: tenantId, store: STORE, file: filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** All shipped-change records for the ambient tenant, newest ship first. Request-cached. */
export const loadShippedChanges = cache(loadShippedChangesUncached);

async function loadShippedChangesUncached(): Promise<ShippedChangeRecord[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return sortNewest(await readFile());
  }
  let tid: string;
  try {
    tid = await currentTenantId();
  } catch (err) {
    log.warn("shipped-change-store: tenant resolve failed; ledger reads as empty", {
      store: STORE, error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  return queryTenantLedger(admin, tid);
}

/** Tenant-EXPLICIT ledger read (background/after() scope where ambient is wrong). */
export async function loadShippedChangesForTenant(tenantId: string): Promise<ShippedChangeRecord[]> {
  if (!tenantId) return [];
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return sortNewest(await readShippedChangesFileForTenant(tenantId));
  }
  return queryTenantLedger(admin, tenantId, () => readShippedChangesFileForTenant(tenantId));
}

async function queryTenantLedger(
  admin: ReturnType<typeof getSupabaseAdmin>,
  tid: string,
  fallback: () => Promise<ShippedChangeRecord[]> = readFile,
): Promise<ShippedChangeRecord[]> {
  const { data, error } = await admin.from(TABLE).select("*").eq("tenant_id", tid);
  if (error != null) {
    if (isUndefinedTableError(error)) return sortNewest(await fallback());
    console.error(`[shipped-change-store] read failed for ${tid}: ${error.message ?? String(error)}`);
    return [];
  }
  return sortNewest((data as LedgerRow[]).map(rowToRecord));
}

/** Every ledger mutation invalidates the /results SWR snapshot + core surfaces. */
async function invalidateResultsSurfaceSafe(): Promise<void> {
  try {
    const { invalidateResultsSurface } = await import("@/app/(shell)/results/results-surface-store");
    await invalidateResultsSurface();
  } catch {
    /* best-effort */
  }
  try {
    const { invalidateCoreSurfaces } = await import("@/app/(shell)/surface-release");
    await invalidateCoreSurfaces();
  } catch {
    /* best-effort */
  }
}

/** Upsert one record (by id) for the ambient tenant. Durable + file mirror. */
export async function upsertShippedChange(record: ShippedChangeRecord): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await upsertFile(record);
    await invalidateResultsSurfaceSafe();
    return;
  }
  const tid = await currentTenantId();
  const up = await admin.from(TABLE).upsert(recordToRow(tid, record), { onConflict: "tenant_id,id" });
  if (up.error != null) {
    if (isUndefinedTableError(up.error)) {
      console.warn(
        `[shipped-change-store] DURABLE upsert fell back to file (apply the pending migration): ${
          (up.error as { code?: string }).code ?? "?"
        } ${(up.error as { message?: string }).message ?? String(up.error)}`,
      );
      await upsertFile(record);
      await invalidateResultsSurfaceSafe();
      return;
    }
    throw new Error(`shipped-change-store: upsert failed for ${tid}: ${up.error.message ?? String(up.error)}`);
  }
  await mirrorFile(record);
  await invalidateResultsSurfaceSafe();
}

async function upsertFile(record: ShippedChangeRecord): Promise<void> {
  const rows = await readFile();
  const next = rows.filter((r) => r.id !== record.id);
  next.push(record);
  await writeFile(next);
}

async function mirrorFile(record: ShippedChangeRecord): Promise<void> {
  try {
    await upsertFile(record);
  } catch {
    /* best-effort local parity */
  }
}

function sortNewest(records: ShippedChangeRecord[]): ShippedChangeRecord[] {
  return [...records].sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
}
