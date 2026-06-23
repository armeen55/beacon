import "server-only";

/**
 * GSC Proof ledger — durable store for manually-shipped changes (Phase 5, Path B).
 *
 * Mirrors `publishing-mode-store` / `mappings-store` posture EXACTLY:
 *   • Service-role admin client, tenant-scoped on every query (.eq("tenant_id", tid)).
 *   • AMBIENT tenant (currentTenantId()) — same routing as the file fallback (no
 *     explicit-tenant override → no cross-tenant desync).
 *   • FILE FALLBACK so local dev (no Supabase env) AND the pre-migration hosted
 *     window keep working: getSupabaseAdmin() throws → file; PostgREST 42P01
 *     undefined_table → file.
 *   • Fail-soft: reads return [] on any error; never throws into a surface.
 *
 * SEPARATE from the citation proof path (change_outcomes_v2) — its own table, its
 * own enums. Operator substrate (no customer surface writes here).
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import type {
  GscWindowMetrics,
  GscProofVerdict,
  GscProofConfidence,
  ProofWindowResult,
} from "./measure";
import type { TrafficOutcome } from "./traffic-outcome";

const TABLE = "shipped_change_proof";
const STORE = "proof-gsc-ledger";

export type ShippedChangeRecord = {
  /** Stable per (page, ship-date). */
  id: string;
  /** Canonical page URL. */
  page: string;
  /** Host-stripped path (display + control matching). */
  path: string;
  actionType: string;
  before: string | null;
  after: string | null;
  /** ISO timestamp the operator confirmed it shipped live. */
  shippedAt: string;
  /** GSC metrics over the pre-ship window (display snapshot). */
  baseline: GscWindowMetrics & { windowDays: number };
  targetQueries: string[];
  /** Canonical control page URLs for diff-in-diff. */
  controlPages: string[];
  windows: ProofWindowResult[];
  verdict: GscProofVerdict;
  confidence: GscProofConfidence;
  measuredAt: string | null;
  /** GA4 traffic + conversion outcome (Dollar-ROI, gap #1). COMPUTED at measure
   *  time and recomputed on every load — NOT persisted (no column; recordToRow
   *  omits it), so it stays in lockstep with live GA4 like the GSC verdict. */
  trafficOutcome?: TrafficOutcome | null;
  /** Operator free-text on the shipped change. */
  notes: string | null;
  /** Operator confirmed it's live on the site (manual ship). */
  verifiedLive: boolean;
  /** Optional URL the operator verified it live at. */
  liveSourceUrl: string | null;
  /** ISO timestamp the operator manually requested a Google recrawl/indexing. */
  recrawlRequestedAt: string | null;
  /** Operator override that PINS the learning verdict to "inconclusive",
   *  excluding this change from the per-action_type outcome prior that steers
   *  recommendation ranking. Use when a measured "won"/"lost" is mis-attributed
   *  (control contamination / seasonal co-movement) and would otherwise skew
   *  the prior. Survives re-measurement (applied in measureRecord). null = the
   *  measured verdict stands. */
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
  baseline: ShippedChangeRecord["baseline"];
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
  /** Additive column (migration 2026-06-23). Optional in the row type so the
   *  store keeps working before the migration is applied — recordToRow only
   *  emits it when set, and a missing column on read/write is tolerated by
   *  isUndefinedTableError (PGRST204) → file fallback. */
  operator_verdict_override?: "inconclusive" | null;
  created_at: string;
  updated_at: string;
};

function isUndefinedTableError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  // Raw Postgres reports 42P01 (undefined table); PostgREST (the supabase-js path)
  // reports PGRST205 ("Could not find the table … in the schema cache") and PGRST204
  // ("Could not find the 'x' column … in the schema cache") when an additive-column
  // migration hasn't been applied yet. Catch all so the file fallback engages and
  // additive-column migrations stay deploy-order-independent like the table itself.
  if (
    typeof e.code === "string" &&
    (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204")
  ) {
    return true;
  }
  return (
    typeof e.message === "string" &&
    /schema cache|could not find the (table|.*column)/i.test(e.message)
  );
}

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  "measuring",
  "won",
  "lost",
  "inconclusive",
  "insufficient_data",
]);
const VALID_CONFIDENCES: ReadonlySet<string> = new Set(["high", "medium", "low"]);
/** Fallback so a legacy/partial row without a baseline can't crash a render. */
const ZERO_BASELINE: ShippedChangeRecord["baseline"] = {
  clicks: 0,
  impressions: 0,
  ctr: 0,
  position: 0,
  windowDays: 28,
};

function recordToRow(tid: string, r: ShippedChangeRecord): LedgerRow {
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
    // Only emit the additive column when SET, so normal ledger writes are
    // unaffected before the migration is applied (a payload without the unknown
    // column never trips PGRST204); an override write degrades to file fallback
    // pre-migration and writes through once applied.
    ...(r.operatorVerdictOverride != null
      ? { operator_verdict_override: r.operatorVerdictOverride }
      : {}),
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function rowToRecord(row: LedgerRow): ShippedChangeRecord {
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
    confidence: (VALID_CONFIDENCES.has(row.confidence)
      ? row.confidence
      : "low") as GscProofConfidence,
    measuredAt: row.measured_at ?? null,
    notes: row.notes ?? null,
    verifiedLive: row.verified_live ?? false,
    liveSourceUrl: row.live_source_url ?? null,
    recrawlRequestedAt: row.recrawl_requested_at ?? null,
    operatorVerdictOverride:
      row.operator_verdict_override === "inconclusive" ? "inconclusive" : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function readFile(): Promise<ShippedChangeRecord[]> {
  try {
    return (await readStore<ShippedChangeRecord>(STORE)) ?? [];
  } catch {
    return [];
  }
}

async function writeFile(records: ShippedChangeRecord[]): Promise<void> {
  await writeStore<ShippedChangeRecord>(STORE, records);
}

/** All shipped-change records for the ambient tenant, newest ship first. Fail-soft → []. */
export async function loadShippedChanges(): Promise<ShippedChangeRecord[]> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return sortNewest(await readFile()); // no env → file
  }
  let tid: string;
  try {
    tid = await currentTenantId();
  } catch {
    return [];
  }
  const { data, error } = await admin.from(TABLE).select("*").eq("tenant_id", tid);
  if (error != null) {
    if (isUndefinedTableError(error)) return sortNewest(await readFile());
    console.error(
      `[shipped-change-store] read failed for ${tid}: ${error.message ?? String(error)}`,
    );
    return [];
  }
  return sortNewest((data as LedgerRow[]).map(rowToRecord));
}

/** Upsert one record (by id) for the ambient tenant. Durable + file mirror. */
export async function upsertShippedChange(record: ShippedChangeRecord): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    await upsertFile(record); // no env → file only
    return;
  }
  const tid = await currentTenantId();
  const up = await admin
    .from(TABLE)
    .upsert(recordToRow(tid, record), { onConflict: "tenant_id,id" });
  if (up.error != null) {
    if (isUndefinedTableError(up.error)) {
      await upsertFile(record);
      return;
    }
    throw new Error(
      `shipped-change-store: upsert failed for ${tid}: ${up.error.message ?? String(up.error)}`,
    );
  }
  await mirrorFile(record);
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
