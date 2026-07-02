/**
 * pipeline-health-store (2026-07-02, master plan item 10) - persistence for the
 * latest pipeline invariant check per tenant. Follows the ai-engine gap-store
 * sibling pattern exactly: a GLOBAL json-store (rows carry tenant_id, because
 * the nightly cron fans out across tenants with no ambient request context) that
 * is Supabase-mirrored so the write survives Vercel's read-only filesystem and
 * the Today surface can read it at $0.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { PipelineReadings, PipelineViolation } from "./pipeline-invariants";

const STORE = "pipeline-violations";

/** A check older than this is not shown anywhere (honest staleness: if the
 *  nightly check stopped running, a week-old alarm is noise, not signal). */
const HEALTH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PipelineHealthSummary = {
  gscRecentRows: number | null;
  ga4RecentRows: number | null;
  profoundRecentRows: number | null;
  planCandidates: number | null;
  graphNodes: number | null;
  graphMoves: number | null;
};

export type PipelineHealthRow = {
  tenant_id: string;
  checked_at: string;
  violations: PipelineViolation[];
  summary: PipelineHealthSummary;
};

/** PURE: fold readings + violations into the persisted row (testable without disk). */
export function buildPipelineHealthRow(
  readings: PipelineReadings,
  violations: PipelineViolation[],
): PipelineHealthRow {
  return {
    tenant_id: readings.tenantId,
    checked_at: readings.checkedAt,
    violations,
    summary: {
      gscRecentRows: readings.tables.gsc_daily_rows.recentRows,
      ga4RecentRows: readings.tables.ga4_url_traffic.recentRows,
      profoundRecentRows: readings.tables.profound_citation_rows.recentRows,
      planCandidates: readings.dailyPlan?.hasPlan ? readings.dailyPlan.candidateCount : null,
      graphNodes: readings.demandGraph?.nodes ?? null,
      graphMoves: readings.demandGraph?.moves ?? null,
    },
  };
}

/** Persist the latest check for a tenant (latest wins; other tenants untouched). */
export async function writePipelineHealth(row: PipelineHealthRow): Promise<void> {
  const rows = await readStore<PipelineHealthRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest check for the tenant, or null when absent / older than 7 days. Fail-soft. */
export async function readPipelineHealth(
  tenantId: string,
  now: Date = new Date(),
): Promise<PipelineHealthRow | null> {
  try {
    const rows = await readStore<PipelineHealthRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.checked_at.localeCompare(a.checked_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.checked_at);
    if (!Number.isFinite(age) || age >= HEALTH_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}
