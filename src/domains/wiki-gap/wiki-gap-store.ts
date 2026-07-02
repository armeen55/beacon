import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { BeatabilityResult } from "./beatability";

/**
 * wiki-gap-store (2026-07-02, master plan item 23) - persistence for the
 * beat-Wikipedia finder. The operator-triggered producer writes ONE row per
 * tenant (latest run wins); the New Pages board reads it at render for $0
 * (no live Wikipedia call ever fires on render). Mirrors keyword-gap-store.ts.
 */

const WIKI_GAP_STORE = "wiki-gap-results";
/** Matches the 30-day article-facts cache TTL - older runs are not shown. */
const WIKI_GAP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_STORED_GAPS = 50;

export type WikiGap = {
  articleTitle: string;
  /** Human-readable title (underscores replaced with spaces). */
  displayTitle: string;
  queryText: string | null;
  words: number | null;
  sections: number | null;
  lastRevisionAt: string | null;
  exists: boolean;
  demand: number | null;
} & BeatabilityResult;

export type StoredWikiGaps = {
  tenant_id: string;
  computed_at: string;
  /** How many distinct Wikipedia articles this run looked up. */
  articlesChecked: number;
  gaps: WikiGap[];
};

export type WikiGapStoreDeps = {
  readRows: () => Promise<StoredWikiGaps[]>;
  writeRows: (rows: StoredWikiGaps[]) => Promise<void>;
};

const defaultDeps: WikiGapStoreDeps = {
  readRows: () => readStore<StoredWikiGaps>(WIKI_GAP_STORE, []),
  writeRows: (rows) => writeStore(WIKI_GAP_STORE, rows),
};

/** Persist a run's results - one row per tenant, latest wins, gaps capped. */
export async function writeWikiGapResults(result: StoredWikiGaps, deps: Partial<WikiGapStoreDeps> = {}): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const rows = await d.readRows();
  const others = rows.filter((r) => r.tenant_id !== result.tenant_id);
  await d.writeRows([...others, { ...result, gaps: result.gaps.slice(0, MAX_STORED_GAPS) }]);
}

/** Latest fresh (<= 30d) wiki-gap run for the tenant, or null. Fail-soft -> null. */
export async function readWikiGapResults(
  tenantId: string,
  now: Date = new Date(),
  deps: Partial<WikiGapStoreDeps> = {},
): Promise<StoredWikiGaps | null> {
  const d = { ...defaultDeps, ...deps };
  try {
    const rows = await d.readRows();
    const mine = rows.filter((r) => r.tenant_id === tenantId).sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    if (now.getTime() - Date.parse(latest.computed_at) >= WIKI_GAP_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}
