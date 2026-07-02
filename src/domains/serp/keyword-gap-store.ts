import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { KeywordGap } from "./keyword-gaps";

/**
 * keyword-gap-store (2026-07-02, master plan item 16) - persistence for the
 * competitor keyword gap engine. The operator-triggered producer writes ONE row
 * per tenant (latest run wins); the New Pages board reads it at render for $0
 * (no live Labs call ever fires on render).
 *
 * GLOBAL json-store (rows carry tenant_id) following the ai-engine-gap-summary
 * precedent: the nightly precompute path calls buildNewPagesData with no ambient
 * request context, so per-tenant path routing would misfile the rows. Registered
 * in store-classification.ts (GLOBAL_STORES) + json-store.ts (Supabase-mirrored,
 * so hosted prod renders survive Vercel's read-only filesystem).
 */

const GAP_STORE = "keyword-gap-results";
/** Matches the 30-day Labs cache TTL - older gap runs are not shown (honest staleness). */
const GAP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Keep the persisted list lean - the board only ever surfaces a handful. */
const MAX_STORED_GAPS = 100;

export type StoredKeywordGaps = {
  tenant_id: string;
  computed_at: string;
  own_domain: string;
  /** The competitor domains this run checked. */
  competitors: string[];
  /** What the run actually spent (0 for cache-served re-runs). */
  spent_usd: number;
  gaps: KeywordGap[];
};

export type GapStoreDeps = {
  readRows: () => Promise<StoredKeywordGaps[]>;
  writeRows: (rows: StoredKeywordGaps[]) => Promise<void>;
};

const defaultDeps: GapStoreDeps = {
  readRows: () => readStore<StoredKeywordGaps>(GAP_STORE, []),
  writeRows: (rows) => writeStore(GAP_STORE, rows),
};

/** Persist a run's results - one row per tenant, latest wins, gaps capped. */
export async function writeKeywordGapResults(
  result: StoredKeywordGaps,
  deps: Partial<GapStoreDeps> = {},
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const rows = await d.readRows();
  const others = rows.filter((r) => r.tenant_id !== result.tenant_id);
  await d.writeRows([...others, { ...result, gaps: result.gaps.slice(0, MAX_STORED_GAPS) }]);
}

/** Latest fresh (<= 30d) gap run for the tenant, or null. Fail-soft -> null. */
export async function readKeywordGapResults(
  tenantId: string,
  now: Date = new Date(),
  deps: Partial<GapStoreDeps> = {},
): Promise<StoredKeywordGaps | null> {
  const d = { ...defaultDeps, ...deps };
  try {
    const rows = await d.readRows();
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    if (now.getTime() - Date.parse(latest.computed_at) >= GAP_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}
