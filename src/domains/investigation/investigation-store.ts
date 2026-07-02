/**
 * investigation-store (2026-07-02, master plan item 53) - persistence for
 * overnight forensic investigation diagnosis cards. Follows the
 * pipeline-health-store.ts / algorithm-weather-store.ts sibling pattern
 * exactly: a GLOBAL json-store (rows carry tenant_id because the nightly cron
 * fans out across tenants with no ambient request context) that is
 * Supabase-mirrored so the write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 *
 * Idempotency: one row per (tenant_id, family, week), keyed by `key` below -
 * run-investigation.ts checks readInvestigation before running so the same
 * family collapse never re-investigates twice inside the same week.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { InvestigationDiagnosis } from "./rank-causes";

const STORE = "forensic-investigations";

/** A diagnosis older than this is not shown anywhere - a month-old collapse
 *  card would be stale urgency, not a live signal. */
const INVESTIGATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type InvestigationRow = {
  tenant_id: string;
  /** Idempotency key: `${family}:${isoWeekStart(collapseDate)}`. */
  key: string;
  family: string;
  collapse_date: string;
  investigated_at: string;
  diagnosis: InvestigationDiagnosis;
};

/** ISO week start (Monday, UTC) for a YYYY-MM-DD date - the idempotency unit
 *  ("once per family per week"). PURE. */
export function isoWeekStart(dateIso: string): string {
  const d = new Date(`${dateIso.slice(0, 10)}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

/** PURE: the idempotency key for one family's investigation of a given
 *  collapse date. */
export function investigationKey(family: string, collapseDate: string): string {
  return `${family}:${isoWeekStart(collapseDate)}`;
}

/** Append (or replace) one investigation row for a tenant. Rows are keyed by
 *  (tenant_id, key) - re-running the same (family, week) overwrites rather
 *  than duplicating. */
export async function writeInvestigation(row: InvestigationRow): Promise<void> {
  const rows = await readStore<InvestigationRow>(STORE, []);
  const others = rows.filter((r) => !(r.tenant_id === row.tenant_id && r.key === row.key));
  await writeStore(STORE, [...others, row]);
}

/** Has this (tenant, family, week) already been investigated? Fail-soft ->
 *  false (never blocks a fresh investigation on a read error - the write's
 *  own dedupe-by-key keeps a re-run harmless, just wasted work). */
export async function hasRecentInvestigation(
  tenantId: string,
  family: string,
  collapseDate: string,
): Promise<boolean> {
  try {
    const rows = await readStore<InvestigationRow>(STORE, []);
    const key = investigationKey(family, collapseDate);
    return rows.some((r) => r.tenant_id === tenantId && r.key === key);
  } catch {
    return false;
  }
}

/** Every fresh (not stale) investigation for a tenant, newest first. Fail-soft
 *  -> []. */
export async function readInvestigationsForTenant(
  tenantId: string,
  now: Date = new Date(),
): Promise<InvestigationRow[]> {
  try {
    const rows = await readStore<InvestigationRow>(STORE, []);
    return rows
      .filter((r) => r.tenant_id === tenantId)
      .filter((r) => {
        const age = now.getTime() - Date.parse(r.investigated_at);
        return Number.isFinite(age) && age < INVESTIGATION_MAX_AGE_MS;
      })
      .sort((a, b) => b.investigated_at.localeCompare(a.investigated_at));
  } catch {
    return [];
  }
}

/** $0 read for the Today card: the most recent fresh investigations for a
 *  tenant, capped, or [] when none exist. */
export async function loadLatestInvestigations(
  tenantId: string,
  limit = 2,
  now: Date = new Date(),
): Promise<InvestigationRow[]> {
  const rows = await readInvestigationsForTenant(tenantId, now);
  return rows.slice(0, Math.max(0, limit));
}
