/**
 * language-gap/language-gap-store (2026-07-02, master plan item 24) -
 * persistence for the language-gap matrix pass, so the Today Demand band and
 * the daily plan builder read the latest gaps at $0.
 *
 * Follows the trend-radar/spike-store + seasonal/seasonal-store sibling
 * pattern exactly: a GLOBAL json-store (rows carry tenant_id because the
 * nightly cron fans out across tenants with no ambient request context) that
 * is Supabase-mirrored so the write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { LanguageGap } from "./language-gaps";

const STORE = "language-gap-matrix";

/** A gap pass older than this is not shown anywhere (the underlying GSC
 *  demand shifts week to week; a month-stale "900 impressions" claim could
 *  already be wrong). */
const LANGUAGE_GAP_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type LanguageGapSummaryRow = {
  tenant_id: string;
  computed_at: string;
  /** How many distinct queries the pass classified (context for the
   *  "checked N queries" honesty line; 0 means GSC data was not ready). */
  queriesClassified: number;
  /** How many were Farsi script, Finglish, and English (for the ground-truth
   *  report + optional future surfacing; not required by any UI today). */
  farsiScriptCount: number;
  finglishCount: number;
  englishCount: number;
  gaps: LanguageGap[];
};

/** Persist the latest language-gap pass for a tenant (latest wins; other
 *  tenants untouched). An EMPTY gap list is written too: "checked, no gap"
 *  keeps computed_at fresh and is a different truth from "never checked". */
export async function writeLanguageGapSummary(row: LanguageGapSummaryRow): Promise<void> {
  const rows = await readStore<LanguageGapSummaryRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest language-gap pass for the tenant, or null when absent / older than
 *  14 days. Fail-soft -> null. */
export async function readLanguageGapSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<LanguageGapSummaryRow | null> {
  try {
    const rows = await readStore<LanguageGapSummaryRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= LANGUAGE_GAP_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for surfaces: this tenant's ranked language gaps, or [] when no
 *  fresh pass exists. */
export async function loadLanguageGaps(tenantId: string, now: Date = new Date()): Promise<LanguageGap[]> {
  const row = await readLanguageGapSummary(tenantId, now);
  return row?.gaps ?? [];
}
