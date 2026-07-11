/**
 * pipeline-readings (2026-07-02, master plan item 10) - the bounded, fail-soft
 * collector for the pipeline invariant checker. Gathers, per tenant:
 *  - connected-source flags + last-sync stamps (connector_tokens, same read
 *    the /settings/connectors cards use via getConnectorInfo)
 *  - per-table recent row counts + newest-write watermarks (two cheap queries
 *    per table: a HEAD count and a single-row order-desc read)
 *  - the latest persisted daily plan's candidate count (Supabase plan store)
 *  - the demand-graph SWR snapshot's node/move counts (NEVER rebuilds the graph)
 *
 * Every read is individually try/caught; a failed read lands as null in the
 * readings and the checker skips it (skip-over-scream). Total cost: ~12 tiny
 * Supabase queries per tenant. $0, deterministic, no LLM.
 */

import "server-only";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getConnectorInfo } from "@/lib/connector-store";
import { listPlans } from "@/domains/experiments/daily-experiment-plan-store";
import { readGraphSnapshot, isGraphSnapshotValid } from "@/domains/demand-graph/graph-snapshot-store";
import { currentTenantId } from "@/lib/tenant-context";
import {
  RECENT_WINDOW_HOURS,
  type PipelineConnectorReading,
  type PipelineReadings,
  type PipelineTableKey,
  type PipelineTableReading,
} from "./pipeline-invariants";

/** The watermark/count timestamp column per table (each sync stamps it per row). */
const TABLE_TS_COLUMN: Record<PipelineTableKey, string> = {
  gsc_daily_rows: "pulled_at",
  ga4_url_traffic: "last_synced_at",
  ga4_ai_referral_daily: "last_synced_at",
  profound_citation_rows: "pulled_at",
  prompt_answer_observations: "observed_at",
};

const TABLE_KEYS = Object.keys(TABLE_TS_COLUMN) as PipelineTableKey[];

async function readConnector(
  provider: "google_gsc" | "google_ga4" | "profound",
  tenantId: string,
): Promise<PipelineConnectorReading> {
  try {
    const info = await getConnectorInfo(provider, tenantId);
    return { connected: info.status === "connected", lastSyncedAt: info.last_synced_at ?? null };
  } catch {
    return { connected: null, lastSyncedAt: null };
  }
}

async function readTable(
  table: PipelineTableKey,
  tenantId: string,
  windowStartIso: string,
): Promise<PipelineTableReading> {
  if (!isSupabaseConfigured()) return { recentRows: null, latestRowAt: null };
  const tsCol = TABLE_TS_COLUMN[table];
  let recentRows: number | null = null;
  let latestRowAt: string | null = null;
  try {
    const admin = getSupabaseAdmin();
    const { count, error } = await admin
      .from(table)
      .select(tsCol, { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte(tsCol, windowStartIso);
    if (!error && typeof count === "number") recentRows = count;
  } catch {
    /* fail-soft: recentRows stays null */
  }
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(table)
      .select(tsCol)
      .eq("tenant_id", tenantId)
      .order(tsCol, { ascending: false })
      .limit(1);
    if (!error) {
      const raw = (data?.[0] as unknown as Record<string, unknown> | undefined)?.[tsCol];
      latestRowAt = typeof raw === "string" && raw !== "" ? raw : null;
    }
  } catch {
    /* fail-soft: latestRowAt stays null */
  }
  return { recentRows, latestRowAt };
}

async function readDailyPlan(tenantId: string): Promise<PipelineReadings["dailyPlan"]> {
  try {
    const plans = await listPlans(tenantId, 1);
    const latest = plans[0];
    if (!latest) return { hasPlan: false, candidateCount: 0, planCreatedAt: null };
    return {
      hasPlan: true,
      candidateCount: (latest.selected?.length ?? 0) + (latest.backups?.length ?? 0),
      planCreatedAt: latest.createdAt ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The demand-graph SWR snapshot counts. The snapshot store routes by the AMBIENT
 * tenant context, so we only read it when the ambient tenant matches the tenant
 * being checked (true for the single-tenant cron env and the headless probe);
 * on a mismatch we return null and the checker skips - we NEVER rebuild the
 * graph just to count moves.
 */
async function readDemandGraphCounts(tenantId: string): Promise<PipelineReadings["demandGraph"]> {
  try {
    const ambient = await currentTenantId();
    if (ambient !== tenantId) return null;
    const row = await readGraphSnapshot(tenantId);
    if (!isGraphSnapshotValid(row)) return null;
    const graph = row.data.graph;
    return { nodes: graph.demandNodes.length, moves: graph.moves.length };
  } catch {
    return null;
  }
}

/** Gather every reading the invariant checker needs. Bounded + fail-soft; never throws. */
export async function gatherPipelineReadings(
  tenantId: string,
  now: Date = new Date(),
): Promise<PipelineReadings> {
  const checkedAt = now.toISOString();
  const windowStartIso = new Date(now.getTime() - RECENT_WINDOW_HOURS * 3_600_000).toISOString();

  const [gsc, ga4, profound] = await Promise.all([
    readConnector("google_gsc", tenantId),
    readConnector("google_ga4", tenantId),
    readConnector("profound", tenantId),
  ]);

  const tableEntries = await Promise.all(
    TABLE_KEYS.map(async (key) => [key, await readTable(key, tenantId, windowStartIso)] as const),
  );
  const tables = Object.fromEntries(tableEntries) as Record<PipelineTableKey, PipelineTableReading>;

  const [dailyPlan, demandGraph] = await Promise.all([
    readDailyPlan(tenantId),
    readDemandGraphCounts(tenantId),
  ]);

  return {
    tenantId,
    checkedAt,
    recentWindowHours: RECENT_WINDOW_HOURS,
    connectors: { gsc, ga4, profound },
    tables,
    dailyPlan,
    demandGraph,
  };
}
