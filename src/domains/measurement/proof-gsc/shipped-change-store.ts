import "server-only";

/**
 * Shipped-change ledger store (CORE 100K) - durable store for manually-shipped changes. Preserves ALL
 * historical records: the Supabase table `shipped_change_proof` is read as-is (extra legacy columns are
 * ignored, never dropped), and the file fallback keeps local dev + the pre-migration hosted window
 * working. Fail-soft: reads return [] on any error. The shape here is the SMALL persisted core the
 * measurement kernel needs; kernel.ts recomputes every directional read, so nothing statistical is stored.
 *
 * THE SHIPMENT (V1 Truth Convergence Phase 6). This record IS the canonical Shipment: the
 * operator-confirmed implementation of one ChangeProposal and its verified live state. Evolved here,
 * never duplicated into a parallel table, so there is one answer to "what did we change and what happened
 * after". Every Shipment column is nullable, so pre-Phase-6 rows decode exactly as before.
 *
 * WRITTEN ONCE: `implementedAt` (the stamp the 28-day window is read from) and `shipmentBaseline` (where
 * the page stood at mark time). A later writer arriving with different values keeps what is on file and
 * says so. `verification` is null until the live check runs, and null IS the due marker; the one exception
 * is a site that did not answer at all, which carries a day-scoped marker good for one retry.
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
import type { GscProofConfidence, GscProofVerdict, ProofBaseline, ProofWindowResult } from "./types";

const TABLE = "shipped_change_proof";
const STORE = "proof-gsc-ledger";

/** What the live check found. FROZEN SHAPE, written only through `recordVerification`.
 *  `components` names each piece and whether it is on the page, so a partly-applied
 *  bundle reads as partly applied instead of as a pass or a failure. */
export type ShipmentVerification = {
  status: "verified" | "partially_verified" | "not_found" | "blocked" | "differs" | "operator_confirmed";
  checkedAt: string;
  components: Array<{ kind: string; state: "verified" | "missing" | "differs" | "unknown"; note: string | null }>;
  /** A DAY-SCOPED ONE-TIME RECHECK (the UTC day this may be looked at again), set ONLY when the site did not
   *  answer at all: a timeout is a fact about the transport, not about the change, so writing it off forever
   *  would bury a change that really shipped. Null on every other ending and on the recheck's own answer. */
  recheckAfter?: string | null;
};

/** The immutable numbers this page stood at when the operator marked the change done. */
type ShipmentBaseline = {
  search: ProofBaseline;
  /** The latest day's first AI reading per tracked question. Null = none on file. */
  ai: { day: string; checked: number; mentioning: number } | null;
  capturedAt: string;
};

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
  // ── Shipment (null on every pre-Phase-6 row) ────────────────────────────────
  /** The ChangeProposal this implements, and the exact version of its copy applied. */
  proposalId: string | null;
  proposalVersion: string | null;
  /** The research basis it was drafted under, and the case a new page answers. */
  basis: string | null;
  caseId: string | null;
  /** What applying the bundle was meant to achieve, in one sentence. */
  bundleHypothesis: string | null;
  /** Which components the operator says they applied, each with the EXACT copy it was handed (`after`),
   *  because that copy is what the live check compares the page against. A subset = a partial bundle. */
  componentsApplied: Array<{ kind: string; label: string; after?: string | null }> | null;
  /** THE STAMP. When the operator marked it done; the window is read from it. Write-once. */
  implementedAt: string | null;
  /** The owned page's HELD content hash at mark time, from the snapshot on file. */
  preChangeContentHash: string | null;
  /** Where this page stood at mark time. Write-once. */
  shipmentBaseline: ShipmentBaseline | null;
  /** Null until the live check runs, and null is the due marker. DEFERRED TO PHASE 8: the SURFACES that
   *  render what the check found (the Changes card line, the Results row) are that phase's work; the answer
   *  accumulates now so the day they are built they read truth instead of an empty column. */
  verification: ShipmentVerification | null;
  /** Why the operator overrode what the check found. */
  operatorOverrideReason: string | null;
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
  proposal_id?: string | null; proposal_version?: string | null; basis?: string | null;
  case_id?: string | null; bundle_hypothesis?: string | null;
  components_applied?: ShippedChangeRecord["componentsApplied"];
  implemented_at?: string | null; pre_change_content_hash?: string | null;
  shipment_baseline?: ShipmentBaseline | null; verification?: ShipmentVerification | null;
  operator_override_reason?: string | null;
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

/** THE TABLE IS THERE AND A COLUMN IS NOT: the pre-migration window, told apart from a genuinely absent
 *  table. It matters because production READS the table, so a write that quietly degraded to the file in
 *  that window is a write nobody will ever read back. */
function isMissingColumnError(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown };
  return e.code === "PGRST204" || (typeof e.message === "string" && /could not find the .*column/i.test(e.message));
}

const VALID_VERDICTS: ReadonlySet<string> = new Set(["measuring", "won", "lost", "inconclusive", "insufficient_data"]);
const VALID_CONFIDENCES: ReadonlySet<string> = new Set(["high", "medium", "low"]);
const ZERO_BASELINE: ProofBaseline = { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 };

function recordToRow(tid: string, r: ShippedChangeRecord): LedgerRow {
  return {
    tenant_id: tid, id: r.id, page: r.page, path: r.path, action_type: r.actionType,
    before_text: r.before, after_text: r.after, shipped_at: r.shippedAt, baseline: r.baseline,
    target_queries: r.targetQueries, control_pages: r.controlPages, windows: r.windows,
    verdict: r.verdict, confidence: r.confidence, measured_at: r.measuredAt, notes: r.notes,
    verified_live: r.verifiedLive, live_source_url: r.liveSourceUrl,
    recrawl_requested_at: r.recrawlRequestedAt, operator_verdict_override: r.operatorVerdictOverride,
    proposal_id: r.proposalId, proposal_version: r.proposalVersion, basis: r.basis,
    case_id: r.caseId, bundle_hypothesis: r.bundleHypothesis, components_applied: r.componentsApplied,
    implemented_at: r.implementedAt, pre_change_content_hash: r.preChangeContentHash,
    shipment_baseline: r.shipmentBaseline, verification: r.verification,
    operator_override_reason: r.operatorOverrideReason, created_at: r.createdAt, updated_at: r.updatedAt,
  };
}

function rowToRecord(row: LedgerRow): ShippedChangeRecord {
  return {
    id: row.id, page: row.page, path: row.path, actionType: row.action_type,
    before: row.before_text ?? null, after: row.after_text ?? null, shippedAt: row.shipped_at,
    baseline: row.baseline ?? ZERO_BASELINE, targetQueries: row.target_queries ?? [],
    controlPages: row.control_pages ?? [], windows: row.windows ?? [],
    verdict: (VALID_VERDICTS.has(row.verdict) ? row.verdict : "inconclusive") as GscProofVerdict,
    confidence: (VALID_CONFIDENCES.has(row.confidence) ? row.confidence : "low") as GscProofConfidence,
    measuredAt: row.measured_at ?? null, notes: row.notes ?? null, verifiedLive: row.verified_live ?? false,
    liveSourceUrl: row.live_source_url ?? null, recrawlRequestedAt: row.recrawl_requested_at ?? null,
    operatorVerdictOverride: row.operator_verdict_override === "inconclusive" ? "inconclusive" : null,
    // A row written before Phase 6 has none of these and reads as a manual record with
    // no proposal behind it, rather than failing to decode at all.
    proposalId: row.proposal_id ?? null, proposalVersion: row.proposal_version ?? null,
    basis: row.basis ?? null, caseId: row.case_id ?? null,
    bundleHypothesis: row.bundle_hypothesis ?? null, componentsApplied: row.components_applied ?? null,
    implementedAt: row.implemented_at ?? null, preChangeContentHash: row.pre_change_content_hash ?? null,
    shipmentBaseline: row.shipment_baseline ?? null, verification: row.verification ?? null,
    operatorOverrideReason: row.operator_override_reason ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function readFile(): Promise<ShippedChangeRecord[]> {
  try {
    return (await readStore<ShippedChangeRecord>(STORE)) ?? [];
  } catch (err) {
    log.warn("shipped-change-store: file ledger read failed; treating as empty", {
      store: STORE, error: err instanceof Error ? err.message : String(err) });
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

/** PURE. The stamp and the baseline are written ONCE. Every later writer (a re-measure,
 *  a retried mark-implemented) arrives with the whole record, so without this a recompute
 *  could quietly move where the window starts and rewrite where the page began. What is on
 *  file wins, and a writer that tried to change it is named in the log. */
type WriteOnce = { implemented_at?: string | null; shipment_baseline?: ShipmentBaseline | null };

function withHeldImmutables(held: WriteOnce | null, row: LedgerRow): LedgerRow {
  if (held?.implemented_at == null) return row;
  const stamp = row.implemented_at !== held.implemented_at;
  const baseline = held.shipment_baseline != null
    && JSON.stringify(row.shipment_baseline ?? null) !== JSON.stringify(held.shipment_baseline);
  if (stamp || baseline) {
    log.warn("[shipment] the stamp and the starting numbers are written once, so I kept what is on file", {
      id: row.id, tenant: row.tenant_id, stamp, baseline });
  }
  return { ...row, implemented_at: held.implemented_at, shipment_baseline: held.shipment_baseline ?? row.shipment_baseline };
}

/** The two write-once columns already on file for this Shipment, or null. */
async function heldImmutables(admin: ReturnType<typeof getSupabaseAdmin>, tid: string, id: string): Promise<WriteOnce | null> {
  try {
    const { data, error } = await admin
      .from(TABLE).select("implemented_at, shipment_baseline").eq("tenant_id", tid).eq("id", id).limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return data[0] as WriteOnce;
  } catch {
    return null;
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
  const row = record.implementedAt != null
    ? withHeldImmutables(await heldImmutables(admin, tid, record.id), recordToRow(tid, record))
    : recordToRow(tid, record);
  const up = await admin.from(TABLE).upsert(row, { onConflict: "tenant_id,id" });
  if (up.error != null) {
    if (isUndefinedTableError(up.error)) {
      // A SHIPMENT IS DURABLE OR IT DOES NOT EXIST. The table is here and the Shipment columns are not, so
      // this write would reach only the file while every production read goes to the table and never sees
      // it: degrading silently let a proposal flip to applied over a Shipment nobody could read back, which
      // is the one outcome the write order exists to prevent. Fail closed and let the caller say so in the
      // operator's own words. A pre-Shipment record (no stamp) keeps the file fallback: it carries none of
      // the new columns and nothing downstream reads it from the table.
      if (record.implementedAt != null && isMissingColumnError(up.error)) {
        throw new Error(`shipped-change-store: ${TABLE} has no Shipment columns yet, so nothing durable landed (apply the pending migration)`);
      }
      console.warn(`[shipped-change-store] DURABLE upsert fell back to file (apply the pending migration): ${
        (up.error as { code?: string }).code ?? "?"} ${(up.error as { message?: string }).message ?? String(up.error)}`);
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
  const held = rows.find((r) => r.id === record.id);
  const next = rows.filter((r) => r.id !== record.id);
  next.push(
    record.implementedAt != null && held?.implementedAt != null
      ? { ...record, implementedAt: held.implementedAt, shipmentBaseline: held.shipmentBaseline ?? record.shipmentBaseline }
      : record,
  );
  await writeFile(next);
}

async function mirrorFile(record: ShippedChangeRecord): Promise<void> {
  try {
    await upsertFile(record);
  } catch {
    /* best-effort local parity */
  }
}

/**
 * THE SEAM. The live-verification module calls this and nothing else: it writes ONE
 * column on ONE Shipment. The stamp and the starting numbers are not in the update
 * statement, so a check running weeks later can never move where the window starts.
 * Fail-closed: false means nothing was written, and an id belonging to another
 * account matches no row here, so a check never lands on somebody else's change.
 */
export async function recordVerification(
  tenantId: string, shipmentId: string, verification: ShipmentVerification,
): Promise<boolean> {
  if (!tenantId || !shipmentId) return false;
  let admin;
  // FILE MODE, exactly as the upsert falls back: local dev has no Supabase, and an answer that cannot be
  // saved is an answer I go back out and fetch again on every single visit, forever.
  try { admin = getSupabaseAdmin(); } catch { return recordVerificationInFile(shipmentId, verification); }
  try {
    const { data, error } = await admin.from(TABLE)
      .update({ verification, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("id", shipmentId).select("id");
    // The pre-migration window: no `verification` column to write, so the file holds the answer instead.
    if (error != null && isUndefinedTableError(error)) return recordVerificationInFile(shipmentId, verification);
    if (error != null || !Array.isArray(data) || data.length === 0) {
      log.warn("[shipment] I did not record what the check found: no change of yours matched that id", {
        tenant: tenantId, id: shipmentId, error: error?.message ?? "no row" });
      return false;
    }
    await invalidateResultsSurfaceSafe();
    return true;
  } catch (err) {
    log.error("[shipment] the verification write did not land", {
      tenant: tenantId, id: shipmentId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** The same ONE column on the same ONE Shipment, written to the file the upsert already mirrors into,
 *  stamp and starting numbers untouched. False = the id is not in the file either, so it stays due. */
async function recordVerificationInFile(shipmentId: string, verification: ShipmentVerification): Promise<boolean> {
  try {
    const rows = await readFile();
    const at = rows.findIndex((r) => r.id === shipmentId);
    if (at < 0) return false;
    rows[at] = { ...rows[at]!, verification, updatedAt: new Date().toISOString() };
    await writeFile(rows);
    await invalidateResultsSurfaceSafe();
    return true;
  } catch (err) {
    log.warn("[shipment] I could not save what the check found to the local ledger", {
      id: shipmentId, error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/** The measurement window a shipped change owns, read from the stamp. */
const MEASUREMENT_WINDOW_DAYS = 28;

/**
 * The pages this account changed in the last 28 days and is still measuring: a fresh
 * proposal for one of them is work already in flight, not a new idea, and the ranker
 * needs to know that. Read from `implementedAt`, which is what the stamp exists for.
 * A change the check could not find, or was blocked from checking, is NOT under
 * measurement (nothing shipped, so the page is free); everything else counts,
 * including a Shipment still waiting for its first check. Four columns, bounded.
 */
export async function pagesUnderMeasurementFromShipments(
  tenantId: string, now: Date = new Date(),
): Promise<string[]> {
  if (!tenantId) return [];
  const since = new Date(now.getTime() - MEASUREMENT_WINDOW_DAYS * 86_400_000).toISOString();
  try {
    const { data, error } = await getSupabaseAdmin()
      .from(TABLE)
      .select("path, page, implemented_at, verification")
      .eq("tenant_id", tenantId)
      .gte("implemented_at", since)
      .limit(200);
    if (error != null || !Array.isArray(data)) {
      if (error != null && !isUndefinedTableError(error)) {
        log.warn("[shipment] I could not read what is under measurement, so nothing reads as in flight", {
          tenant: tenantId, error: error.message ?? String(error) });
      }
      return [];
    }
    const out: string[] = [];
    for (const r of data as Array<Pick<LedgerRow, "path" | "page" | "implemented_at" | "verification">>) {
      const status = r.verification?.status ?? null;
      if (status === "not_found" || status === "blocked") continue;
      const key = (r.path || r.page || "").trim();
      if (key && !out.includes(key)) out.push(key);
    }
    return out;
  } catch (err) {
    log.warn("[shipment] the under-measurement read failed, so nothing reads as in flight", {
      tenant: tenantId, error: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function sortNewest(records: ShippedChangeRecord[]): ShippedChangeRecord[] {
  return [...records].sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
}
